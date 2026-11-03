import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ReaBrowserView, ReaEvidenceListResponse, ReaEvidenceView, ReaSqliteView, ReaStaticView, ReaTraceView } from '@open-design/contracts';
import { startServer, type StartServerResult } from '../src/server.js';
import { BrowserEvidenceError, type BrowserEvidenceFileAccess } from '../src/services/browser-evidence.js';
import { buildReaEvidenceView, listReaEvidenceFiles, viewReaEvidenceFile } from '../src/services/rea-evidence.js';

const STUDIO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'rea', 'studio');
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'rea');
const read = (name: string, dir = STUDIO) => readFileSync(path.join(dir, name));
const view = (name: string) => buildReaEvidenceView(read(name), name);
type Json = Record<string, any>;

function memoryFiles(initial: Record<string, Buffer | string>): BrowserEvidenceFileAccess {
  const store = new Map(Object.entries(initial).map(([name, value]) => [name, Buffer.from(value)]));
  return {
    list: async () => [...store].map(([name, buffer], index) => ({ name, size: buffer.length, mtime: 1000 + index })),
    read: async (name) => { const buffer = store.get(name); if (!buffer) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return { buffer, name }; },
    head: async (name, bytes) => store.get(name)!.subarray(0, bytes),
    write: async () => undefined,
  };
}

describe('REA Studio: finding evidence', () => {
  it('lists the real REA files of every kind, newest first, and skips what is not evidence', async () => {
    const files = memoryFiles({
      ...Object.fromEntries(readdirSync(STUDIO).map((name) => [`evidence/${name}`, read(name)])),
      'docs/orders.interface-spec.json': read('interface-spec.json', FIXTURES),
      'package.json': '{"name":"x"}',
      'notes.txt': 'rea.browser-scenario-capture',
    });
    const list = await listReaEvidenceFiles(files);
    expect(Object.fromEntries(list.map((entry) => [entry.file.replace('evidence/', ''), entry.kind]))).toEqual({
      'browser-overview.json': 'browser', 'db-before.json': 'sqlite', 'db-settlements.json': 'sqlite',
      'static-summary.json': 'view', 'duplicate-trace.json': 'trace', 'static.json': 'static',
    });
    expect(list.find((entry) => entry.file.endsWith('static.json'))).toMatchObject({ operation: 'analyze_javascript_application', evidenceId: expect.stringMatching(/^ev_/) });
    expect(list.map((entry) => entry.mtime)).toEqual([...list.map((entry) => entry.mtime)].sort((a, b) => b - a));
  });
});

describe('REA Studio: a browser capture', () => {
  const browser = view('browser-overview.json') as ReaEvidenceView & ReaBrowserView;

  it('carries the envelope and what REA said it could not establish', () => {
    expect(browser).toMatchObject({ ok: true, kind: 'browser', envelope: { operation: 'capture_browser_scenario', predicate: 'rea.browser-scenario-capture', confidence: 'observed', authority: 'controlled-replay' } });
    expect(browser.envelope.provider.id).toBe('rea-playwright-browser-scenario');
    expect(browser.envelope.limitations.length).toBeGreaterThan(3);
    expect(browser.completeness).toMatchObject({ status: expect.any(String) });
    expect(browser.durationMs).toBe(1127);
  });

  it('lists steps with timing, and shows the screenshot and DOM only because their hashes match', () => {
    expect(browser.steps.map((step) => [step.index, step.id, step.action, step.status])).toEqual([[0, 'scenario_start', 'goto_start', 'completed'], [1, 'overview-ready', 'wait_for', 'completed']]);
    expect(browser.steps[1]).toMatchObject({ elapsedMs: 187, url: 'http://127.0.0.1:4318/' });
    const shot = browser.steps[1]!.screenshot!;
    expect(shot).toMatchObject({ state: 'captured-binary', mediaType: 'image/png', bytes: 53745, sha256: '307ecd926f4ad82596254ddfdc4806e8274e15e7705d1fb93f687dca19f0886c' });
    expect(shot.dataUrl!.startsWith('data:image/png;base64,')).toBe(true);
    expect(browser.steps[1]!.dom!.text).toContain('<');
    // A step that asked for no screenshot has none, rather than an empty one.
    expect(browser.steps[0]!.screenshot).toBeUndefined();
  });

  it('refuses to show an artifact whose bytes no longer match the recorded hash', () => {
    const tampered = JSON.parse(read('browser-overview.json').toString('utf8')) as Json;
    const shot = tampered.normalized_result.steps[1].artifacts.screenshot.value;
    shot.data_base64 = Buffer.from('not the screenshot').toString('base64');
    const broken = buildReaEvidenceView(Buffer.from(JSON.stringify(tampered)), 'tampered.json') as unknown as ReaBrowserView;
    expect(broken.steps[1]!.screenshot).toMatchObject({ state: 'integrity-failed' });
    expect(broken.steps[1]!.screenshot!.dataUrl).toBeUndefined();
  });

  it('decodes the settlement capture requests, with bodies pretty-printed and non-JSON bodies left alone', () => {
    const settle = buildReaEvidenceView(readFileSync(path.join(FIXTURES, 'browser-scenario-capture.json')), 'capture.json') as unknown as ReaBrowserView;
    expect(settle.steps).toHaveLength(12);
    expect(settle.requests.map((r) => `${r.method} ${r.path} ${r.status}`)).toContain('POST /api/orders/1001/settle 201');
    const conflict = settle.requests.find((r) => r.status === 409)!;
    expect(conflict.isApi).toBe(true);
    expect(conflict.response).toMatchObject({ state: 'captured', mediaType: expect.stringContaining('json') });
    expect(conflict.response.text).toBe('{\n  "code": "ALREADY_SETTLED"\n}');
    expect(settle.requests.find((r) => r.resourceType === 'document')!.isApi).toBe(false);
    expect(settle.captured).toEqual({ requestBodies: true, responseBodies: true });
  });
});

