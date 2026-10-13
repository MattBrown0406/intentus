export type PlanTier = "free" | "exec" | "premium" | "coach";

export type TierCapability = {
  label: string;
  coachingName: string;
  aiBehavior: string;
  canUseAiChat: boolean;
  canUseAiDebrief: boolean;
  hasCoreCheckInQuestions: boolean;
  hasRotatingCheckInQuestions: boolean;
  hasMirrorMode: boolean;
};

export const TIER_CAPABILITIES: Record<PlanTier, TierCapability> = {
  free: {
    label: "Starter",
    coachingName: "Starter Snapshot",
    aiBehavior: "Lite audit reflection and weekly accountability tracking. Ongoing AI coach chat and AI check-in debriefs are reserved for Executive and above.",
    canUseAiChat: false,
    canUseAiDebrief: false,
    hasCoreCheckInQuestions: false,
    hasRotatingCheckInQuestions: false,
    hasMirrorMode: false,
  },
  exec: {
    label: "Executive",
    coachingName: "Executive Operating Coach",
    aiBehavior: "Balanced AI coaching for audit insights, check-in debriefs, drift detection, and practical weekly execution.",
    canUseAiChat: true,
    canUseAiDebrief: true,
    hasCoreCheckInQuestions: true,
    hasRotatingCheckInQuestions: false,
    hasMirrorMode: false,
  },
  premium: {
    label: "Premium",
    coachingName: "Premium Mirror Mode",
    aiBehavior: "Sharper AI coaching with stronger contradiction detection, rotating signal questions, quarterly re-audits, and plan refresh support.",
    canUseAiChat: true,
    canUseAiDebrief: true,
    hasCoreCheckInQuestions: true,
    hasRotatingCheckInQuestions: true,
    hasMirrorMode: true,
  },
  coach: {
    label: "Coach",
    coachingName: "Coach Program AI",
    aiBehavior: "Premium-level AI behavior for the coach account, with client AI depth following each client's assigned tier.",
    canUseAiChat: true,
    canUseAiDebrief: true,
    hasCoreCheckInQuestions: true,
    hasRotatingCheckInQuestions: true,
    hasMirrorMode: true,
  },
};

export function normalizePlanTier(value: unknown): PlanTier {
  // Backward compatibility: legacy "pro" tier maps to "exec"
  if (value === "pro" || value === "exec") return "exec";
  if (value === "premium" || value === "coach") return value;
  return "free";
}

export function getTierCapability(value: unknown): TierCapability {
  return TIER_CAPABILITIES[normalizePlanTier(value)];
}

const TIER_RANK: Record<PlanTier, number> = { free: 0, exec: 1, premium: 2, coach: 3 };

/** The server grants the highest of all sources (store, Square, coach-assigned tier). */
export function tierCovers(actual: unknown, target: PlanTier): boolean {
  return TIER_RANK[normalizePlanTier(actual)] >= TIER_RANK[target];
}
