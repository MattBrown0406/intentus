import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppBreadcrumb from "@/components/AppBreadcrumb";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, X, ArrowRight, CheckCircle, MessageSquare, Loader2, RefreshCw, Wind, Zap, ListChecks } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatLensLabel, getBlockerPrompt, getCommitmentPrompt, getFocusPrompt, type IntentProfile } from "@/lib/intentus-architecture";
import { brandLogo as logo } from "@/lib/brand";
import { getTierCapability, normalizePlanTier } from "@/lib/tier-policy";
import {
  type WeeklyCommitment,
  getPreviousWeekCommitment,
  getMondayOfWeek,
} from "@/lib/commitments";
import {
  type CoachingQuestion,
  type Tier,
  selectQuestionsForCheckIn,
  buildRecencyMap,
  extractRecentGroups,
} from "@/lib/coaching-questions";
import { ExtraQuestionsStep } from "@/components/checkin/ExtraQuestionsStep";

type CheckInProfile = {
  intent_profile?: IntentProfile | null;
  plan_tier?: unknown;
};

type RecentCheckInRow = {
  created_at: string;
  extras: Record<string, unknown> | null;
};

const ScaleSelector = ({ value, onChange, label, helper, emoji }: {
  value: number; onChange: (n: number) => void; label: string; helper?: string; emoji: string[];
}) => (
  <div className="space-y-4">
    <div>
      <h3 className="font-heading text-lg font-bold text-foreground">{label}</h3>
      {helper && <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{helper}</p>}
    </div>
    <div className="flex gap-0.5 sm:gap-1 w-full">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={`flex-1 min-w-0 h-11 sm:h-12 rounded-md sm:rounded-lg border text-xs sm:text-sm font-medium transition-all ${
            n === value
              ? "bg-primary text-primary-foreground border-primary scale-105 sm:scale-110"
              : n <= value
              ? "bg-primary/10 border-primary/30 text-primary"
              : "border-border text-muted-foreground hover:border-primary/50"
          }`}
        >
          {n}
        </button>
      ))}
    </div>
    <p className="text-sm text-muted-foreground text-center">{emoji[Math.min(Math.floor(value / 3), 2)]}</p>
  </div>
);

const ListInput = ({ label, helper, examples, items, onAdd, onRemove, inputVal, setInputVal, placeholder }: {
  label: string; helper?: string; examples?: string[]; items: string[]; onAdd: () => void; onRemove: (index: number) => void;
  inputVal: string; setInputVal: (v: string) => void; placeholder: string;
}) => (
  <div className="space-y-4">
    <div>
      <h3 className="font-heading text-lg font-bold text-foreground">{label}</h3>
      {helper && <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{helper}</p>}
      {examples && examples.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {examples.map((ex, i) => (
            <li key={i} className="flex gap-2"><span className="text-primary">•</span><span className="italic">"{ex}"</span></li>
          ))}
        </ul>
      )}
    </div>
    <div className="flex gap-2 items-start">
      <Textarea
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onAdd(); }
        }}
        placeholder={placeholder}
        className="flex-1 min-h-[90px] text-sm resize-none"
      />
      <Button variant="outline" size="icon" onClick={onAdd} aria-label="Add item"><Plus className="h-4 w-4" /></Button>
    </div>
    <p className="text-xs text-muted-foreground -mt-2"><span className="hidden sm:inline">Aim for a full sentence with context. Press <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted text-[10px]">⌘/Ctrl + Enter</kbd> or click + to add.</span><span className="sm:hidden">Tap + to add. Aim for a full sentence with context.</span></p>
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground">
          <span className="flex-1 whitespace-pre-wrap">{item}</span>
          <button type="button" onClick={() => onRemove(i)} aria-label={`Remove item ${i + 1}`}><X className="h-4 w-4 text-muted-foreground hover:text-destructive" /></button>
        </li>
      ))}
    </ul>
  </div>
);

