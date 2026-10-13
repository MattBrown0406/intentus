import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const m = vi.hoisted(() => ({ onboarded: false }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u' } }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'maybeSingle']) q[name] = () => q;
      q.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: { onboarding_completed: m.onboarded }, error: null }).then(resolve);
      return q;
    },
  },
}));

import Onboarding from '@/pages/Onboarding';
afterEach(cleanup);

const renderAt = () => render(
  <MemoryRouter initialEntries={['/onboarding']}>
    <Routes>
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/dashboard" element={<p>Dashboard page</p>} />
    </Routes>
  </MemoryRouter>,
);

it('sends an already-onboarded user (the default post-sign-in destination) to the dashboard', async () => {
  m.onboarded = true;
  renderAt();
  expect(await screen.findByText('Dashboard page')).toBeTruthy();
});

it('shows onboarding to a user who has not completed it', async () => {
  m.onboarded = false;
  renderAt();
  expect(await screen.findByText('Welcome to Intentus')).toBeTruthy();
});
