import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { coachInviteMayLink } from "../functions/_shared/payment-security.ts";
import { brandedSlug, isBrandedInvite, resolveBrandedCoach } from "../functions/_shared/coach-invite.ts";

const COACH = "b1111111-1111-4111-8111-111111111111";
const OTHER = "b2222222-2222-4222-8222-222222222222";

Deno.test("coach invite links only accounts this call created or this coach invited", () => {
  // New account: GoTrue stored this call's metadata, including the nonce.
  assertEquals(coachInviteMayLink({ user_metadata: { coach_user_id: COACH, coach_invite_nonce: "n1" } }, "n1", COACH), true);
  // Existing unconfirmed self-signup (even one created seconds ago): original metadata only.
  assertEquals(coachInviteMayLink({ user_metadata: { display_name: "Victim" } }, "n1", COACH), false);
  assertEquals(coachInviteMayLink({ user_metadata: null }, "n1", COACH), false);
  // Re-invite of someone this coach invited before.
  assertEquals(coachInviteMayLink({ user_metadata: { coach_user_id: COACH, coach_invite_nonce: "old" } }, "n2", COACH), true);
  // Someone another coach invited.
  assertEquals(coachInviteMayLink({ user_metadata: { coach_user_id: OTHER, coach_invite_nonce: "old" } }, "n2", COACH), false);
  assertEquals(coachInviteMayLink({ user_metadata: {} }, "", COACH), false);
});

Deno.test("branded coach links require a slug that resolves to that coach", async () => {
  const rows: Record<string, { coach_user_id: string }> = { "coach-a": { coach_user_id: COACH } };
  const lookup = (slug: string) => Promise.resolve(rows[slug] ?? null);
  assertEquals(isBrandedInvite("__branded__"), true);
  assertEquals(isBrandedInvite(null), true);
  assertEquals(isBrandedInvite(undefined), true);
  assertEquals(isBrandedInvite("real-code"), false);
  // Bare UUID, no slug anywhere: rejected.
  assertEquals(await resolveBrandedCoach(brandedSlug(undefined, undefined), COACH, lookup), null);
  // Slug from auth metadata (BrandedAuth sign-up / login) resolves the coach.
  assertEquals(await resolveBrandedCoach(brandedSlug(undefined, "coach-a"), COACH, lookup), COACH);
  assertEquals(await resolveBrandedCoach(brandedSlug("coach-a", undefined), null, lookup), COACH);
  // Slug of coach A but UUID of coach B: rejected.
  assertEquals(await resolveBrandedCoach(brandedSlug("coach-a", undefined), OTHER, lookup), null);
  assertEquals(await resolveBrandedCoach(brandedSlug("missing", undefined), null, lookup), null);
  assertEquals(brandedSlug(42, undefined), null);
  assertEquals(brandedSlug("x".repeat(201), undefined), null);
});
