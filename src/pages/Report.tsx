import { useCallback, useEffect, useState, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import AppBreadcrumb from "@/components/AppBreadcrumb";
import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage } from "@/lib/function-errors";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Printer, Target, AlertTriangle,
  Crosshair, Calendar, TrendingUp, Eye, Zap, CheckCircle, Layers, BrainCircuit,
  RefreshCw, ChevronDown, ChevronUp, Clock,
  RotateCcw, CheckCircle2, Circle, Download, Loader2, Pencil,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { brandLogo as logo } from "@/lib/brand";
import { formatLensLabel, type IntentModel } from "@/lib/intentus-architecture";
import { canReaudit, archiveAndResetAudit, getAuditHistory, type AuditHistoryEntry } from "@/lib/reaudit";
import { needsReportForAudit, normalizeContradictions, normalizeEditedPlan, normalizePatternAnalysis, usablePatternIntel } from "@/lib/report-data";
import { format } from "date-fns";

interface PatternAnalysis {
  themes: { title: string; description: string; areas_affected: string[] }[];
  strengths: string[];
  blind_spots: string[];
}

interface Contradiction {
  stated: string;
  actual: string;
  impact: string;
}

interface Phase {
  title: string;
  actions: string[];
}

interface NinetyDayPlan {
  phase_1: Phase;
  phase_2: Phase;
  phase_3: Phase;
}

interface StrategicReport {
  id: string;
  audit_id?: string | null;
  created_at: string;
  pattern_analysis: PatternAnalysis;
  contradictions: Contradiction[];
  forced_choice: string;
  north_star_focus: string;
  ninety_day_plan: NinetyDayPlan;
  intent_model?: IntentModel | null;
  edited_ninety_day_plan?: any[] | null;
}


