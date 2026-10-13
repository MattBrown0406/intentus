import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import GettingStarted from "@/components/dashboard/GettingStarted";
import ProgressStory from "@/components/dashboard/ProgressStory";
import AppBreadcrumb from "@/components/AppBreadcrumb";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { brandLogo as logo } from "@/lib/brand";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import {
  LogOut, Target, TrendingUp, Flame,
  CheckCircle, AlertTriangle, ArrowRight, BarChart3, Clock,
  FileText, Users, MessageSquare, Sparkles, Lock, Settings, Shield, Circle,
  RefreshCw, ArrowUpRight, CheckCircle2, Menu as MenuIcon,
} from "lucide-react";
import { format, differenceInDays, formatDistanceToNow } from "date-fns";
import { calculateDayStreak } from "@/lib/check-in-streak";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatLensLabel, type IntentModel, type IntentProfile } from "@/lib/intentus-architecture";
import {
  getCurrentWeekCommitment,
  getPreviousWeekCommitment,
  getRecentCommitments,
  computeFollowThroughStreak,
  setWeeklyCommitment,
  type WeeklyCommitment,
} from "@/lib/commitments";
import confetti from "canvas-confetti";
import { canReaudit } from "@/lib/reaudit";
import { CalibrationWidget } from "@/components/dashboard/CalibrationWidget";

interface Profile {
  display_name: string | null;
  coaching_tone: string | null;
  check_in_cadence: string | null;
  intent_profile?: IntentProfile | null;
  plan_tier: string | null;
  onboarding_completed: boolean | null;
}

interface StrategicReportSummary {
  intent_model?: IntentModel | null;
  north_star_focus?: string | null;
  pattern_analysis?: unknown;
}

interface CheckIn {
  id: string;
  mood_score: number | null;
  energy_score: number | null;
  wins: string[] | null;
  blockers: string[] | null;
  commitments: string[] | null;
  drift_detected: boolean | null;
  created_at: string;
}

