import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from, auth: { onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })) } } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }));
vi.mock('@revenuecat/purchases-capacitor', () => ({ Purchases: {}, LOG_LEVEL: { DEBUG: 'debug', INFO: 'info' } }));
import { waitForVerifiedPlanTier } from '@/lib/revenuecat';
import { tierCovers } from '@/lib/tier-policy';

function profileReads(...results: unknown[]) {
  const single = vi.fn();
  for (const r of results) single.mockResolvedValueOnce(r);
  const query = { select: vi.fn(), eq: vi.fn(), single };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  mocks.from.mockReturnValue(query);
  return single;
}
beforeEach(() => { vi.clearAllMocks(); });

it('treats a verified tier above the purchased one as verified (plan_tier is the max of all grants)', async () => {
  // e.g. a client whose coach assigned Premium buys Executive in the store.
  const single = profileReads({ data: { plan_tier: 'premium' }, error: null });
  await expect(waitForVerifiedPlanTier('u', 'exec', { delayMs: 0, attempts: 3 })).resolves.toBe('premium');
  expect(single).toHaveBeenCalledTimes(1);
});

it('still waits when the verified tier is below the purchased one', async () => {
  const single = profileReads(
    { data: { plan_tier: 'exec' }, error: null },
    { data: { plan_tier: 'exec' }, error: null },
  );
  await expect(waitForVerifiedPlanTier('u', 'premium', { delayMs: 0, attempts: 2 })).resolves.toBe('exec');
  expect(single).toHaveBeenCalledTimes(2);
});

it('ranks tiers free < exec (incl. legacy pro) < premium < coach', () => {
  expect(tierCovers('pro', 'exec')).toBe(true);
  expect(tierCovers('coach', 'premium')).toBe(true);
  expect(tierCovers('exec', 'premium')).toBe(false);
  expect(tierCovers(null, 'exec')).toBe(false);
});
