import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import AppBreadcrumb from "@/components/AppBreadcrumb";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Compass, Send, ArrowRight } from "lucide-react";
import { AUDIT_QUESTIONS, AUDIT_SECTIONS } from "@/lib/audit-questions";
import { useToast } from "@/hooks/use-toast";
import { formatLensLabel, type IntentProfile } from "@/lib/intentus-architecture";
import { normalizePlanTier, type PlanTier } from "@/lib/tier-policy";
import type { Json } from "@/integrations/supabase/types";
import { canReaudit, archiveAndResetAudit } from "@/lib/reaudit";
import { format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface ChatMessage {
  role: "system" | "user" | "coach";
  text: string;
  streaming?: boolean;
  shallowConfirm?: { pendingAnswer: string };
}

type AuditProfile = {
  coaching_tone: string | null;
  display_name: string | null;
};

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/audit-coach`;

async function streamCoachResponse({
  responses,
  currentQuestion,
  currentSection,
  coachingTone,
  displayName,
  intentProfile,
  mode,
  clarificationRequest,
  currentQuestionText,
  onDelta,
  onDone,
}: {
  responses: Record<string, string>;
  currentQuestion: string;
  currentSection: string;
  coachingTone: string;
  displayName: string;
  intentProfile?: IntentProfile | null;
  mode?: "feedback" | "clarification";
  clarificationRequest?: string;
  currentQuestionText?: string;
  onDelta: (text: string) => void;
  onDone: () => void;
}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    onDone();
    return;
  }

  const resp = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({
      responses,
      current_question: currentQuestion,
      current_section: currentSection,
      all_questions: AUDIT_QUESTIONS.map((q) => ({ id: q.id, text: q.text, section: q.section, kind: q.kind })),
      coaching_tone: coachingTone,
      display_name: displayName,
      intent_profile: intentProfile,
      mode: mode ?? "feedback",
      clarification_request: clarificationRequest,
      current_question_text: currentQuestionText,
    }),
  });

  if (!resp.ok || !resp.body) {
    onDone();
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let textBuffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    textBuffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
      let line = textBuffer.slice(0, newlineIndex);
      textBuffer = textBuffer.slice(newlineIndex + 1);

      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.startsWith(":") || line.trim() === "") continue;
      if (!line.startsWith("data: ")) continue;

      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") break;

      try {
        const parsed = JSON.parse(jsonStr);
        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (content) onDelta(content);
      } catch {
        textBuffer = line + "\n" + textBuffer;
        break;
      }
    }
  }

  // Flush remaining
  if (textBuffer.trim()) {
    for (let raw of textBuffer.split("\n")) {
      if (!raw) continue;
      if (raw.endsWith("\r")) raw = raw.slice(0, -1);
      if (raw.startsWith(":") || raw.trim() === "") continue;
      if (!raw.startsWith("data: ")) continue;
      const jsonStr = raw.slice(6).trim();
      if (jsonStr === "[DONE]") continue;
      try {
        const parsed = JSON.parse(jsonStr);
        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (content) onDelta(content);
      } catch { /* ignore */ }
    }
  }

  onDone();
}

const Audit = () => {
  const answerFlight = useRef(false);
  const startFreshFlight = useRef(false);
  const [startingFresh, setStartingFresh] = useState(false);
  const [answerSaving, setAnswerSaving] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [initAttempt, setInitAttempt] = useState(0);
  const [initializing, setInitializing] = useState(true);
  const [currentQ, setCurrentQ] = useState(0);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [auditId, setAuditId] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [coachStreaming, setCoachStreaming] = useState(false);
  const [profile, setProfile] = useState<{ coaching_tone: string; display_name: string; intent_profile?: IntentProfile | null }>({
    coaching_tone: "balanced",
    display_name: "",
    intent_profile: null,
  });
  const [planTier, setPlanTier] = useState<PlanTier>("free");
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isShallowResponse = (value: string) => {
    const trimmed = value.trim();
    const words = trimmed.split(/\s+/).filter(Boolean);
    return trimmed.length < 10 || words.length < 2;
  };

  const isClarificationRequest = (value: string) => {
    const t = value.trim().toLowerCase();
    if (!t) return false;
    const patterns = [
      "clarify",
      "clarification",
      "what do you mean",
      "what does that mean",
      "don't understand",
      "dont understand",
      "do not understand",
      "can you explain",
      "could you explain",
      "please explain",
      "need more context",
      "more context",
      "not sure what",
      "what are you asking",
      "rephrase",
      "in plain english",
      "what is this asking",
    ];
    if (patterns.some((p) => t.includes(p))) return true;
    // Short question ending in "?"
    if (t.endsWith("?") && t.split(/\s+/).length <= 14) return true;
    return false;
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      setInitializing(true);
      setInitError(null);
      try {
      // Load profile
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("coaching_tone, display_name, plan_tier")
        .eq("user_id", user.id)
        .single();
      if (cancelled) return;
      if (profileError) throw profileError;
      const loadedTier = normalizePlanTier((profileData as { plan_tier?: string | null } | null)?.plan_tier);
      if (profileData) {
        const typedProfile = profileData as AuditProfile & { plan_tier?: string | null };
        setProfile({
          coaching_tone: typedProfile.coaching_tone || "balanced",
          display_name: typedProfile.display_name || "",
          intent_profile: null,
        });
        setPlanTier(normalizePlanTier(typedProfile.plan_tier));
      }

      // A completed audit takes precedence: the lifecycle trigger refuses to
      // complete a second audit while one is completed/archived, so a stray
      // in-progress row (another tab, legacy data) could never be finished.
      const { data: completedAudit, error: completedError } = await supabase
        .from("baseline_audits")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "completed")
        .limit(1);

      if (cancelled) return;
      if (completedError) throw completedError;
      if (completedAudit && completedAudit.length > 0) {
        setCompleted(true);
        setMessages([{ role: "system", text: loadedTier === "premium" || loadedTier === "coach"
          ? "✅ Your operating audit is already complete. View your report or start a fresh assessment."
          : "✅ Your operating audit is already complete. View your report below." }]);
        return;
      }

      // Check for existing in-progress audit
      const { data, error: auditError } = await supabase
        .from("baseline_audits")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "in_progress")
        .order("created_at", { ascending: false })
        .limit(1);

      if (cancelled) return;
      if (auditError) throw auditError;
      if (data && data.length > 0) {
        const audit = data[0];
        setAuditId(audit.id);
        const raw = audit.responses as Record<string, unknown> | null;
        const saved = Object.fromEntries(AUDIT_QUESTIONS.filter(q => typeof raw?.[q.id] === 'string' && (raw[q.id] as string).trim()).map(q => [q.id, raw![q.id] as string]));
        setResponses(saved);
        const msgs: ChatMessage[] = [];
        const firstMissing = AUDIT_QUESTIONS.findIndex(q => !saved[q.id]);
        // A legacy in-progress row with every answer still needs a final acknowledged completion write.
        const answeredCount = firstMissing < 0 ? AUDIT_QUESTIONS.length - 1 : firstMissing;
        for (let i = 0; i < answeredCount && i < AUDIT_QUESTIONS.length; i++) {
          msgs.push({ role: "system", text: AUDIT_QUESTIONS[i].text });
          if (saved[AUDIT_QUESTIONS[i].id]) {
            msgs.push({ role: "user", text: saved[AUDIT_QUESTIONS[i].id] });
          }
        }
        if (answeredCount < AUDIT_QUESTIONS.length) {
          msgs.push({ role: "system", text: AUDIT_QUESTIONS[answeredCount].text });
        }
        setCurrentQ(answeredCount);
        setMessages(msgs);
      } else {
        // Create new audit
        const { data: newAudit, error: createError } = await supabase
          .from("baseline_audits")
          .insert({ user_id: user.id })
          .select()
          .single();

        if (cancelled) return;
        if (createError) throw createError;
        if (!newAudit) throw new Error("Audit could not be created");
        if (newAudit) {
          setAuditId(newAudit.id);
          setMessages([
            {
              role: "system",
              text: "Before you start: do this when you can be fully present. We begin by getting oriented, then pressure-test reality, then go after blind spots, then force prioritization. Honest, thoughtful answers are what make that progression useful.",
            },
            { role: "system", text: AUDIT_QUESTIONS[0].text },
          ]);
        }
      }
      } catch (error) {
        if (!cancelled) setInitError(error instanceof Error ? error.message : 'Unable to load audit. Please retry.');
      } finally {
        if (!cancelled) setInitializing(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [user?.id, initAttempt]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const processAnswer = async (answer: string) => {
    if (!auditId || answerFlight.current || initializing || initError) return;
    answerFlight.current = true;
    setAnswerSaving(true);
    try {

    const question = AUDIT_QUESTIONS[currentQ];
    const newResponses = { ...responses, [question.id]: answer };

    // Save progress
    const missing = AUDIT_QUESTIONS.findIndex(q => !newResponses[q.id]);
    const nextQ = missing < 0 ? AUDIT_QUESTIONS.length : missing;
    const isLast = nextQ >= AUDIT_QUESTIONS.length;

    const { data: savedAudit, error: saveError } = await supabase
      .from("baseline_audits")
      .update({
        responses: newResponses as Json,
        current_section: isLast ? AUDIT_SECTIONS.length - 1 : AUDIT_QUESTIONS[nextQ]?.sectionIndex ?? 0,
        current_question: isLast ? 0 : AUDIT_QUESTIONS[nextQ]?.questionIndex ?? 0,
        ...(isLast ? { status: "completed" as const, completed_at: new Date().toISOString() } : {}),
      })
      .eq("id", auditId).eq("user_id", user!.id).select("id").single();

    if (saveError || savedAudit?.id !== auditId) {
      setInput(answer);
      // The lifecycle trigger rejects writes to an audit that is already
      // completed/archived (e.g. finished in another tab). Retrying can never
      // succeed, so reload to show the audit's real state instead of looping.
      const lifecycleRejected = /Completed audits are server managed|A completed audit exists/.test(saveError?.message ?? "");
      toast({
        title: "Answer not saved",
        description: lifecycleRejected
          ? "This audit was already completed elsewhere. Reloading its current state."
          : saveError?.message || "Audit update was not acknowledged",
        variant: "destructive",
      });
      if (lifecycleRejected) setInitAttempt((n) => n + 1);
      return;
    }
    setMessages((prev) => [...prev, { role: "user", text: answer }]);
    setInput("");
    setResponses(newResponses);

    if (isLast) {
      setCompleted(true);
      // Get final AI reflection
      setCoachStreaming(true);
      let coachText = "";
      setMessages((prev) => [...prev, { role: "coach", text: "", streaming: true }]);

      try {
        await streamCoachResponse({
          responses: newResponses,
          currentQuestion: question.id,
          currentSection: question.section,
          coachingTone: profile.coaching_tone,
          displayName: profile.display_name,
          intentProfile: profile.intent_profile,
          onDelta: (chunk) => {
            coachText += chunk;
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: "coach", text: coachText, streaming: true };
              return updated;
            });
          },
          onDone: () => {
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: "coach", text: coachText };
              return [...updated, { role: "system", text: "✅ Your operating audit is complete. Let’s build your report." }];
            });
            setCoachStreaming(false);
          },
        });
      } catch {
        setMessages((prev) => [...prev, { role: "system", text: "✅ Your operating audit is complete. Let’s build your report." }]);
        setCoachStreaming(false);
      }
      return;
    }

    // Stream AI coaching response before next question
    setCoachStreaming(true);
    let coachText = "";
    setMessages((prev) => [...prev, { role: "coach", text: "", streaming: true }]);

    try {
      await streamCoachResponse({
        responses: newResponses,
        currentQuestion: question.id,
        currentSection: question.section,
        coachingTone: profile.coaching_tone,
        displayName: profile.display_name,
        intentProfile: profile.intent_profile,
        onDelta: (chunk) => {
          coachText += chunk;
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: "coach", text: coachText, streaming: true };
            return updated;
          });
        },
        onDone: () => {
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: "coach", text: coachText };
            return updated;
          });
          setCoachStreaming(false);

          // Show section transition if needed
          if (AUDIT_QUESTIONS[nextQ].sectionIndex !== question.sectionIndex) {
            setMessages((prev) => [
              ...prev,
              { role: "system", text: `Moving on to **${AUDIT_QUESTIONS[nextQ].section}**.` },
            ]);
          }

          // Show next question after a pause
          setMessages((prev) => [...prev, { role: "system", text: AUDIT_QUESTIONS[nextQ].text }]);
          setCurrentQ(nextQ);
        },
      });
    } catch {
      setCoachStreaming(false);
      // Fallback: just show next question
      if (AUDIT_QUESTIONS[nextQ].sectionIndex !== question.sectionIndex) {
        setMessages((prev) => [
          ...prev,
          { role: "system", text: `Moving on to **${AUDIT_QUESTIONS[nextQ].section}**.` },
        ]);
      }
      setMessages((prev) => [...prev, { role: "system", text: AUDIT_QUESTIONS[nextQ].text }]);
      setCurrentQ(nextQ);
    }
    } catch (error) {
      setInput(answer);
      toast({ title: 'Answer not saved', description: error instanceof Error ? error.message : 'Please retry.', variant: 'destructive' });
    } finally {
      answerFlight.current = false;
      setAnswerSaving(false);
    }
  };

  const handleClarification = async (userText: string) => {
    const question = AUDIT_QUESTIONS[currentQ];
    if (!question) return;

    setMessages((prev) => [...prev, { role: "user", text: userText }]);
    setInput("");

    setCoachStreaming(true);
    let coachText = "";
    setMessages((prev) => [...prev, { role: "coach", text: "", streaming: true }]);

    try {
      await streamCoachResponse({
        responses,
        currentQuestion: question.id,
        currentSection: question.section,
        coachingTone: profile.coaching_tone,
        displayName: profile.display_name,
        intentProfile: profile.intent_profile,
        mode: "clarification",
        clarificationRequest: userText,
        currentQuestionText: question.text,
        onDelta: (chunk) => {
          coachText += chunk;
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: "coach", text: coachText, streaming: true };
            return updated;
          });
        },
        onDone: () => {
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: "coach", text: coachText };
            return updated;
          });
          setCoachStreaming(false);
        },
      });
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "coach",
          text: "Take the question at face value — share what's actually true for you right now, in your own words.",
        };
        return updated;
      });
      setCoachStreaming(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || coachStreaming || answerFlight.current || initializing || initError) return;
    const trimmed = input.trim();

    // Clarification check runs before shallow check and before processAnswer
    if (isClarificationRequest(trimmed)) {
      await handleClarification(trimmed);
      return;
    }

    if (AUDIT_QUESTIONS[currentQ]?.type === "text" && isShallowResponse(trimmed)) {
      setMessages((prev) => [
        ...prev,
        { role: "user", text: trimmed },
        {
          role: "coach",
          text: "That's a short one — want to add more detail, or are you good with that answer?",
          shallowConfirm: { pendingAnswer: trimmed },
        },
      ]);
      setInput("");
      return;
    }
    await processAnswer(trimmed);
  };

  const handleExpandShallow = (messageIndex: number) => {
    setMessages((prev) => {
      const target = prev[messageIndex];
      const pending = target?.shallowConfirm?.pendingAnswer ?? "";
      // Strip the confirm chips and the user's short message so they can rewrite
      const next = prev.filter((_, i) => i !== messageIndex && i !== messageIndex - 1);
      setInput(pending);
      return next;
    });
  };

  const handleAcceptShallow = async (messageIndex: number) => {
    const pending = messages[messageIndex]?.shallowConfirm?.pendingAnswer;
    if (!pending) return;
    // Remove the coach prompt and the duplicate user bubble — processAnswer re-adds the user message
    setMessages((prev) => prev.filter((_, i) => i !== messageIndex && i !== messageIndex - 1));
    await processAnswer(pending);
  };

  const handleScaleClick = async (n: number) => {
    if (coachStreaming) return;
    await processAnswer(String(n));
  };

  // Starting over goes through the same server-enforced re-audit workflow as the
  // report page: Premium/Coach only, 30-day cooldown, prior audit + report archived
  // to history. A direct status flip would bypass all three and leave the old
  // report in place for the new audit.
  const handleStartFresh = async () => {
    if (!user || startFreshFlight.current) return;
    startFreshFlight.current = true;
    setStartingFresh(true);
    try {
      const eligibility = await canReaudit(user.id);
      if (!eligibility.eligible) {
        toast({
          title: "Re-audit not available",
          description: eligibility.nextEligibleDate
            ? `${eligibility.reason ?? ""} Next available ${format(eligibility.nextEligibleDate, "MMM d")}.`.trim()
            : eligibility.reason ?? "Please try again.",
          variant: "destructive",
        });
        return;
      }
      await archiveAndResetAudit(user.id);

      // Reset local state; the loader creates the new in-progress audit.
      setCompleted(false);
      setAuditId(null);
      setCurrentQ(0);
      setMessages([]);
      setResponses({});
      setInput("");
      setInitAttempt((n) => n + 1);
    } catch (err) {
      toast({
        title: "Couldn't start a fresh assessment",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      startFreshFlight.current = false;
      setStartingFresh(false);
    }
  };


  const currentSection = currentQ < AUDIT_QUESTIONS.length ? AUDIT_QUESTIONS[currentQ].sectionIndex : AUDIT_SECTIONS.length - 1;
  const progress = (currentQ / AUDIT_QUESTIONS.length) * 100;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-heading text-base font-extrabold tracking-tight text-foreground uppercase sm:text-xl">Intentus</span>
            <span className="font-heading text-sm font-bold text-foreground sm:text-lg">Operating Audit</span>
          </div>
          <div className="text-xs text-muted-foreground sm:text-sm truncate ml-2">
            {AUDIT_SECTIONS[currentSection]}
          </div>
        </div>
        <div className="h-1 bg-border">
          <div className="h-full bg-gradient-primary transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <AppBreadcrumb />
      {initializing && <p role="status">Loading audit…</p>}
      {initError && <div role="alert">{initError} <Button onClick={() => setInitAttempt(n => n + 1)}>Retry audit</Button></div>}
      {answerSaving && <p role="status">Saving answer…</p>}

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto">
        <div className="container mx-auto max-w-2xl px-4 py-6 space-y-4">
          {/* Section pills */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {AUDIT_SECTIONS.map((s, i) => (
              <span
                key={s}
                className={`whitespace-nowrap text-xs px-3 py-1 rounded-full border ${
                  i === currentSection
                    ? "bg-primary/10 border-primary text-primary"
                    : i < currentSection
                    ? "bg-primary/5 border-primary/20 text-primary/60"
                    : "border-border text-muted-foreground"
                }`}
              >
                {s}
              </span>
            ))}
          </div>

          <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground space-y-1">
            <p>We start with alignment, then reality, then blind spots, then priority. Real beats polished at every step.</p>
            {profile.intent_profile?.primaryLens && (
              <p className="text-xs text-muted-foreground">Current adaptive lens: {formatLensLabel(profile.intent_profile.primaryLens)}.</p>
            )}
          </div>

          {/* Messages */}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : msg.role === "coach"
                    ? "bg-accent/10 border border-accent/30 text-foreground rounded-bl-md"
                    : "bg-card border border-border text-foreground rounded-bl-md"
                }`}
              >
                {msg.role === "coach" && (
                  <p className="text-[10px] font-semibold text-accent uppercase tracking-wider mb-1">Coach</p>
                )}
                <p className="text-sm whitespace-pre-wrap">
                  {msg.text}
                  {msg.streaming && <span className="inline-block w-1.5 h-4 bg-accent/60 animate-pulse ml-0.5 align-text-bottom" />}
                </p>
                {msg.shallowConfirm && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Button size="sm" variant="outline" onClick={() => handleExpandShallow(i)}>
                      Expand my answer
                    </Button>
                    <Button size="sm" variant="hero" onClick={() => handleAcceptShallow(i)}>
                      That's my answer
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-border bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto max-w-2xl px-4 py-4">
          {completed ? (
            <div className="space-y-3">
              {planTier === "free" && (
                <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Your report is ready — unlock the full picture</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Executive subscribers get AI check-in debriefs, drift tracking, and an AI operating coach. $39.99/mo.
                    </p>
                  </div>
                  <Button variant="hero" className="w-full" onClick={() => navigate("/subscribe")}>
                    Upgrade to Executive <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                  <button
                    onClick={() => navigate("/report")}
                    className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Continue with Starter →
                  </button>
                </div>
              )}
              {planTier !== "free" && (
                <Button variant="hero" className="w-full" onClick={() => navigate("/report")}>
                  View your Operating Report <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              )}
              {(planTier === "premium" || planTier === "coach") && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" className="w-full" disabled={startingFresh}>
                      {startingFresh ? "Archiving…" : "Start Fresh Assessment"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Archive this audit and start fresh?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Your current audit and report will be saved to your history and you will begin a new audit. Re-audits are available once every 30 days. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleStartFresh}>Yes, start re-audit</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          ) : coachStreaming ? (
            <div className="flex items-center justify-center py-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
                Intentus is reflecting…
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              {AUDIT_QUESTIONS[currentQ]?.type === "scale" ? (
                <div className="flex-1 flex gap-1">
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      onClick={() => handleScaleClick(n)}
                      className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-primary hover:text-primary-foreground transition-colors text-foreground"
                    >
                      {n}
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                    placeholder="Answer directly. Specific beats polished..."
                    className="flex-1"
                  />
                  <Button onClick={handleSend} disabled={!input.trim()} variant="hero" size="icon" aria-label="Send answer">
                    <Send className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Audit;