const OneThingStreak = ({ history }: { history: WeeklyCommitment[] }) => {
  const streak = computeFollowThroughStreak(history);
  const dots = history.slice(-7);
  const dotColor = (o: string | null) => {
    if (o === "yes") return "bg-green-500";
    if (o === "partially") return "bg-yellow-500";
    if (o === "no") return "bg-destructive";
    return "bg-muted";
  };
  useEffect(() => {
    // Confetti when 3+ consecutive "yes" outcomes (most recent runs)
    const consecutiveYes = computeFollowThroughStreak(history.map(c => ({
      ...c, outcome: c.outcome === 'partially' ? 'no' : c.outcome,
    })));
    if (consecutiveYes >= 3) {
      const key = `intentus_streak_confetti_${history[history.length - 1]?.week_start}`;
      if (typeof window !== "undefined" && !window.sessionStorage.getItem(key)) {
        window.sessionStorage.setItem(key, "1");
        confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
      }
    }
  }, [history]);

  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/70 px-3 py-2.5">
      <div className="flex items-center gap-2">
        {streak > 0 ? (
          <>
            <span className="text-base">🔥</span>
            <span className="text-sm font-semibold text-foreground">{streak}-week streak</span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">Start your streak this week</span>
        )}
      </div>
      <div className="flex items-center gap-1">
        {Array.from({ length: 7 }).map((_, i) => {
          const c = dots[i];
          return <span key={i} className={`h-2 w-2 rounded-full ${dotColor(c?.outcome ?? null)}`} />;
        })}
      </div>
    </div>
  );
};

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { isAdmin } = useAdminCheck();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [auditCompleted, setAuditCompleted] = useState(false);
  const [reportSummary, setReportSummary] = useState<StrategicReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentCommitment, setCurrentCommitment] = useState<WeeklyCommitment | null>(null);
  const [lastCommitment, setLastCommitment] = useState<WeeklyCommitment | null>(null);
  const [recentCommitmentHistory, setRecentCommitmentHistory] = useState<WeeklyCommitment[]>([]);
  const [showOneThingModal, setShowOneThingModal] = useState(false);
  const [oneThingInput, setOneThingInput] = useState("");
  const [oneThingSaving, setOneThingSaving] = useState(false);
  const [reauditEligible, setReauditEligible] = useState(false);
  const [reauditNextDate, setReauditNextDate] = useState<Date | undefined>();
  const [lastAuditAt, setLastAuditAt] = useState<Date | null>(null);
  const [auditCount, setAuditCount] = useState(1);
  const [coachNotes, setCoachNotes] = useState<{ id: string; content: string; created_at: string }[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      try {
        const [profileRes, checkInsRes, auditRes, reportRes, historyRes] = await Promise.all([
          supabase.from("profiles").select("*").eq("user_id", user.id).single(),
          supabase.from("check_ins").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
          supabase.from("baseline_audits").select("status, completed_at").eq("user_id", user.id).eq("status", "completed").order("completed_at", { ascending: false }).limit(1),
          supabase.from("strategic_reports").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1),
          (supabase as any).from("audit_history").select("id, completed_at").eq("user_id", user.id).order("completed_at", { ascending: false }),
        ]);
        if (profileRes.data) setProfile(profileRes.data as unknown as Profile);
        if (checkInsRes.data) setCheckIns(checkInsRes.data as CheckIn[]);
        setAuditCompleted((auditRes.data?.length ?? 0) > 0);
        const latestActive = auditRes.data?.[0]?.completed_at ?? null;
        const latestArchived = (historyRes.data as any[] | null)?.[0]?.completed_at ?? null;
        const mostRecent = [latestActive, latestArchived]
          .filter(Boolean)
          .map((d) => new Date(d as string))
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
        setLastAuditAt(mostRecent);
        setAuditCount(((historyRes.data as any[] | null)?.length ?? 0) + ((auditRes.data?.length ?? 0) > 0 ? 1 : 0));
        if (reportRes.data?.[0]) setReportSummary(reportRes.data[0] as unknown as StrategicReportSummary);
      } catch (err) {
        toast({ title: "Failed to load", description: "Please refresh and try again.", variant: "destructive" });
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();

    const loadCommitments = async () => {
      if (!user) return;
      try {
        const [curr, prev, recent] = await Promise.all([
          getCurrentWeekCommitment(user.id),
          getPreviousWeekCommitment(user.id),
          getRecentCommitments(user.id, 7),
        ]);
        setCurrentCommitment(curr);
        setLastCommitment(prev);
        setRecentCommitmentHistory(recent);
      } catch (err) {
        toast({ title: "Failed to load", description: "Please refresh and try again.", variant: "destructive" });
        console.error(err);
      }
    };
    loadCommitments();


    const loadReaudit = async () => {
      if (!user) return;
      try {
        const { data: prof } = await supabase
          .from("profiles")
          .select("plan_tier")
          .eq("user_id", user.id)
          .single();
        const tier = prof?.plan_tier ?? "free";
        if (tier === "premium" || tier === "coach") {
          const result = await canReaudit(user.id);
          setReauditEligible(result.eligible);
          setReauditNextDate(result.nextEligibleDate);
        }
      } catch (err) {
        console.error(err);
      }
    };
    loadReaudit();

    const loadCoachNotes = async () => {
      if (!user) return;
      try {
        // A client may be linked to several coaches (unique per coach+client),
        // so .maybeSingle() would error and hide every shared note.
        const { data: clientLinks } = await supabase
          .from("coach_clients")
          .select("coach_user_id")
          .eq("client_user_id", user.id)
          .limit(1);
        if (!clientLinks?.length) return;
        const { data: notes } = await supabase
          .from("coach_annotations")
          .select("id, content, created_at")
          .eq("client_user_id", user.id)
          .eq("is_private", false)
          .eq("resolved", false)
          .order("created_at", { ascending: false });
        if (notes) setCoachNotes(notes);
      } catch (err) {
        console.error(err);
      }
    };
    loadCoachNotes();
  }, [user, toast]);

  const handleSaveOneThing = async () => {
    if (!user || !oneThingInput.trim() || oneThingSaving) return;
    setOneThingSaving(true);
    try {
      const saved = await setWeeklyCommitment(user.id, oneThingInput.trim());
      setCurrentCommitment(saved);
      setShowOneThingModal(false);
      setOneThingInput("");
    } catch (e) {
      console.error("Error saving one thing:", e);
      toast({ title: "Not saved", description: "Your one thing wasn't saved. Please try again.", variant: "destructive" });
    }
    setOneThingSaving(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const streak = calculateDayStreak(checkIns.map((c) => c.created_at));
  const moodSamples = checkIns.filter((c) => c.mood_score !== null);
  const energySamples = checkIns.filter((c) => c.energy_score !== null);
  const avgMood = moodSamples.length > 0
    ? Math.round(moodSamples.reduce((acc, c) => acc + (c.mood_score ?? 0), 0) / moodSamples.length * 10)
    : null;
  const avgEnergy = energySamples.length > 0
    ? Math.round(energySamples.reduce((acc, c) => acc + (c.energy_score ?? 0), 0) / energySamples.length * 10)
    : null;
  const driftCount = checkIns.filter((c) => c.drift_detected).length;
  const driftRate = checkIns.length > 0 ? Math.round((driftCount / checkIns.length) * 100) : null;
  const recentCommitments = checkIns[0]?.commitments ?? [];
  const planTier = profile?.plan_tier ?? "free";
  const trendWindow = planTier === "premium" || planTier === "coach" ? 10 : planTier === "exec" ? 7 : 4;
  const trendData = [...checkIns]
    .slice(0, trendWindow)
    .reverse()
    .map((checkIn, index) => ({
      label: checkIn.created_at ? format(new Date(checkIn.created_at), "MMM d") : `#${index + 1}`,
      focus: checkIn.mood_score ? checkIn.mood_score * 10 : null,
      energy: checkIn.energy_score ? checkIn.energy_score * 10 : null,
      drift: checkIn.drift_detected ? 1 : 0,
    }));
  const hasTrendData = trendData.some((point) => point.focus !== null || point.energy !== null);
  const activeLens = reportSummary?.intent_model?.primary_lens || profile?.intent_profile?.primaryLens;
  const northStarFocus = reportSummary?.north_star_focus;

  // Execution quality = average of focus & energy (as percentage)
  const executionScore = avgMood !== null && avgEnergy !== null
    ? Math.round((avgMood + avgEnergy) / 2)
    : null;

  // Scorecard data
  const scorecardItems = [
    { label: "Focus", value: avgMood },
    { label: "Energy", value: avgEnergy },
    { label: "Execution", value: executionScore },
    { label: "Drift", value: driftRate },
  ];

  // Momentum assessment
  const getMomentumLabel = () => {
    if (!hasTrendData || trendData.length < 2) return null;
    const recent = trendData.slice(-2);
    const first = (recent[0]?.focus ?? 0) + (recent[0]?.energy ?? 0);
    const last = (recent[1]?.focus ?? 0) + (recent[1]?.energy ?? 0);
    if (last > first) return "Momentum is improving";
    if (last < first) return "Momentum is declining";
    return "Momentum is steady";
  };
  const momentumLabel = getMomentumLabel();

  // Coaching signals
  const coachingSignals = [
    { label: "Check-in cadence", value: profile?.check_in_cadence ? capitalize(profile.check_in_cadence.replace("_", " ")) : "Not set" },
    { label: "Coaching tone", value: profile?.coaching_tone ? capitalize(profile.coaching_tone) : "Balanced" },
    { label: "Drift risk", value: driftRate !== null ? (driftRate > 30 ? "Elevated" : "Low") : "Unknown" },
  ];

  // Next actions
  const nextActions: string[] = [];
  if (!auditCompleted) nextActions.push("Finish the operating audit");
  if (auditCompleted && !reportSummary) nextActions.push("Review the strategic report");
  if (!currentCommitment) nextActions.push("Set this week's one thing");
  if (checkIns.length === 0) nextActions.push("Complete your first check-in");
  else nextActions.push("Start this week's check-in");
  if (nextActions.length < 3) nextActions.push("Lock next week's commitments");

  return (
    <div className="min-h-screen bg-background">
      {/* Subtle radial glow background like the mock */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.08),transparent_32%),radial-gradient(circle_at_left,rgba(20,184,166,0.06),transparent_28%)]" />

      {/* Navigation */}
      <nav className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            {profile?.plan_tier === "coach" && (
              <Button variant="outline" size="sm" onClick={() => navigate("/coach")} className="border-primary text-primary hidden md:inline-flex">
                <Users className="h-4 w-4 mr-1" /> Coach Portal
              </Button>
            )}
          </div>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/audit")}>Audit</Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/check-in")}>Check-in</Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/goals")}>
              <Target className="h-4 w-4 mr-1" /> North Star
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/subscribe")}>
              <Sparkles className="h-4 w-4 mr-1" /> Plan
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/coaching")}>
              <MessageSquare className="h-4 w-4 mr-1" /> Coach
            </Button>
            {auditCompleted && (
              <Button variant="ghost" size="sm" onClick={() => navigate("/report")}>
                <FileText className="h-4 w-4 mr-1" /> Report
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => navigate("/settings")}>
              <Settings className="h-4 w-4 mr-1" /> Settings
            </Button>
            {isAdmin && (
              <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
                <Shield className="h-4 w-4 mr-1" /> Admin
              </Button>
            )}
            <Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => { void signOut().catch(() => toast({ title: "Sign out failed", description: "You are still signed in. Please try again.", variant: "destructive" })); }}><LogOut className="h-4 w-4" /></Button>
          </div>

          {/* Mobile nav */}
          <div className="flex md:hidden items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => navigate("/check-in")} title="Check-in">
              <CheckCircle className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => navigate("/goals")} title="North Star">
              <Target className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => navigate("/coaching")} title="Coach">
              <MessageSquare className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => navigate("/subscribe")} title="Plan">
              <Sparkles className="h-4 w-4" />
            </Button>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Open menu">
                  <MenuIcon className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-64 bg-background p-0">
                <div className="flex flex-col h-full">
                  <div className="border-b border-border px-5 py-4">
                    <img src={logo} alt="Intentus" className="h-8 w-auto" />
                  </div>
                  <nav className="flex flex-col gap-1 px-4 py-4">
                    <SheetClose asChild>
                      <Button variant="ghost" className="justify-start" onClick={() => navigate("/audit")}>
                        <Target className="h-4 w-4 mr-2" /> Audit
                      </Button>
                    </SheetClose>
                    <SheetClose asChild>
                      <Button variant="ghost" className="justify-start" onClick={() => navigate("/check-in")}>
                        <CheckCircle className="h-4 w-4 mr-2" /> Check-in
                      </Button>
                    </SheetClose>
                    <SheetClose asChild>
                      <Button variant="ghost" className="justify-start" onClick={() => navigate("/goals")}>
                        <Target className="h-4 w-4 mr-2" /> North Star
                      </Button>
                    </SheetClose>
                    <SheetClose asChild>
                      <Button variant="ghost" className="justify-start" onClick={() => navigate("/coaching")}>
                        <MessageSquare className="h-4 w-4 mr-2" /> AI Coach
                      </Button>
                    </SheetClose>
                    {auditCompleted && (
                      <SheetClose asChild>
                        <Button variant="ghost" className="justify-start" onClick={() => navigate("/report")}>
                          <FileText className="h-4 w-4 mr-2" /> Report
                        </Button>
                      </SheetClose>
                    )}
                    <SheetClose asChild>
                      <Button variant="ghost" className="justify-start" onClick={() => navigate("/settings")}>
                        <Settings className="h-4 w-4 mr-2" /> Settings
                      </Button>
                    </SheetClose>
                    {profile?.plan_tier === "coach" && (
                      <SheetClose asChild>
                        <Button variant="ghost" className="justify-start" onClick={() => navigate("/coach")}>
                          <Users className="h-4 w-4 mr-2" /> Coach Portal
                        </Button>
                      </SheetClose>
                    )}
                    {isAdmin && (
                      <SheetClose asChild>
                        <Button variant="ghost" className="justify-start" onClick={() => navigate("/admin")}>
                          <Shield className="h-4 w-4 mr-2" /> Admin
                        </Button>
                      </SheetClose>
                    )}
                  </nav>
                  <div className="mt-auto border-t border-border px-4 py-4">
                    <Button variant="ghost" className="w-full justify-start text-destructive" onClick={() => { void signOut().catch(() => toast({ title: "Sign out failed", description: "You are still signed in. Please try again.", variant: "destructive" })); }}>
                      <LogOut className="h-4 w-4 mr-2" /> Sign out
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </nav>

      <AppBreadcrumb />

      <div className="relative container mx-auto px-4 py-6 max-w-6xl">
        {/* Dashboard card — mirrors the hero mock container */}
        <div className="rounded-[28px] border border-white/50 bg-background/90 shadow-[0_30px_120px_rgba(15,23,42,0.14)] backdrop-blur-xl">

          {/* Header bar — logo + title + momentum badge */}
          <div className="flex flex-col gap-2 border-b border-border/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-6 md:py-4">
            <div className="flex items-center gap-3">
              <Link to="/" className="flex items-center">
                <img src={logo} alt="Intentus" className="h-7 w-auto cursor-pointer sm:h-8" />
              </Link>
              <div>
                <p className="text-xs font-semibold text-foreground sm:text-sm">
                  Operating Dashboard
                  {profile?.display_name ? ` — ${profile.display_name}` : ""}
                </p>
                <p className="text-[10px] text-muted-foreground sm:text-xs">Weekly executive snapshot</p>
              </div>
            </div>
            <div className="hidden md:flex items-center gap-3">
              {activeLens && (
                <div className="flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
                  <Sparkles className="h-3.5 w-3.5" /> {formatLensLabel(activeLens)}
                </div>
              )}
              {momentumLabel && (
                <div className="flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
                  <TrendingUp className="h-3.5 w-3.5" /> {momentumLabel}
                </div>
              )}
            </div>
          </div>

          {/* Quarterly Re-Audit Discovery Banner */}
          {auditCompleted &&
            (planTier === "premium" || planTier === "coach") &&
            lastAuditAt &&
            differenceInDays(new Date(), lastAuditAt) >= 90 && (
              <div className="mx-4 mt-4 md:mx-6 flex flex-col gap-3 rounded-2xl border border-accent/30 bg-gradient-to-r from-accent/15 via-background to-background p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-heading font-bold text-foreground">🔄 Quarterly Audit Available</h3>
                  <p className="text-sm text-muted-foreground">
                    Your operating reality has shifted. Run your Q{auditCount + 1} audit to refresh your report and 90-day plan.
                  </p>
                </div>
                <Button variant="hero" size="sm" onClick={() => navigate("/audit?reaudit=true")}>
                  Start Re-Audit <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            )}

          {user && <div className="mx-4 mt-4 space-y-4 md:mx-6">
            <GettingStarted key={`start:${user.id}`} userId={user.id} />
            <ProgressStory key={`progress:${user.id}`} userId={user.id} />
            <Link className="inline-block text-sm text-primary underline" to="/sharing">Review human-coach sharing and feedback</Link>
          </div>}

          {/* Main grid — matches hero mock layout */}
          <div className="grid min-w-0 grid-cols-1 gap-4 p-4 md:grid-cols-[minmax(0,1.6fr)_minmax(0,0.95fr)] md:p-6 [&>*]:min-w-0">
            {/* Left column */}
            <div className="space-y-4">
              {/* Top row: Momentum trend + Operating scorecard */}
              <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] [&>*]:min-w-0">
                {/* Momentum trend chart */}
                <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Momentum trend</p>
                      <p className="text-xs text-muted-foreground">Focus and energy from recent check-ins</p>
                    </div>
                    <div className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                      Last {trendData.length || trendWindow} {trendData.length === 1 ? "check-in" : "check-ins"}
                    </div>
                  </div>
                  <div className="h-56">
                    {hasTrendData ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendData}>
                          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="label" axisLine={false} tickLine={false} />
                          <YAxis domain={[0, 100]} axisLine={false} tickLine={false} width={28} />
                          <Tooltip
                            cursor={{ stroke: "hsl(var(--border))", strokeDasharray: "4 4" }}
                            contentStyle={{
                              borderRadius: 12,
                              border: "1px solid hsl(var(--border))",
                              background: "hsl(var(--background))",
                            }}
                          />
                          <Line type="monotone" dataKey="focus" name="Focus" stroke="hsl(var(--primary))" strokeWidth={3} dot={{ r: 0 }} activeDot={{ r: 5 }} connectNulls />
                          <Line type="monotone" dataKey="energy" name="Energy" stroke="hsl(var(--accent))" strokeWidth={3} dot={{ r: 0 }} activeDot={{ r: 5 }} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground text-center">
                        Your trend view populates from real check-ins, not filler data. Complete a check-in to start plotting your rhythm.
                      </div>
                    )}
                  </div>
                </div>

                {/* Operating scorecard */}
                <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
                  <div className="mb-4 flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    <p className="text-sm font-semibold text-foreground">Operating scorecard</p>
                  </div>
                  <div className="space-y-4">
                    {scorecardItems.map((metric) => (
                      <div key={metric.label} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{metric.label}</span>
                          <span className="font-medium text-foreground">{metric.value !== null ? `${metric.value}%` : "—"}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${metric.label === "Drift" ? "bg-accent" : "bg-gradient-primary"}`}
                            style={{ width: `${metric.value ?? 0}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Calibration: promises vs follow-through (Executive+ only) */}
              {user && profile?.plan_tier && profile.plan_tier !== "free" && (
                <CalibrationWidget userId={user.id} />
              )}

              {/* Bottom row: 90-day plan / This Week + Coach summary */}
              <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] [&>*]:min-w-0">
                {/* This Week / Commitments */}
                <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">This week's focus</p>
                      <p className="text-xs text-muted-foreground">Commitments tied to your operating sprint</p>
                    </div>
                    <Target className="h-4 w-4 text-primary" />
                  </div>

                  {/* One Thing streak */}
                  <OneThingStreak history={recentCommitmentHistory} />



                  {/* The one thing */}
                  {currentCommitment ? (
                    <div className="mb-3 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-3">
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        01
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{currentCommitment.commitment}</p>
                        <p className="text-xs text-muted-foreground">This week's one thing</p>
                      </div>
                    </div>
                  ) : (
                    <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-dashed border-border/70 bg-background/70 px-3 py-3">
                      <p className="text-sm text-muted-foreground">What's your one thing this week?</p>
                      <Button variant="outline" size="sm" onClick={() => setShowOneThingModal(true)}>Set it</Button>
                    </div>
                  )}

                  {/* Recent commitments from check-in */}
                  <div className="space-y-2">
                    {recentCommitments.slice(0, 2).map((commitment, index) => (
                      <div key={commitment} className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/70 px-3 py-3">
                        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          0{index + 2}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{commitment}</p>
                          <p className="text-xs text-muted-foreground">From latest check-in</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {lastCommitment?.outcome && (
                    <div className="mt-3 flex items-center gap-1.5">
                      <Circle
                        className={`h-2.5 w-2.5 fill-current ${
                          lastCommitment.outcome === "yes"
                            ? "text-green-500"
                            : lastCommitment.outcome === "partially"
                            ? "text-yellow-500"
                            : "text-destructive"
                        }`}
                      />
                      <span className="text-xs text-muted-foreground">
                        Last week: {lastCommitment.outcome === "yes" ? "Done" : lastCommitment.outcome === "partially" ? "Partial" : "Missed"}
                      </span>
                    </div>
                  )}
                </div>

                {/* Coach summary */}
                <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Coach summary</p>
                      <p className="text-xs text-muted-foreground">Quick-glance context for your next conversation</p>
                    </div>
                    {driftRate !== null && driftRate > 30 && (
                      <div className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">1 open risk</div>
                    )}
                  </div>

                  {/* Operating focus */}
                  <div className="mb-4 rounded-xl border border-primary/15 bg-primary/5 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-primary/80">Current operating focus</p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {northStarFocus || "Complete your audit to generate a focused operating plan."}
                    </p>
                  </div>

                  <div className="space-y-3">
                    {coachingSignals.map((signal) => (
                      <div key={signal.label} className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2 text-sm">
                        <span className="text-muted-foreground">{signal.label}</span>
                        <span className="font-medium text-foreground">{signal.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Right column */}
            <div className="space-y-4">
              {/* Execution quality — area chart */}
              <div className="rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-background to-background p-4 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-primary/80">Weekly review</p>
                    <p className="text-lg font-semibold text-foreground">Execution quality</p>
                  </div>
                  <div className="rounded-full bg-background px-3 py-1 text-sm font-semibold text-primary shadow-sm">
                    {executionScore !== null ? `${executionScore}%` : "—"}
                  </div>
                </div>
                <div className="h-36">
                  {hasTrendData ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trendData}>
                        <defs>
                          <linearGradient id="dashArea" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" axisLine={false} tickLine={false} />
                        <Tooltip
                          contentStyle={{
                            borderRadius: 12,
                            border: "1px solid hsl(var(--border))",
                            background: "hsl(var(--background))",
                          }}
                        />
                        <Area type="monotone" dataKey="focus" name="Focus" stroke="hsl(var(--primary))" fill="url(#dashArea)" strokeWidth={2.5} connectNulls />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Check-in data needed
                    </div>
                  )}
                </div>
                {hasTrendData && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <ArrowUpRight className="h-3.5 w-3.5 text-primary" /> Trend reflects follow-through across the current sprint.
                  </div>
                )}
              </div>

              {/* Quick stats row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-border/70 bg-card/90 p-3 text-center">
                  <Flame className="h-5 w-5 text-accent mx-auto mb-1" />
                  <p className="text-lg font-bold text-foreground">{streak}</p>
                  <p className="text-xs text-muted-foreground">Day streak</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-card/90 p-3 text-center">
                  <AlertTriangle className="h-5 w-5 text-accent mx-auto mb-1" />
                  <p className="text-lg font-bold text-foreground">{driftCount}</p>
                  <p className="text-xs text-muted-foreground">Drift flags</p>
                </div>
              </div>

              {/* Next actions */}
              <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <p className="text-sm font-semibold text-foreground">Next actions</p>
                </div>
                <div className="space-y-2">
                  {nextActions.slice(0, 3).map((item) => (
                    <button
                      type="button"
                      key={item}
                      className="flex w-full items-center justify-between rounded-xl border border-border/60 bg-background/80 px-3 py-2.5 text-left text-sm cursor-pointer hover:border-primary/30 transition-colors"
                      onClick={() => {
                        if (item.includes("audit")) navigate("/audit");
                        else if (item.includes("report")) navigate("/report");
                        else if (item.includes("check-in") || item.includes("commitments")) navigate("/check-in");
                        else if (item.includes("one thing")) setShowOneThingModal(true);
                      }}
                    >
                      <span className="text-foreground">{item}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </div>

              {/* AI Coach teaser — free tier only */}
              {planTier === "free" && (
                <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-background to-background p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <p className="text-sm font-semibold text-foreground">Executive unlocks your AI Operating Coach</p>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    Ongoing AI coaching, personalized check-in debriefs, and drift accountability — all tied to your audit and 90-day plan.
                  </p>
                  <Button variant="hero" size="sm" className="w-full" onClick={() => navigate("/subscribe")}>
                    See plans — from $39.99/mo <ArrowRight className="ml-2 h-3.5 w-3.5" />
                  </Button>
                </div>
              )}


              {/* Coach Notes — only when client has a coach with visible notes */}
              {coachNotes.length > 0 && (
                <div className="rounded-2xl border border-primary/30 bg-card/90 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-primary" />
                    <p className="text-sm font-semibold text-foreground">From Your Coach</p>
                  </div>
                  <div className="space-y-2">
                    {coachNotes.map((n) => (
                      <div key={n.id} className="rounded-xl bg-muted/40 px-3 py-2.5">
                        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{n.content}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent check-ins */}
              <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  <p className="text-sm font-semibold text-foreground">Recent check-ins</p>
                </div>
                {checkIns.length > 0 ? (
                  <div className="space-y-2">
                    {checkIns.slice(0, 4).map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2 text-sm">
                        <span className="text-muted-foreground">{format(new Date(c.created_at), "MMM d")}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-foreground">F: {c.mood_score ?? "—"}</span>
                          <span className="text-foreground">E: {c.energy_score ?? "—"}</span>
                          {c.drift_detected && <AlertTriangle className="h-3.5 w-3.5 text-accent" />}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No check-ins yet. Start one when you can answer honestly.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* One Thing Modal */}
      {showOneThingModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowOneThingModal(false)}>
          <div className="bg-card rounded-2xl border border-border p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-heading font-bold text-foreground">What's the one thing this week?</h3>
            <p className="text-sm text-muted-foreground">If you actually did this — and nothing else — it would make the most difference.</p>
            <Input
              value={oneThingInput}
              onChange={(e) => setOneThingInput(e.target.value)}
              placeholder="This week I will..."
              onKeyDown={(e) => e.key === "Enter" && handleSaveOneThing()}
              autoFocus
            />
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowOneThingModal(false)}>Cancel</Button>
              <Button variant="hero" className="flex-1" onClick={handleSaveOneThing} disabled={oneThingSaving || !oneThingInput.trim()}>
                {oneThingSaving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default Dashboard;
