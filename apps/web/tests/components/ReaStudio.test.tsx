// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReaBrowserView, ReaEvidenceView, ReaSqliteView, ReaStaticView, ReaTraceView, ReaPayload } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { ReaEvidenceGate, ReaStudio } from '../../src/components/rea-studio/ReaStudio';
import type { ProjectFile } from '../../src/types';

const envelope = { evidenceId: 'ev_0123456789abcdef0123', predicate: 'rea.x', operation: 'op', provider: { id: 'p', name: 'REA test provider', version: '1' }, confidence: 'observed', authority: 'controlled-replay', limitations: ['Only the sampled responses were captured.'] };
const payload = (over: Partial<ReaPayload> = {}): ReaPayload => ({ state: 'captured', mediaType: 'application/json', bytes: 30, sha256: 'a'.repeat(64), redacted: false, ...over });
const base = { ok: true as const, file: 'evidence/x.json', envelope, unknowns: ['201 semantic graph unknowns remain.'] };

const browser: ReaEvidenceView & ReaBrowserView = {
  ...base, kind: 'browser', origin: 'http://127.0.0.1:4318', durationMs: 1127, droppedEvents: 0, captured: { requestBodies: true, responseBodies: true },
  completeness: { status: 'incomplete', missingSections: ['events'], truncatedSections: [] },
  steps: [
    { index: 0, id: 'scenario_start', action: 'goto_start', status: 'completed', elapsedMs: 850, url: 'http://127.0.0.1:4318/', eventStart: 1, eventEnd: 0, error: null },
    { index: 1, id: 'paid-settlement-click', action: 'click', status: 'completed', elapsedMs: 45, url: null, eventStart: 4, eventEnd: 8, error: null,
      screenshot: payload({ state: 'captured-binary', mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAAA' }), dom: payload({ mediaType: 'text/html', text: '<main id="orders">ready</main>' }) },
    { index: 2, id: 'duplicate-click', action: 'click', status: 'completed', elapsedMs: 40, url: null, eventStart: 9, eventEnd: 12, error: null },
  ],
  requests: [
    { id: 'request-1', stepIndex: 0, method: 'GET', origin: null, path: '/', queryNames: [], resourceType: 'document', status: 200, isApi: false, request: payload({ state: 'not_exposed', bytes: null, sha256: null }), response: payload({ state: 'captured-binary', mediaType: 'text/html', bytes: 1661 }) },
    { id: 'request-2', stepIndex: 1, method: 'POST', origin: null, path: '/api/orders/1001/settle', queryNames: ['dry'], resourceType: 'fetch', status: 201, isApi: true, request: payload({ text: '{}' }), response: payload({ text: '{\n  "settlement_id": 1\n}' }) },
    { id: 'request-3', stepIndex: 2, method: 'POST', origin: null, path: '/api/orders/1001/settle', queryNames: [], resourceType: 'fetch', status: 409, isApi: true, request: payload({ text: '{}' }), response: payload({ state: 'integrity-failed', text: undefined }) },
    { id: 'request-4', stepIndex: 2, method: 'GET', origin: null, path: '/api/settlements', queryNames: [], resourceType: 'fetch', status: null, failure: 'net::ERR_ABORTED', isApi: true, request: payload({ state: 'not_exposed' }), response: payload({ state: 'missing' }) },
  ],
};

const col = (name: string, primaryKey = 0, notNull = false, type = 'INTEGER') => ({ name, type, notNull, primaryKey, defaultSql: null });
const sqlite: ReaEvidenceView & ReaSqliteView = {
  ...base, kind: 'sqlite', engine: 'SQLite 3.53.3', encoding: 'UTF-8', bytes: 28672, sha256: 'b'.repeat(64), completeness: 'complete', views: [], triggers: [],
  tables: [
    { name: 'customers', columns: [col('id', 1), col('name', 0, true, 'TEXT')], foreignKeys: [], unique: [], checks: [], indexes: [] },
    { name: 'orders', columns: [col('id', 1), col('customer_id', 0, true), col('status', 0, true, 'TEXT')], foreignKeys: [{ column: 'customer_id', refTable: 'customers', refColumn: 'id' }], unique: [], checks: ["status IN ('PAID','PENDING')"], indexes: [],
      rows: { columns: ['id', 'status'], values: [['1001', 'PAID']], returned: 1, truncated: false } },
  ],
};

const staticView: ReaEvidenceView & ReaStaticView = {
  ...base, kind: 'static', format: 'directory', applicationCoverage: 'complete', semanticCoverage: 'unknown', semanticUnknowns: 201, nodeTotal: 17, edgeTotal: 17,
  statistics: [{ key: 'parsed_javascript_files', value: 2 }, { key: 'parse_failures', value: 0 }],
  unknownReasons: [{ reason: 'dynamic-call', count: 120 }, { reason: 'unresolved-import', count: 60 }],
  nodes: [{ id: 'a', kind: 'artifact', label: 'artifact root' }, { id: 'm', kind: 'javascript-module', label: 'public/app.js' }, { id: 'e', kind: 'endpoint', label: '/api/orders' }],
  edges: [{ from: 'a', to: 'm', relation: 'contains' }, { from: 'm', to: 'e', relation: 'calls' }],
};

const trace: ReaEvidenceView & ReaTraceView = { ...base, kind: 'trace', seed: 'ALREADY_SETTLED', direction: 'incoming', status: 'no-match', matches: 0, tracedNodes: 0, terminalPaths: 0, paths: [] };

function stub(view: ReaEvidenceView | null, options: { probe?: boolean; status?: number } = {}) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    if (url.endsWith('/rea-evidence/probe')) return Response.json({ evidence: options.probe ?? true });
    if (url.endsWith('/rea-evidence/view')) return view ? Response.json(view) : Response.json({ error: { message: 'boom' } }, { status: options.status ?? 400 });
    return new Response('{}', { status: 404 });
  }));
  return calls;
}
const studio = (locale: 'en' | 'ko' = 'en') => render(<I18nProvider initial={locale}><ReaStudio projectId="p1" file="evidence/x.json" onShowRaw={vi.fn()} /></I18nProvider>);

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ReaStudio: browser capture', () => {
  it('shows the envelope, the tiles and what REA said it could not establish', async () => {
    stub(browser);
    studio();
    const root = await screen.findByTestId('rea-browser');
    expect(within(root).getByText('3/3')).toBeTruthy(); // every step completed
    expect(within(root).getByText('incomplete')).toBeTruthy();
    expect(within(root).getByText(/Missing sections: events/)).toBeTruthy();
    const header = screen.getByTestId('rea-envelope');
    expect(header.textContent).toContain('REA test provider 1');
    expect(header.textContent).toContain('observed');
    expect(header.textContent).toContain('controlled-replay');
    expect(screen.getByText('Limitations (1)')).toBeTruthy();
    expect(screen.getByText('Unknowns (1)')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toContain('Browser capture');
  });

  it('lists API calls first, filters by step and path, and opens a request with its pretty body', async () => {
    stub(browser);
    studio();
    await screen.findByTestId('rea-browser');
    // API only is on by default because the capture has API calls: the document is hidden.
    expect(screen.getAllByTestId('rea-request-row')).toHaveLength(3);
    fireEvent.click(screen.getByLabelText('API calls only'));
    expect(screen.getAllByTestId('rea-request-row')).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('Filter by path'), { target: { value: 'settlements' } });
    expect(screen.getAllByTestId('rea-request-row')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Filter by path'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /paid-settlement-click/ }));
    const rows = screen.getAllByTestId('rea-request-row');
    expect(rows).toHaveLength(1);
    fireEvent.click(within(rows[0]!).getByRole('button', { name: '/api/orders/1001/settle' }));
    expect(screen.getByText(/"settlement_id": 1/)).toBeTruthy();
    expect(screen.getByText('?dry')).toBeTruthy();
    // The step's screenshot and DOM are shown, tabbed.
    expect(screen.getByRole('img', { name: 'Screenshot' }).getAttribute('src')).toBe('data:image/png;base64,AAAA');
    fireEvent.click(screen.getByRole('tab', { name: 'DOM' }));
    expect(screen.getByText('<main id="orders">ready</main>')).toBeTruthy();
  });

  it('refuses to show a body whose hash failed, and says when a request failed', async () => {
    stub(browser);
    studio();
    await screen.findByTestId('rea-browser');
    fireEvent.click(screen.getByLabelText('API calls only'));
    const conflict = screen.getAllByTestId('rea-request-row').find((row) => within(row).queryByText('409'))!;
    fireEvent.click(within(conflict).getByRole('button'));
    expect(screen.getByRole('alert').textContent).toBe('The recorded hash does not match, so the content is not shown.');
    const failed = screen.getAllByTestId('rea-request-row').find((row) => within(row).queryByText('/api/settlements'))!;
    fireEvent.click(within(failed).getByRole('button'));
    expect(screen.getByText(/Request failed: net::ERR_ABORTED/)).toBeTruthy();
  });
});

