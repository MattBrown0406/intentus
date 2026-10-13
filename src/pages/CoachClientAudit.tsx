import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Compass, ArrowLeft, ClipboardList } from "lucide-react";
import { AUDIT_SECTIONS, AUDIT_QUESTIONS } from "@/lib/audit-questions";

const CoachClientAudit = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [audit, setAudit] = useState<any>(null);
  const [clientName, setClientName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !clientId) return;
    const load = async () => {
      const [auditRes, profileRes] = await Promise.all([
        supabase.from("baseline_audits").select("*").eq("user_id", clientId).eq("status", "completed").order("created_at", { ascending: false }).limit(1),
        supabase.from("profiles").select("display_name").eq("user_id", clientId).single(),
      ]);
      if (profileRes.data) setClientName((profileRes.data as any).display_name || "Client");
      if (auditRes.data && auditRes.data.length > 0) setAudit(auditRes.data[0]);
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

  if (!audit) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <h2 className="font-heading text-xl font-bold text-foreground">No completed audit</h2>
          <p className="text-muted-foreground">This client hasn't completed their operating audit yet.</p>
          <Button variant="hero" onClick={() => navigate("/coach")}>Back to Coach Dashboard</Button>
        </div>
      </div>
    );
  }

  const responses = audit.responses || {};
  const scores = audit.scores || {};

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            <span className="font-heading text-xl font-extrabold tracking-tight text-foreground uppercase">Intentus</span>
            <span className="font-heading text-lg font-bold text-foreground">{clientName}'s Audit</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/coach")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Coach Dashboard
          </Button>
        </div>
      </nav>

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        {/* Section Scores */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
          {AUDIT_SECTIONS.map((section, i) => {
            // The audit flow never writes baseline_audits.scores, so fall back to
            // section coverage instead of a permanent "—".
            const questions = AUDIT_QUESTIONS.filter(q => q.sectionIndex === i);
            const answered = questions.filter(q => responses[q.id] != null && responses[q.id] !== "").length;
            return (
              <div key={i} className="bg-card rounded-xl border border-border p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{section}</p>
                {scores[i] != null
                  ? <p className="font-heading text-2xl font-bold text-primary">{scores[i]}</p>
                  : <p className="font-heading text-2xl font-bold text-primary">{answered}/{questions.length}<span className="block text-xs font-normal text-muted-foreground">answered</span></p>}
              </div>
            );
          })}
        </div>

        {/* Responses */}
        <div className="space-y-6">
          {AUDIT_SECTIONS.map((sectionName, sIdx) => {
            const sectionQuestions = AUDIT_QUESTIONS.filter(q => q.sectionIndex === sIdx);
            return (
              <div key={sIdx} className="bg-card rounded-2xl border border-border p-6">
                <h2 className="font-heading text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                  <ClipboardList className="h-5 w-5 text-primary" /> {sectionName}
                </h2>
                <div className="space-y-4">
                  {sectionQuestions.map((q) => {
                    const answer = responses[q.id];
                    return (
                      <div key={q.id}>
                        <p className="text-sm font-medium text-foreground mb-1">{q.text}</p>
                        {q.kind === "follow_up" && (
                          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-2">Follow-up</p>
                        )}
                        <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
                          {answer
                            ? typeof answer === "object"
                              ? JSON.stringify(answer)
                              : String(answer)
                            : "No response"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-center mt-8 pb-8">
          <Button variant="hero" size="lg" onClick={() => navigate("/coach")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Coach Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CoachClientAudit;
