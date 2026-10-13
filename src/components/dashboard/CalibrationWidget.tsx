import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Target, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { format, parseISO, startOfWeek } from "date-fns";

interface CalibrationWidgetProps {
  userId: string;
}

interface WeekRow {
  weekLabel: string;        // e.g. "Mar 17"
  weekStart: string;        // ISO date of week start
  selfTrust: number | null;
  confidence: number | null;
  outcomeScore: number | null; // 0/50/100 from yes/partially/no, or null
  outcomeRaw: "yes" | "partially" | "no" | null;
}

const outcomeToScore = (o: string | null): number | null => {
  if (o === "yes") return 100;
  if (o === "partially") return 50;
  if (o === "no") return 0;
  return null;
};

const avg = (nums: (number | null | undefined)[]): number | null => {
  const valid = nums.filter((n): n is number => typeof n === "number" && !isNaN(n));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
};

export const CalibrationWidget = ({ userId }: CalibrationWidgetProps) => {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<WeekRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      // Pull last ~8 weeks of check-ins + weekly commitments
      const sinceIso = new Date(Date.now() - 8 * 7 * 24 * 60 * 60 * 1000).toISOString();
      const [ciRes, wcRes] = await Promise.all([
        supabase
          .from("check_ins")
          .select("created_at, extras")
          .eq("user_id", userId)
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false }),
        supabase
          .from("weekly_commitments")
          .select("week_start, outcome")
          .eq("user_id", userId)
          .gte("week_start", sinceIso.slice(0, 10))
          .order("week_start", { ascending: false }),
      ]);
      if (cancelled) return;

      // Group check-ins by ISO week (Mon start)
      const byWeek = new Map<string, { selfTrust: number[]; confidence: number[] }>();
      for (const ci of ciRes.data ?? []) {
        const wkStart = format(startOfWeek(new Date(ci.created_at), { weekStartsOn: 1 }), "yyyy-MM-dd");
        const bucket = byWeek.get(wkStart) ?? { selfTrust: [], confidence: [] };
        const extras = (ci.extras ?? {}) as Record<string, unknown>;
        const st = typeof extras.self_trust === "number" ? extras.self_trust : null;
        const cc = typeof extras.commitment_confidence === "number" ? extras.commitment_confidence : null;
        if (st !== null) bucket.selfTrust.push(st);
        if (cc !== null) bucket.confidence.push(cc);
        byWeek.set(wkStart, bucket);
      }

      // Index outcomes by week_start
      const outcomeByWeek = new Map<string, "yes" | "partially" | "no">();
      for (const wc of wcRes.data ?? []) {
        if (wc.outcome === "yes" || wc.outcome === "partially" || wc.outcome === "no") {
          outcomeByWeek.set(wc.week_start, wc.outcome);
        }
      }

      // Combine
      const allWeeks = new Set<string>([...byWeek.keys(), ...outcomeByWeek.keys()]);
      const combined: WeekRow[] = [...allWeeks]
        .sort((a, b) => (a < b ? 1 : -1))
        .slice(0, 6)
        .map((wkStart) => {
          const b = byWeek.get(wkStart) ?? { selfTrust: [], confidence: [] };
          const outcome = outcomeByWeek.get(wkStart) ?? null;
          return {
            weekStart: wkStart,
            // parseISO keeps a date-only week start on the local calendar day;
            // new Date("yyyy-MM-dd") is UTC midnight and shows Sunday west of UTC.
            weekLabel: format(parseISO(wkStart), "MMM d"),
            selfTrust: avg(b.selfTrust),
            confidence: avg(b.confidence),
            outcomeRaw: outcome,
            outcomeScore: outcomeToScore(outcome),
          };
        });

      setRows(combined.reverse()); // oldest → newest left to right
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Headline: average gap between self-promised confidence (×10 to align with 0–100 outcome scale) and actual outcome
  const calibrationGap = (() => {
    const pairs = rows.filter((r) => r.confidence !== null && r.outcomeScore !== null);
    if (pairs.length === 0) return null;
    const gaps = pairs.map((r) => (r.confidence! * 10) - r.outcomeScore!);
    return gaps.reduce((a, b) => a + b, 0) / gaps.length;
  })();

  const trustAvg = avg(rows.map((r) => r.selfTrust));

  if (loading) {
    return (
      <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
        <div className="h-32 animate-pulse bg-muted/30 rounded-lg" />
      </div>
    );
  }

  const hasAnyData = rows.some((r) => r.selfTrust !== null || r.confidence !== null || r.outcomeScore !== null);

  return (
    <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-heading text-sm font-bold text-foreground flex items-center gap-1.5">
            <Target className="h-4 w-4 text-primary" />
            Calibration
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">Promises vs. follow-through</p>
        </div>
        {calibrationGap !== null && (
          <div className="text-right">
            <div className="flex items-center gap-1 justify-end">
              {calibrationGap > 15 ? (
                <TrendingUp className="h-3.5 w-3.5 text-accent" />
              ) : calibrationGap < -15 ? (
                <TrendingDown className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Minus className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className="text-xs font-semibold text-foreground">
                {calibrationGap > 0 ? "+" : ""}{calibrationGap.toFixed(0)}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {calibrationGap > 15 ? "Over-promising" : calibrationGap < -15 ? "Under-promising" : "Well calibrated"}
            </p>
          </div>
        )}
      </div>

      {!hasAnyData ? (
        <div className="text-xs text-muted-foreground py-6 text-center">
          Calibration appears once you've answered the self-trust and commitment-confidence questions in a few check-ins and recorded a weekly commitment outcome.
        </div>
      ) : (
        <>
          {/* Compact bar grid: per week, show confidence (×10) vs. outcome */}
          <div className="space-y-2.5">
            {rows.map((r) => (
              <div key={r.weekStart} className="grid grid-cols-[36px_1fr_56px] sm:grid-cols-[44px_1fr_64px] items-center gap-2 text-xs">
                <span className="text-muted-foreground tabular-nums">{r.weekLabel}</span>
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="w-14 sm:w-16 shrink-0 text-[10px] text-muted-foreground">Promised</span>
                    <div className="flex-1 min-w-0 h-2 bg-muted/40 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary/60 rounded-full transition-all"
                        style={{ width: `${(r.confidence ?? 0) * 10}%` }}
                      />
                    </div>
                    <span className="w-6 shrink-0 text-[10px] tabular-nums text-foreground text-right">
                      {r.confidence !== null ? r.confidence.toFixed(0) : "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-14 sm:w-16 shrink-0 text-[10px] text-muted-foreground">Actual</span>
                    <div className="flex-1 min-w-0 h-2 bg-muted/40 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          r.outcomeRaw === "yes"
                            ? "bg-accent"
                            : r.outcomeRaw === "partially"
                            ? "bg-yellow-500"
                            : r.outcomeRaw === "no"
                            ? "bg-destructive"
                            : "bg-muted"
                        }`}
                        style={{ width: `${r.outcomeScore ?? 0}%` }}
                      />
                    </div>
                    <span className="w-6 shrink-0 text-[10px] tabular-nums text-foreground text-right">
                      {r.outcomeScore !== null ? `${r.outcomeScore}` : "—"}
                    </span>
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground text-right">
                  {r.selfTrust !== null ? `Trust ${r.selfTrust.toFixed(0)}` : ""}
                </span>
              </div>
            ))}
          </div>

          {trustAvg !== null && (
            <div className="mt-3 pt-3 border-t border-border/50 text-[11px] text-muted-foreground leading-relaxed">
              {calibrationGap !== null && Math.abs(calibrationGap) > 15 && (
                <p>
                  {calibrationGap > 15
                    ? "You consistently rate confidence higher than what you actually deliver. Try shrinking commitments — pick one observable thing instead of three."
                    : "You under-rate yourself. You're delivering more than you predict. Trust your capacity and commit to the harder thing."}
                </p>
              )}
              {calibrationGap !== null && Math.abs(calibrationGap) <= 15 && (
                <p>Your self-prediction and follow-through are in tight alignment. Keep raising the ceiling.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
