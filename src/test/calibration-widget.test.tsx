import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from } }));
import { CalibrationWidget } from '@/components/dashboard/CalibrationWidget';

function table(result: unknown) {
  const query: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte', 'order']) query[m] = vi.fn(() => query);
  query.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return query;
}

const originalTz = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/Los_Angeles'; });
afterAll(() => { process.env.TZ = originalTz; });

it('labels a Monday week_start with the Monday date west of UTC', async () => {
  from
    .mockReturnValueOnce(table({ data: [], error: null }))
    .mockReturnValueOnce(table({ data: [{ week_start: '2026-10-05', outcome: 'yes' }], error: null }));
  render(<CalibrationWidget userId="u" />);
  expect(await screen.findByText('Oct 5')).toBeInTheDocument();
  expect(screen.queryByText('Oct 4')).not.toBeInTheDocument();
});
