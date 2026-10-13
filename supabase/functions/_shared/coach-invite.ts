// Branded-page coach links ("__branded__" or no invite code) are self-service:
// the client joins the coach whose PUBLIC branded page (slug) they signed up or
// logged in through. A bare coach UUID is never sufficient; otherwise any user
// could attach themselves to any active coach's roster without an invitation.

export const BRANDED_INVITE = "__branded__";

export function isBrandedInvite(inviteCode: unknown): boolean {
  return inviteCode == null || inviteCode === BRANDED_INVITE;
}

/** Request body slug wins; else the slug the user arrived with (auth metadata). */
export function brandedSlug(bodySlug: unknown, metadataSlug: unknown): string | null {
  const candidate = bodySlug ?? metadataSlug;
  // Exact-match lookup only (parameterized); legacy slugs may predate the UI format rules.
  return typeof candidate === "string" && candidate.length > 0 && candidate.length <= 200 ? candidate : null;
}

/** Returns the coach that owns the slug's branding row, or null when the slug is
 * unknown or (if the caller also named a coach) belongs to a different coach. */
export async function resolveBrandedCoach(
  slug: string | null,
  requestedCoach: string | null,
  lookup: (slug: string) => Promise<{ coach_user_id: string } | null>,
): Promise<string | null> {
  if (!slug) return null;
  const row = await lookup(slug);
  if (!row?.coach_user_id) return null;
  if (requestedCoach && requestedCoach.toLowerCase() !== row.coach_user_id.toLowerCase()) return null;
  return row.coach_user_id;
}
