import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Compass, ArrowLeft, TrendingUp, AlertTriangle,
  Flame, CheckCircle, Clock
} from "lucide-react";
import { format } from "date-fns";
import { SignalCoverage } from "@/components/coach/SignalCoverage";
import { COACHING_QUESTIONS } from "@/lib/coaching-questions";

interface CheckIn {
  id: string;
  mood_score: number | null;
  energy_score: number | null;
  wins: string[] | null;
  blockers: string[] | null;
  commitments: string[] | null;
  drift_detected: boolean | null;
  created_at: string;
  ai_response: any;
  extras: Record<string, unknown> | null;
}

const CoachClientCheckIns = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [clientName, setClientName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !clientId) return;
    const load = async () => {
      const [checkInsRes, profileRes] = await Promise.all([
        supabase.from("check_ins").select("*").eq("user_id", clientId).order("created_at", { ascending: false }),
        supabase.from("profiles").select("display_name").eq("user_id", clientId).single(),
      ]);
      if (profileRes.data) setClientName((profileRes.data as any).display_name || "Client");
      if (checkInsRes.data) setCheckIns(checkInsRes.data as any);
      setLoading(false);
    };
    load();
  }, [user, clientId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // Quick check-ins omit scores; an all-unscored history must not render "NaN".
  const average = (scores: (number | null)[]) => {
    const scored = scores.filter((score): score is number => typeof score === "number");
    return scored.length > 0 ? (scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(1) : "—";
  };
  const avgMood = average(checkIns.map(c => c.mood_score));
  const avgEnergy = average(checkIns.map(c => c.energy_score));
  const driftCount = checkIns.filter(c => c.drift_detected).length;

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            <span className="font-heading text-xl font-extrabold tracking-tight text-foreground uppercase">Intentus</span>
            <span className="font-heading text-lg font-bold text-foreground">{clientName}'s Check-ins</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/coach")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Coach Dashboard
          </Button>
        </div>
      </nav>

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-card rounded-2xl border border-border p-4 text-center">
            <TrendingUp className="h-5 w-5 text-primary mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Avg Focus</p>
            <p className="font-heading text-2xl font-bold text-foreground">{avgMood}</p>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4 text-center">
            <Flame className="h-5 w-5 text-accent mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Avg Energy</p>
            <p className="font-heading text-2xl font-bold text-foreground">{avgEnergy}</p>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4 text-center">
            <AlertTriangle className="h-5 w-5 text-accent mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Drift Flags</p>
            <p className="font-heading text-2xl font-bold text-foreground">{driftCount}</p>
          </div>
        </div>

        {checkIns.length > 0 && <SignalCoverage checkIns={checkIns} />}

        {checkIns.length === 0 ? (
          <div className="text-center py-12">
            <Clock className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="font-heading font-bold text-foreground">No check-ins yet</h3>
            <p className="text-sm text-muted-foreground">This client hasn't completed any check-ins.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {checkIns.map((ci) => (
              <div key={ci.id} className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-muted-foreground">
                    {format(new Date(ci.created_at), "EEEE, MMM d, yyyy 'at' h:mm a")}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-foreground">Mood: <strong>{ci.mood_score ?? "—"}</strong></span>
                    <span className="text-sm text-foreground">Energy: <strong>{ci.energy_score ?? "—"}</strong></span>
                    {ci.drift_detected && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Drift
                      </span>
                    )}
                  </div>
                </div>

                {ci.wins && ci.wins.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Wins</p>
                    <ul className="space-y-1">
                      {ci.wins.map((w, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <CheckCircle className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                          <span className="text-foreground">{w}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {ci.blockers && ci.blockers.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Blockers</p>
                    <ul className="space-y-1">
                      {ci.blockers.map((b, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <AlertTriangle className="h-3 w-3 text-accent mt-0.5 shrink-0" />
                          <span className="text-foreground">{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {ci.commitments && ci.commitments.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Commitments</p>
                    <ul className="space-y-1">
                      {ci.commitments.map((c, i) => (
                        <li key={i} className="text-sm text-foreground">• {c}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {ci.extras && typeof ci.extras === "object" && Object.keys(ci.extras).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/60">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Coaching signals</p>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {Object.entries(ci.extras).map(([key, val]) => {
                        if (val === null || val === undefined || val === "") return null;
                        const q = COACHING_QUESTIONS.find((qq) => qq.id === key);
                        if (!q) return null;
                        return (
                          <div key={key} className="rounded-lg bg-muted/30 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{q.label}</p>
                            <p className="text-sm text-foreground mt-0.5">
                              {q.type === "scale" ? `${val}/10` : String(val)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="text-center mt-8 pb-8">
          <Button variant="hero" size="lg" onClick={() => navigate("/coach")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Coach Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CoachClientCheckIns;
