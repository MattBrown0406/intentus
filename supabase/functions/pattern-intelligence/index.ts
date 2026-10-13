import { readBoundedJson, fetchWithDeadline, limitErrorResponse } from "../_shared/request-limits.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { boundedArray, parseToolArguments, safeJsonStringify, truncate } from "../_shared/ai-guardrails.ts";
import { normalizePlanTier } from "../_shared/tier-policy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Types ─────────────────────────────────────────────────────────────────────

type RecurringBlindSpot = {
  pattern: string;
  evidence: string;
  cycles_present: number;
};

type GrowthArea = {
  area: string;
  evidence: string;
  from_cycle: number;
  to_cycle: number;
};

type PersistentContradiction = {
  contradiction: string;
  impact: string;
};

type LongitudinalResult = {
  recurring_blind_spots: RecurringBlindSpot[];
  growth_areas: GrowthArea[];
  persistent_contradictions: PersistentContradiction[];
  executive_summary: string;
  recommended_focus: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitizeLongitudinalResult(raw: Record<string, unknown>): LongitudinalResult {
  return {
    recurring_blind_spots: boundedArray<Record<string, unknown>>(raw.recurring_blind_spots, 6).map(
      (item) => ({
        pattern: truncate(item.pattern, 200),
        evidence: truncate(item.evidence, 600),
        cycles_present: typeof item.cycles_present === "number" ? item.cycles_present : 1,
      }),
    ),
    growth_areas: boundedArray<Record<string, unknown>>(raw.growth_areas, 6).map((item) => ({
      area: truncate(item.area, 200),
      evidence: truncate(item.evidence, 600),
      from_cycle: typeof item.from_cycle === "number" ? item.from_cycle : 1,
      to_cycle: typeof item.to_cycle === "number" ? item.to_cycle : 1,
    })),
    persistent_contradictions: boundedArray<Record<string, unknown>>(
      raw.persistent_contradictions,
      5,
    ).map((item) => ({
      contradiction: truncate(item.contradiction, 400),
      impact: truncate(item.impact, 400),
    })),
    executive_summary: truncate(raw.executive_summary, 1200),
    recommended_focus: truncate(raw.recommended_focus, 400),
  };
}

/** Safely extract string list from a pattern_analysis field */
function extractStringList(value: unknown, maxItems: number): string[] {
  return boundedArray<unknown>(value, maxItems)
    .map((item) => {
      if (typeof item === "string") return truncate(item, 220);
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        // themes have a title + description
        const parts = [
          typeof obj.title === "string" ? obj.title : "",
          typeof obj.description === "string" ? obj.description : "",
        ].filter(Boolean);
        return truncate(parts.join(": "), 300);
      }
      return "";
    })
    .filter(Boolean);
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

    await readBoundedJson(req, { allowEmpty: true });

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
            "Pattern intelligence is available on Premium and Coach tiers only. Upgrade to access this feature.",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const name = profileRow?.display_name || "there";
    const tone = profileRow?.coaching_tone || "balanced";

    // ── Load all data in parallel ─────────────────────────────────────────
    // archive_and_reset_audit() snapshots each prior report into
    // audit_history.report_data and then DELETES strategic_reports, so the
    // live table never holds more than the current cycle. Prior cycles must
    // come from the archive (the same source Report.tsx counts).
    const [reportsRes, historyRes] = await Promise.all([
      anonClient
        .from("strategic_reports")
        .select(
          "id, north_star_focus, ninety_day_plan, pattern_analysis, forced_choice, contradictions, created_at",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: true }),

      anonClient
        .from("audit_history")
        .select("audit_number, report_data, completed_at")
        .eq("user_id", user.id)
        .order("audit_number", { ascending: true }),
    ]);
    if (reportsRes.error || historyRes.error) throw new Error("Failed to load audit cycles");

    type CycleReport = {
      id?: string;
      north_star_focus?: unknown;
      pattern_analysis?: unknown;
      forced_choice?: unknown;
      contradictions?: unknown;
      created_at: string;
    };
    const archivedReports: CycleReport[] = (historyRes.data || []).flatMap((row) => {
      const data = row.report_data;
      if (!data || typeof data !== "object" || Array.isArray(data)) return [];
      const snapshot = data as Record<string, unknown>;
      const createdAt = typeof snapshot.created_at === "string" ? snapshot.created_at : row.completed_at;
      return [{ ...snapshot, created_at: createdAt } as CycleReport];
    });
    const seen = new Set<string>();
    // Bound prompt size: the most recent 8 cycles, oldest first.
    const reports: CycleReport[] = [...archivedReports, ...((reportsRes.data || []) as CycleReport[])]
      .filter((report) => {
        if (typeof report.id !== "string") return true;
        if (seen.has(report.id)) return false;
        seen.add(report.id);
        return true;
      })
      .slice(-8);

    // ── Insufficient data guard ───────────────────────────────────────────
    if (reports.length < 2) {
      return new Response(
        JSON.stringify({
          insufficient_data: true,
          report_count: reports.length,
          message: "Pattern intelligence requires at least 2 completed audit cycles.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Build per-cycle summaries ─────────────────────────────────────────
    const cycleSummaries = reports.map((report, index) => {
      const cycleNumber = index + 1;
      const reportDate = new Date(report.created_at).toISOString().split("T")[0];

      const patternAnalysis = report.pattern_analysis && typeof report.pattern_analysis === "object"
        ? report.pattern_analysis as Record<string, unknown>
        : {};

      const themes = extractStringList(patternAnalysis.themes, 5);
      const blindSpots = extractStringList(patternAnalysis.blind_spots, 5);
      const strengths = extractStringList(patternAnalysis.strengths, 4);

      // Forced choice snippet
      const forcedChoiceSnippet = truncate(report.forced_choice, 300);

      // Contradiction count from any contradictions array stored in the report
      // (strategic_reports may also store contradictions as a separate field)
      let contradictionCount = 0;
      const rawReport = report as Record<string, unknown>;
      if (Array.isArray(rawReport.contradictions)) {
        contradictionCount = rawReport.contradictions.length;
      }

      return {
        cycle: cycleNumber,
        date: reportDate,
        north_star_focus: truncate(report.north_star_focus, 300),
        forced_choice_snippet: forcedChoiceSnippet,
        themes,
        blind_spots: blindSpots,
        strengths,
        contradictions_count: contradictionCount,
      };
    });

    // ── Build prompt ──────────────────────────────────────────────────────
    let cyclesText = "";
    for (const cycle of cycleSummaries) {
      cyclesText += `\n=== CYCLE ${cycle.cycle} — ${cycle.date} ===\n`;
      cyclesText += `North Star Focus: ${cycle.north_star_focus || "not recorded"}\n`;
      cyclesText += `Forced Choice: ${cycle.forced_choice_snippet || "not recorded"}\n`;
      if (cycle.themes.length > 0) cyclesText += `Key Themes: ${cycle.themes.join(" | ")}\n`;
      if (cycle.blind_spots.length > 0) cyclesText += `Blind Spots: ${cycle.blind_spots.join(" | ")}\n`;
      if (cycle.strengths.length > 0) cyclesText += `Strengths: ${cycle.strengths.join(" | ")}\n`;
      if (cycle.contradictions_count > 0) {
        cyclesText += `Contradictions identified: ${cycle.contradictions_count}\n`;
      }
      cyclesText += "\n";
    }

    const systemPrompt = `You are analyzing longitudinal behavioral patterns for a leader (${name}) across ${reports.length} completed audit cycles. Your tone setting is ${tone}.

Your job is to find patterns that PERSIST across cycles — recurring blind spots, repeating themes, consistent contradictions between stated priorities and actual behavior, and evidence of genuine growth or sustained drift. Be specific and quote the data. Name things directly. This is premium intelligence that requires candor.

Doctrine:
- operating system first
- discipline over motivation
- drift is the enemy
- direct because the outcome matters; warm because the person matters

You MUST call the tool analyze_longitudinal_patterns. Do not produce freeform text — your entire response must be the tool call.

Rules:
1. Only identify patterns that are demonstrably present across MULTIPLE cycles. Do not invent patterns from a single data point.
2. Quote specific language from the cycle data when naming patterns or contradictions.
3. Growth is only genuine if the data shows a sustained shift — not just one improved cycle.
4. The executive_summary must name the single most important longitudinal pattern in the first sentence.
5. The recommended_focus must be one clear, actionable sentence — not a question, not a list.
6. Be a candid advisor, not a cheerleader.

--- LONGITUDINAL CYCLE DATA ---
${cyclesText}`;

    const userPrompt = `Analyze the ${reports.length} audit cycles above and identify my longitudinal behavioral patterns.`;

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
              name: "analyze_longitudinal_patterns",
              description:
                "Return a structured longitudinal pattern analysis across multiple audit cycles.",
              parameters: {
                type: "object",
                properties: {
                  recurring_blind_spots: {
                    type: "array",
                    description:
                      "Blind spots that appear in more than one audit cycle. Only include genuine cross-cycle patterns.",
                    items: {
                      type: "object",
                      properties: {
                        pattern: {
                          type: "string",
                          description: "Name of the blind spot pattern (concise, direct)",
                        },
                        evidence: {
                          type: "string",
                          description:
                            "Specific evidence showing how this pattern appeared across cycles — quote the data",
                        },
                        cycles_present: {
                          type: "number",
                          description: "Number of cycles in which this blind spot was detected",
                        },
                      },
                      required: ["pattern", "evidence", "cycles_present"],
                    },
                  },
                  growth_areas: {
                    type: "array",
                    description:
                      "Areas where genuine, sustained improvement is visible across cycles. Do not include single-cycle improvements.",
                    items: {
                      type: "object",
                      properties: {
                        area: {
                          type: "string",
                          description: "The area of growth (concise label)",
                        },
                        evidence: {
                          type: "string",
                          description: "Specific evidence of the growth, grounded in cycle data",
                        },
                        from_cycle: {
                          type: "number",
                          description: "Cycle number where the growth began",
                        },
                        to_cycle: {
                          type: "number",
                          description: "Most recent cycle where the growth is visible",
                        },
                      },
                      required: ["area", "evidence", "from_cycle", "to_cycle"],
                    },
                  },
                  persistent_contradictions: {
                    type: "array",
                    description:
                      "Contradictions between stated priorities and actual behavior that persist across multiple cycles.",
                    items: {
                      type: "object",
                      properties: {
                        contradiction: {
                          type: "string",
                          description: "Description of the contradiction, naming both sides specifically",
                        },
                        impact: {
                          type: "string",
                          description:
                            "The observable impact of this contradiction on performance or priorities",
                        },
                      },
                      required: ["contradiction", "impact"],
                    },
                  },
                  executive_summary: {
                    type: "string",
                    description:
                      "3-4 direct sentences naming the most important longitudinal pattern, what it costs, and what it would take to shift it. The first sentence must name the pattern directly.",
                  },
                  recommended_focus: {
                    type: "string",
                    description:
                      "One sentence — the single highest-leverage thing to address based on the cross-cycle evidence. Must be an action directive, not a question.",
                  },
                },
                required: [
                  "recurring_blind_spots",
                  "growth_areas",
                  "persistent_contradictions",
                  "executive_summary",
                  "recommended_focus",
                ],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "analyze_longitudinal_patterns" } },
        temperature: 0.2,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limited. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add funds." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      console.error("AI gateway error:", aiResponse.status);
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call returned by AI");

    const parsed = parseToolArguments(toolCall.function.arguments);
    const result = sanitizeLongitudinalResult(parsed);

    // ── Return ────────────────────────────────────────────────────────────
    return new Response(
      JSON.stringify({
        cycles_analyzed: reports.length,
        generated_at: new Date().toISOString(),
        ...result,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const limited = limitErrorResponse(e, corsHeaders);
    if (limited) return limited;
    console.error("pattern-intelligence request failed:", e);
    return new Response(
      JSON.stringify({ error: "Pattern analysis failed. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
