import { Capacitor } from "@capacitor/core";
import { Purchases, LOG_LEVEL, type CustomerInfo } from "@revenuecat/purchases-capacitor";
import { supabase } from "@/integrations/supabase/client";
import { tierCovers, type PlanTier } from "@/lib/tier-policy";

export const REVENUECAT_PRODUCT_IDS = {
  exec: "intentus_executive_monthly",
  premium: "intentus_premium_monthly",
  coach: "intentus_coach_monthly",
} as const;

export const REVENUECAT_ENTITLEMENTS = {
  exec: "exec",
  premium: "premium",
  coach: "coach",
} as const;

let configuredUserId: string | null = null;
let sdkConfigured = false;
let identityEpoch = 0;
let configurationQueue: Promise<unknown> = Promise.resolve();
function apiKeyForPlatform() {
  if (Capacitor.getPlatform() === 'ios') return import.meta.env.VITE_REVENUECAT_IOS_API_KEY;
  if (Capacitor.getPlatform() === 'android') return import.meta.env.VITE_REVENUECAT_ANDROID_API_KEY;
  return undefined;
}
export function isNativeRevenueCatAvailable() {
  return Capacitor.isNativePlatform() && !!apiKeyForPlatform();
}
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = configurationQueue.then(work);
  configurationQueue = result.catch(() => undefined);
  return result;
}
async function configureIdentity(userId: string) {
  if (!isNativeRevenueCatAvailable()) return false;
  if (configuredUserId === userId) return true;
  if (sdkConfigured) await Purchases.logIn({ appUserID: userId });
  else {
    await Purchases.setLogLevel({ level: import.meta.env.DEV ? LOG_LEVEL.DEBUG : LOG_LEVEL.INFO });
    await Purchases.configure({ apiKey: apiKeyForPlatform()!, appUserID: userId });
    sdkConfigured = true;
  }
  configuredUserId = userId;
  return true;
}
export function configureRevenueCat(userId: string): Promise<boolean> {
  return enqueue(() => configureIdentity(userId));
}
export function resetRevenueCatIdentity() {
  identityEpoch++;
  return enqueue(async () => {
    if (sdkConfigured && configuredUserId) {
      await Purchases.logOut();
      configuredUserId = null;
    }
  });
}
// Identity changes cannot interleave with a purchase/restore. Never cancel the
// store sheet; fence its completion instead, so an accepted receipt is retained.
export function withRevenueCatIdentity<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const epoch = identityEpoch;
  return enqueue(async () => {
    const before = await supabase.auth.getUser();
    if (epoch !== identityEpoch || before.data.user?.id !== userId) throw new Error('Account changed');
    if (!await configureIdentity(userId)) throw new Error('Store unavailable on this platform');
    const result = await work();
    const after = await supabase.auth.getUser();
    if (epoch !== identityEpoch || after.data.user?.id !== userId) throw new Error('Account changed; any completed purchase is awaiting verification on the purchasing account.');
    return result;
  });
}
supabase.auth.onAuthStateChange((_event, session) => {
  if (!session || (configuredUserId && session.user.id !== configuredUserId)) {
    void resetRevenueCatIdentity().catch(() => { /* Future operations still verify identity. */ });
  }
});

export function getPlanTierFromCustomerInfo(customerInfo: CustomerInfo): PlanTier | null {
  const active = customerInfo.entitlements.active;
  if (active[REVENUECAT_ENTITLEMENTS.coach]?.isActive) return "coach";
  if (active[REVENUECAT_ENTITLEMENTS.premium]?.isActive) return "premium";
  // Accept legacy "pro" entitlement as well (maps to "exec")
  if (active[REVENUECAT_ENTITLEMENTS.exec]?.isActive || active["pro"]?.isActive) return "exec";
  return null;
}

export async function syncSupabasePlanTierFromCustomerInfo(userId: string, _customerInfo: CustomerInfo) {
  return readVerifiedPlanTier(userId);
}

// Only the verified billing webhook may grant access. Client SDK state is not authority.
export async function readVerifiedPlanTier(userId: string): Promise<Exclude<PlanTier, "free"> | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("plan_tier")
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  const tier = data?.plan_tier;
  if (tier === "coach" || tier === "premium" || tier === "exec") return tier;
  if (tier === "pro") return "exec";
  return null;
}

// The store/Square confirms payment before its webhook updates profiles.plan_tier,
// so a single read right after checkout almost always sees the old tier. Poll the
// server-verified tier briefly until it reaches the purchased tier. profiles.plan_tier
// is the highest of every grant (store, Square, coach-assigned), so a tier at or
// above the target (e.g. a coach-assigned Premium client buying Executive, or a
// store downgrade that only applies at renewal) is already as verified as it gets.
export async function waitForVerifiedPlanTier(
  userId: string,
  target: Exclude<PlanTier, "free">,
  { attempts = 8, delayMs = 2000, isCurrent = () => true }: { attempts?: number; delayMs?: number; isCurrent?: () => boolean } = {},
): Promise<Exclude<PlanTier, "free"> | null> {
  let tier: Exclude<PlanTier, "free"> | null = null;
  let lastError: unknown = null;
  let read = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (!isCurrent()) break;
    try {
      tier = await readVerifiedPlanTier(userId);
      read = true;
      if (tier && tierCovers(tier, target)) return tier;
    } catch (error) {
      lastError = error; // transient read failure: keep waiting for the webhook
    }
  }
  if (!read && lastError) throw lastError;
  return tier;
}
