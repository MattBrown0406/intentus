// Branded coach pages live at /:slug, but static routes always win in the
// router, so a coach slug equal to an app route would publish a dead link.
export const RESERVED_COACH_SLUGS: ReadonlySet<string> = new Set([
  "accountability-software", "admin", "audit", "auth", "check-in", "coach", "coaching",
  "dashboard", "faq", "for-coaches", "for-executives", "for-leaders", "goals", "onboarding",
  "operating-audit", "privacy", "report", "reset-password", "review-demo", "sample",
  "settings", "sharing", "subscribe", "support", "terms",
]);

export function coachSlugError(slug: string): string | null {
  if (!/^[a-z0-9-]+$/.test(slug)) return "Use only lowercase letters, numbers, and hyphens.";
  if (RESERVED_COACH_SLUGS.has(slug)) return "That URL is reserved by Intentus. Choose a different slug.";
  return null;
}
