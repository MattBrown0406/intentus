// Defensive readers for strategic_reports JSON columns. Every column is nullable
// in the schema, and AI/edge-function output shapes have drifted over time.

export interface PlanPhase {
  title?: string;
  actions: string[];
  phase_label?: string;
  [key: string]: unknown;
}

export interface PatternAnalysisView {
  themes: { title: string; description: string; areas_affected: string[] }[];
  strengths: string[];
  blind_spots: string[];
}

export interface ContradictionView {
  stated: string;
  actual: string;
  impact: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const str = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * edited_ninety_day_plan is written as a bare phase array by the report editor
 * but as `{ phases: [...] }` by the refresh-plan edge function. Accept both.
 */
export function normalizeEditedPlan(value: unknown): PlanPhase[] | null {
  const phases = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.phases) ? value.phases : null;
  if (!phases) return null;
  const normalized = phases.filter(isRecord).map((phase) => ({ ...phase, actions: strings(phase.actions) }));
  return normalized.length > 0 ? normalized : null;
}

export function normalizePatternAnalysis(value: unknown): PatternAnalysisView {
  const source = isRecord(value) ? value : {};
  return {
    themes: (Array.isArray(source.themes) ? source.themes : []).filter(isRecord).map((theme) => ({
      title: str(theme.title),
      description: str(theme.description),
      areas_affected: strings(theme.areas_affected),
    })),
    strengths: strings(source.strengths),
    blind_spots: strings(source.blind_spots),
  };
}

export function normalizeContradictions(value: unknown): ContradictionView[] {
  return (Array.isArray(value) ? value : []).filter(isRecord).map((item) => ({
    stated: str(item.stated),
    actual: str(item.actual),
    impact: str(item.impact),
  }));
}

/**
 * Only a successful, non-error pattern-intelligence payload may be shown or
 * cached. Error bodies (401/403/429/500) must never be persisted as results.
 */
export function usablePatternIntel(ok: boolean, value: unknown): Record<string, unknown> | null {
  if (!ok || !isRecord(value) || "error" in value) return null;
  if (value.insufficient_data === true) return value;
  return typeof value.executive_summary === "string" ? value : null;
}

/**
 * Decide whether the newest completed audit still needs its own report.
 * Legacy reports without audit_id are treated as belonging to the latest audit.
 */
export function needsReportForAudit(
  latestReport: { audit_id?: string | null } | null | undefined,
  latestCompletedAudit: { id: string } | null | undefined,
): boolean {
  if (!latestCompletedAudit) return false;
  if (!latestReport) return true;
  return !!latestReport.audit_id && latestReport.audit_id !== latestCompletedAudit.id;
}
