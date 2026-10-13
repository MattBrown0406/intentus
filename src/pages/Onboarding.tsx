import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ArrowRight, Clock, MessageCircle, Calendar, CheckCircle, Brain, ShieldCheck, Layers, User } from "lucide-react";
import { brandLogo as logo } from "@/lib/brand";
import { useToast } from "@/hooks/use-toast";
import {
  FOCUS_AREA_OPTIONS,
  LENS_OPTIONS,
  PRESSURE_OPTIONS,
  SUPPORT_MODE_OPTIONS,
  type AdaptiveLens,
} from "@/lib/intentus-architecture";
import { TIMEZONE_GROUPS, formatTimezoneLabel } from "@/lib/timezones";
import { TimezonePicker } from "@/components/TimezonePicker";

type Gender = "male" | "female" | "non_binary" | "prefer_not_to_say";

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "male", label: "He/him" },
  { value: "female", label: "She/her" },
  { value: "non_binary", label: "They/them" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

const TONES = [
  { value: "direct" as const, label: "Direct", desc: "Clear, firm, and willing to name avoidance without dressing it up.", icon: "🎯" },
  { value: "supportive" as const, label: "Supportive", desc: "Warm, grounded, emotionally intelligent, and still unwilling to let drift slide.", icon: "🤝" },
  { value: "balanced" as const, label: "Balanced", desc: "Direct because the outcome matters, warm because you matter.", icon: "⚖️" },
];

const CADENCES = [
  { value: "daily" as const, label: "Daily", desc: "Best for disciplined execution and fast drift correction" },
  { value: "every_other_day" as const, label: "Every other day", desc: "A steady operating rhythm with room to adjust" },
  { value: "weekly" as const, label: "Weekly", desc: "Best for strategic review, honest reflection, and resets" },
];

const Onboarding = () => {
  const [step, setStep] = useState(0);
  const [timezone, setTimezone] = useState("America/New_York");
  const [gender, setGender] = useState<Gender>("prefer_not_to_say");
  const [tone, setTone] = useState<"direct" | "supportive" | "balanced">("balanced");
  const [cadence, setCadence] = useState<"daily" | "every_other_day" | "weekly">("daily");
  const [primaryLens, setPrimaryLens] = useState<AdaptiveLens>("discipline_execution");
  const [secondaryLens, setSecondaryLens] = useState<AdaptiveLens>("decision_making");
  const [pressureState, setPressureState] = useState<(typeof PRESSURE_OPTIONS)[number]["value"]>("stretched");
  const [focusArea, setFocusArea] = useState<(typeof FOCUS_AREA_OPTIONS)[number]["value"]>("self_leadership");
  const [supportMode, setSupportMode] = useState<(typeof SUPPORT_MODE_OPTIONS)[number]["value"]>("structure");
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  // Sign-in lands here by default (safeDestination fallback). A returning,
  // already-onboarded user must go to the dashboard instead of redoing
  // onboarding and overwriting their saved preferences and intent profile.
  const [checkingOnboarded, setCheckingOnboarded] = useState(true);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void (async () => {
      const { data } = await supabase.from("profiles").select("onboarding_completed").eq("user_id", user.id).maybeSingle();
      if (!active) return;
      if (data?.onboarding_completed) navigate("/dashboard", { replace: true });
      else setCheckingOnboarded(false);
    })().catch(() => { if (active) setCheckingOnboarded(false); });
    return () => { active = false; };
  }, [user, navigate]);

  const handleComplete = async () => {
    if (!user) return;
    setLoading(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        timezone,
        gender,
        coaching_tone: tone,
        check_in_cadence: cadence,
        intent_profile: {
          primaryLens,
          secondaryLens,
          pressureState,
          focusArea,
          supportMode,
        },
        onboarding_completed: true,
      })
      .eq("user_id", user.id);
    setLoading(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      navigate("/audit");
    }
  };

  const stepCount = 6;

  const steps = [
    <div key="welcome" className="text-center space-y-6">
      <div className="inline-flex">
        <img src={logo} alt="Intentus" className="h-20 w-auto" />
      </div>
      <h1 className="font-heading text-3xl font-bold text-foreground">Welcome to Intentus</h1>
      <p className="text-muted-foreground max-w-md mx-auto">
        Intentus is your AI operating coach. The audit starts by building alignment and trust, then gets honest about current reality, then surfaces blind spots, then forces prioritization so you leave with something usable instead of just feeling exposed.
      </p>
      <div className="max-w-md mx-auto rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-left">
        <p className="text-sm font-medium text-foreground">Do this when you can actually think.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Not while driving, multitasking, half-working, or rushing. Focused, honest answers are required or the audit turns into performance instead of insight.
        </p>
      </div>
      <div className="max-w-md mx-auto rounded-2xl border border-border bg-card px-4 py-4 text-left space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-primary">How Intentus thinks</p>
        <p className="text-sm text-foreground">Core anchors stay constant — drawn from the best thinking in habit science, executive leadership, decision-making under uncertainty, management theory, and human-centered coaching.</p>
        <p className="text-sm text-muted-foreground">Then the coaching emphasis adapts to your pressure, priorities, and blind spots so the product feels like a serious mirror instead of a generic chatbot.</p>
      </div>
      <p className="text-xs text-muted-foreground max-w-sm mx-auto">
        ⚠️ Intentus provides coaching and self-reflection tools. It is not medical advice or mental health treatment.
        If you are in crisis, contact local emergency services.
      </p>
      <Button variant="hero" size="lg" onClick={() => setStep(1)}>
        Let&apos;s go <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>,

    <div key="timezone-tone" className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="bg-primary/10 rounded-xl p-3"><Clock className="h-6 w-6 text-primary" /></div>
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground">Timing and tone</h2>
          <p className="text-sm text-muted-foreground">Set the rhythm and feedback style so the coaching lands when it can actually help.</p>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">Your timezone</p>
        <TimezonePicker value={timezone} onChange={setTimezone} />
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium text-foreground">Feedback style</p>
        </div>
        <div className="grid gap-3">
          {TONES.map((t) => (
            <button
              key={t.value}
              onClick={() => setTone(t.value)}
              className={`text-left p-4 rounded-xl border transition-all ${
                tone === t.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{t.icon}</span>
                <div>
                  <p className="font-semibold text-foreground">{t.label}</p>
                  <p className="text-sm text-muted-foreground">{t.desc}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <Button variant="hero" className="w-full" onClick={() => setStep(2)}>
        Continue <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>,

    <div key="gender" className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="bg-primary/10 rounded-xl p-3"><User className="h-6 w-6 text-primary" /></div>
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground">A quick personal note</h2>
          <p className="text-sm text-muted-foreground">This helps your AI coach refer to you naturally.</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {GENDER_OPTIONS.map((g) => (
          <button
            key={g.value}
            onClick={() => setGender(g.value)}
            className={`text-left p-4 rounded-xl border transition-all ${
              gender === g.value
                ? "border-primary bg-primary/5 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/50"
            }`}
          >
            <p className="font-semibold text-foreground">{g.label}</p>
          </button>
        ))}
      </div>

      <Button variant="hero" className="w-full" onClick={() => setStep(3)}>
        Continue <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>,

    <div key="lenses" className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="bg-primary/10 rounded-xl p-3"><Brain className="h-6 w-6 text-primary" /></div>
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground">What kind of mirror do you need?</h2>
          <p className="text-sm text-muted-foreground">This helps Intentus weight its coaching lens without turning the product into a personality test.</p>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">Primary lens</p>
        <div className="grid gap-3">
          {LENS_OPTIONS.map((lens) => (
            <button
              key={lens.value}
              onClick={() => {
                setPrimaryLens(lens.value);
                if (secondaryLens === lens.value) {
                  const fallback = LENS_OPTIONS.find((option) => option.value !== lens.value)?.value ?? "decision_making";
                  setSecondaryLens(fallback);
                }
              }}
              className={`rounded-xl border p-4 text-left transition-all ${primaryLens === lens.value ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
            >
              <p className="font-semibold text-foreground">{lens.label}</p>
              <p className="text-sm text-muted-foreground mt-1">{lens.description}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">Secondary lens</p>
        <div className="grid gap-3">
          {LENS_OPTIONS.filter((lens) => lens.value !== primaryLens).map((lens) => (
            <button
              key={lens.value}
              onClick={() => setSecondaryLens(lens.value)}
              className={`rounded-xl border p-4 text-left transition-all ${secondaryLens === lens.value ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
            >
              <p className="font-semibold text-foreground">{lens.label}</p>
              <p className="text-sm text-muted-foreground mt-1">{lens.description}</p>
            </button>
          ))}
        </div>
      </div>

      <Button variant="hero" className="w-full" onClick={() => setStep(4)}>
        Continue <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>,

    <div key="state" className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="bg-primary/10 rounded-xl p-3"><ShieldCheck className="h-6 w-6 text-primary" /></div>
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground">What pressure are you under right now?</h2>
          <p className="text-sm text-muted-foreground">A few honest choices help the coach frame your report, check-ins, and challenges more intelligently.</p>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">Current pressure state</p>
        <div className="grid gap-3">
          {PRESSURE_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setPressureState(option.value)}
              className={`rounded-xl border p-4 text-left transition-all ${pressureState === option.value ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
            >
              <p className="font-semibold text-foreground">{option.label}</p>
              <p className="text-sm text-muted-foreground mt-1">{option.description}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">Where do you need traction most?</p>
        <div className="grid gap-3">
          {FOCUS_AREA_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setFocusArea(option.value)}
              className={`rounded-xl border p-4 text-left transition-all ${focusArea === option.value ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
            >
              <p className="font-semibold text-foreground">{option.label}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">What would help most from the coach?</p>
        <div className="grid gap-3">
          {SUPPORT_MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setSupportMode(option.value)}
              className={`rounded-xl border p-4 text-left transition-all ${supportMode === option.value ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
            >
              <p className="font-semibold text-foreground">{option.label}</p>
              <p className="text-sm text-muted-foreground mt-1">{option.description}</p>
            </button>
          ))}
        </div>
      </div>

      <Button variant="hero" className="w-full" onClick={() => setStep(5)}>
        Continue <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>,

    <div key="cadence" className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="bg-primary/10 rounded-xl p-3"><Calendar className="h-6 w-6 text-primary" /></div>
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground">Check-in cadence</h2>
          <p className="text-sm text-muted-foreground">Choose the rhythm for reviewing disciplined action, drift, decision quality, and follow-through.</p>
        </div>
      </div>
      <div className="grid gap-3">
        {CADENCES.map((c) => (
          <button
            key={c.value}
            onClick={() => setCadence(c.value)}
            className={`text-left p-4 rounded-xl border transition-all ${
              cadence === c.value
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
          >
            <p className="font-semibold text-foreground">{c.label}</p>
            <p className="text-sm text-muted-foreground">{c.desc}</p>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium text-foreground">Your starting coaching architecture</p>
        </div>
        <div className="grid gap-2 text-sm">
          <p className="text-foreground">Primary lens: <span className="font-medium">{LENS_OPTIONS.find((lens) => lens.value === primaryLens)?.label}</span></p>
          <p className="text-foreground">Secondary lens: <span className="font-medium">{LENS_OPTIONS.find((lens) => lens.value === secondaryLens)?.label}</span></p>
          <p className="text-muted-foreground">Intentus will still use its full core anchor set, but these choices shape which questions get sharpened, which patterns get emphasized, and how your report is framed.</p>
        </div>
      </div>

      <Button variant="hero" className="w-full" onClick={handleComplete} disabled={loading}>
        {loading ? "Saving..." : (
          <>Start my audit <CheckCircle className="ml-2 h-4 w-4" /></>
        )}
      </Button>
    </div>,
  ];

  if (checkingOnboarded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" role="status" aria-label="Loading">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {step > 0 && (
          <div className="flex gap-1 mb-8">
            {Array.from({ length: stepCount }, (_, index) => index + 1).map((s) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-all ${
                  s <= step ? "bg-primary" : "bg-border"
                }`}
              />
            ))}
          </div>
        )}
        {steps[step]}
      </div>
    </div>
  );
};

export default Onboarding;
