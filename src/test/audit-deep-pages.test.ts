import { describe, it, expect, vi } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { format } from 'date-fns';
import {
  needsReportForAudit, normalizeContradictions, normalizeEditedPlan, normalizePatternAnalysis, usablePatternIntel,
} from '@/lib/report-data';
import { calculateDayStreak } from '@/lib/check-in-streak';
import { selectQuestionsForCheckIn, ROTATING_QUESTION_IDS } from '@/lib/coaching-questions';

// Execute the actual page callback source with injected dependencies.
function callback(file: string, name: string, scope: Record<string, unknown> = {}) {
  const source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = '';
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) expression = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!expression) throw new Error(`Missing ${name}`);
  const js = ts.transpileModule(`const extracted = ${expression};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(scope), `${js}; return extracted;`)(...Object.values(scope));
}

function table(result: unknown) {
  const query: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'single']) query[m] = vi.fn(() => query);
  query.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return query;
}

describe('report data normalization', () => {
  it('reads the refresh-plan {phases} shape as well as the editor array shape', () => {
    const phases = [{ title: 'A', actions: ['x', 3] }, { title: 'B', actions: null }];
    expect(normalizeEditedPlan({ phases })).toEqual([{ title: 'A', actions: ['x'] }, { title: 'B', actions: [] }]);
    expect(normalizeEditedPlan(phases)).toEqual([{ title: 'A', actions: ['x'] }, { title: 'B', actions: [] }]);
    expect(normalizeEditedPlan(null)).toBeNull();
    expect(normalizeEditedPlan({})).toBeNull();
    expect(normalizeEditedPlan([])).toBeNull();
  });
  it('never yields non-arrays for nullable report sections', () => {
    expect(normalizePatternAnalysis(null)).toEqual({ themes: [], strengths: [], blind_spots: [] });
    expect(normalizePatternAnalysis({ themes: [{ title: 't' }] }).themes[0].areas_affected).toEqual([]);
    expect(normalizeContradictions(null)).toEqual([]);
  });
  it('never treats an error body as pattern intelligence', () => {
    expect(usablePatternIntel(false, { executive_summary: 's' })).toBeNull();
    expect(usablePatternIntel(true, { error: 'Pattern intelligence is available on Premium' })).toBeNull();
    expect(usablePatternIntel(true, null)).toBeNull();
    expect(usablePatternIntel(true, { insufficient_data: true, message: 'm' })).toEqual({ insufficient_data: true, message: 'm' });
    expect(usablePatternIntel(true, { executive_summary: 's' })).toEqual({ executive_summary: 's' });
  });
  it('requires a report for the newest completed audit', () => {
    expect(needsReportForAudit(null, { id: 'a2' })).toBe(true);
    expect(needsReportForAudit({ audit_id: 'a1' }, { id: 'a2' })).toBe(true);
    expect(needsReportForAudit({ audit_id: 'a2' }, { id: 'a2' })).toBe(false);
    expect(needsReportForAudit({ audit_id: null }, { id: 'a2' })).toBe(false);
    expect(needsReportForAudit({ audit_id: 'a1' }, undefined)).toBe(false);
  });
});

describe('Report loading', () => {
  it('generates a report for a newer completed audit instead of showing the old one', async () => {
    const oldReport = { id: 'r1', audit_id: 'a1' };
    const from = vi.fn()
      .mockReturnValueOnce(table({ data: [oldReport], error: null }))
      .mockReturnValueOnce(table({ data: [{ id: 'a2' }], error: null }))
      .mockReturnValueOnce(table({ data: { id: 'r2', audit_id: 'a2' }, error: null }));
    const invoke = vi.fn().mockResolvedValue({ data: { report_id: 'r2' }, error: null });
    const setReport = vi.fn();
    const load = callback('src/pages/Report.tsx', 'loadReport', {
      user: { id: 'u' }, searchParams: new URLSearchParams(), supabase: { from, functions: { invoke } },
      setReport, setLoading: vi.fn(), setGenerating: vi.fn(), toast: vi.fn(), needsReportForAudit,
    });
    await load();
    expect(invoke).toHaveBeenCalledWith('generate-report', { body: { audit_id: 'a2' } });
    expect(setReport).toHaveBeenLastCalledWith({ id: 'r2', audit_id: 'a2' });
  });
  it('shows the latest report when it belongs to the latest audit', async () => {
    const from = vi.fn()
      .mockReturnValueOnce(table({ data: [{ id: 'r2', audit_id: 'a2' }], error: null }))
      .mockReturnValueOnce(table({ data: [{ id: 'a2' }], error: null }));
    const invoke = vi.fn();
    const setReport = vi.fn();
    await callback('src/pages/Report.tsx', 'loadReport', {
      user: { id: 'u' }, searchParams: new URLSearchParams(), supabase: { from, functions: { invoke } },
      setReport, setLoading: vi.fn(), setGenerating: vi.fn(), toast: vi.fn(), needsReportForAudit,
    })();
    expect(invoke).not.toHaveBeenCalled();
    expect(setReport).toHaveBeenCalledWith({ id: 'r2', audit_id: 'a2' });
  });
});

describe('Audit start fresh', () => {
  function deps(eligible: boolean) {
    return {
      user: { id: 'u' }, startFreshFlight: { current: false }, setStartingFresh: vi.fn(), format,
      canReaudit: vi.fn().mockResolvedValue(eligible ? { eligible: true } : { eligible: false, reason: 'Re-audit is available on the Premium and Coach plans.' }),
      archiveAndResetAudit: vi.fn().mockResolvedValue(2), toast: vi.fn(),
      setCompleted: vi.fn(), setAuditId: vi.fn(), setCurrentQ: vi.fn(), setMessages: vi.fn(), setResponses: vi.fn(), setInput: vi.fn(), setInitAttempt: vi.fn(),
      supabase: { from: vi.fn() },
    };
  }
  it('does not archive or reset for an ineligible plan', async () => {
    const d = deps(false);
    await callback('src/pages/Audit.tsx', 'handleStartFresh', d)();
    expect(d.archiveAndResetAudit).not.toHaveBeenCalled();
    expect(d.supabase.from).not.toHaveBeenCalled();
    expect(d.setCompleted).not.toHaveBeenCalled();
    expect(d.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  });
  it('archives through the server workflow before restarting', async () => {
    const d = deps(true);
    await callback('src/pages/Audit.tsx', 'handleStartFresh', d)();
    expect(d.archiveAndResetAudit).toHaveBeenCalledWith('u');
    expect(d.supabase.from).not.toHaveBeenCalled();
    expect(d.setInitAttempt).toHaveBeenCalledOnce();
    expect(d.startFreshFlight.current).toBe(false);
  });
});

describe('CheckIn list steps', () => {
  it('keeps typed-but-unadded text when moving to another step', () => {
    let wins = ['first'];
    const setWins = vi.fn((fn: (p: string[]) => string[]) => { wins = fn(wins); });
    const setInputVal = vi.fn();
    callback('src/pages/CheckIn.tsx', 'commitPendingInput', {
      inputVal: '  shipped the thing  ', step: 3, setWins, setBlockers: vi.fn(), setCommitments: vi.fn(), setInputVal,
    })();
    expect(wins).toEqual(['first', 'shipped the thing']);
    expect(setInputVal).toHaveBeenCalledWith('');
  });
  it('does not add text on non-list steps', () => {
    const setWins = vi.fn(), setBlockers = vi.fn(), setCommitments = vi.fn();
    callback('src/pages/CheckIn.tsx', 'commitPendingInput', { inputVal: 'x', step: 6, setWins, setBlockers, setCommitments, setInputVal: vi.fn() })();
    expect(setWins).not.toHaveBeenCalled();
    expect(setBlockers).not.toHaveBeenCalled();
    expect(setCommitments).not.toHaveBeenCalled();
  });
});

describe('dashboard day streak', () => {
  const now = new Date(2026, 9, 12, 9, 0);
  it('counts calendar days once, not check-ins', () => {
    expect(calculateDayStreak([new Date(2026, 9, 12, 8).toISOString(), new Date(2026, 9, 12, 7).toISOString(), new Date(2026, 9, 11, 22).toISOString()], now)).toBe(2);
  });
  it('breaks on a skipped calendar day even within 48 hours', () => {
    // Oct 10 23:00 → Oct 12 08:00 is 33h (differenceInDays = 1) but skips Oct 11.
    expect(calculateDayStreak([new Date(2026, 9, 12, 8).toISOString(), new Date(2026, 9, 10, 23).toISOString()], now)).toBe(1);
  });
  it('is zero when the latest check-in is older than yesterday', () => {
    expect(calculateDayStreak([new Date(2026, 8, 1).toISOString(), new Date(2026, 7, 31).toISOString()], now)).toBe(0);
    expect(calculateDayStreak([], now)).toBe(0);
  });
});

describe('rotating question selection', () => {
  it('walks past every recent group instead of oscillating back to one', () => {
    const recency = Object.fromEntries(ROTATING_QUESTION_IDS.map((id, i) => [id, 100 - i]));
    const sorted = [...ROTATING_QUESTION_IDS];
    const first = sorted.slice(0, 4);
    const firstSwap = [...sorted.slice(0, 3), sorted[4]];
    const picked = selectQuestionsForCheckIn('premium', recency, [first, firstSwap]).filter(q => !q.core).map(q => q.id);
    const key = [...picked].sort().join('|');
    expect(key).not.toBe([...first].sort().join('|'));
    expect(key).not.toBe([...firstSwap].sort().join('|'));
  });
});

describe('CheckIn already-saved operation', () => {
  function deps(rpcResult: unknown) {
    localStorage.setItem('draft:u', '{"operationId":"x"}');
    return {
      user: { id: 'u' }, loading: false, hasThinCheckIn: () => false, showThinPrompt: false, setShowThinPrompt: vi.fn(),
      setLoading: vi.fn(), extraValues: {}, supabase: { rpc: vi.fn().mockResolvedValue(rpcResult) },
      operationId: '00000000-0000-4000-8000-000000000000', mood: 5, energy: 5, wins: [], blockers: [], commitments: [],
      oneThing: '', getMondayOfWeek: () => '2026-10-12', callbackOutcome: null, previousCommitment: null, callbackReflection: '',
      toast: vi.fn(), setSaveWarning: vi.fn(), localStorage, draftKey: 'draft:u', setDone: vi.fn(), setOperationId: vi.fn(),
      getTierCapability: () => ({ canUseAiDebrief: false }), tier: 'free', streamDebrief: vi.fn(),
      // The real module helper; it closes over the module constant, injected here.
      isAlreadySavedCheckIn: callback('src/pages/CheckIn.tsx', 'isAlreadySavedCheckIn', { ALREADY_SAVED_MESSAGE: 'Operation already saved with different content' }),
    };
  }
  it('treats an already-committed operation as saved and retires the draft', async () => {
    const d = deps({ data: null, error: { code: '22023', message: 'Operation already saved with different content; original draft retained' } });
    await callback('src/pages/CheckIn.tsx', 'handleSubmit', d)();
    expect(d.setDone).toHaveBeenCalledWith(true);
    expect(localStorage.getItem('draft:u')).toBeNull();
    expect(d.setOperationId).toHaveBeenCalledOnce();
    expect(d.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Check-in saved', description: expect.stringContaining("weren't applied") }));
    expect(d.toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  });
  it('still retains the draft for other save failures', async () => {
    const d = deps({ data: null, error: { code: '22023', message: 'Invalid scale' } });
    await callback('src/pages/CheckIn.tsx', 'handleSubmit', d)();
    expect(d.setDone).not.toHaveBeenCalled();
    expect(localStorage.getItem('draft:u')).not.toBeNull();
    expect(d.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  });
});

describe('Audit lifecycle trigger rejection', () => {
  it('reloads instead of looping when the audit was completed elsewhere', async () => {
    const query: Record<string, unknown> = {};
    for (const m of ['update', 'eq', 'select', 'single']) query[m] = vi.fn(() => query);
    query.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'Completed audits are server managed' } }).then(r);
    const setInitAttempt = vi.fn(), setInput = vi.fn(), setResponses = vi.fn();
    await callback('src/pages/Audit.tsx', 'processAnswer', {
      supabase: { from: () => query }, user: { id: 'u' }, auditId: 'a', answerFlight: { current: false }, initializing: false, initError: null,
      setAnswerSaving: vi.fn(), currentQ: 0, responses: {}, AUDIT_QUESTIONS: [{ id: 'q' }], AUDIT_SECTIONS: [{}],
      setInput, setResponses, toast: vi.fn(), setInitAttempt,
    })('answer');
    expect(setInitAttempt).toHaveBeenCalledOnce();
    expect(setResponses).not.toHaveBeenCalled();
  });
});
