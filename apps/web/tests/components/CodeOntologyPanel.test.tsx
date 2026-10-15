// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeOntologyResponse, CodeOntologyPlanResponse } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { CodeOntologyPanel } from '../../src/components/CodeOntologyPanel';

const evidence = { path: 'SignalController.java', line: 6, sha256: 'a'.repeat(64) };
const report: CodeOntologyResponse = { schemaVersion: 1, projectPath: '.', analyzedAt: new Date().toISOString(), snapshotSha256: 'b'.repeat(64),
  nodes: [{ id: 'controller', kind: 'class', label: 'SignalController', evidence }, { id: 'api', kind: 'api', label: 'GET /signals', evidence }],
  edges: [{ id: 'edge', from: 'controller', to: 'api', relation: 'serves', basis: 'syntax', evidence }], issues: [],
  coverage: { scannedFiles: 3, parsedFiles: 3, sourceBytes: 1000, businessDocuments: 0, unsupportedFiles: 0, languages: [{ id: 'java', files: 2 }, { id: 'vue', files: 1 }], truncated: false, inventoryComplete: true },
  dependencyGraph: { ok: true, analyzedAt: '', documents: [], nodes: [], edges: [], changedNodeIds: [], impacts: [], unlinkedNodeIds: [], warnings: [], schemaWatch: null },
  handoff: 'Inspect current signal source before changing it.', elapsedMs: 100, cacheHit: false, modelCalls: 0,
};
beforeEach(() => { localStorage.setItem('open-design:locale', 'en'); localStorage.setItem('monofield:ontology-tutorial-dismissed:v1','true'); vi.stubGlobal('fetch', vi.fn(async () => Response.json(report))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const props = { projectId: 'traffic', ready: true };
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Build ontology from code' }));
const build = () => fireEvent.click(screen.getByRole('button', { name: 'Build from code' }));
describe('explicit code-first ontology UI', () => {
  it('connects code impact to document review through an explicit plan action', async () => {
    const result: CodeOntologyPlanResponse = { ontology: report,
      plan: { schemaVersion: 1, mode: 'observed', graph: report.dependencyGraph, ontology: { nodes: [], edges: [] },
        source: { scope: 'git-visible-worktree', head: null, digest: null, fileCount: 0, reason: 'No Git' }, checks: [], changedFiles: [], unmatchedChangedFiles: [], affectedNodeIds: [], obligations: [], warnings: [],
        summary: { affected: 2, obligations: 0, passed: 0, outstanding: 0, coverageGaps: 1 }, handoff: 'Review the service change and its API document.', handoffTruncated: false, elapsedMs: 110, modelCalls: 0 },
      documentReviews: [{ documentFile: 'docs/api.json', itemId: 'IF-1', label: 'Signal cycle', state: 'review-required', impactPath: ['Service.java','GET /signals','Signal cycle'] }], documentHashes: [], elapsedMs: 110, modelCalls: 0 };
    vi.mocked(fetch).mockResolvedValue(Response.json(result)); const draft = vi.fn();
    render(<I18nProvider><CodeOntologyPanel {...props} onRequestDraft={draft} /></I18nProvider>); open();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Build code and document change plan' }));
    await waitFor(() => expect(screen.getByText('docs/api.json · IF-1')).toBeTruthy());
    expect(screen.getByText('Review required')).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1); expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/projects/traffic/ontology/plan');
    fireEvent.click(screen.getByRole('button', { name: 'Prepare investigation request' })); expect(draft).toHaveBeenCalledWith(result.plan.handoff);
  });
  it('refreshes only after opting in, a saved revision, and an open panel', async () => {
    const view = render(<I18nProvider><CodeOntologyPanel {...props} revisionKey="one" /></I18nProvider>); open(); build();
    await waitFor(() => expect(screen.getByText('SignalController → GET /signals')).toBeTruthy());
    expect(screen.getByText('No business documents · code-based draft')).toBeTruthy();
    expect(screen.getByText(/0 documents · 0 concepts · 0 association candidates/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Refresh after saved changes while this panel is open' }));
    view.rerender(<I18nProvider><CodeOntologyPanel {...props} revisionKey="two" /></I18nProvider>);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2), { timeout: 2500 });
    open();
    view.rerender(<I18nProvider><CodeOntologyPanel {...props} revisionKey="three" /></I18nProvider>);
    await new Promise(resolve => setTimeout(resolve, 1400)); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('opts into a whole imported codebase without changing the active command module', async () => {
    render(<I18nProvider><CodeOntologyPanel {...props} projectPath="backend" /></I18nProvider>); open();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include the full imported codebase (frontend/backend)' }));
    expect(fetch).not.toHaveBeenCalled(); build();
    await waitFor(() => expect(screen.getByText('SignalController → GET /signals')).toBeTruthy());
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body)).projectPath).toBe('.');
  });
  it('builds without specifications or documents and makes no requests on mount/open/type', async () => {
    render(<I18nProvider><CodeOntologyPanel {...props} /></I18nProvider>); open();
    fireEvent.change(screen.getByLabelText('Change or business topic to investigate (optional)'), { target: { value: 'Signal workflow' } });
    expect(fetch).not.toHaveBeenCalled(); build();
    await waitFor(() => expect(screen.getByText('SignalController → GET /signals')).toBeTruthy());
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/projects/traffic/ontology/build');
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toEqual({ businessFiles: [], request: 'Signal workflow' });
  });
  it('passes optional document paths and keeps source evidence and candidates visible', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ ...report, cacheHit: true, edges: [{ ...report.edges[0], basis: 'candidate' }],
      coverage: { ...report.coverage, businessDocuments: 1, unsupportedFiles: 1 }, issues: [{ path: 'unknown.py', reason: 'unsupported-language', message: 'Not supported' }] }));
    render(<I18nProvider><CodeOntologyPanel {...props} projectPath="backend" /></I18nProvider>); open();
    fireEvent.change(screen.getByLabelText('Optional business documents (module-relative Markdown/TXT paths, one per line)'), { target: { value: 'business.md' } }); build();
    await waitFor(() => expect(screen.getByText('Candidate · review needed', { exact: false })).toBeTruthy());
    expect(screen.getByText('Unsupported language', { exact: false })).toBeTruthy(); expect(screen.getByText('Unchanged-source graph reused', { exact: false })).toBeTruthy();
    expect(screen.getByText('SignalController.java:6')).toBeTruthy();
    expect(screen.getByText('Business documents: 1 · candidate associations')).toBeTruthy();
    expect(screen.getByText(/Document currency, code consistency/)).toBeTruthy();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toMatchObject({ projectPath: 'backend', businessFiles: ['business.md'] });
  });
  it('aborts late analysis when modules or source revisions change', async () => {
    let finish!: (response: Response) => void; vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<I18nProvider><CodeOntologyPanel {...props} /></I18nProvider>); open(); build();
    const signal = vi.mocked(fetch).mock.calls[0]![1]?.signal as AbortSignal;
    view.rerender(<I18nProvider><CodeOntologyPanel {...props} projectPath="frontend" /></I18nProvider>); expect(signal.aborted).toBe(true);
    finish(Response.json(report)); await waitFor(() => expect(screen.queryByText('SignalController → GET /signals')).toBeNull());
  });
  it('prepares a draft without executing commands or sending a chat and clears stale results on editing', async () => {
    const draft = vi.fn(); render(<I18nProvider><CodeOntologyPanel {...props} onRequestDraft={draft} /></I18nProvider>); open(); build();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare investigation request' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Prepare investigation request' })); expect(draft).toHaveBeenCalledWith(report.handoff); expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Change or business topic to investigate (optional)'), { target: { value: 'Another topic' } });
    expect(screen.queryByText('SignalController → GET /signals')).toBeNull();
  });
  it('keeps snapshot evidence after watcher updates and does not cancel a rebuild that includes an edit', async () => {
    const view = render(<I18nProvider><CodeOntologyPanel {...props} revisionKey="before" /></I18nProvider>); open(); build();
    await waitFor(() => expect(screen.getByText('SignalController → GET /signals')).toBeTruthy());
    view.rerender(<I18nProvider><CodeOntologyPanel {...props} revisionKey="edited" /></I18nProvider>);
    expect(screen.getByText(/Source changed or was refreshed/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Prepare investigation request' }).hasAttribute('disabled')).toBe(true);
    let finish!: (response: Response) => void; vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve; })); build();
    const signal = vi.mocked(fetch).mock.calls[1]![1]?.signal as AbortSignal;
    view.rerender(<I18nProvider><CodeOntologyPanel {...props} revisionKey="delayed-watcher-update" /></I18nProvider>);
    expect(signal.aborted).toBe(false); finish(Response.json(report));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare investigation request' }).hasAttribute('disabled')).toBe(false));
  });
});