// ── Step 0: Commitment Callback ──────────────────────────────────────────────
const CommitmentCallbackStep = ({
  previousCommitment,
  callbackOutcome,
  setCallbackOutcome,
  callbackReflection,
  setCallbackReflection,
}: {
  previousCommitment: WeeklyCommitment;
  callbackOutcome: "yes" | "partially" | "no" | null;
  setCallbackOutcome: (v: "yes" | "partially" | "no") => void;
  callbackReflection: string;
  setCallbackReflection: (v: string) => void;
}) => (
  <div className="space-y-6">
    <div>
      <h3 className="font-heading text-lg font-bold text-foreground mb-1">Last week you committed to:</h3>
      <blockquote className="border-l-4 border-primary pl-4 py-2 bg-primary/5 rounded-r-lg text-foreground text-base italic">
        "{previousCommitment.commitment}"
      </blockquote>
    </div>

    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">Did this happen?</p>
      <div className="grid grid-cols-3 gap-3">
        {(["yes", "partially", "no"] as const).map((option) => (
          <button
            key={option}
            onClick={() => setCallbackOutcome(option)}
            className={`py-4 rounded-xl border-2 text-sm font-semibold capitalize transition-all ${
              callbackOutcome === option
                ? option === "yes"
                  ? "border-green-500 bg-green-500/10 text-green-700 dark:text-green-400"
                  : option === "partially"
                  ? "border-yellow-500 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
                  : "border-destructive bg-destructive/10 text-destructive"
                : "border-border text-muted-foreground hover:border-primary/50"
            }`}
          >
            {option === "yes" ? "Yes" : option === "partially" ? "Partially" : "No"}
          </button>
        ))}
      </div>
    </div>

    {callbackOutcome && (
      <div className="space-y-2">
        <label className="text-sm text-muted-foreground">
          Anything worth noting? <span className="text-xs">(optional)</span>
        </label>
        <Input
          value={callbackReflection}
          onChange={(e) => setCallbackReflection(e.target.value)}
          placeholder="One line reflection..."
          className="text-sm"
        />
      </div>
    )}
  </div>
);

// ── Final Step: Set "The One Thing" ─────────────────────────────────────────
const OneThingStep = ({
  oneThing,
  setOneThing,
}: {
  oneThing: string;
  setOneThing: (v: string) => void;
}) => (
  <div className="space-y-4">
    <div>
      <h3 className="font-heading text-lg font-bold text-foreground">What's the one thing this week?</h3>
      <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
        If you actually did this — and nothing else — it would make the most difference. Not the easiest thing. Not the most urgent thing. The thing that, if you skip it, you'll feel it for weeks. Be specific enough that someone else could check whether you did it.
      </p>
      <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
        <li className="flex gap-2"><span className="text-primary">•</span><span className="italic">"This week I will sit down and write the one-page strategic narrative I've been avoiding, and share it with two people for honest feedback."</span></li>
        <li className="flex gap-2"><span className="text-primary">•</span><span className="italic">"This week I will have the direct conversation with my Head of Sales about the underperformance — by Wednesday, in person."</span></li>
      </ul>
    </div>
    <Textarea
      value={oneThing}
      onChange={(e) => setOneThing(e.target.value)}
      placeholder="This week I will…"
      className="min-h-[140px] text-sm resize-none"
    />
  </div>
);

// ── Draft persistence ────────────────────────────────────────────────────────
const DRAFT_KEY = "intentus_checkin_draft";
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

type CheckInDraft = {
  operationId?: string;
  step: number;
  mood: number;
  energy: number;
  wins: string[];
  blockers: string[];
  commitments: string[];
  oneThing: string;
  callbackOutcome: "yes" | "partially" | "no" | null;
  callbackReflection: string;
  extras: Record<string, string | number>;
  savedAt: number;
};