describe('REA Studio: a SQLite inspection', () => {
  const schema = view('db-before.json') as ReaEvidenceView & ReaSqliteView;

  it('reads the tables, columns and the constraints REA only has as SQL', () => {
    expect(schema).toMatchObject({ kind: 'sqlite', engine: 'SQLite 3.53.3', encoding: 'UTF-8', bytes: 28672, completeness: 'complete' });
    expect(schema.tables.map((table) => table.name)).toEqual(['customers', 'orders', 'settlements', 'audit_log']);
    const orders = schema.tables.find((table) => table.name === 'orders')!;
    expect(orders.columns.find((column) => column.name === 'id')).toMatchObject({ type: 'INTEGER', primaryKey: 1, notNull: false });
    expect(orders.columns.find((column) => column.name === 'customer_id')).toMatchObject({ notNull: true });
    expect(orders.foreignKeys).toEqual([{ column: 'customer_id', refTable: 'customers', refColumn: 'id' }]);
    expect(orders.checks).toContain("status IN ('PAID','PENDING','CANCELLED')");
    const settlements = schema.tables.find((table) => table.name === 'settlements')!;
    expect(settlements.unique).toEqual(['order_id']);
    expect(settlements.foreignKeys).toEqual([{ column: 'order_id', refTable: 'orders', refColumn: 'id' }]);
    expect(settlements.columns.find((column) => column.name === 'created_at')!.defaultSql).toBe('CURRENT_TIMESTAMP');
    expect(schema.tables.find((table) => table.name === 'audit_log')!.foreignKeys).toHaveLength(1);
    expect(schema.tables.every((table) => table.rows === undefined)).toBe(true);
  });

  it('attaches the sampled rows to their table, values as the strings REA gave', () => {
    const rows = view('db-settlements.json') as ReaEvidenceView & ReaSqliteView;
    const settlements = rows.tables.find((table) => table.name === 'settlements');
    expect(settlements?.rows).toEqual({ columns: ['id', 'order_id', 'gross_amount', 'fee_amount', 'net_amount'], values: [['1', '1001', '10001', '351', '9650']], returned: 1, truncated: false });
  });
});

describe('REA Studio: static analysis, a view and a trace', () => {
  it('summarizes the application graph and keeps the unknowns REA listed', () => {
    const analysis = view('static.json') as ReaEvidenceView & ReaStaticView;
    expect(analysis).toMatchObject({ kind: 'static', format: 'directory', applicationCoverage: 'complete', semanticCoverage: 'unknown', semanticUnknowns: 201, nodeTotal: 17, edgeTotal: 17 });
    expect(analysis.statistics).toContainEqual({ key: 'parsed_javascript_files', value: 2 });
    expect(analysis.nodes.map((node) => node.label)).toEqual(expect.arrayContaining(['public/app.js', 'server.js', '/api/orders', '/api/settlements']));
    expect(analysis.nodes.find((node) => node.label === '/api/orders')!.kind).toBe('endpoint');
    // Layers: the artifact root first, endpoints last.
    expect(analysis.nodes[0]!.kind).toBe('artifact');
    expect(analysis.nodes.at(-1)!.kind).toBe('endpoint');
    const ids = new Set(analysis.nodes.map((node) => node.id));
    expect(analysis.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to))).toBe(true);
    expect(analysis.edges.map((edge) => edge.relation)).toEqual(expect.arrayContaining(['calls', 'imports', 'contains']));
    expect(analysis.unknownReasons[0]).toMatchObject({ reason: expect.any(String), count: expect.any(Number) });
    expect(analysis.unknownReasons.reduce((sum, item) => sum + item.count, 0)).toBeLessThanOrEqual(201);
  });

  it('shows a trace that matched nothing as no-match, not as a missing feature', () => {
    const trace = view('duplicate-trace.json') as ReaEvidenceView & ReaTraceView;
    expect(trace).toMatchObject({ kind: 'trace', seed: 'ALREADY_SETTLED', direction: 'incoming', status: 'no-match', matches: 0, terminalPaths: 0, paths: [] });
  });

  it('shows an analysis view with the facts REA put in it', () => {
    const summary = view('static-summary.json');
    expect(summary.kind).toBe('view');
    expect((summary as { facts: Array<{ key: string; value: string }> }).facts).toContainEqual({ key: 'parent_operation', value: 'analyze_javascript_application' });
    expect(summary.unknowns).toContain('201 semantic graph unknowns remain in the parent Evidence.');
  });
});