describe('ReaStudio: SQLite', () => {
  it('draws every table with its columns and the foreign key between them, and shows constraints and rows on selection', async () => {
    stub(sqlite);
    studio();
    const root = await screen.findByTestId('rea-sqlite');
    const svg = within(root).getByTestId('rea-er');
    expect(svg.querySelectorAll('g[role="button"]')).toHaveLength(2);
    expect(svg.querySelectorAll('path[marker-end]')).toHaveLength(1);
    expect(svg.textContent).toContain('customer_id');
    expect(svg.textContent).toContain('PK INTEGER');
    fireEvent.click(within(root).getByRole('tab', { name: 'orders' }));
    expect(within(root).getByText("status IN ('PAID','PENDING')")).toBeTruthy();
    expect(within(root).getByText('customers.id')).toBeTruthy();
    expect(within(root).getByText('1001')).toBeTruthy();
    expect(within(root).getByText(/says nothing about whether the connection enforced it/)).toBeTruthy();
    // Selecting a table in the diagram selects its tab too.
    fireEvent.click(svg.querySelector('g[aria-label="customers"]')!);
    expect(within(root).getByRole('tab', { name: 'customers' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('ReaStudio: static analysis and trace', () => {
  it('shows REA\'s own coverage words, the graph and why things stayed unknown', async () => {
    stub(staticView);
    studio();
    const root = await screen.findByTestId('rea-static');
    expect(within(root).getByText('complete')).toBeTruthy();
    expect(within(root).getByText('unknown')).toBeTruthy();
    expect(within(root).getByText('201')).toBeTruthy();
    expect(within(root).getByText(/not that it is absent/)).toBeTruthy();
    const graph = within(root).getByTestId('rea-graph');
    expect(graph.textContent).toContain('/api/orders');
    expect(graph.querySelectorAll('path')).toHaveLength(2);
    expect(within(root).getByText('dynamic call')).toBeTruthy();
    expect(within(root).getByText('parsed javascript files')).toBeTruthy();
  });

  it('shows a trace with no match without claiming the feature is absent', async () => {
    stub(trace);
    studio();
    const root = await screen.findByTestId('rea-trace');
    expect(within(root).getByText('ALREADY_SETTLED')).toBeTruthy();
    expect(within(root).getByRole('note').textContent).toContain('does not show the feature is absent');
  });
});

describe('ReaStudio: failures and the Korean screen', () => {
  it('reports a file it cannot read', async () => {
    stub(null);
    studio();
    expect((await screen.findByTestId('rea-error')).textContent).toContain('Could not read this evidence file. boom');
  });

  it('is available in Korean', async () => {
    stub(sqlite);
    studio('ko');
    expect((await screen.findByRole('heading', { level: 3 })).textContent).toContain('SQLite 검사');
    expect(screen.getAllByText('관계도').length).toBeGreaterThan(0);
  });
});

describe('ReaEvidenceGate', () => {
  const file = { name: 'evidence/x.json', kind: 'code', mtime: 1 } as unknown as ProjectFile;
  const raw = <pre data-testid="raw">{'{"plain":true}'}</pre>;
  const gate = () => render(<I18nProvider initial="en"><ReaEvidenceGate projectId="p1" file={file} raw={raw} /></I18nProvider>);

  it('leaves an ordinary JSON file alone', async () => {
    const calls = stub(sqlite, { probe: false });
    gate();
    await waitFor(() => expect(calls.some((url) => url.endsWith('/probe'))).toBe(true));
    expect(screen.getByTestId('raw')).toBeTruthy();
    expect(calls.some((url) => url.endsWith('/view'))).toBe(false);
  });

  it('opens REA evidence in the Studio and switches to the raw JSON and back', async () => {
    stub(sqlite);
    gate();
    await screen.findByTestId('rea-studio');
    expect(screen.queryByTestId('raw')).toBeNull();
    fireEvent.click(screen.getByTestId('rea-show-raw'));
    expect(screen.getByTestId('raw')).toBeTruthy();
    fireEvent.click(screen.getByTestId('rea-show-studio'));
    await screen.findByTestId('rea-studio');
  });
});