const Report = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [report, setReport] = useState<StrategicReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  // Re-audit state
  const [planTier, setPlanTier] = useState<string>("free");
  const [reauditEligible, setReauditEligible] = useState(false);
  const [reauditReason, setReauditReason] = useState<string | undefined>();
  const [nextEligibleDate, setNextEligibleDate] = useState<Date | undefined>();
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [reauditInProgress, setReauditInProgress] = useState(false);
  const [auditHistory, setAuditHistory] = useState<AuditHistoryEntry[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  const actionFlight = useRef(false);
  const [completions, setCompletions] = useState<Record<string, boolean>>({});
  const [editedPlan, setEditedPlan] = useState<any[] | null>(null);
  const [editingPhase, setEditingPhase] = useState<number | null>(null);
  const [editingAction, setEditingAction] = useState<{phase: number; action: number} | null>(null);
  const [editActionText, setEditActionText] = useState('');
  const [refreshingPlan, setRefreshingPlan] = useState(false);
  const [patternIntel, setPatternIntel] = useState<any>(null);
  const [loadingPatternIntel, setLoadingPatternIntel] = useState(false);
  const [patternIntelLoaded, setPatternIntelLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    const loadReport = async () => {
      const reportId = searchParams.get("id");

      if (reportId) {
        const { data } = await supabase
          .from("strategic_reports")
          .select("*")
          .eq("id", reportId)
          .eq("user_id", user.id)
          .single();
        if (data) setReport(data as unknown as StrategicReport);
        setLoading(false);
        return;
      }

      // Load latest report and the newest completed audit together: a newer
      // completed audit without its own report must not keep showing the old one.
      const [{ data }, { data: audit }] = await Promise.all([
        supabase
          .from("strategic_reports")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1),
        supabase
          .from("baseline_audits")
          .select("id")
          .eq("user_id", user.id)
          .eq("status", "completed")
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
      const latestReport = (data?.[0] ?? null) as unknown as StrategicReport | null;

      if (latestReport && !needsReportForAudit(latestReport, audit?.[0])) {
        setReport(latestReport);
        setLoading(false);
        return;
      }

      if (audit && audit.length > 0) {
        // Keep the previous report as a fallback if generation fails.
        if (latestReport) setReport(latestReport);
        setGenerating(true);
        setLoading(false);
        try {
          const { data: fnData, error: fnError } = await supabase.functions.invoke("generate-report", {
            body: { audit_id: audit[0].id },
          });
          if (fnError) throw new Error(await functionErrorMessage(fnError, "Report generation failed. Please try again."));

          // Reload report
          const { data: newReport } = await supabase
            .from("strategic_reports")
            .select("*")
            .eq("id", fnData.report_id)
            .single();
          if (newReport) setReport(newReport as unknown as StrategicReport);
        } catch (e: unknown) {
          const err = e as { message?: string };
          toast({ title: "Error generating report", description: err.message, variant: "destructive" });
        } finally {
          setGenerating(false);
        }
      } else {
        setLoading(false);
      }
    };
    loadReport();
  }, [user]);

  // Load re-audit eligibility and history after report is available
  const loadReauditData = useCallback(async () => {
    if (!user) return;
    try {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("plan_tier")
        .eq("user_id", user.id)
        .single();
      const tier = profileData?.plan_tier ?? "free";
      setPlanTier(tier);

      if (tier === "premium" || tier === "coach") {
        const result = await canReaudit(user.id);
        setReauditEligible(result.eligible);
        setReauditReason(result.reason);
        setNextEligibleDate(result.nextEligibleDate);

        const history = await getAuditHistory(user.id);
        setAuditHistory(history);
      }
    } catch (err) {
      toast({ title: "Failed to load", description: "Please refresh and try again.", variant: "destructive" });
      console.error(err);
    }
  }, [user, toast]);

  useEffect(() => {
    loadReauditData();
  }, [loadReauditData]);

  // Load action completions
  const loadCompletions = useCallback(async () => {
    if (!user || !report) return;
    try {
      const { data } = await supabase
        .from('plan_action_completions')
        .select('phase_index, action_index')
        .eq('user_id', user.id)
        .eq('report_id', report.id);
      if (data) {
        const map: Record<string, boolean> = {};
        data.forEach(c => { map[`${c.phase_index}-${c.action_index}`] = true; });
        setCompletions(map);
      }
    } catch (err) {
      toast({ title: "Failed to load", description: "Please refresh and try again.", variant: "destructive" });
      console.error(err);
    }
  }, [user, report, toast]);

  useEffect(() => {
    loadCompletions();
  }, [loadCompletions]);

  // The edited plan belongs to the loaded report. Reset it whenever a different
  // report is shown (e.g. the fallback report is replaced by a newly generated
  // one), and never re-apply it on unrelated re-renders, which would revert
  // in-session action edits or a plan refresh.
  useEffect(() => {
    setEditedPlan(normalizeEditedPlan(report?.edited_ninety_day_plan));
  }, [report]);

  const handleConfirmReaudit = async () => {
    if (!user) return;
    setReauditInProgress(true);
    try {
      await archiveAndResetAudit(user.id);
      toast({ title: "Audit archived", description: "Starting your new operating audit." });
      navigate("/audit");
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast({ title: "Re-audit failed", description: err.message ?? "Something went wrong.", variant: "destructive" });
    } finally {
      setReauditInProgress(false);
      setShowConfirmModal(false);
    }
  };

  const activePlan = editedPlan || (report?.ninety_day_plan ? [
    { ...(report.ninety_day_plan as any).phase_1, phase_label: 'Days 1–30', _phaseIdx: 0 },
    { ...(report.ninety_day_plan as any).phase_2, phase_label: 'Days 31–60', _phaseIdx: 1 },
    { ...(report.ninety_day_plan as any).phase_3, phase_label: 'Days 61–90', _phaseIdx: 2 },
  ] : null);

  const toggleActionComplete = async (phaseIdx: number, actionIdx: number) => {
    if (!user || !report || actionFlight.current) return;
    actionFlight.current = true;
    const key = `${phaseIdx}-${actionIdx}`;
    const isDone = completions[key];
    try {
      const query = isDone
        ? supabase.from('plan_action_completions').delete().eq('user_id', user.id).eq('report_id', report.id).eq('phase_index', phaseIdx).eq('action_index', actionIdx)
        : supabase.from('plan_action_completions').insert({ user_id: user.id, report_id: report.id, phase_index: phaseIdx, action_index: actionIdx });
      const { data, error } = await query.select('report_id, phase_index, action_index').single();
      if (error) throw error;
      if (!data || data.report_id !== report.id || data.phase_index !== phaseIdx || data.action_index !== actionIdx) throw new Error('Action update was not acknowledged. Reload before retrying.');
      setCompletions(prev => { const next = {...prev}; if (isDone) delete next[key]; else next[key] = true; return next; });
    } catch (error) {
      toast({ title: 'Action not saved', description: error instanceof Error ? error.message : 'Please retry.', variant: 'destructive' });
    } finally { actionFlight.current = false; }
  };

  const saveActionEdit = async (phaseIdx: number, actionIdx: number) => {
    if (!user || !report || !editActionText.trim() || actionFlight.current) return;
    actionFlight.current = true;
    try {
    const base = (editedPlan || [
      { ...(report.ninety_day_plan as any).phase_1, phase_label: 'Days 1–30', _phaseIdx: 0 },
      { ...(report.ninety_day_plan as any).phase_2, phase_label: 'Days 31–60', _phaseIdx: 1 },
      { ...(report.ninety_day_plan as any).phase_3, phase_label: 'Days 61–90', _phaseIdx: 2 },
    ]) as any[];
    const updated = base.map((phase: any, pi: number) => pi !== phaseIdx ? phase : {
      ...phase,
      actions: phase.actions.map((a: string, ai: number) => ai !== actionIdx ? a : editActionText.trim()),
    });
    const { data, error } = await supabase.from('strategic_reports').update({
      edited_ninety_day_plan: updated, last_edited_at: new Date().toISOString(), last_edited_by: user?.id,
    }).eq('id', report.id).eq('user_id', user.id).select('id, edited_ninety_day_plan').single();
    if (error || data?.id !== report.id) {
      toast({ title: 'Action not saved', description: error?.message || 'Update was not acknowledged', variant: 'destructive' });
      return;
    }
    setEditedPlan(data.edited_ninety_day_plan as any[]);
    setEditingAction(null);
    setEditActionText('');
    toast({ title: 'Action updated' });
    } catch (error) {
      toast({ title: 'Action not saved', description: error instanceof Error ? error.message : 'Please retry.', variant: 'destructive' });
    } finally { actionFlight.current = false; }
  };

  const handleRefreshPlan = async () => {
    if (!user || !report) return;
    setRefreshingPlan(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refresh-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ reportId: report.id }),
      });
      const json = await res.json();
      const refreshed = json.success ? normalizeEditedPlan(json.refreshed_plan) : null;
      if (refreshed) {
        setEditedPlan(refreshed);
        toast({ title: 'Plan refreshed', description: 'Your 90-day plan has been updated based on your check-in patterns.' });
      } else {
        toast({ title: 'Refresh failed', description: json.error || 'Unable to refresh plan.', variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Refresh failed', variant: 'destructive' });
    } finally {
      setRefreshingPlan(false);
    }
  };

  const handleLoadPatternIntel = async () => {
    if (!user || patternIntelLoaded) return;
    setLoadingPatternIntel(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pattern-intelligence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({}),
      });
      const json = usablePatternIntel(res.ok, await res.json().catch(() => null));
      if (!json) throw new Error("Pattern analysis unavailable");
      setPatternIntel(json);
      setPatternIntelLoaded(true);
      // Persist only real results so an error body is never cached as analysis.
      if (report && !json.insufficient_data) {
        await supabase
          .from('strategic_reports')
          .update({ pattern_intelligence: json as Json })
          .eq('id', report.id);
      }
    } catch (e) {
      toast({ title: 'Could not load pattern analysis', variant: 'destructive' });
    } finally {
      setLoadingPatternIntel(false);
    }
  };

  // Auto-load Pattern Intelligence: hydrate from DB if cached, otherwise
  // trigger generation once when the user has at least 2 audits.
  useEffect(() => {
    if (!user || !report) return;
    const cached = usablePatternIntel(true, (report as unknown as { pattern_intelligence?: unknown }).pattern_intelligence);
    if (cached && !patternIntelLoaded) {
      setPatternIntel(cached);
      setPatternIntelLoaded(true);
      return;
    }
    if (!patternIntelLoaded && !loadingPatternIntel && auditHistory.length >= 2) {
      handleLoadPatternIntel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, report, auditHistory.length]);


  const handleExportText = () => {
    if (!report) return;
    const plan = activePlan as any[];
    const lines = [
      `INTENTUS OPERATING PLAN`,
      `Generated: ${new Date(report.created_at).toLocaleDateString()}`,
      ``,
      `NORTH STAR FOCUS`,
      report.north_star_focus,
      ``,
      `90-DAY PLAN`,
      ...(plan || []).flatMap((phase: any) => [
        ``,
        `${phase.phase_label}: ${phase.title}`,
        ...(phase.actions || []).map((a: string, i: number) => `  ${i + 1}. ${a}`),
      ]),
      ``,
      `FORCED CHOICE`,
      report.forced_choice,
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'intentus-plan.txt'; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }
  if (generating) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto" />
          <h2 className="font-heading text-xl font-bold text-foreground">Generating your Operating Report…</h2>
          <p className="text-muted-foreground text-sm max-w-md">Intentus is analyzing your audit responses for strengths, weaknesses, blind spots, contradictions, and your next 90-day operating plan. This may take 30–60 seconds.</p>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <h2 className="font-heading text-xl font-bold text-foreground">No report yet</h2>
          <p className="text-muted-foreground">Complete your operating audit first to generate your report.</p>
          <Button variant="hero" onClick={() => navigate("/audit")}>Start Audit</Button>
        </div>
      </div>
    );
  }

  const { forced_choice, north_star_focus, intent_model } = report;
  const pattern_analysis = normalizePatternAnalysis(report.pattern_analysis);
  const contradictions = normalizeContradictions(report.contradictions);
  const isPremiumTier = planTier === "premium" || planTier === "coach";

  return (
    <div className="min-h-screen bg-background">
      {/* Nav - hidden in print */}
      <nav className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10 print:hidden">
        <div className="container mx-auto flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            <Link to="/" className="flex items-center">
              <img src={logo} alt="Intentus" className="h-7 w-auto cursor-pointer" />
            </Link>
            <span className="font-heading text-base font-bold text-foreground sm:text-lg">Operating Report</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")} className="px-2 sm:px-3">
              <ArrowLeft className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">Dashboard</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()} className="px-2 sm:px-3">
              <Printer className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">Print / PDF</span>
            </Button>
          </div>
        </div>
      </nav>

      <AppBreadcrumb />

      <div className="container mx-auto px-4 py-8 max-w-3xl print:max-w-none print:py-0">
        {/* Print header */}
        <div className="hidden print:block mb-8 pt-4">
          <div className="flex items-center gap-2 mb-2">
            <img src={logo} alt="Intentus" className="h-8 w-auto print:h-8" />
            <span className="font-heading text-2xl font-bold">Operating Report</span>
          </div>
          <p className="text-sm text-muted-foreground">Generated {new Date(report.created_at).toLocaleDateString()}</p>
        </div>

        {/* Strategic Focus */}
        <section className="mb-8">
          <div className="bg-gradient-subtle rounded-2xl p-8 border border-primary/20 text-center print:border print:border-foreground/20">
            <Crosshair className="h-8 w-8 text-accent mx-auto mb-3" />
            <h2 className="font-heading text-sm font-semibold text-primary uppercase tracking-wider mb-2">Your Current Priority</h2>
            <p className="font-heading text-2xl font-bold text-foreground leading-relaxed">{north_star_focus}</p>
            <p className="mt-3 text-sm text-muted-foreground">Protect this priority. Drift usually starts when secondary concerns start sounding equally urgent.</p>
          </div>
        </section>

        {intent_model?.primary_lens && (
          <section className="mb-8 print:break-inside-avoid">
            <h2 className="font-heading text-xl font-bold text-foreground mb-4 flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" /> Adaptive Coaching Architecture
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="bg-card rounded-xl border border-border p-5">
                <p className="text-xs uppercase tracking-wider text-primary mb-2">Active lenses</p>
                <p className="font-heading text-lg font-bold text-foreground">{formatLensLabel(intent_model.primary_lens)}</p>
                <p className="text-sm text-muted-foreground mt-1">Supported by {formatLensLabel(intent_model.secondary_lens)}</p>
                <p className="text-sm text-foreground mt-4">{intent_model.lens_rationale}</p>
                <p className="text-sm text-muted-foreground mt-4">{intent_model.report_framing}</p>
              </div>
              <div className="bg-card rounded-xl border border-border p-5">
                <p className="text-xs uppercase tracking-wider text-primary mb-2">Coaching posture</p>
                <p className="text-sm text-foreground mb-4">{intent_model.coaching_posture}</p>
                <p className="text-xs uppercase tracking-wider text-primary/80 mb-2">Background threads</p>
                <div className="flex flex-wrap gap-2">
                  {intent_model.background_threads?.map((thread) => (
                    <span key={thread} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">{thread}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 bg-card rounded-xl border border-border p-5">
              <h3 className="font-heading font-semibold text-foreground mb-3 flex items-center gap-2">
                <BrainCircuit className="h-4 w-4 text-accent" /> Core anchor emphasis
              </h3>
              <div className="grid gap-3 md:grid-cols-2">
                {intent_model.anchor_emphasis?.map((anchor) => (
                  <div key={anchor.name} className="rounded-xl border border-border/70 bg-background/70 p-4">
                    <p className="font-medium text-foreground">{anchor.name}</p>
                    <p className="text-sm text-muted-foreground mt-1">{anchor.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Pattern Analysis */}
        <section className="mb-8 print:break-inside-avoid">
          <h2 className="font-heading text-xl font-bold text-foreground mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" /> Pattern Analysis
          </h2>

          {/* Themes */}
          <div className="space-y-4 mb-6">
            {pattern_analysis.themes.map((theme, i) => (
              <div key={i} className="bg-card rounded-xl border border-border p-5 print:break-inside-avoid">
                <h3 className="font-heading font-bold text-foreground mb-1">{theme.title}</h3>
                <p className="text-sm text-muted-foreground mb-2">{theme.description}</p>
                <div className="flex flex-wrap gap-1">
                  {theme.areas_affected.map((area) => (
                    <span key={area} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{area}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Strengths & Blind Spots */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="font-heading font-semibold text-foreground mb-3 flex items-center gap-2">
                <Zap className="h-4 w-4 text-accent" /> Strengths
              </h3>
              <ul className="space-y-2">
                {pattern_analysis.strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span className="text-foreground">{s}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="font-heading font-semibold text-foreground mb-3 flex items-center gap-2">
                <Eye className="h-4 w-4 text-accent" /> Blind Spots
              </h3>
              <ul className="space-y-2">
                {pattern_analysis.blind_spots.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <AlertTriangle className="h-4 w-4 text-accent mt-0.5 shrink-0" />
                    <span className="text-foreground">{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Contradictions */}
        <section className="mb-8 print:break-inside-avoid">
          <h2 className="font-heading text-xl font-bold text-foreground mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-accent" /> Contradictions
          </h2>
          <div className="space-y-4">
            {contradictions.map((c, i) => (
              <div key={i} className="bg-card rounded-xl border border-border p-5 print:break-inside-avoid">
                <div className="grid md:grid-cols-2 gap-4 mb-3">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">What you say</p>
                    <p className="text-sm text-foreground font-medium">"{c.stated}"</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">What you do</p>
                    <p className="text-sm text-foreground font-medium">"{c.actual}"</p>
                  </div>
                </div>
                <p className="text-sm text-accent font-medium">Impact: {c.impact}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Forced Choice */}
        <section className="mb-8 print:break-inside-avoid">
          <h2 className="font-heading text-xl font-bold text-foreground mb-4 flex items-center gap-2">
            <Crosshair className="h-5 w-5 text-primary" /> The Forced Choice
          </h2>
          <div className="bg-gradient-subtle rounded-2xl p-6 border border-primary/20 print:border print:border-foreground/20">
            <p className="text-foreground leading-relaxed">{forced_choice}</p>
            <p className="text-sm text-muted-foreground mt-4">Don't soften this for comfort. Agreement matters because this is the tradeoff your next quarter will actually be built on.</p>
          </div>
        </section>

        {/* 90-Day Plan */}
        <section className="mb-8 print:break-inside-avoid">
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <h2 className="font-heading text-xl font-bold text-foreground flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" /> 90-Day Plan
            </h2>
            {editedPlan && (
              <Badge variant="outline" className="text-xs text-primary border-primary/40">Refreshed</Badge>
            )}
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={handleExportText} className="print:hidden">
              <Download className="h-4 w-4 mr-1.5" /> Export
            </Button>
            {isPremiumTier && (
              <Button variant="outline" size="sm" onClick={handleRefreshPlan} disabled={refreshingPlan} className="print:hidden">
                {refreshingPlan ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-1.5" />}
                Refresh Plan
              </Button>
            )}
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            {(activePlan as any[] | null || []).map((phase: any, phaseIdx: number) => {
              const phaseLabel = phase.phase_label || (phaseIdx === 0 ? 'Days 1–30' : phaseIdx === 1 ? 'Days 31–60' : 'Days 61–90');
              const actions: string[] = phase.actions || [];
              const doneCount = actions.filter((_: string, ai: number) => completions[`${phaseIdx}-${ai}`]).length;
              return (
                <div key={phaseIdx} className="bg-card rounded-xl border border-border p-5 print:break-inside-avoid">
                  <p className="text-xs text-primary uppercase tracking-wider font-semibold mb-1">{phaseLabel}</p>
                  <h3 className="font-heading font-bold text-foreground mb-1">{phase.title}</h3>
                  {doneCount > 0 && (
                    <p className="text-xs text-muted-foreground mb-3">{doneCount}/{actions.length} complete</p>
                  )}
                  {doneCount === 0 && <div className="mb-3" />}
                  <ul className="space-y-2">
                    {actions.map((a: string, actionIdx: number) => {
                      const key = `${phaseIdx}-${actionIdx}`;
                      const isDone = !!completions[key];
                      const isEditing = editingAction?.phase === phaseIdx && editingAction?.action === actionIdx;
                      return (
                        <li key={actionIdx} className="text-sm group">
                          {isEditing ? (
                            <div className="space-y-2">
                              <Input
                                value={editActionText}
                                onChange={e => setEditActionText(e.target.value)}
                                className="text-sm"
                                autoFocus
                              />
                              <div className="flex gap-2">
                                <Button size="sm" variant="default" onClick={() => saveActionEdit(phaseIdx, actionIdx)}>Save</Button>
                                <Button size="sm" variant="ghost" onClick={() => { setEditingAction(null); setEditActionText(''); }}>Cancel</Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start gap-2">
                              <button
                                className="mt-0.5 shrink-0 print:hidden"
                                onClick={() => toggleActionComplete(phaseIdx, actionIdx)}
                                aria-label={isDone ? `Mark not done: ${a}` : `Mark done: ${a}`}
                                aria-pressed={isDone}
                              >
                                {isDone
                                  ? <CheckCircle2 className="h-4 w-4 text-primary" />
                                  : <Circle className="h-4 w-4 text-muted-foreground" />
                                }
                              </button>
                              <span className={isDone ? 'line-through text-muted-foreground flex-1' : 'text-foreground flex-1'}>{a}</span>
                              <button
                                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity shrink-0 print:hidden"
                                onClick={() => { setEditingAction({ phase: phaseIdx, action: actionIdx }); setEditActionText(a); }}
                                aria-label={`Edit action: ${a}`}
                              >
                                <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        {/* Disclaimer */}
        <section className="mb-8 text-center print:break-inside-avoid">
          <p className="text-xs text-muted-foreground">
            This report is AI-generated coaching guidance, not professional medical, legal, or financial advice.
            Always consult qualified professionals for critical decisions.
          </p>
        </section>

        {/* CTA - hidden in print */}
        <div className="text-center pb-8 print:hidden">
          <Button variant="hero" size="lg" onClick={() => navigate("/dashboard")}>
            Back to Dashboard <ArrowLeft className="ml-2 h-4 w-4" />
          </Button>
        </div>

        {/* ── Re-Audit Section (Premium/Coach only, hidden in print) ── */}
        {isPremiumTier && (
          <div className="print:hidden mb-8 space-y-4">
            {/* Re-audit card */}
            <div className="bg-card rounded-2xl border border-primary/20 p-6">
              <div className="flex items-start gap-4">
                <div className="rounded-xl bg-primary/10 p-3 shrink-0">
                  <RefreshCw className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-heading font-bold text-foreground mb-1">Ready for a fresh look?</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Your operating system evolves. A quarterly re-audit surfaces what's shifted — new blind spots, changed priorities, updated commitments.
                  </p>
                  {reauditEligible ? (
                    <Button
                      variant="hero"
                      size="sm"
                      onClick={() => setShowConfirmModal(true)}
                    >
                      <RefreshCw className="h-4 w-4 mr-1.5" /> Start Re-Audit
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      <Clock className="h-4 w-4 mr-1.5" />
                      {nextEligibleDate
                        ? `Available ${format(nextEligibleDate, "MMM d")}`
                        : reauditReason ?? "Not available"}
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Audit history */}
            {auditHistory.length > 0 && (
              <div className="bg-card rounded-2xl border border-border overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => setHistoryExpanded((v) => !v)}
                >
                  <span className="font-heading font-semibold text-foreground text-sm">
                    Past Audits ({auditHistory.length})
                  </span>
                  {historyExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>

                {historyExpanded && (
                  <div className="border-t border-border divide-y divide-border">
                    {auditHistory.map((entry) => {
                      const isOpen = expandedEntry === entry.id;
                      const reportSnap = entry.report_data as Record<string, string> | null;
                      return (
                        <div key={entry.id}>
                          <button
                            className="w-full flex items-center justify-between px-6 py-3 text-left hover:bg-muted/20 transition-colors"
                            onClick={() => setExpandedEntry(isOpen ? null : entry.id)}
                          >
                            <span className="text-sm text-foreground">
                              Audit #{entry.audit_number} — completed{" "}
                              {format(new Date(entry.completed_at), "MMM d, yyyy")}
                            </span>
                            {isOpen ? (
                              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            )}
                          </button>

                          {isOpen && reportSnap && (
                            <div className="px-6 pb-4 space-y-3 bg-muted/10">
                              {reportSnap.north_star_focus && (
                                <div>
                                  <p className="text-xs text-primary uppercase tracking-wider mb-1">Priority</p>
                                  <p className="text-sm text-foreground">{reportSnap.north_star_focus}</p>
                                </div>
                              )}
                              {reportSnap.forced_choice && (
                                <div>
                                  <p className="text-xs text-primary uppercase tracking-wider mb-1">Forced choice</p>
                                  <p className="text-sm text-foreground">{reportSnap.forced_choice}</p>
                                </div>
                              )}
                              {!reportSnap.north_star_focus && !reportSnap.forced_choice && (
                                <p className="text-sm text-muted-foreground">No report snapshot available for this audit.</p>
                              )}
                            </div>
                          )}

                          {isOpen && !reportSnap && (
                            <div className="px-6 pb-4 bg-muted/10">
                              <p className="text-sm text-muted-foreground">No report snapshot saved for this audit.</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {/* Pattern Intelligence (Premium/Coach only) */}
        {isPremiumTier && (
          <Card className="border-border mb-8 print:hidden">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-heading">Pattern Intelligence</CardTitle>
              </div>
              <p className="text-sm text-muted-foreground">Behavioral patterns across all your audit cycles.</p>
            </CardHeader>
            <CardContent>
              {auditHistory.length < 2 && !patternIntelLoaded && (
                <p className="text-sm text-muted-foreground">
                  Pattern Intelligence activates after your second quarterly audit.
                </p>
              )}
              {auditHistory.length >= 2 && loadingPatternIntel && (
                <div className="space-y-3 animate-pulse">
                  <div className="h-16 rounded-xl bg-muted/60" />
                  <div className="h-10 rounded-lg bg-muted/40" />
                  <div className="h-10 rounded-lg bg-muted/40" />
                </div>
              )}
              {patternIntel?.insufficient_data && (
                <p className="text-sm text-muted-foreground">{patternIntel.message}</p>
              )}
              {patternIntel && !patternIntel.insufficient_data && (
                <div className="space-y-5">
                  <div className="rounded-xl bg-primary/5 border border-primary/20 p-4">
                    <p className="text-sm font-semibold text-foreground">{patternIntel.executive_summary}</p>
                    <p className="mt-2 text-sm text-primary font-medium">→ {patternIntel.recommended_focus}</p>
                  </div>
                  {patternIntel.recurring_blind_spots?.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-2">Recurring Blind Spots</h4>
                      <div className="space-y-2">
                        {patternIntel.recurring_blind_spots.map((b: any, i: number) => (
                          <div key={i} className="rounded-lg border border-border bg-card p-3">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium text-foreground">{b.pattern}</p>
                              <Badge variant="outline" className="text-xs">{b.cycles_present} cycles</Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{b.evidence}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {patternIntel.growth_areas?.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-2">Growth Areas</h4>
                      <div className="space-y-2">
                        {patternIntel.growth_areas.map((g: any, i: number) => (
                          <div key={i} className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                            <p className="text-sm font-medium text-emerald-400">{g.area}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{g.evidence}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Confirmation Modal ── */}
      {showConfirmModal && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => !reauditInProgress && setShowConfirmModal(false)}
        >
          <div
            className="bg-card rounded-2xl border border-border p-6 w-full max-w-md space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-accent/10 p-2.5 shrink-0">
                <RefreshCw className="h-5 w-5 text-accent" />
              </div>
              <h3 className="font-heading font-bold text-foreground">Archive this audit and start fresh?</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Your current audit and report will be saved to your history. You'll begin a new 24-question audit. This cannot be undone.
            </p>
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowConfirmModal(false)}
                disabled={reauditInProgress}
              >
                Cancel
              </Button>
              <Button
                variant="hero"
                className="flex-1"
                onClick={handleConfirmReaudit}
                disabled={reauditInProgress}
              >
                {reauditInProgress ? (
                  <span className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    Archiving…
                  </span>
                ) : (
                  "Yes, start re-audit"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Report;
