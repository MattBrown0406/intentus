import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/AuthContext';
import { RESERVED_COACH_SLUGS, coachSlugError } from '@/lib/coach-slug';
import { SITE_URL, publicOrigin } from '@/lib/site';

const m = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn(), updateUser: vi.fn(), invoke: vi.fn(), rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: m, functions: { invoke: m.invoke }, rpc: m.rpc } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
let event: (event: string, session: unknown) => void;
const session = (id: string, metadata = {}) => ({ access_token: 'test', user: { id, user_metadata: metadata } });
beforeEach(() => {
  vi.clearAllMocks();
  m.getSession.mockResolvedValue({ data: { session: null } });
  m.onAuthStateChange.mockImplementation(cb => { event = cb; return { data: { subscription: { unsubscribe: vi.fn() } } }; });
  m.updateUser.mockResolvedValue({ data: {}, error: null });
});
afterEach(cleanup);

describe('coach invite metadata', () => {
  it('consumes the stored invite after successful redemption so it cannot re-link later', async () => {
    m.invoke.mockResolvedValue({ data: { success: true }, error: null });
    render(<AuthProvider><div>content</div></AuthProvider>);
    act(() => event('SIGNED_IN', session('a', { invite_code: 'invite-123' })));
    await waitFor(() => expect(m.updateUser).toHaveBeenCalledWith({ data: { invite_code: null, coach_slug: null } }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the invite for retry on failure, and lets the user dismiss a dead invite', async () => {
    m.invoke.mockResolvedValue({ data: null, error: new Error('Invitation could not be accepted') });
    render(<AuthProvider><div>content</div></AuthProvider>);
    act(() => event('SIGNED_IN', session('a', { invite_code: 'deleted-link' })));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be accepted');
    expect(m.updateUser).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss invite' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(m.updateUser).toHaveBeenCalledWith({ data: { invite_code: null, coach_slug: null } });
  });
});

describe('public link origin', () => {
  it('never emits capacitor://localhost in emailed or copied links', () => {
    expect(publicOrigin({ protocol: 'capacitor:', origin: 'capacitor://localhost' })).toBe(SITE_URL);
    expect(publicOrigin({ protocol: 'https:', origin: 'https://preview.example.test' })).toBe('https://preview.example.test');
  });
});

describe('coach slugs', () => {
  it('reserves every static single-segment app route', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const routes = [...app.matchAll(/path="\/([a-z0-9-]+)"/g)].map(match => match[1]);
    expect(routes.length).toBeGreaterThan(10);
    for (const route of routes) expect(RESERVED_COACH_SLUGS.has(route), route).toBe(true);
  });

  it('rejects reserved and malformed slugs but accepts ordinary ones', () => {
    expect(coachSlugError('dashboard')).toMatch(/reserved/);
    expect(coachSlugError('Bad Slug')).toMatch(/lowercase/);
    expect(coachSlugError('jane-doe-coaching')).toBeNull();
  });
});

describe('iOS push wiring', () => {
  it('forwards APNs registration callbacks to the Capacitor push plugin', () => {
    const delegate = readFileSync(resolve(process.cwd(), 'ios/App/App/AppDelegate.swift'), 'utf8');
    expect(delegate).toContain('.capacitorDidRegisterForRemoteNotifications');
    expect(delegate).toContain('.capacitorDidFailToRegisterForRemoteNotifications');
  });
});
