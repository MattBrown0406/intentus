import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const phase = (title: string) => ({ title, actions: [`${title} action`] });
const oldReport = {
  id: 'r1', audit_id: 'a1', created_at: '2026-01-01', forced_choice: 'Old choice', north_star_focus: 'Old focus',
  pattern_analysis: null, contradictions: null,
  ninety_day_plan: { phase_1: phase('Old P1'), phase_2: phase('Old P2'), phase_3: phase('Old P3') },
  edited_ninety_day_plan: [phase('Old edited phase')],
};
const newReport = {
  id: 'r2', audit_id: 'a2', created_at: '2026-10-12', forced_choice: 'New choice', north_star_focus: 'New focus',
  pattern_analysis: null, contradictions: null,
  ninety_day_plan: { phase_1: phase('New P1'), phase_2: phase('New P2'), phase_3: phase('New P3') },
  edited_ninety_day_plan: null,
};
const m = vi.hoisted(() => ({ reportReads: 0 }));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u' } }) }));
vi.mock('@/components/AppBreadcrumb', () => ({ default: () => null }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    // Generation takes a while in production; the fallback report renders first.
    functions: { invoke: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve({ data: { report_id: 'r2' }, error: null }), 30))) },
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'order', 'limit', 'single']) q[name] = () => q;
      q.then = (resolve: (value: unknown) => unknown) => {
        let result: unknown = { data: [], error: null };
        if (table === 'strategic_reports') result = m.reportReads++ === 0 ? { data: [oldReport], error: null } : { data: newReport, error: null };
        else if (table === 'baseline_audits') result = { data: [{ id: 'a2' }], error: null };
        else if (table === 'profiles') result = { data: { plan_tier: 'free' }, error: null };
        return Promise.resolve(result).then(resolve);
      };
      return q;
    },
  },
}));

import Report from '@/pages/Report';
afterEach(() => { cleanup(); m.reportReads = 0; });

it('does not carry the fallback report\'s edited plan over to the newly generated report', async () => {
  render(<MemoryRouter initialEntries={['/report']}><Report /></MemoryRouter>);
  expect(await screen.findByText('New P1')).toBeTruthy();
  expect(screen.queryByText('Old edited phase')).toBeNull();
  expect(screen.queryByText('Refreshed')).toBeNull();
});
