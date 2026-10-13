import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), user: { id: 'coach' } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc, from: (table: string) => {
 const q: any = { select: () => q, eq: () => q, order: () => q, single: () => q,
 then: (resolve: any) => Promise.resolve({ error: null, data: table === 'profiles' ? { display_name: 'Coach' } : table === 'coach_invite_links' ? [{ id: 'link', invite_code: 'code', assigned_tier: 'free', is_active: true, uses_count: 0 }] : [] }).then(resolve) }; return q;
} } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, signOut: vi.fn() }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/components/AppBreadcrumb', () => ({ default: () => null }));
vi.mock('@/components/coach/CoachBrandingSettings', () => ({ default: () => null }));
vi.mock('@/components/coach/CoachSessionPrep', () => ({ CoachSessionPrep: () => null }));
import CoachDashboard from '@/pages/CoachDashboard';
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ error: null }); });
async function open() { render(<CoachDashboard />); await screen.findByText('Invite Links'); fireEvent.click(screen.getByText('Invite Links')); }
describe('coach RPC handlers', () => {
 it('creates with narrow arguments and reports server failures honestly', async () => {
  mocks.rpc.mockResolvedValue({ error: { message: 'Active coach required' } }); await open();
  fireEvent.click(screen.getByText('Create Link'));
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('coach_create_invite', { p_tier: 'free', p_label: null }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Action failed', description: 'Active coach required' })));
  expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Invite link created' }));
 });
 it('awaits clipboard and fences repeated clicks', async () => {
  let reject!: (e: Error) => void;
  const copy = vi.fn(() => new Promise<void>((_, r) => { reject = r; }));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  await open(); fireEvent.click(screen.getByLabelText('Copy invite link')); fireEvent.click(screen.getByLabelText('Copy invite link'));
  expect(copy).toHaveBeenCalledTimes(1); expect(mocks.toast).not.toHaveBeenCalled();
  await act(async () => reject(new Error('Clipboard denied')));
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Action failed', description: 'Clipboard denied' }));
 });
 it('calls rpc bound to the Supabase client (SupabaseClient.rpc uses this.rest)', async () => {
  const { supabase } = await import('@/integrations/supabase/client');
  await open(); fireEvent.click(screen.getByText('Create Link'));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Invite link created' })));
  expect(mocks.rpc.mock.contexts.at(-1)).toBe(supabase);
 });
 it('deletes via ownership RPC', async () => { await open(); fireEvent.click(screen.getByLabelText('Delete invite link'));
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('coach_delete_invite', { p_link_id: 'link' }));
 });
});
