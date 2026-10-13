import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { from, toast } = vi.hoisted(() => ({ from: vi.fn(), toast: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from } }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
import { CoachAnnotations } from '@/components/coach/CoachAnnotations';
import { organizationJsonLd, softwareJsonLd } from '@/lib/site';

function table(result: unknown) {
  const query: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'update', 'delete']) query[m] = vi.fn(() => query);
  query.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return query;
}

it('does not report a resolve that RLS silently ignored (sharing revoked)', async () => {
  from
    .mockReturnValueOnce(table({ data: [{ id: 'n1', annotation_type: 'note', content: 'Prep', resolved: false, created_at: '2026-10-01T00:00:00Z' }], error: null }))
    .mockReturnValueOnce(table({ data: [], error: null }));
  render(<CoachAnnotations clientUserId="c" coachId="k" />);
  fireEvent.click(await screen.findByTitle('Mark resolved'));
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Failed to resolve' })));
  expect(screen.getByTitle('Mark resolved')).toBeInTheDocument();
});

it('ignores a stale annotation load for a previously shown client', async () => {
  let releaseA!: (v: unknown) => void;
  const slow: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order']) slow[m] = vi.fn(() => slow);
  slow.then = (resolve: (v: unknown) => unknown) => new Promise(r => { releaseA = r; }).then(resolve);
  from.mockReset();
  from
    .mockReturnValueOnce(slow)
    .mockReturnValueOnce(table({ data: [{ id: 'b', annotation_type: 'note', content: 'Client B note', resolved: false, created_at: '2026-10-01T00:00:00Z' }], error: null }));
  const { rerender } = render(<CoachAnnotations clientUserId="a" coachId="k" />);
  rerender(<CoachAnnotations clientUserId="b" coachId="k" />);
  expect(await screen.findByText('Client B note')).toBeInTheDocument();
  releaseA({ data: [{ id: 'a', annotation_type: 'note', content: 'Client A note', resolved: false, created_at: '2026-10-01T00:00:00Z' }], error: null });
  await new Promise(r => setTimeout(r, 0));
  expect(screen.queryByText('Client A note')).not.toBeInTheDocument();
});

it('reports a completed account deletion even if the follow-up sign-out fails', async () => {
  const source = readFileSync('src/pages/Settings.tsx', 'utf8');
  const ast = ts.createSourceFile('Settings.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler = '';
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleDeleteAccount') handler = node.initializer!.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  const localSignOut = vi.fn().mockResolvedValue({ error: null });
  const deps = {
    user: { id: 'a' }, hydrated: 'a', confirmDelete: true, deleting: false, saving: false, owner: { current: 'a' },
    setDeleting: vi.fn(), cleanupBeforeSignOut: async () => {}, bounded: (p: Promise<unknown>) => p,
    supabase: { functions: { invoke: vi.fn().mockResolvedValue({ data: { success: true }, error: null }) }, auth: { signOut: localSignOut } },
    signOut: vi.fn().mockRejectedValue(new Error('Request timed out. Please try again.')), toast: vi.fn(), navigate: vi.fn(),
  };
  const js = ts.transpileModule(`const handler = ${handler};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  await new Function(...Object.keys(deps), `${js}; return handler;`)(...Object.values(deps))();
  expect(localSignOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(deps.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Account deleted' }));
  expect(deps.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Account deletion failed' }));
  expect(deps.navigate).toHaveBeenCalledWith('/', { replace: true });
});

it('structured data points at assets that exist and the real entry price', () => {
  expect(organizationJsonLd.logo).toBe('https://intentusai.com/favicon.png');
  expect(() => readFileSync('public/favicon.png')).not.toThrow();
  expect(softwareJsonLd.offers.price).toBe('39.99');
});
