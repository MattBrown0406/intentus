import { readBoundedJson, fetchWithDeadline, limitErrorResponse } from "../_shared/request-limits.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { boundedArray, isUsablePlanRefresh, parseToolArguments, safeJsonStringify, truncate } from "../_shared/ai-guardrails.ts";
import { normalizePlanTier } from "../_shared/tier-policy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Types ─────────────────────────────────────────────────────────────────────

type RefreshedPhase = {
  phase_label: string;
  title: string;
  actions: string[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns 0 = phase 1 (days 1-30), 1 = phase 2 (days 31-60), 2 = phase 3 (days 61-90) */
function calcCompletedPhase(reportCreatedAt: string): number {
  const daysSince = Math.floor(
    (Date.now() - new Date(reportCreatedAt).getTime()) / (1000 * 60 * 60 * 24),
  );
  if (daysSince >= 60) return 2;
  if (daysSince >= 30) return 1;
  return 0;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function sanitizeRefreshedPhases(phases: unknown): RefreshedPhase[] {
  return boundedArray<unknown>(phases, 3).map((value, i) => {
    const p = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
    phase_label: truncate(p.phase_label, 80, `Phase ${i + 1}`),
    title: truncate(p.title, 160, ""),
    actions: boundedArray<unknown>(p.actions, 4).map((a) => truncate(a, 280)).filter(Boolean),
    };
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method !== "POST") return new Response(null, { status: 405, headers: corsHeaders });

  try {
    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY not configured");

    // ── Auth ───────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Anon client (RLS-scoped for reads + auth)
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await readBoundedJson(req, { allowEmpty: true });
    // Report.tsx sends the report it is displaying; refresh exactly that one.
    const requestedReportId = body.reportId ?? body.report_id;
    if (
      requestedReportId !== undefined &&
      (typeof requestedReportId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedReportId))
    ) {
      return new Response(JSON.stringify({ error: "Invalid reportId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role client for the UPDATE write
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // ── Tier check (premium or coach only) ────────────────────────────────
    const { data: profileRow } = await anonClient
      .from("profiles")
      .select("display_name, coaching_tone, plan_tier")
      .eq("user_id", user.id)
      .single();

    const planTier = normalizePlanTier(profileRow?.plan_tier);
    if (planTier !== "premium" && planTier !== "coach") {
      return new Response(
        JSON.stringify({
          error:
            "Plan refresh is available on Premium and Coach tiers only. Upgrade to access this feature.",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const name = profileRow?.display_name || "there";
    const tone = profileRow?.coaching_tone || "balanced";

    // ── Load data in parallel ─────────────────────────────────────────────
    const [reportRes, checkInsRes, commitmentsRes] = await Promise.all([
      (() => {
        let query = anonClient
          .from("strategic_reports")
          .select(
            "id, north_star_focus, ninety_day_plan, pattern_analysis, forced_choice, intent_model, created_at",
          )
          .eq("user_id", user.id);
        if (requestedReportId) query = query.eq("id", requestedReportId);
        return query.order("created_at", { ascending: false }).limit(1).maybeSingle();
      })(),

      anonClient
        .from("check_ins")
        .select(
          "mood_score, energy_score, wins, blockers, commitments, extras, drift_detected, created_at",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(12),

      anonClient
        .from("weekly_commitments")
        .select("commitment, outcome")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(8),
    ]);

    if (reportRes.error) throw new Error("Failed to load strategic report");
    const report = reportRes.data;
    if (!report) {
      return new Response(
        JSON.stringify({ error: "No strategic report found. Complete a baseline audit first." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const checkIns = checkInsRes.data || [];
    const commitments = commitmentsRes.data || [];

    // ── Calculate metrics ─────────────────────────────────────────────────
    const completedPhase = calcCompletedPhase(report.created_at);

    // Follow-through rate: outcome = 'yes' counts fully, 'partially' counts 0.5
    const commitmentsWithOutcome = commitments.filter((c) => c.outcome !== null);
    let followThroughRate: number | null = null;
    let followThroughLabel = "insufficient data";
    if (commitmentsWithOutcome.length >= 2) {
      const yes = commitmentsWithOutcome.filter((c) => c.outcome === "yes").length;
      const partial = commitmentsWithOutcome.filter((c) => c.outcome === "partially").length;
      followThroughRate = (yes + partial * 0.5) / commitmentsWithOutcome.length;
      if (followThroughRate >= 0.8) followThroughLabel = "high follow-through (completing most commitments)";
      else if (followThroughRate >= 0.6) followThroughLabel = "moderate follow-through (more often than not)";
      else if (followThroughRate >= 0.4) followThroughLabel = "inconsistent follow-through (starting strong, rarely finishing)";
      else followThroughLabel = "low follow-through (commitments consistently not completed)";
    }

    // Drift rate
    const driftRate = checkIns.length > 0
      ? checkIns.filter((c) => c.drift_detected).length / checkIns.length
      : 0;

    // Avg mood and energy from last 4 check-ins
    const last4 = checkIns.slice(0, 4);
    const avgMood = avg(last4.filter((c) => c.mood_score != null).map((c) => c.mood_score));
    const avgEnergy = avg(last4.filter((c) => c.energy_score != null).map((c) => c.energy_score));

    // Recurring wins and blockers across all 12 check-ins
    const allWins: string[] = checkIns.flatMap((c) =>
      boundedArray<string>(c.wins, 4).map((w) => truncate(w, 200))
    ).filter(Boolean);
    const allBlockers: string[] = checkIns.flatMap((c) =>
      boundedArray<string>(c.blockers, 4).map((b) => truncate(b, 200))
    ).filter(Boolean);

    // ── Build phase labels ────────────────────────────────────────────────
    const phaseLabels = ["Days 1-30", "Days 31-60", "Days 61-90"];
    const phaseStatuses = phaseLabels.map((label, i) => {
      if (i < completedPhase) return `${label}: COMPLETED`;
      if (i === completedPhase) return `${label}: IN PROGRESS (current)`;
      return `${label}: NOT YET STARTED`;
    });

    // ── Build system prompt ───────────────────────────────────────────────
    const originalPlan = safeJsonStringify(report.ninety_day_plan, 3000);
    const patternSummary = safeJsonStringify(report.pattern_analysis, 2000);

    const systemPrompt = `You are Intentus, a precision AI operating coach. You are refreshing ${name}'s 90-day execution plan based on real check-in data gathered since their original strategic report.

Tone: ${tone}. Doctrine: direct because outcomes matter, warm because the person matters.

--- ORIGINAL NORTH STAR FOCUS ---
${truncate(report.north_star_focus, 400)}

--- ORIGINAL FORCED CHOICE ---
${truncate(report.forced_choice, 500)}

--- ORIGINAL 90-DAY PLAN ---
${originalPlan}

--- ORIGINAL PATTERN ANALYSIS ---
${patternSummary}

--- PHASE STATUS (based on ${Math.floor((Date.now() - new Date(report.created_at).getTime()) / (1000 * 60 * 60 * 24))} days since report) ---
${phaseStatuses.join("\n")}

--- CHECK-IN TRENDS (last ${checkIns.length} check-ins) ---
Drift rate: ${(driftRate * 100).toFixed(0)}% of check-ins flagged drift
Average mood (last 4): ${avgMood > 0 ? avgMood.toFixed(1) : "no data"}
Average energy (last 4): ${avgEnergy > 0 ? avgEnergy.toFixed(1) : "no data"}
Recurring wins: ${allWins.slice(0, 10).join("; ") || "none recorded"}
Recurring blockers: ${allBlockers.slice(0, 10).join("; ") || "none recorded"}

--- COMMITMENT FOLLOW-THROUGH ---
${followThroughRate !== null ? `Rate: ${(followThroughRate * 100).toFixed(0)}% — ${followThroughLabel}` : "Insufficient data"}

--- REFRESH INSTRUCTIONS ---
You must call the tool refresh_ninety_day_plan with exactly 3 phases covering Days 1-30, Days 31-60, and Days 61-90.

Rules:
1. The north_star_focus is LOCKED. Do not change it. Every refreshed action must serve it directly.
2. For COMPLETED phases (marked COMPLETED above): write phase_label as the original days range, title as a brief "Done: [original title]" summary, and actions as a 1-2 item summary of what was accomplished or attempted. Keep it short — this is a record, not coaching.
3. For the IN PROGRESS phase: keep the title directionally the same but tighten actions based on what the check-in data shows is actually working or stuck. Reference the real wins and blockers. Be specific — no generic advice.
4. For NOT YET STARTED phases: refresh actions to reflect the actual capability, energy, and momentum visible in the check-in data. If drift is high (>40%), simplify — fewer actions, higher accountability stakes. If follow-through is low, name the pattern and build in the correction.
5. Each phase must have 2-4 actions maximum. No vague language. No participation-trophy framing.
6. Be realistic. The actions must be achievable given the evidence of this person's actual operating rhythm.`;

    const userPrompt =
      "Refresh my 90-day plan based on my check-in history and the phase I'm currently in.";

    // ── Call AI ───────────────────────────────────────────────────────────
    const aiResponse = await fetchWithDeadline("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GOOGLE_AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "refresh_ninety_day_plan",
              description:
                "Return a refreshed 90-day plan with 3 phases based on check-in history and current phase progress.",
              parameters: {
                type: "object",
                properties: {
                  phases: {
                    type: "array",
                    minItems: 3,
                    maxItems: 3,
                    items: {
                      type: "object",
                      properties: {
                        phase_label: {
                          type: "string",
                          description:
                            "The day range label, e.g. 'Days 1-30', 'Days 31-60', 'Days 61-90'",
                        },
                        title: {
                          type: "string",
                          description:
                            "A concise phase title (max ~12 words). For completed phases, prefix with 'Done: '",
                        },
                        actions: {
                          type: "array",
                          minItems: 1,
                          maxItems: 4,
                          items: { type: "string" },
                          description:
                            "2-4 specific, actionable items grounded in the user's actual check-in data",
                        },
                      },
                      required: ["phase_label", "title", "actions"],
                    },
                  },
                },
                required: ["phases"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "refresh_ninety_day_plan" } },
        temperature: 0.25,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("AI gateway error:", aiResponse.status);
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call returned by AI");

    const parsed = parseToolArguments(toolCall.function.arguments);
    const refreshedPhases = sanitizeRefreshedPhases(parsed.phases);

    // An empty phase would overwrite the user's edited plan with nothing.
    if (!isUsablePlanRefresh(refreshedPhases)) {
      throw new Error("AI plan refresh output incomplete");
    }

    // ── Persist to DB ─────────────────────────────────────────────────────
    const { data: saved, error: updateError } = await serviceClient
      .from("strategic_reports")
      .update({
        // Same shape Report.tsx reads and writes: a bare array of phases.
        edited_ninety_day_plan: refreshedPhases,
        last_edited_at: new Date().toISOString(),
        last_edited_by: user.id,
      })
      .eq("id", report.id)
      .eq("user_id", user.id)
      .select("id");

    if (updateError || saved?.length !== 1) {
      console.error("DB update failed");
      throw new Error("Failed to save refreshed plan");
    }

    // ── Return ────────────────────────────────────────────────────────────
    return new Response(
      JSON.stringify({
        success: true,
        refreshed_plan: refreshedPhases,
        completed_phase: completedPhase,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const limited = limitErrorResponse(e, corsHeaders);
    if (limited) return limited;
    console.error("refresh-plan request failed:", e);
    return new Response(
      JSON.stringify({ error: "Plan refresh failed. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
