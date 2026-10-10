// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangePlanResponse } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { ChangePlanPanel } from '../../src/components/document-spec/ChangePlanPanel';

const node = { id: 'code', kind: 'code' as const, label: 'prices.mjs' };
const report: ChangePlanResponse = {
  schemaVersion: 1, mode: 'observed', graph: { ok: true, analyzedAt: new Date().toISOString(), documents: [], nodes: [node], edges: [], changedNodeIds: ['code'], impacts: [], unlinkedNodeIds: [], warnings: [], schemaWatch: null },
  ontology: { nodes: [node], edges: [] }, source: { scope: 'git-visible-worktree', head: null, digest: 'a'.repeat(64), fileCount: 1, reason: null },
  checks: [], changedFiles: ['prices.mjs'], unmatchedChangedFiles: [], affectedNodeIds: ['code'],
  obligations: [{ id: 'o', nodeId: 'code', ruleId: 'builtin:coverage', path: ['code'], condition: 'affected.kind == code', triggers: [{ ruleId: 'builtin:coverage', condition: 'affected.kind == code' }], requirement: 'Inspect assertions', state: 'coverage-gap', checkId: null, review: null, receiptId: null }],
  warnings: [], summary: { affected: 1, obligations: 1, passed: 0, outstanding: 1, coverageGaps: 1 }, handoff: 'Inspect current prices.mjs and verify the change.', handoffTruncated: false, elapsedMs: 12, modelCalls: 0,
};
beforeEach(() => { localStorage.setItem('open-design:locale', 'en'); vi.stubGlobal('fetch', vi.fn(async () => Response.json(report))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const props = { projectId: 'p', dirty: false, inputFiles: '' };
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Change impact and verification plan' }));
const analyze = () => fireEvent.click(screen.getByRole('button', { name: 'Build change plan' }));
describe('manual ontology planner UI', () => {
  it('does not analyze on mount/open/type and creates a draft without starting commands', async () => {
    const draft = vi.fn(); render(<I18nProvider><ChangePlanPanel {...props} onRequestDraft={draft} /></I18nProvider>); open();
    fireEvent.change(screen.getByLabelText('Change to develop'), { target: { value: 'Improve prices UI' } }); expect(fetch).not.toHaveBeenCalled();
    analyze(); await waitFor(() => expect(screen.getByText('Coverage unknown')).toBeTruthy());
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/projects/p/documents/plan');
    fireEvent.click(screen.getByRole('button', { name: 'Prepare development request' }));
    expect(draft).toHaveBeenCalledWith(report.handoff); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('simulates explicitly selected graph IDs and does not execute a project mutation', async () => {
    render(<I18nProvider><ChangePlanPanel {...props} /></I18nProvider>); open(); analyze();
    await waitFor(() => expect(screen.getByText('What if a file or database target changes?')).toBeTruthy());
    fireEvent.click(screen.getByText('What if a file or database target changes?'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'code · prices.mjs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Simulate selected changes' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]?.body))).toEqual({ request: '', simulateNodeIds: ['code'] });
  });
  it('aborts and discards late results when the project or source editing state changes', async () => {
    let finish!: (response: Response) => void; vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<I18nProvider><ChangePlanPanel {...props} /></I18nProvider>); open(); analyze();
    const signal = vi.mocked(fetch).mock.calls[0]![1]?.signal as AbortSignal;
    view.rerender(<I18nProvider><ChangePlanPanel {...props} dirty /></I18nProvider>);
    expect(signal.aborted).toBe(true); finish(Response.json(report));
    await waitFor(() => expect(screen.queryByText('Coverage unknown')).toBeNull());
    expect(screen.getByRole('button', { name: 'Build change plan' }).hasAttribute('disabled')).toBe(true);
  });
  it('shows conflicts and invalidates old plans after rules or request edits', async () => {
    render(<I18nProvider><ChangePlanPanel {...props} /></I18nProvider>); open(); analyze();
    await waitFor(() => expect(screen.getByText('Coverage unknown')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Project policy JSON (optional)'), { target: { value: 'policy.json' } });
    expect(screen.queryByText('Coverage unknown')).toBeNull();
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: { message: 'Source changed' } }, { status: 409 })); analyze();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Source changed'));
  });
});
