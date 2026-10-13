import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Compass, ArrowLeft, Save, Target, AlertTriangle,
  Crosshair, Calendar, TrendingUp, Eye, Zap, CheckCircle,
  Pencil, X
} from "lucide-react";

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
  created_at: string;
  pattern_analysis: PatternAnalysis;
  contradictions: Contradiction[];
  forced_choice: string;
  north_star_focus: string;
  ninety_day_plan: NinetyDayPlan;
}

const CoachClientReport = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [report, setReport] = useState<StrategicReport | null>(null);
  const [clientName, setClientName] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editable state
  const [editNorthStar, setEditNorthStar] = useState("");
  const [editForcedChoice, setEditForcedChoice] = useState("");
  const [editPlan, setEditPlan] = useState<NinetyDayPlan | null>(null);

  useEffect(() => {
    if (!user || !clientId) return;
    const load = async () => {
      const [reportRes, profileRes] = await Promise.all([
        supabase.from("strategic_reports").select("*").eq("user_id", clientId).order("created_at", { ascending: false }).limit(1),
        supabase.from("profiles").select("display_name").eq("user_id", clientId).single(),
      ]);

      if (profileRes.data) setClientName((profileRes.data as any).display_name || "Client");
      if (reportRes.data && reportRes.data.length > 0) {
        const r = reportRes.data[0] as any;
        setReport(r);
        setEditNorthStar(r.north_star_focus || "");
        setEditForcedChoice(r.forced_choice || "");
        setEditPlan(r.ninety_day_plan);
      }
      setLoading(false);
    };
    load();
  }, [user, clientId]);

  const startEditing = () => {
    if (!report) return;
    setEditNorthStar(report.north_star_focus);
    setEditForcedChoice(report.forced_choice);
    setEditPlan({ ...report.ninety_day_plan });
    setEditing(true);
  };

  const saveChanges = async () => {
    if (!report) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("strategic_reports")
      .update({
        north_star_focus: editNorthStar,
        forced_choice: editForcedChoice,
        ninety_day_plan: editPlan as any,
      })
      .eq("id", report.id)
      .eq("user_id", clientId!)
      .select("id");

    // If the client revoked sharing or the link ended, RLS matches zero rows without an error.
    if (error || !data?.length) {
      toast({ title: "Error saving", description: error?.message || "You no longer have access to edit this client's plan.", variant: "destructive" });
    } else {
      setReport({
        ...report,
        north_star_focus: editNorthStar,
        forced_choice: editForcedChoice,
        ninety_day_plan: editPlan!,
      });
      setEditing(false);
      toast({ title: "Changes saved" });
    }
    setSaving(false);
  };

  const updatePhaseAction = (phase: "phase_1" | "phase_2" | "phase_3", actionIndex: number, value: string) => {
    if (!editPlan) return;
    const updated = { ...editPlan };
    updated[phase] = { ...updated[phase], actions: [...updated[phase].actions] };
    updated[phase].actions[actionIndex] = value;
    setEditPlan(updated);
  };

  const updatePhaseTitle = (phase: "phase_1" | "phase_2" | "phase_3", value: string) => {
    if (!editPlan) return;
    const updated = { ...editPlan };
    updated[phase] = { ...updated[phase], title: value };
    setEditPlan(updated);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <h2 className="font-heading text-xl font-bold text-foreground">No report yet</h2>
          <p className="text-muted-foreground">This client hasn't completed their audit yet.</p>
          <Button variant="hero" onClick={() => navigate("/coach")}>Back to Coach Dashboard</Button>
        </div>
      </div>
    );
  }

  const { pattern_analysis, contradictions, forced_choice, north_star_focus, ninety_day_plan } = report;

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            <span className="font-heading text-xl font-extrabold tracking-tight text-foreground uppercase">Intentus</span>
            <span className="font-heading text-lg font-bold text-foreground">{clientName}'s Report</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/coach")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Coach Dashboard
            </Button>
            {!editing ? (
              <Button variant="outline" size="sm" onClick={startEditing}>
                <Pencil className="h-4 w-4 mr-1" /> Edit Plan
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  <X className="h-4 w-4 mr-1" /> Cancel
                </Button>
                <Button variant="hero" size="sm" onClick={saveChanges} disabled={saving}>
                  <Save className="h-4 w-4 mr-1" /> {saving ? "Saving..." : "Save Changes"}
                </Button>
              </>
            )}
          </div>
        </div>
      </nav>

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        {editing && (
          <div className="bg-accent/10 border border-accent/30 rounded-xl p-4 mb-6 text-sm text-accent flex items-center gap-2">
            <Pencil className="h-4 w-4 shrink-0" />
            <span>You're editing {clientName}'s plan. Changes will be visible to the client immediately.</span>
          </div>
        )}

        {/* Operating Focus */}
        <section className="mb-8">
          <div className="bg-gradient-subtle rounded-2xl p-8 border border-primary/20 text-center">
            <Crosshair className="h-8 w-8 text-accent mx-auto mb-3" />
            <h2 className="font-heading text-sm font-semibold text-primary uppercase tracking-wider mb-2">Current Priority</h2>
            {editing ? (
              <Textarea
                value={editNorthStar}
                onChange={(e) => setEditNorthStar(e.target.value)}
                className="text-center font-heading text-xl font-bold"
                rows={2}
              />
            ) : (
              <p className="font-heading text-2xl font-bold text-foreground leading-relaxed">{north_star_focus}</p>
            )}
          </div>
        </section>

        {/* Pattern Analysis (read-only for coaches) */}
        <section className="mb-8">
          <h2 className="font-heading text-xl font-bold text-foreground mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" /> Pattern Analysis
          </h2>
          <div className="space-y-4 mb-6">
            {pattern_analysis.themes.map((theme, i) => (
              <div key={i} className="bg-card rounded-xl border border-border p-5">
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
        <section className="mb-8">
          <h2 className="font-heading text-xl font-bold text-foreground mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-accent" /> Contradictions
          </h2>
          <div className="space-y-4">
            {contradictions.map((c, i) => (
              <div key={i} className="bg-card rounded-xl border border-border p-5">
                <div className="grid md:grid-cols-2 gap-4 mb-3">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">What they say</p>
                    <p className="text-sm text-foreground font-medium">"{c.stated}"</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">What they do</p>
                    <p className="text-sm text-foreground font-medium">"{c.actual}"</p>
                  </div>
                </div>
                <p className="text-sm text-accent font-medium">Impact: {c.impact}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Forced Choice */}
        <section className="mb-8">
          <h2 className="font-heading text-xl font-bold text-foreground mb-4 flex items-center gap-2">
            <Crosshair className="h-5 w-5 text-primary" /> The Forced Choice
          </h2>
          <div className="bg-gradient-subtle rounded-2xl p-6 border border-primary/20">
            {editing ? (
              <Textarea
                value={editForcedChoice}
                onChange={(e) => setEditForcedChoice(e.target.value)}
                rows={4}
              />
            ) : (
              <p className="text-foreground leading-relaxed">{forced_choice}</p>
            )}
          </div>
        </section>

        {/* 90-Day Plan - Editable */}
        <section className="mb-8">
          <h2 className="font-heading text-xl font-bold text-foreground mb-4 flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" /> 90-Day Plan
          </h2>
          <div className="grid md:grid-cols-3 gap-4">
            {([
              { key: "phase_1" as const, label: "Days 1–30" },
              { key: "phase_2" as const, label: "Days 31–60" },
              { key: "phase_3" as const, label: "Days 61–90" },
            ]).map(({ key, label }) => {
              const phase = editing ? editPlan?.[key] : ninety_day_plan[key];
              if (!phase) return null;
              return (
                <div key={key} className="bg-card rounded-xl border border-border p-5">
                  <p className="text-xs text-primary uppercase tracking-wider font-semibold mb-1">{label}</p>
                  {editing ? (
                    <>
                      <Input
                        value={editPlan?.[key]?.title ?? ""}
                        onChange={(e) => updatePhaseTitle(key, e.target.value)}
                        className="font-heading font-bold mb-3"
                      />
                      <div className="space-y-2">
                        {editPlan?.[key]?.actions.map((a, i) => (
                          <Input
                            key={i}
                            value={a}
                            onChange={(e) => updatePhaseAction(key, i, e.target.value)}
                            className="text-sm"
                          />
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <h3 className="font-heading font-bold text-foreground mb-3">{phase.title}</h3>
                      <ul className="space-y-2">
                        {phase.actions.map((a, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <Target className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                            <span className="text-foreground">{a}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <div className="text-center pb-8">
          <Button variant="hero" size="lg" onClick={() => navigate("/coach")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Coach Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CoachClientReport;
