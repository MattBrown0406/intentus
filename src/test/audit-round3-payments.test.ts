import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from, auth: { onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })) } } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }));
vi.mock('@revenuecat/purchases-capacitor', () => ({ Purchases: {}, LOG_LEVEL: { DEBUG: 'debug', INFO: 'info' } }));
import { waitForVerifiedPlanTier } from '@/lib/revenuecat';
import { selectAllRows } from '@/lib/select-all-rows';

function profileReads(...results: unknown[]) {
  const single = vi.fn();
  for (const r of results) single.mockResolvedValueOnce(r);
  const query = { select: vi.fn(), eq: vi.fn(), single };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  mocks.from.mockReturnValue(query);
  return single;
}
beforeEach(() => { vi.clearAllMocks(); });

it('keeps polling the verified tier until the purchase webhook lands', async () => {
  const single = profileReads(
    { data: { plan_tier: 'exec' }, error: null },
    { data: null, error: { message: 'network' } },
    { data: { plan_tier: 'premium' }, error: null },
  );
  await expect(waitForVerifiedPlanTier('u', 'premium', { delayMs: 0 })).resolves.toBe('premium');
  expect(single).toHaveBeenCalledTimes(3);
});

it('stops polling once the account is no longer current and never grants a tier itself', async () => {
  let current = true;
  const single = profileReads({ data: { plan_tier: 'free' }, error: null }, { data: { plan_tier: 'free' }, error: null });
  const pending = waitForVerifiedPlanTier('u', 'coach', { delayMs: 0, isCurrent: () => current });
  current = false;
  await expect(pending).resolves.toBeNull();
  expect(single).toHaveBeenCalledTimes(1);
});

it('reads every page instead of stopping at the 1,000-row API cap', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: i }));
  const page = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }));
  await expect(selectAllRows(page, 2)).resolves.toEqual(rows);
  expect(page.mock.calls).toEqual([[0, 1], [2, 3], [4, 5]]);
  await expect(selectAllRows(async () => ({ data: null, error: { message: 'denied' } }))).rejects.toThrow('denied');
});
