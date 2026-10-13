import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useNativeDeepLinks, clearRecovery } from '@/hooks/useNativeDeepLinks';

const mocks = vi.hoisted(() => ({
  current: vi.fn(),
  addListener: vi.fn(),
  getLaunchUrl: vi.fn(),
  setSession: vi.fn(),
}));
// useNavigate() returns a new function whenever the pathname changes.
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.current }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: mocks.addListener, getLaunchUrl: mocks.getLaunchUrl } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { setSession: mocks.setSession } } }));
afterEach(() => { cleanup(); clearRecovery(); vi.clearAllMocks(); vi.restoreAllMocks(); });

it('does not replay the launch URL when navigation changes the navigate identity', async () => {
  const remove = vi.fn().mockResolvedValue(undefined);
  mocks.addListener.mockResolvedValue({ remove });
  mocks.getLaunchUrl.mockResolvedValue({ url: 'intentus://app/check-in' });
  const first = vi.fn();
  mocks.current = first;
  const { rerender } = renderHook(useNativeDeepLinks);
  await waitFor(() => expect(first).toHaveBeenCalledWith('/check-in', undefined));

  // The user navigates elsewhere: a new navigate function is returned.
  const second = vi.fn();
  mocks.current = second;
  rerender();
  await act(async () => { await Promise.resolve(); });

  expect(mocks.getLaunchUrl).toHaveBeenCalledTimes(1);
  expect(mocks.addListener).toHaveBeenCalledTimes(1);
  expect(remove).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();

  // Later links still route, through the latest navigate.
  await act(async () => mocks.addListener.mock.calls[0][1]({ url: 'intentus://app/report' }));
  expect(second).toHaveBeenCalledWith('/report', undefined);
});

it('never replays a consumed auth callback but routes a re-tapped plain link', async () => {
  mocks.addListener.mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) });
  mocks.getLaunchUrl.mockResolvedValue(undefined);
  mocks.setSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null });
  const navigate = vi.fn();
  mocks.current = navigate;
  renderHook(useNativeDeepLinks);
  await waitFor(() => expect(mocks.addListener).toHaveBeenCalled());
  const open = mocks.addListener.mock.calls[0][1] as (e: { url: string }) => Promise<void>;
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);

  const callback = 'intentus://app/reset-password#type=recovery&access_token=a&refresh_token=r';
  await act(async () => open({ url: callback }));
  await act(async () => open({ url: 'intentus://app/goals' }));
  now.mockReturnValue(1_000_000 + 60_000);
  await act(async () => open({ url: callback }));
  await act(async () => open({ url: 'intentus://app/goals' }));

  expect(mocks.setSession).toHaveBeenCalledTimes(1);
  expect(navigate.mock.calls.filter(([to]) => to === '/goals')).toHaveLength(2);
  expect(navigate).not.toHaveBeenCalledWith('/reset-password?error=expired', { replace: true });
});
