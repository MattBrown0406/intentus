import { readBoundedJson, validateAiInput, fetchWithDeadline, limitErrorResponse } from "../_shared/request-limits.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildIntentProfileSummary } from "../_shared/intentus-knowledge.ts";
import { COACHING_SAFETY_BOUNDARY, boundedArray, boundedTail, editedPlanPhases, safeJsonStringify, truncate } from "../_shared/ai-guardrails.ts";
import { buildTierPolicyPrompt, canUseAiChat, canUseAiDebrief, normalizePlanTier } from "../_shared/tier-policy.ts";
import { chatMode } from "../_shared/payment-security.ts";
import { buildPronounDirective } from "../_shared/pronouns.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type PlanPhase = {
  phase?: string | number;
  title?: string;
  days?: string;
  actions?: string[];
};

type NinetyDayPlan = {
  phases?: PlanPhase[];
  phase_1?: PlanPhase;
  phase_2?: PlanPhase;
  phase_3?: PlanPhase;
};

function getPlanPhases(plan: NinetyDayPlan) {
  if (Array.isArray(plan.phases)) return plan.phases;
  const phases = [plan.phase_1, plan.phase_2, plan.phase_3].filter(Boolean) as PlanPhase[];
  return phases.map((phase, index) => ({
    phase: index + 1,
    title: phase.title,
    days: index === 0 ? "Days 1-30" : index === 1 ? "Days 31-60" : "Days 61-90",
    actions: Array.isArray(phase.actions) ? phase.actions : [],
  }));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method !== "POST") return new Response(null, { status: 405, headers: corsHeaders });

  try {
    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const requestBody = await readBoundedJson(req);
    validateAiInput("coaching-chat", requestBody);
    const { messages, mode: requestedMode } = requestBody;
    const mode = chatMode(requestedMode);
    if (!mode) return new Response(JSON.stringify({ error: "Invalid mode" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    // mode: "check-in-debrief" or "chat"

    // Gather user context
    const [profileRes, checkInsRes, auditRes, reportRes, weeklyCommitmentsRes, goalsRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", user.id).single(),
      supabase.from("check_ins").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10),
      supabase.from("baseline_audits").select("responses, scores, status").eq("user_id", user.id).eq("status", "completed").limit(1),
      supabase.from("strategic_reports").select("north_star_focus, forced_choice, contradictions, pattern_analysis, ninety_day_plan, edited_ninety_day_plan, intent_model, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1),
      // Fetch last 8 weekly_commitments for follow-through context
      supabase.from("weekly_commitments").select("commitment, outcome, week_start").eq("user_id", user.id).order("week_start", { ascending: false }).limit(9),
      supabase.from("north_star_goals").select("horizon, title, why, success_looks_like").eq("user_id", user.id).eq("is_active", true).order("horizon"),
    ]);

    const profile = profileRes.data;
    const checkIns = checkInsRes.data || [];
    const audit = auditRes.data?.[0];
    const report = reportRes.data?.[0];
    const allCommitments = weeklyCommitmentsRes.data || [];
    const goals = goalsRes.data || [];
    const planTier = normalizePlanTier(profile?.plan_tier);

    if (mode === "chat" && !canUseAiChat(planTier)) {
      return new Response(JSON.stringify({
        error: "The ongoing AI Operating Coach is available on Executive and above. Starter includes the audit snapshot and weekly accountability tracking.",
      }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "check-in-debrief" && !canUseAiDebrief(planTier)) {
      return new Response(JSON.stringify({
        error: "AI check-in debriefs are available on Executive and above.",
      }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Build commitment context ──────────────────────────────────────────
    // Determine current week Monday
    const todayMs = Date.now();
    const todayDate = new Date(todayMs);
    const dayOfWeek = todayDate.getDay(); // 0=Sun
    const daysToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const mondayDate = new Date(todayDate);
    mondayDate.setDate(todayDate.getDate() + daysToMon);
    const thisWeekStart = mondayDate.toISOString().split("T")[0];

    const currentWeekCommitment = allCommitments.find(c => c.week_start === thisWeekStart) || null;
    const previousCommitments = allCommitments.filter(c => c.week_start < thisWeekStart);
    const previousCommitmentOutcome = previousCommitments[0]?.outcome || null;

    // Follow-through rate (exclude current week, last 8 previous)
    const prevWithOutcome = previousCommitments.filter(c => c.outcome !== null);
    let followThroughRate: number | null = null;
    let followThroughPattern: string | null = null;
    if (prevWithOutcome.length >= 3) {
      const yes = prevWithOutcome.filter(c => c.outcome === "yes").length;
      const partial = prevWithOutcome.filter(c => c.outcome === "partially").length;
      followThroughRate = (yes + partial * 0.5) / prevWithOutcome.length;
      if (followThroughRate >= 0.8) followThroughPattern = "You complete most of what you commit to";
      else if (followThroughRate >= 0.6) followThroughPattern = "You follow through more often than not";
      else if (followThroughRate >= 0.4) followThroughPattern = "You consistently start strong but rarely finish";
      else followThroughPattern = "Your commitments are consistently not being completed";
    }

    // 90-day plan current phase
    let currentPlanPhase: string | null = null;
    let currentPlanActions: string[] = [];
    const editedPhases = editedPlanPhases(report?.edited_ninety_day_plan);
    if (report && (report.ninety_day_plan || editedPhases)) {
      const reportCreated = new Date(report.created_at || todayMs);
      const daysSinceReport = Math.floor((todayMs - reportCreated.getTime()) / (1000 * 60 * 60 * 24));
      const phases = editedPhases ?? getPlanPhases(report.ninety_day_plan as NinetyDayPlan);
      if (Array.isArray(phases) && phases.length > 0) {
        let targetPhase = phases[0];
        if (daysSinceReport >= 60 && phases.length >= 3) targetPhase = phases[2];
        else if (daysSinceReport >= 30 && phases.length >= 2) targetPhase = phases[1];
        currentPlanPhase = targetPhase?.phase ? `Phase ${targetPhase.phase}${targetPhase.title ? ` — ${targetPhase.title}` : ""}${targetPhase.days ? ` (${targetPhase.days})` : ""}` : null;
        currentPlanActions = Array.isArray(targetPhase?.actions) ? targetPhase.actions : [];
      }
    }
    const tone = profile?.coaching_tone || "balanced";
    const name = profile?.display_name || "there";
    const pronounDirective = buildPronounDirective(profile?.gender);

    // Build rich context
    let userContext = `User: ${name}\nCoaching tone preference: ${tone}\n\n`;

    // Append commitment context block
    userContext += `--- COMMITMENT TRACKING ---\n`;
    userContext += `Current week's "one thing": ${currentWeekCommitment?.commitment ?? "not yet set"}\n`;
    userContext += `Previous week outcome: ${previousCommitmentOutcome ?? "no data"}\n`;
    userContext += `Follow-through rate (last 8 weeks): ${followThroughRate !== null ? `${(followThroughRate * 100).toFixed(0)}% — ${followThroughPattern}` : "insufficient data"}\n`;
    if (currentPlanPhase) {
      userContext += `\n90-DAY PLAN — CURRENT PHASE: ${currentPlanPhase}\n`;
      if (currentPlanActions.length > 0) {
        userContext += `Current phase actions:\n`;
        for (const action of currentPlanActions) userContext += `  - ${action}\n`;
      }
    }
    userContext += "\n";

    const intentSummary = buildIntentProfileSummary(profile?.intent_profile || null);
    userContext += `${intentSummary}\n\n`;
    userContext += `${buildTierPolicyPrompt(planTier)}\n\n`;

    if (report) {
      userContext += `--- STRATEGIC REPORT ---\n`;
      if (report.north_star_focus) userContext += `Operating Focus: ${report.north_star_focus}\n`;
      if (report.forced_choice) userContext += `Forced Choice: ${report.forced_choice}\n`;
      if (report.contradictions) userContext += `Key Contradictions: ${safeJsonStringify(report.contradictions, 2500)}\n`;
      if (report.pattern_analysis) userContext += `Patterns: ${safeJsonStringify(report.pattern_analysis, 3000)}\n`;
      if (editedPhases) userContext += `90-Day Plan (current, as edited/refreshed by the user): ${safeJsonStringify(editedPhases, 3000)}\n`;
      else if (report.ninety_day_plan) userContext += `90-Day Plan: ${safeJsonStringify(report.ninety_day_plan, 3000)}\n`;
      
      userContext += "\n";
    }

    if (goals.length > 0) {
      userContext += `North Star Goals:\n`;
      for (const g of goals) {
        const horizonLabel = g.horizon === '1_year' ? '1 Year' : g.horizon === '3_year' ? '3 Years' : '5 Years';
        userContext += `- ${horizonLabel}: ${g.title}${g.why ? ` — Why: ${g.why}` : ''}${g.success_looks_like ? ` — Success: ${g.success_looks_like}` : ''}\n`;
      }
      userContext += `\n`;
    }

    if (checkIns.length > 0) {
      userContext += `--- RECENT CHECK-INS (last ${checkIns.length}) ---\n`;
      for (const ci of checkIns.slice(0, 5)) {
        userContext += `${ci.created_at}: Mood=${ci.mood_score}, Energy=${ci.energy_score}`;
        if (ci.drift_detected) userContext += " [DRIFT DETECTED]";
        if (ci.wins?.length) userContext += `, Wins: ${boundedArray<string>(ci.wins, 4).map((item) => truncate(item, 220)).join("; ")}`;
        if (ci.blockers?.length) userContext += `, Blockers: ${boundedArray<string>(ci.blockers, 4).map((item) => truncate(item, 220)).join("; ")}`;
        if (ci.commitments?.length) userContext += `, Commitments: ${boundedArray<string>(ci.commitments, 4).map((item) => truncate(item, 220)).join("; ")}`;
        if (ci.extras && typeof ci.extras === "object" && Object.keys(ci.extras).length > 0) {
          const extrasStr = Object.entries(ci.extras)
            .slice(0, 8)
            .map(([k, v]) => `${k}=${typeof v === "string" ? `"${truncate(v, 260)}"` : safeJsonStringify(v, 260)}`)
            .join("; ");
          userContext += `, Extras: ${extrasStr}`;
        }
        userContext += "\n";
      }

      // Latest non-empty value for each extras key (so the coach always has the freshest signal)
      const latestExtras: Record<string, { value: unknown; created_at: string }> = {};
      for (const ci of checkIns) {
        if (!ci.extras || typeof ci.extras !== "object") continue;
        for (const [k, v] of Object.entries(ci.extras)) {
          if (v === null || v === undefined || v === "") continue;
          if (!latestExtras[k]) latestExtras[k] = { value: v, created_at: ci.created_at };
        }
      }
      if (Object.keys(latestExtras).length > 0) {
        userContext += `\nLatest signal per question:\n`;
        for (const [k, info] of Object.entries(latestExtras)) {
          userContext += `  • ${k} (${info.created_at}): ${typeof info.value === "string" ? `"${truncate(info.value, 300)}"` : safeJsonStringify(info.value, 300)}\n`;
        }
      }

      // Trend analysis
      const moods = checkIns.filter(c => c.mood_score).map(c => c.mood_score);
      const energies = checkIns.filter(c => c.energy_score).map(c => c.energy_score);
      if (moods.length >= 2) {
        const moodTrend = moods[0] - moods[moods.length - 1];
        userContext += `Mood trend: ${moodTrend > 0 ? "improving" : moodTrend < 0 ? "declining" : "stable"} (latest: ${moods[0]}, avg: ${(moods.reduce((a, b) => a + b, 0) / moods.length).toFixed(1)})\n`;
      }
      if (energies.length >= 2) {
        const energyTrend = energies[0] - energies[energies.length - 1];
        userContext += `Energy trend: ${energyTrend > 0 ? "improving" : energyTrend < 0 ? "declining" : "stable"} (latest: ${energies[0]}, avg: ${(energies.reduce((a, b) => a + b, 0) / energies.length).toFixed(1)})\n`;
      }
      const driftRate = checkIns.filter(c => c.drift_detected).length / checkIns.length;
      userContext += `Drift rate: ${(driftRate * 100).toFixed(0)}% of recent check-ins\n`;
    }

    let systemPrompt = "";

    if (mode === "check-in-debrief") {
      systemPrompt = `You are Intentus, an AI operating coach for executives, business owners, and aspiring leaders. You are providing a debrief after ${name}'s check-in. Your tone setting is ${tone}, but your doctrine stays constant: direct because the outcome matters, warm because the person matters.${pronounDirective ? `\n${pronounDirective}` : ""}

${userContext}

${COACHING_SAFETY_BOUNDARY}

COMMITMENT CONTEXT GUIDANCE:
- If follow-through rate is below 50%: this IS the coaching conversation. Name the pattern directly.
- If previous outcome was "no": open with curiosity about what happened, not judgment
- If previous outcome was "partially": explore what stopped full completion
- Reference the 90-day plan actions when they are relevant to the conversation
- Never show follow-through rate as a number to the user — translate it using the pattern language already provided
- If current week commitment is not yet set, prompt them to set it before ending the conversation

TREND LANGUAGE RULES:
- Never show mood/energy as numbers or averages in your response
- Instead translate trends into language:
  * 3+ weeks declining: "Your energy has been quietly declining for a few weeks now. Not dramatically — but consistently."
  * Flat/stable: "You've been steady — neither losing ground nor gaining it."
  * Improving: "There's been a real shift in your energy over the last few weeks."
- Always follow a trend observation with a question, never a conclusion
- The goal is for the user to feel seen, not measured

Based on this check-in and their history, provide a personalized coaching debrief:

1. **Pattern Recognition**: What trends do you see across their recent check-ins? Is mood/energy improving or declining?
2. **Alignment Check**: Are their wins and commitments aligned with their operating focus and 90-day plan?
3. **Drift Analysis**: If drift was detected, what might be causing it? Reference specific data.
4. **Actionable Insight**: Give ONE specific, actionable piece of advice for the next 24 hours.
5. **Accountability**: Reference their previous commitments — did their wins reflect follow-through?

Coaching sequence to reflect:
- identify strengths briefly
- identify weaknesses clearly
- reveal blind spots without flinching
- reinforce the current priority and decisive next action
- correct drift, vague language, rationalization, pat answers, or self-protection when present
- let the active lens shape the emphasis: execution, decision quality, blind spots, business value, or responsibility/meaning

Participation standard:
- if the check-in reads thin, rushed, vague, or guarded, call that out directly and tell them to come back more honestly next time

Keep it concise (4-6 sentences). Be direct, human, and specific. Use their actual data. No headers or bullet points in the final answer. End with a refocusing line that pushes decisiveness.`;
    } else {
      systemPrompt = `You are Intentus, an AI operating coach for executives, business owners, and aspiring leaders. You are having an ongoing conversation with ${name}. Your tone setting is ${tone}, but the doctrine stays constant: direct because the outcome matters, warm because the person matters.${pronounDirective ? `\n${pronounDirective}` : ""}

${userContext}

${COACHING_SAFETY_BOUNDARY}

COMMITMENT COACHING GUIDANCE:
- If follow-through rate is below 50%: this IS the coaching conversation. Name the pattern directly.
- If previous outcome was "no": open with curiosity about what happened, not judgment
- If previous outcome was "partially": explore what stopped full completion
- Reference the 90-day plan actions when they are relevant to the conversation
- Never show follow-through rate as a number — translate it: "You complete most of what you commit to" or "You consistently start strong but rarely finish" etc.
- If current week commitment is not yet set, prompt them to set it before ending the conversation

You have full access to their baseline audit data, strategic report, and check-in history. Use this data to provide deeply personalized coaching.

Your approach:
- Reference their specific data, scores, patterns, and stated goals
- Connect current concerns back to their operating focus, current priority, and 90-day plan
- Identify strengths briefly, weaknesses clearly, and blind spots fearlessly without becoming harsh
- Point out contradictions between what they say they want and what their data shows
- Detect drift, vague language, rationalization, self-protection, and softened priorities for comfort
- Give actionable, specific advice — never generic platitudes
- Ask for decisiveness and agreement when priorities or actions need to be set
- Encourage reflective listening or reading when the same harmful pattern keeps repeating

Core philosophy:
- operating system first
- discipline over motivation
- accountability only matters once clear structure exists
- drift is the enemy

Knowledge architecture guidance:
- keep the six core anchors available at all times: James Clear, Stephen Covey, Marshall Goldsmith, Annie Duke, Peter Drucker, Carl Rogers
- weight the response toward the active adaptive lens from the profile/report intent model
- use Jordan Peterson, Viktor Frankl, Gabor Maté, Jung, Dalio, or Naval only as subtle background framing when the pattern clearly calls for it
- never name-drop authors unless the user explicitly asks where the framing comes from

You are not a therapist. You are a grounded, emotionally intelligent operating coach.
Keep responses focused and conversational. Do not lecture. Do not be permissive.`;
    }

    // Keep the NEWEST turns: the client sends oldest-first history, so a head
    // slice would drop the user's latest message from long conversations.
    const safeMessages = boundedTail<{ role?: string; content?: string }>(messages, 16)
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: truncate(message.content, 1800),
      }));

    const aiMessages = [
      { role: "system", content: systemPrompt },
      ...safeMessages,
    ];

    if (mode === "check-in-debrief" && (!messages || messages.length === 0)) {
      aiMessages.push({ role: "user", content: "I just completed my check-in. Give me your coaching debrief." });
    }

    const aiResponse = await fetchWithDeadline("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GOOGLE_AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: aiMessages,
        stream: true,
        temperature: mode === "check-in-debrief" ? 0.3 : 0.4,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("AI gateway error:", aiResponse.status);
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    return new Response(aiResponse.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    const limited = limitErrorResponse(e, corsHeaders);
    if (limited) return limited;
    console.error("coaching-chat request failed:", e);
    return new Response(JSON.stringify({ error: "Coaching is temporarily unavailable. Please try again." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
