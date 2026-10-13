import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CoachClientReport from '@/pages/CoachClientReport';

const m = vi.hoisted(() => ({ toast: vi.fn(), updateRows: [] as unknown[], updateFilters: [] as unknown[][] }));
const phase = { title: 'Phase', actions: ['Act'] };
const report = {
  id: 'report-1', created_at: '2026-01-01', forced_choice: 'Choice', north_star_focus: 'Focus',
  pattern_analysis: { themes: [], strengths: [], blind_spots: [] }, contradictions: [],
  ninety_day_plan: { phase_1: phase, phase_2: phase, phase_3: phase },
};
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: m.toast }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'coach-1' } }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      let updating = false;
      for (const name of ['select', 'eq', 'order', 'limit', 'single']) q[name] = (...args: unknown[]) => { if (updating && name === 'eq') m.updateFilters.push(args); return q; };
      q.update = () => { updating = true; return q; };
      q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(
        updating ? { data: m.updateRows, error: null }
          : table === 'profiles' ? { data: { display_name: 'Client' }, error: null } : { data: [report], error: null },
      ).then(resolve);
      return q;
    },
  },
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); m.updateFilters = []; });

const renderReport = () => render(
  <MemoryRouter initialEntries={['/coach/client/client-1/report']}>
    <Routes><Route path="/coach/client/:clientId/report" element={<CoachClientReport />} /></Routes>
  </MemoryRouter>,
);

it('does not claim a coach plan edit saved when RLS matched zero rows', async () => {
  m.updateRows = [];
  renderReport();
  fireEvent.click(await screen.findByRole('button', { name: /Edit Plan/ }));
  fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
  await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Error saving', variant: 'destructive' })));
  expect(m.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Changes saved' }));
  expect(m.updateFilters).toContainEqual(['user_id', 'client-1']);
});

it('confirms a coach plan edit only after the row is returned', async () => {
  m.updateRows = [{ id: 'report-1' }];
  renderReport();
  fireEvent.click(await screen.findByRole('button', { name: /Edit Plan/ }));
  fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
  await waitFor(() => expect(m.toast).toHaveBeenCalledWith({ title: 'Changes saved' }));
});
