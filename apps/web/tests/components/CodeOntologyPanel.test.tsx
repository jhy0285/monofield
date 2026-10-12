// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeOntologyResponse } from '@open-design/contracts';
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
beforeEach(() => { localStorage.setItem('open-design:locale', 'en'); vi.stubGlobal('fetch', vi.fn(async () => Response.json(report))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const props = { projectId: 'traffic', ready: true };
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Build ontology from code' }));
const build = () => fireEvent.click(screen.getByRole('button', { name: 'Build from code' }));
describe('explicit code-first ontology UI', () => {
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
      coverage: { ...report.coverage, unsupportedFiles: 1 }, issues: [{ path: 'unknown.py', reason: 'unsupported-language', message: 'Not supported' }] }));
    render(<I18nProvider><CodeOntologyPanel {...props} projectPath="backend" /></I18nProvider>); open();
    fireEvent.change(screen.getByLabelText('Optional business documents (module-relative Markdown/TXT paths, one per line)'), { target: { value: 'business.md' } }); build();
    await waitFor(() => expect(screen.getByText('Candidate · review needed', { exact: false })).toBeTruthy());
    expect(screen.getByText('Unsupported language', { exact: false })).toBeTruthy(); expect(screen.getByText('Unchanged-source graph reused', { exact: false })).toBeTruthy();
    expect(screen.getByText('SignalController.java:6')).toBeTruthy();
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