const loadDraft = (userId: string): CheckInDraft | null => {
  try {
    const raw = localStorage.getItem(`${DRAFT_KEY}:${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CheckInDraft;
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > DRAFT_TTL_MS || parsed.savedAt > Date.now()
      || (parsed.operationId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.operationId))
      || !Number.isInteger(parsed.step) || parsed.step < 0 || parsed.step > 7
      || ![parsed.mood, parsed.energy].every(v => Number.isInteger(v) && v >= 1 && v <= 10)
      || ![parsed.wins, parsed.blockers, parsed.commitments].every(v => Array.isArray(v) && v.every(x => typeof x === "string"))
      || typeof parsed.oneThing !== "string" || typeof parsed.callbackReflection !== "string"
      || ![null, "yes", "partially", "no"].includes(parsed.callbackOutcome)
      || !parsed.extras || typeof parsed.extras !== "object" || Array.isArray(parsed.extras)) {
      localStorage.removeItem(`${DRAFT_KEY}:${userId}`);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

// save_check_in raises this (SQLSTATE 22023) when the operation id was already
// committed by an earlier attempt whose response was lost, but the payload has
// since been edited. The check-in exists; only the later edits were not applied.
const ALREADY_SAVED_MESSAGE = "Operation already saved with different content";
const isAlreadySavedCheckIn = (error: { message?: string } | null | undefined) =>
  typeof error?.message === "string" && error.message.includes(ALREADY_SAVED_MESSAGE);

// ── Main Component ───────────────────────────────────────────────────────────
const CheckInForm = () => {
  const { user } = useAuth();
  const draftKey = `${DRAFT_KEY}:${user?.id}`;
  const [initialDraft] = useState(() => user ? loadDraft(user.id) : null);
  const [operationId, setOperationId] = useState(() => initialDraft?.operationId ?? crypto.randomUUID());

  // Mode picker: 'full' (existing flow) or 'quick' (3-step mood/energy + one thing).
  // null means we still need to ask the user.
  const [mode, setMode] = useState<"full" | "quick" | null>(null);

  // Step index: 0 = commitment callback (or skipped), 1–5 = original steps, 6 = one-thing
  const [step, setStep] = useState(initialDraft?.step ?? 0);
  const [mood, setMood] = useState(initialDraft?.mood ?? 5);
  const [energy, setEnergy] = useState(initialDraft?.energy ?? 5);
  const [wins, setWins] = useState<string[]>(initialDraft?.wins ?? []);
  const [blockers, setBlockers] = useState<string[]>(initialDraft?.blockers ?? []);
  const [commitments, setCommitments] = useState<string[]>(initialDraft?.commitments ?? []);
  const [inputVal, setInputVal] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [saveWarning, setSaveWarning] = useState("");
  const [intentProfile, setIntentProfile] = useState<IntentProfile | null>(null);
  const [aiDebrief, setAiDebrief] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [showCenteringGuide, setShowCenteringGuide] = useState(false);
  const [showThinPrompt, setShowThinPrompt] = useState(false);
  const [showResumeBanner, setShowResumeBanner] = useState(!!initialDraft);

  // Commitment callback state
  const [previousCommitment, setPreviousCommitment] = useState<WeeklyCommitment | null>(null);
  const [callbackOutcome, setCallbackOutcome] = useState<"yes" | "partially" | "no" | null>(initialDraft?.callbackOutcome ?? null);
  const [callbackReflection, setCallbackReflection] = useState(initialDraft?.callbackReflection ?? "");
  const [hasPreviousCommitment, setHasPreviousCommitment] = useState<boolean | null>(null); // null = loading

  // One-thing state
  const [oneThing, setOneThing] = useState(initialDraft?.oneThing ?? "");

  // Quick-mode local step (0 = mood/energy, 1 = one thing)
  const [quickStep, setQuickStep] = useState(0);

  // Extras (rotating coaching questions)
  const [tier, setTier] = useState<Tier>("free");
  const [extraQuestions, setExtraQuestions] = useState<CoachingQuestion[]>([]);
  const [extraValues, setExtraValues] = useState<Record<string, string | number>>(initialDraft?.extras ?? {});

  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (!user) return;
    const loadProfileAndExtras = async () => {
      const [profileRes, recentRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", user.id).single(),
        supabase
          .from("check_ins")
          .select("created_at, extras")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(14),
      ]);

      const profile = profileRes.data as unknown as CheckInProfile | null;
      if (profile?.intent_profile) setIntentProfile(profile.intent_profile as IntentProfile);
      const userTier = normalizePlanTier(profile?.plan_tier) as Tier;
      setTier(userTier);

      const recentCheckIns = ((recentRes.data ?? []) as RecentCheckInRow[]).map((r) => ({
        created_at: r.created_at,
        extras: (r.extras ?? {}) as Record<string, unknown>,
      }));
      const recency = buildRecencyMap(recentCheckIns);
      const recentGroups = extractRecentGroups(recentCheckIns);
      const selected = selectQuestionsForCheckIn(userTier, recency, recentGroups);
      setExtraQuestions(selected);
      // A restored draft may sit on the extras step (7) when this tier has none.
      if (selected.length === 0) setStep((s) => Math.min(s, 6));
    };
    loadProfileAndExtras();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const checkPrevious = async () => {
      const prev = await getPreviousWeekCommitment(user.id);
      // Only ask about follow-through once: a prior commitment whose outcome is
      // already recorded (e.g. a second check-in this week) needs no callback.
      if (prev && !prev.outcome) {
        setPreviousCommitment(prev);
        setHasPreviousCommitment(true);
      } else {
        setHasPreviousCommitment(false);
        // Skip step 0. A restored draft keeps a later step, but never the
        // callback step: with no callback it renders nothing and blocks Continue.
        setStep((s) => (s === 0 ? 1 : s));
      }
    };
    checkPrevious();
  }, [user]);

  // Auto-save draft on any change
  useEffect(() => {
    if (done || !user) return;
    const draft: CheckInDraft = {
      operationId, step, mood, energy, wins, blockers, commitments,
      oneThing, callbackOutcome, callbackReflection,
      extras: extraValues,
      savedAt: Date.now(),
    };
    try {
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      // ignore quota errors
    }
  }, [operationId, draftKey, user, step, mood, energy, wins, blockers, commitments, oneThing, callbackOutcome, callbackReflection, extraValues, done]);

  const dismissResumeBanner = () => {
    try { localStorage.removeItem(draftKey); } catch { /* Storage may be unavailable. */ }
    setShowResumeBanner(false);
    setOperationId(crypto.randomUUID());
    setMood(5);
    setEnergy(5);
    setWins([]);
    setBlockers([]);
    setCommitments([]);
    setOneThing("");
    setCallbackOutcome(null);
    setCallbackReflection("");
    setExtraValues({});
    setStep(hasPreviousCommitment ? 0 : 1);
  };


  const hasThinCheckIn = () => {
    const totalItems = wins.length + blockers.length + commitments.length;
    const totalWords = [...wins, ...blockers, ...commitments]
      .join(" ")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    return totalItems < 3 || totalWords < 12;
  };

  // Text typed into a list step but not yet added with "+" must not be lost
  // when the user moves on.
  const commitPendingInput = () => {
    const pending = inputVal.trim();
    const setter = step === 3 ? setWins : step === 4 ? setBlockers : step === 5 ? setCommitments : null;
    if (pending && setter) setter((prev) => [...prev, pending]);
    setInputVal("");
  };

  const addItem = (setter: typeof setWins) => {
    if (inputVal.trim()) {
      setter((prev) => [...prev, inputVal.trim()]);
      setInputVal("");
    }
  };

  const removeItem = (setter: typeof setWins, index: number) => {
    setter((prev) => prev.filter((_, i) => i !== index));
  };

  const streamDebrief = async () => {
    if (!getTierCapability(tier).canUseAiDebrief) return;
    setAiLoading(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/coaching-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ mode: "check-in-debrief", messages: [] }),
      });

      if (!resp.ok || !resp.body) {
        setAiLoading(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullText += content;
              setAiDebrief(fullText);
            }
          } catch {
            // Ignore incomplete SSE chunks; the next chunk usually completes the frame.
          }
        }
      }
    } catch (e) {
      console.error("Debrief error:", e);
    }
    setAiLoading(false);
  };

  const handleSubmit = async (options?: { quick?: boolean }) => {
    if (!user || loading) return;
    const isQuick = options?.quick === true;
    // Thin-check-in guard only applies to the full flow.
    if (!isQuick && hasThinCheckIn() && !showThinPrompt) {
      setShowThinPrompt(true);
      return;
    }
    setShowThinPrompt(false);
    setLoading(true);

    // Build a clean extras payload — strip empty strings / 0 scale values
    const cleanedExtras: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(extraValues)) {
      if (typeof v === "string" && v.trim() !== "") cleanedExtras[k] = v.trim();
      else if (typeof v === "number" && v > 0) cleanedExtras[k] = v;
    }

    let alreadySaved = false;
    try {
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        name: "save_check_in", args: { p_operation_id: string; p_payload: Json }
      ) => PromiseLike<{ data: string | null; error: { message: string; code?: string } | null }>;
      const { data, error } = await rpc("save_check_in", {
        p_operation_id: operationId,
        p_payload: {
          mood, energy, wins: isQuick ? [] : wins, blockers: isQuick ? [] : blockers,
          commitments: isQuick ? [] : commitments, extras: isQuick ? {} : cleanedExtras,
          quick: isQuick, oneThing: oneThing.trim(), weekStart: getMondayOfWeek(new Date()),
          previousCommitmentId: !isQuick && callbackOutcome ? previousCommitment?.id ?? null : null,
          outcome: !isQuick && previousCommitment ? callbackOutcome : null,
          reflection: callbackReflection,
        },
      });
      if (isAlreadySavedCheckIn(error)) alreadySaved = true;
      else if (error || !data) throw new Error(error?.message ?? "No save acknowledgement received.");
    } catch (error) {
      setLoading(false);
      toast({ title: "Not saved — retry safely", description: error instanceof Error ? error.message : "Save failed. Your draft is retained.", variant: "destructive" });
      return;
    }
    setLoading(false);
    // Retire the draft and its operation id exactly as on a normal success, so
    // no later retry can collide with the already-committed operation.
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    setOperationId(crypto.randomUUID());
    if (alreadySaved) {
      setSaveWarning("your most recent edits weren't applied because an earlier attempt had already saved it.");
      toast({
        title: "Check-in saved",
        description: "An earlier attempt already saved this check-in. Your most recent edits weren't applied.",
      });
    } else {
      setSaveWarning("");
    }
    setDone(true);
    // Quick check-ins skip the AI debrief.
    if (!isQuick && getTierCapability(tier).canUseAiDebrief) streamDebrief();
  };


  const resetAndRetry = () => {
    setWins([]);
    setBlockers([]);
    setCommitments([]);
    setInputVal("");
    setMood(5);
    setEnergy(5);
    setStep(hasPreviousCommitment ? 0 : 1);
    setShowCenteringGuide(false);
  };

  // ── Loading state while checking previous commitment ──────────────────────
  if (hasPreviousCommitment === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // ── Mode picker (shown once, before either flow starts) ───────────────────
  if (!done && mode === null) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <img src={logo} alt="Intentus" className="h-7 w-auto object-contain" />
              <span className="font-heading text-lg font-bold text-foreground">Check-in</span>
            </Link>
          </div>
        </div>
        <AppBreadcrumb />
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-lg space-y-6">
            <div className="text-center space-y-2">
              <h2 className="font-heading text-2xl font-bold text-foreground">How are you checking in?</h2>
              <p className="text-sm text-muted-foreground">
                Pick the depth that matches the time you actually have right now.
              </p>
            </div>

            <button
              onClick={() => setMode("full")}
              className="w-full text-left rounded-2xl border border-primary/30 bg-primary/5 p-5 transition-all hover:border-primary hover:bg-primary/10"
            >
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-primary/15 p-2 text-primary">
                  <ListChecks className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="font-heading font-bold text-foreground">Full check-in</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Wins, blockers, commitments, "one thing" — plus AI debrief. ~5–8 min.
                  </p>
                </div>
              </div>
            </button>

            <button
              onClick={() => {
                setMode("quick");
                // Quick mode ignores the commitment-callback step
                setQuickStep(0);
              }}
              className="w-full text-left rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary/40"
            >
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-accent/15 p-2 text-accent">
                  <Zap className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="font-heading font-bold text-foreground">Quick check-in</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Just mood, energy, and one thing for the week. ~60 seconds. No AI debrief.
                  </p>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Quick check-in flow ────────────────────────────────────────────────────
  if (!done && mode === "quick") {
    const totalQuickSteps = 2;
    const displayQuickStep = quickStep + 1;
    const quickCanContinue = quickStep === 0 ? mood > 0 && energy > 0 : oneThing.trim().length > 0;

    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Link to="/" className="flex items-center">
                <img src={logo} alt="Intentus" className="h-7 w-auto object-contain cursor-pointer" />
              </Link>
              <span className="font-heading text-lg font-bold text-foreground">Quick check-in</span>
            </div>
            <span className="text-sm text-muted-foreground">{displayQuickStep} of {totalQuickSteps}</span>
          </div>
          <div className="h-1 bg-border">
            <div
              className="h-full bg-gradient-primary transition-all duration-500"
              style={{ width: `${(displayQuickStep / totalQuickSteps) * 100}%` }}
            />
          </div>
        </div>

        <AppBreadcrumb />

        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-lg space-y-6">
            {quickStep === 0 ? (
              <div className="space-y-8">
                <ScaleSelector
                  value={mood}
                  onChange={setMood}
                  label="Mood"
                  helper="How clear and steady are you right now?"
                  emoji={["😔 Off your game", "😐 Mixed", "😊 Locked in"]}
                />
                <ScaleSelector
                  value={energy}
                  onChange={setEnergy}
                  label="Energy"
                  helper="How much execution fuel do you have?"
                  emoji={["🔋 Running on empty", "⚡ Moderate energy", "🚀 Fully charged"]}
                />
              </div>
            ) : (
              <OneThingStep oneThing={oneThing} setOneThing={setOneThing} />
            )}
          </div>
        </div>

        <div className="border-t border-border bg-card/50 backdrop-blur-sm p-4">
          <div className="container mx-auto max-w-lg flex gap-3">
            {quickStep === 0 ? (
              <Button variant="outline" className="flex-1" onClick={() => setMode(null)}>Back</Button>
            ) : (
              <Button variant="outline" className="flex-1" onClick={() => setQuickStep(0)}>Back</Button>
            )}
            {quickStep < totalQuickSteps - 1 ? (
              <Button
                variant="hero"
                className="flex-1"
                disabled={!quickCanContinue}
                onClick={() => setQuickStep(quickStep + 1)}
              >
                Continue <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button
                variant="hero"
                className="flex-1"
                disabled={loading || !quickCanContinue}
                onClick={() => handleSubmit({ quick: true })}
              >
                {loading ? "Saving..." : "Submit quick check-in"}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }



  if (showThinPrompt) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-lg space-y-6">
          <div className="text-center space-y-3">
            <div className="inline-flex bg-primary/10 rounded-2xl p-4">
              <Wind className="h-8 w-8 text-primary" />
            </div>
            <h2 className="font-heading text-2xl font-bold text-foreground">A quick gut check</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your answers were very short and it seemed like you didn't give this much thought. In order to get the most out of this experience together, I need you to make sure you're thoughtful and intentional about your responses.
            </p>
            <p className="text-sm text-foreground font-medium pt-2">
              Would you like to start over, or do you feel good about the answers you've submitted?
            </p>
          </div>

          <div className="grid gap-3">
            <Button
              variant="hero"
              className="w-full"
              onClick={() => {
                setShowThinPrompt(false);
                setShowCenteringGuide(true);
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Let me start over
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => handleSubmit()}
            >
              I feel good — submit my check-in
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (showCenteringGuide) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-lg space-y-6">
          <div className="text-center space-y-3">
            <div className="inline-flex bg-primary/10 rounded-2xl p-4">
              <Wind className="h-12 w-12 text-primary" />
            </div>
            <h2 className="font-heading text-2xl font-bold text-foreground">Let's get you centered first</h2>
            <p className="text-sm text-muted-foreground">
              Your check-in felt a bit rushed — and that's okay. The best coaching happens when you're present and honest with yourself.
            </p>
          </div>

          <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
            <h3 className="font-heading font-bold text-foreground text-sm">Try this 5-minute reset:</h3>
            <ol className="space-y-3 text-sm text-foreground">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">1</span>
                <span><strong>Close everything else.</strong> Tabs, Slack, your phone — give yourself just these five minutes.</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">2</span>
                <span><strong>Take three slow breaths.</strong> Inhale for 4 counts, hold for 4, exhale for 6. Let your nervous system settle.</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">3</span>
                <span><strong>Ask yourself one question:</strong> "What's actually true about my week right now?" — not what you wish were true, not what sounds good. What's real.</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">4</span>
                <span><strong>When you feel ready,</strong> come back and check in from that place. Your coaching is only as good as the signal you give it.</span>
              </li>
            </ol>
          </div>

          <Button variant="hero" className="w-full" onClick={resetAndRetry}>
            <RefreshCw className="mr-2 h-4 w-4" /> I'm ready — let me try again
          </Button>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-lg space-y-6">
          <div className="text-center space-y-3">
            <div className="inline-flex bg-primary/10 rounded-2xl p-4">
              <CheckCircle className="h-12 w-12 text-primary" />
            </div>
            <h2 className="font-heading text-2xl font-bold text-foreground">Check-in complete</h2>
            {saveWarning && <p role="alert" className="text-sm text-destructive">Your check-in was saved, but {saveWarning}</p>}
            <p className="text-sm text-muted-foreground">Clear signal in, clear coaching back.</p>
            {intentProfile?.primaryLens && (
              <p className="text-xs text-muted-foreground">Adaptive lens: {formatLensLabel(intentProfile.primaryLens)}</p>
            )}
          </div>

          {/* AI Debrief */}
          <div className="bg-card rounded-2xl border border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="bg-primary/10 rounded-lg p-1.5">
                <MessageSquare className="h-4 w-4 text-primary" />
              </div>
              <h3 className="font-heading font-bold text-foreground text-sm">{getTierCapability(tier).coachingName}</h3>
            </div>
            {aiLoading && !aiDebrief ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Reviewing your check-in for drift, clarity, and follow-through...
              </div>
            ) : aiDebrief ? (
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{aiDebrief}</p>
            ) : !getTierCapability(tier).canUseAiDebrief ? (
              <p className="text-sm text-muted-foreground">
                Starter saves your weekly accountability signal. Executive and above add AI debriefs that read your check-in against your operating focus, drift, and commitments.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {mood <= 4
                  ? "Your self-rating shows drift. Useful signal — reset the next move before a vague week turns into avoidable damage."
                  : "You're on track. Keep the operating rhythm tight and the next move decisive."}
              </p>
            )}
          </div>

          {/* Free-tier upsell card */}
          {!getTierCapability(tier).canUseAiDebrief && (
            <div className="bg-card rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-background to-background p-6">
              <h3 className="font-heading font-bold text-foreground text-sm mb-1">Want your AI debrief?</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Executive subscribers get a personalized AI debrief after every check-in — what it means, what to watch, what to do next.
              </p>
              <Button variant="hero" size="sm" onClick={() => navigate("/subscribe")}>
                Try Executive — $39.99/mo <ArrowRight className="ml-2 h-3.5 w-3.5" />
              </Button>
            </div>
          )}


          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => navigate(getTierCapability(tier).canUseAiChat ? "/coaching" : "/subscribe")}>
              <MessageSquare className="mr-2 h-4 w-4" /> {getTierCapability(tier).canUseAiChat ? "Continue coaching" : "View plans"}
            </Button>
            <Button variant="hero" className="flex-1" onClick={() => navigate("/dashboard")}>
              Dashboard <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Steps definition ─────────────────────────────────────────────────────
  // step 0 = commitment callback (only shown if hasPreviousCommitment)
  // step 1 = mood, step 2 = energy, step 3 = wins, step 4 = blockers
  // step 5 = commitments, step 6 = one thing, step 7 = extras (skipped on free)
  const hasExtras = extraQuestions.length > 0;
  const LAST_STEP = hasExtras ? 7 : 6;

  const renderStep = () => {
    switch (step) {
      case 0:
        return previousCommitment ? (
          <CommitmentCallbackStep
            previousCommitment={previousCommitment}
            callbackOutcome={callbackOutcome}
            setCallbackOutcome={setCallbackOutcome}
            callbackReflection={callbackReflection}
            setCallbackReflection={setCallbackReflection}
          />
        ) : null;
      case 1:
        return <ScaleSelector value={mood} onChange={setMood} label="How focused and steady are you right now?"
          helper="Be honest, not aspirational. Think about the last 48 hours: how clear is your head, how reactive vs. intentional have you been, how present are you for the people and decisions in front of you?"
          emoji={["😔 Off your game", "😐 Mixed", "😊 Locked in"]} />;
      case 2:
        return <ScaleSelector value={energy} onChange={setEnergy} label="What's your disciplined execution energy level?"
          helper="Not how busy you feel — how much capacity you have to do the hard, focused work that actually moves things forward. Are you sprinting, jogging, or running on fumes?"
          emoji={["🔋 Running on empty", "⚡ Moderate energy", "🚀 Fully charged"]} />;
      case 3:
        return <ListInput
          label={getFocusPrompt(intentProfile)}
          helper="What actually moved? Be specific. Name the decision, the conversation, the shipped work — and why it mattered. Generic wins like 'had a good week' give your coach nothing to work with."
          examples={[
            "Closed the partnership conversation with X by getting clear on our deal-breakers — saved us 3 weeks of back-and-forth.",
            "Shipped the v2 onboarding flow and watched 4 users go through it live; saw exactly where two of them stalled.",
          ]}
          items={wins}
          onAdd={() => addItem(setWins)} onRemove={(i) => removeItem(setWins, i)}
          inputVal={inputVal} setInputVal={setInputVal}
          placeholder="What happened, what made it a win, and what does it tell you about your operating rhythm?" />;
      case 4:
        return <ListInput
          label={getBlockerPrompt(intentProfile)}
          helper="What's actually in the way — and what's your honest read on why? Don't just name the symptom (e.g. 'no time'). Name the real friction: a decision you're avoiding, a person you haven't pushed, a habit that keeps slipping."
          examples={[
            "I keep delaying the hard conversation with my co-founder about role clarity — I'm telling myself it's timing, but really I don't want the conflict.",
            "Our pipeline is stalling because I haven't decided which segment to double down on; I'm hedging instead of choosing.",
          ]}
          items={blockers}
          onAdd={() => addItem(setBlockers)} onRemove={(i) => removeItem(setBlockers, i)}
          inputVal={inputVal} setInputVal={setInputVal}
          placeholder="What's blocking you, and what's the real reason underneath the surface reason?" />;
      case 5:
        return <ListInput
          label={getCommitmentPrompt(intentProfile)}
          helper="Specific, observable, and small enough to actually do this week. 'I will be more disciplined' is not a commitment. 'I will send the partnership decision email by Wednesday EOD' is. If a stranger read it on Sunday, could they tell whether you did it?"
          examples={[
            "By Thursday, I will book the 60-min strategy block with my exec team and send a one-page brief 24 hours ahead.",
            "I will say no — in writing — to the two non-core opportunities sitting in my inbox by tomorrow.",
          ]}
          items={commitments}
          onAdd={() => addItem(setCommitments)} onRemove={(i) => removeItem(setCommitments, i)}
          inputVal={inputVal} setInputVal={setInputVal}
          placeholder="What will you do, by when, and how will you know it's done?" />;
      case 6:
        return <OneThingStep oneThing={oneThing} setOneThing={setOneThing} />;
      case 7:
        return (
          <ExtraQuestionsStep
            questions={extraQuestions}
            values={extraValues}
            setValue={(id, v) => setExtraValues((prev) => ({ ...prev, [id]: v }))}
          />
        );
      default:
        return null;
    }
  };

  // Total steps shown in progress bar: if hasPreviousCommitment → 7 steps (0–6), else 6 (1–6)
  const firstStep = hasPreviousCommitment ? 0 : 1;
  const totalSteps = LAST_STEP - firstStep + 1;
  const displayStep = step - firstStep + 1;

  const canAdvanceStep0 = step !== 0 || callbackOutcome !== null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link to="/" className="flex items-center">
              <img src={logo} alt="Intentus" className="h-7 w-auto object-contain cursor-pointer" />
            </Link>
            <span className="font-heading text-lg font-bold text-foreground">Check-in</span>
          </div>
          <span className="text-sm text-muted-foreground">{displayStep} of {totalSteps}</span>
        </div>
        <div className="h-1 bg-border">
          <div className="h-full bg-gradient-primary transition-all duration-500" style={{ width: `${(displayStep / totalSteps) * 100}%` }} />
        </div>
      </div>

      <AppBreadcrumb />

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-lg space-y-4">
          {showResumeBanner && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm text-foreground">
              <span>Resuming your saved check-in.</span>
              <button
                onClick={dismissResumeBanner}
                aria-label="Dismiss and start fresh"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {step >= 1 && (
            <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground space-y-1">
              <p>Do this check-in when you can be honest and undistracted. If you are multitasking, rushing, or half-present, wait.</p>
              {intentProfile?.primaryLens && (
                <p className="text-xs text-muted-foreground">This check-in is currently weighted toward {formatLensLabel(intentProfile.primaryLens).toLowerCase()}.</p>
              )}
            </div>
          )}
          {renderStep()}
        </div>
      </div>

      <div className="border-t border-border bg-card/50 backdrop-blur-sm p-4">
        <div className="container mx-auto max-w-lg flex gap-3">
          {step > firstStep && (
            <Button variant="outline" className="flex-1" onClick={() => { commitPendingInput(); setStep(step - 1); }}>Back</Button>
          )}
          {step < LAST_STEP ? (
            <Button
              variant="hero"
              className="flex-1"
              disabled={!canAdvanceStep0}
              onClick={() => { commitPendingInput(); setStep(step + 1); }}
            >
              Continue <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button variant="hero" className="flex-1" onClick={() => handleSubmit()} disabled={loading}>
              {loading ? "Saving..." : "Complete check-in"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

const CheckIn = () => {
  const { user } = useAuth();
  return user ? <CheckInForm key={user.id} /> : null;
};

export default CheckIn;
