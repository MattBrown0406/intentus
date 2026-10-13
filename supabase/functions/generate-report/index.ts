import { readBoundedJson, validateAiInput, fetchWithDeadline, limitErrorResponse } from "../_shared/request-limits.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildIntentModelInstructions, buildIntentProfileSummary } from "../_shared/intentus-knowledge.ts";
import {
  COACHING_SAFETY_BOUNDARY,
  boundedArray,
  isUsableStrategicReport,
  parseToolArguments,
  truncate,
} from "../_shared/ai-guardrails.ts";
import { buildReportDepthPrompt, buildTierPolicyPrompt, normalizePlanTier } from "../_shared/tier-policy.ts";
import { buildPronounDirective } from "../_shared/pronouns.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_LENSES = new Set([
  "discipline_execution",
  "decision_making",
  "self_awareness",
  "business_value",
  "responsibility_meaning",
]);

function stringList(value: unknown, maxItems: number, maxLength: number) {
  return boundedArray<unknown>(value, maxItems)
    .map((item) => truncate(item, maxLength))
    .filter(Boolean);
}

function sanitizePhase(value: unknown, fallbackTitle: string) {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    title: truncate(raw.title, 140, fallbackTitle),
    actions: stringList(raw.actions, 4, 220),
  };
}

function sanitizeStrategicReport(input: Record<string, unknown>) {
  const pattern = input.pattern_analysis && typeof input.pattern_analysis === "object"
    ? input.pattern_analysis as Record<string, unknown>
    : {};
  const plan = input.ninety_day_plan && typeof input.ninety_day_plan === "object"
    ? input.ninety_day_plan as Record<string, unknown>
    : {};
  const intentModel = input.intent_model && typeof input.intent_model === "object"
    ? input.intent_model as Record<string, unknown>
    : {};
  const primaryLens = truncate(intentModel.primary_lens, 80, "discipline_execution");
  const secondaryLens = truncate(intentModel.secondary_lens, 80, "self_awareness");

  return {
    pattern_analysis: {
      themes: boundedArray<Record<string, unknown>>(pattern.themes, 5).map((theme) => ({
        title: truncate(theme.title, 140, "Operating pattern"),
        description: truncate(theme.description, 900),
        areas_affected: stringList(theme.areas_affected, 6, 80),
      })),
      strengths: stringList(pattern.strengths, 6, 260),
      blind_spots: stringList(pattern.blind_spots, 6, 260),
    },
    contradictions: boundedArray<Record<string, unknown>>(input.contradictions, 5).map((item) => ({
      stated: truncate(item.stated, 400),
      actual: truncate(item.actual, 400),
      impact: truncate(item.impact, 500),
    })),
    forced_choice: truncate(input.forced_choice, 800),
    north_star_focus: truncate(input.north_star_focus, 300),
    ninety_day_plan: {
      phase_1: sanitizePhase(plan.phase_1, "Stabilize the operating rhythm"),
      phase_2: sanitizePhase(plan.phase_2, "Build consistency under pressure"),
      phase_3: sanitizePhase(plan.phase_3, "Raise the standard and sustain it"),
    },
    intent_model: {
      primary_lens: VALID_LENSES.has(primaryLens) ? primaryLens : "discipline_execution",
      secondary_lens: VALID_LENSES.has(secondaryLens) ? secondaryLens : "self_awareness",
      lens_rationale: truncate(intentModel.lens_rationale, 700),
      anchor_emphasis: boundedArray<Record<string, unknown>>(intentModel.anchor_emphasis, 4).map((anchor) => ({
        name: truncate(anchor.name, 80),
        reason: truncate(anchor.reason, 260),
      })),
      background_threads: stringList(intentModel.background_threads, 3, 120),
      coaching_posture: truncate(intentModel.coaching_posture, 240),
      report_framing: truncate(intentModel.report_framing, 240),
    },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method !== "POST") return new Response(null, { status: 405, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from JWT
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    ).auth.getUser(token);
    if (userError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const requestBody = await readBoundedJson(req);
    validateAiInput("generate-report", requestBody);
    const { audit_id } = requestBody;
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    // Get audit data
    const { data: audit, error: auditError } = await supabase
      .from("baseline_audits")
      .select("*")
      .eq("id", audit_id)
      .eq("user_id", user.id)
      .single();

    if (auditError || !audit) return reply({ error: "Audit not found" }, 404);
    if (audit.status !== "completed") return reply({ error: "Audit not completed" }, 409);

    // Check if report already exists
    const { data: existing } = await supabase
      .from("strategic_reports")
      .select("id")
      .eq("audit_id", audit_id)
      .eq("user_id", user.id)
      .limit(1);

    if (existing && existing.length > 0) {
      return new Response(JSON.stringify({ report_id: existing[0].id, already_exists: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get profile for coaching tone + adaptive lens choices
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, coaching_tone, intent_profile, plan_tier, gender")
      .eq("user_id", user.id)
      .single();

    // Build prompt from audit responses
    const responses = audit.responses as Record<string, string>;
    const sections = [
      { name: "Alignment & Trust", keys: ["p1", "p2", "r1", "r2", "te1", "te2"] },
      { name: "Reality Check", keys: ["te3", "te4", "mb1", "mb2", "h1", "h2"] },
      { name: "Blind Spots & Friction", keys: ["r3", "r4", "e1", "e2", "p3", "p4"] },
      { name: "Priority & Commitment", keys: ["mb3", "mb4", "e3", "e4", "h3", "h4"] },
    ];

    let auditSummary = "";
    for (const section of sections) {
      auditSummary += `\n## ${section.name}\n`;
      for (const key of section.keys) {
        if (responses[key]) auditSummary += `- ${truncate(responses[key], 1500)}\n`;
      }
    }

    const tone = profile?.coaching_tone || "balanced";
    const name = profile?.display_name || "there";
    const planTier = normalizePlanTier(profile?.plan_tier);
    const intentSummary = buildIntentProfileSummary(profile?.intent_profile || null);
    const intentModelInstructions = buildIntentModelInstructions();
    const pronounDirective = buildPronounDirective(profile?.gender);

    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY not configured");

    const systemPrompt = `You are Intentus, an AI operating coach for executives, business owners, and aspiring leaders. Your tone setting is ${tone}. You are generating a Strategic Report for ${name} based on their baseline audit responses.${pronounDirective ? `\n${pronounDirective}` : ""}

Doctrine:
- operating system first
- discipline over motivation
- accountability only matters once clear structure exists
- drift is the enemy
- direct because the outcome matters; warm because the person matters

You must return a JSON object using the tool provided.

Analyze the responses deeply. The audit was intentionally sequenced to move from alignment and trust, to current reality, to blind-spot depth, to prioritization. Use that progression in your report logic:
1. identify what the user is sincerely trying to protect, build, or honor
2. identify the reality gaps between that intent and how they are currently operating
3. reveal blind spots and contradictions fearlessly without sounding cruel
4. create a prioritized action path that demands agreement rather than vague aspiration
5. set up check-in-ready actions that make drift obvious

Look for:
1. Pattern Analysis: recurring themes across all 6 life areas
2. Contradictions: where their stated values conflict with their actions
3. A Forced Choice: the single most important decision, tradeoff, or truth they are avoiding
4. Operating Focus: one decisive sentence capturing the singular intent they should orient their next 90 days around
5. 90-Day Plan: 3 phases (30/60/90 days) with 2-3 specific actions each

Rules:
- reference their actual words whenever possible
- no generic advice, no participation-trophy language, no victim framing
- show compassion for circumstance without surrendering standards
- if they are hiding inside complexity, call for simplification and prioritization
- use follow-up answers to disambiguate vague claims and weigh how self-aware they really are

${intentSummary}

${buildTierPolicyPrompt(planTier)}

${buildReportDepthPrompt(planTier)}

${COACHING_SAFETY_BOUNDARY}

${intentModelInstructions}`;

    const userPrompt = `Here are the baseline audit responses:\n${auditSummary}\n\nGenerate the strategic report.`;

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
              name: "create_strategic_report",
              description: "Create a strategic report based on audit analysis",
              parameters: {
                type: "object",
                properties: {
                  pattern_analysis: {
                    type: "object",
                    properties: {
                      themes: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            title: { type: "string" },
                            description: { type: "string" },
                            areas_affected: { type: "array", items: { type: "string" } },
                          },
                          required: ["title", "description", "areas_affected"],
                        },
                      },
                      strengths: { type: "array", items: { type: "string" } },
                      blind_spots: { type: "array", items: { type: "string" } },
                    },
                    required: ["themes", "strengths", "blind_spots"],
                  },
                  contradictions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        stated: { type: "string" },
                        actual: { type: "string" },
                        impact: { type: "string" },
                      },
                      required: ["stated", "actual", "impact"],
                    },
                  },
                  forced_choice: { type: "string" },
                  north_star_focus: { type: "string" },
                  ninety_day_plan: {
                    type: "object",
                    properties: {
                      phase_1: {
                        type: "object",
                        properties: {
                          title: { type: "string" },
                          actions: { type: "array", items: { type: "string" } },
                        },
                        required: ["title", "actions"],
                      },
                      phase_2: {
                        type: "object",
                        properties: {
                          title: { type: "string" },
                          actions: { type: "array", items: { type: "string" } },
                        },
                        required: ["title", "actions"],
                      },
                      phase_3: {
                        type: "object",
                        properties: {
                          title: { type: "string" },
                          actions: { type: "array", items: { type: "string" } },
                        },
                        required: ["title", "actions"],
                      },
                    },
                    required: ["phase_1", "phase_2", "phase_3"],
                  },
                  intent_model: {
                    type: "object",
                    properties: {
                      primary_lens: { type: "string" },
                      secondary_lens: { type: "string" },
                      lens_rationale: { type: "string" },
                      anchor_emphasis: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            reason: { type: "string" },
                          },
                          required: ["name", "reason"],
                        },
                      },
                      background_threads: { type: "array", items: { type: "string" } },
                      coaching_posture: { type: "string" },
                      report_framing: { type: "string" },
                    },
                    required: ["primary_lens", "secondary_lens", "lens_rationale", "anchor_emphasis", "background_threads", "coaching_posture", "report_framing"],
                  },
                },
                required: ["pattern_analysis", "contradictions", "forced_choice", "north_star_focus", "ninety_day_plan", "intent_model"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "create_strategic_report" } },
        temperature: 0.25,
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in AI response");

    const reportData = sanitizeStrategicReport(parseToolArguments(toolCall?.function?.arguments));
    // Never persist an empty shell: the unique audit_id index would lock the
    // user into it permanently (generate-report then answers already_exists).
    if (!isUsableStrategicReport(reportData)) throw new Error("AI report output incomplete");

    // Save report
    const { data: report, error: reportError } = await supabase
      .from("strategic_reports")
      .insert({
        user_id: user.id,
        audit_id,
        pattern_analysis: reportData.pattern_analysis,
        contradictions: reportData.contradictions,
        forced_choice: reportData.forced_choice,
        north_star_focus: reportData.north_star_focus,
        ninety_day_plan: reportData.ninety_day_plan,
        intent_model: reportData.intent_model,
      })
      .select("id")
      .single();

    if (reportError) {
      // strategic_reports_audit_id_unique: a concurrent request already saved the
      // report for this audit. Return it with the same "already exists" shape.
      if (reportError.code === "23505") {
        const { data: winner, error: winnerError } = await supabase
          .from("strategic_reports")
          .select("id")
          .eq("audit_id", audit_id)
          .eq("user_id", user.id)
          .limit(1)
          .maybeSingle();
        if (!winnerError && winner?.id) return reply({ report_id: winner.id, already_exists: true });
      }
      throw reportError;
    }

    return new Response(JSON.stringify({ report_id: report.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const limited = limitErrorResponse(e, corsHeaders);
    if (limited) return limited;
    console.error("generate-report request failed:", e);
    return new Response(JSON.stringify({ error: "Report generation failed. Please try again." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
