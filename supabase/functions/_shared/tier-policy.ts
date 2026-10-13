export type PlanTier = "free" | "pro" | "premium" | "coach";

export function normalizePlanTier(value: unknown): PlanTier {
  // The database Executive tier is `exec` (legacy rows may still say `pro`);
  // edge prompts use "pro" as the internal Executive label.
  if (value === "exec" || value === "pro") return "pro";
  return value === "premium" || value === "coach" ? value : "free";
}

export function canUseAiChat(tier: PlanTier) {
  return tier !== "free";
}

export function canUseAiDebrief(tier: PlanTier) {
  return tier !== "free";
}

export function buildTierPolicyPrompt(tier: PlanTier) {
  switch (tier) {
    case "free":
      return `TIER POLICY: Starter Snapshot
- Provide only lightweight audit reflection and basic priority clarification.
- Do not present this as the ongoing AI coach, full Executive report, Mirror Mode, or plan refresh experience.
- Keep responses shorter and focused on one next step.
- Do not imply access to chat-based ongoing coaching or AI check-in debriefs.`;
    case "pro":
      return `TIER POLICY: Executive Operating Coach
- Provide full personalized AI coaching for audit reports, check-in debriefs, drift detection, and ongoing chat.
- Be direct, practical, and grounded in the user's audit, report, commitments, and check-ins.
- Ask for clearer decisions and better follow-through, but do not use Premium Mirror Mode intensity.
- Prioritize one next action and one accountability standard over broad exploration.`;
    case "premium":
      return `TIER POLICY: Premium Mirror Mode
- Use the full Executive coaching behavior plus a sharper mirror.
- Name contradictions, avoidance, image management, rationalization, and drift more explicitly when the evidence supports it.
- Integrate rotating check-in signals and re-audit context into coaching when available.
- Push harder on decisive tradeoffs, plan refreshes, and the standard the user said they wanted.`;
    case "coach":
      return `TIER POLICY: Coach Program AI
- Use Premium-level AI depth for the coach account.
- When coaching the account owner, behave like Premium Mirror Mode.
- When discussing client programs, distinguish the coach's professional oversight from each client's assigned tier.
- Do not imply the AI replaces the human coach; position it as a structured accountability layer.`;
  }
}

export function buildReportDepthPrompt(tier: PlanTier) {
  switch (tier) {
    case "free":
      return `REPORT DEPTH: Starter users receive a 90-day priority snapshot. Keep the analysis useful but lighter: fewer themes, shorter contradictions, a clear north star, and a simple 90-day path. Do not frame it as the full Executive report.`;
    case "pro":
      return `REPORT DEPTH: Executive users receive the full operating audit report: strengths, blind spots, contradictions, forced choice, north star, and a concrete 90-day plan.`;
    case "premium":
      return `REPORT DEPTH: Premium users receive the full report with Mirror Mode sharpness: call out stronger contradictions, drift risks, and plan-refresh implications.`;
    case "coach":
      return `REPORT DEPTH: Coach users receive Premium-level report depth, with language suitable for a serious operating coach using this as a client-accountability foundation.`;
  }
}
