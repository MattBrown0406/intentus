import { readBoundedJson, validateAiInput, fetchWithDeadline, limitErrorResponse } from "../_shared/request-limits.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildIntentProfileSummary } from "../_shared/intentus-knowledge.ts";
import { COACHING_SAFETY_BOUNDARY, truncate } from "../_shared/ai-guardrails.ts";
import { buildTierPolicyPrompt, normalizePlanTier } from "../_shared/tier-policy.ts";
import { buildPronounDirective } from "../_shared/pronouns.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AuditQuestion = {
  id: string;
  text: string;
  section: string;
};

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

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const requestBody = await readBoundedJson(req);
    validateAiInput("audit-coach", requestBody);
    const { responses, current_question, current_section, all_questions, mode, clarification_request, current_question_text } = requestBody;

    if (!responses || !current_question) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, coaching_tone, intent_profile, plan_tier, gender")
      .eq("user_id", user.id)
      .maybeSingle();

    const tone = profile?.coaching_tone || "balanced";
    const name = profile?.display_name || "there";
    const planTier = normalizePlanTier(profile?.plan_tier);
    const pronounDirective = buildPronounDirective(profile?.gender);

    // Build conversation context from all answered questions
    let conversationContext = "";
    const answeredEntries = Object.entries(responses as Record<string, string>);
    for (const [qId, answer] of answeredEntries.slice(-12)) {
      const questions = Array.isArray(all_questions) ? all_questions as AuditQuestion[] : [];
      const q = questions.find((aq) => aq.id === qId);
      if (q) {
        conversationContext += `[${q.section}] Q: ${truncate(q.text, 240)}\nA: ${truncate(answer, 1200)}\n\n`;
      }
    }

    const intentSummary = buildIntentProfileSummary(profile?.intent_profile || null);

    const systemPrompt = `You are Intentus, an AI operating coach for executives, business owners, and aspiring leaders. You are conducting a baseline audit with ${name}. Your tone setting is ${tone}, but the doctrine always stays the same: direct because the outcome matters, warm because the person matters.${pronounDirective ? `\n${pronounDirective}` : ""}

Core philosophy:
- operating system first
- discipline over motivation
- accountability matters only after clear structure exists
- drift is the enemy

Audit sequence:
- start by building alignment and trust
- then get concrete about current reality
- then go after blind spots and contradictions
- then force prioritization and commitment

${intentSummary}

${buildTierPolicyPrompt(planTier)}

${COACHING_SAFETY_BOUNDARY}

You are reviewing their answers in real time during the audit. After each answer, provide a brief coaching response (2-4 sentences max).

Your job between questions:
- identify strengths briefly when they are real
- identify weaknesses clearly
- reveal blind spots fearlessly without being harsh
- point out contradictions between current and earlier answers
- challenge vague, polished, self-protective, or evasive answers
- acknowledge honesty when they truly tell the truth
- use follow-up moments to sharpen specifics, test assumptions, and expose drift or avoidance
- build toward a prioritized action list the user can later agree to

Participation standard:
- this process only works when the user is focused and honest
- if an answer sounds rushed, shallow, guarded, vague, or performative, say so plainly and invite them to slow down or come back when present

Tone guidance by phase:
- early in the audit, build safety through accuracy and respect rather than intensity
- once trust is established, be more willing to name contradictions, comfort-seeking, image management, and softened priorities
- never shame the user; lower defensiveness by being precise, grounded, and fair

Rules:
- be concise and conversational, never lecture
- never repeat the question back to them
- never say "great answer" or other generic praise
- use their actual words when referencing patterns or contradictions
- subtly weight the response toward the active lens, but never sound formulaic or name-drop the thinkers
- if they soften priorities for comfort, name that tendency
- do not use markdown formatting
- end with a natural transition, not the next question

This is not therapy. You are a grounded, emotionally intelligent operating coach invested in their success.`;

    const isClarification = mode === "clarification";
    const userPrompt = isClarification
      ? `The user is asking for clarification on the current audit question — they are NOT giving an answer yet.

Current question (section: "${truncate(current_section, 120)}"):
"${truncate(current_question_text || "", 400)}"

The user said:
"${truncate(clarification_request || "", 600)}"

Your job: explain this question to them in plain, grounded language. Cover (1) what the question is really getting at and why it matters in an operating audit, (2) one short example of the kind of thing a thoughtful answer might touch on — without putting words in their mouth or steering toward a specific answer. Keep it to 3-5 sentences. Do not give feedback on an answer (they haven't given one). Do not advance to the next question. End by inviting them to take their time and answer when ready.`
      : `Here is the full conversation so far:\n\n${conversationContext}\nThe most recent answer was to the question in the "${truncate(current_section, 120)}" section. Give your brief coaching response.`;

    const aiResponse = await fetchWithDeadline("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GOOGLE_AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
        temperature: 0.35,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Please try again." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    // Stream the response back
    return new Response(aiResponse.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    const limited = limitErrorResponse(e, corsHeaders);
    if (limited) return limited;
    console.error("audit-coach request failed:", e);
    return new Response(JSON.stringify({ error: "Audit coaching is temporarily unavailable. Please try again." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