describe('REA Studio: what is not evidence', () => {
  it('rejects non-JSON, non-REA JSON and unsafe paths', async () => {
    expect(() => buildReaEvidenceView(Buffer.from('nope'), 'a.json')).toThrow(BrowserEvidenceError);
    expect(() => buildReaEvidenceView(Buffer.from('{"predicate_type":"other"}'), 'b.json')).toThrow(/not an REA evidence file/);
    const files = memoryFiles({ 'a.json': '{}' });
    await expect(viewReaEvidenceFile(files, { file: '../x.json' })).rejects.toThrow(/project-relative/);
    await expect(viewReaEvidenceFile(files, {})).rejects.toThrow(/project-relative/);
    await expect(viewReaEvidenceFile(files, { file: 'missing.json' })).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('shows an unknown future operation as an envelope with its facts instead of failing', () => {
    const future = { evidence_id: 'ev_x', predicate_type: 'rea.future-thing', operation: 'future_operation', provider: { id: 'p', name: 'P', version: '1' }, limitations: ['L'], normalized_result: { kind: 'x', coverage: { status: 'partial' } } };
    const result = buildReaEvidenceView(Buffer.from(JSON.stringify(future)), 'future.json');
    expect(result).toMatchObject({ kind: 'other', envelope: { operation: 'future_operation', limitations: ['L'] } });
    expect((result as { facts: unknown[] }).facts).toContainEqual({ key: 'coverage', value: 'partial' });
  });
});

describe('REA Studio routes (real server)', () => {
  let server: StartServerResult;
  let projectId: string;
  const url = (suffix: string) => `${server.url}/api/projects/${projectId}${suffix}`;
  const post = (suffix: string, body: unknown, headers: Record<string, string> = {}) => fetch(url(suffix), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  beforeAll(async () => {
    server = await startServer({ port: 0, returnServer: true }) as StartServerResult;
    projectId = randomUUID();
    expect((await fetch(`${server.url}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: projectId, name: 'rea-studio' }) })).ok).toBe(true);
    for (const name of ['browser-overview.json', 'db-before.json', 'duplicate-trace.json']) {
      const response = await fetch(url('/files'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `evidence/${name}`, content: read(name).toString('utf8') }) });
      expect(response.ok).toBe(true);
    }
    await fetch(url('/files'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'package.json', content: '{"name":"demo"}' }) });
  }, 60_000);
  afterAll(async () => { await server?.shutdown(); server?.server.closeAllConnections?.(); });

  it('lists the evidence and serves a checked view of one file', async () => {
    const listed = await (await fetch(url('/rea-evidence'))).json() as ReaEvidenceListResponse;
    expect(listed.files.map((entry) => `${entry.kind}:${entry.file}`).sort()).toEqual(['browser:evidence/browser-overview.json', 'sqlite:evidence/db-before.json', 'trace:evidence/duplicate-trace.json']);
    const response = await post('/rea-evidence/view', { file: 'evidence/db-before.json' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json() as ReaEvidenceView & ReaSqliteView;
    expect(body.tables).toHaveLength(4);
  });

  it('tells from the first bytes whether a file is evidence', async () => {
    expect(await (await post('/rea-evidence/probe', { file: 'evidence/db-before.json' })).json()).toEqual({ evidence: true, kind: 'sqlite', operation: 'inspect_sqlite_database' });
    expect(await (await post('/rea-evidence/probe', { file: 'package.json' })).json()).toEqual({ evidence: false });
    expect((await post('/rea-evidence/probe', { file: '../x.json' })).status).toBe(400);
  });

  it('refuses bad input, other origins and unknown projects', async () => {
    expect((await post('/rea-evidence/view', { file: '../x.json' })).status).toBe(400);
    expect((await post('/rea-evidence/view', { file: 'package.json' })).status).toBe(400);
    expect((await post('/rea-evidence/view', { file: 'evidence/missing.json' })).status).toBe(404);
    expect((await post('/rea-evidence/view', { file: 'evidence/db-before.json' }, { origin: 'https://untrusted.example' })).status).toBe(403);
    expect((await fetch(`${server.url}/api/projects/${randomUUID()}/rea-evidence`)).status).toBe(404);
  });
});
