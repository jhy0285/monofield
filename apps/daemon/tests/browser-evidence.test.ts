import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { BrowserEvidenceCrossCheckResponse } from '@open-design/contracts';
import { startServer, type StartServerResult } from '../src/server.js';
import {
  BrowserEvidenceError,
  applyBrowserEvidenceFiles,
  classifyBrowserEvidenceError,
  crossCheckBrowserEvidenceFiles,
  listBrowserEvidenceFiles,
  readBrowserEvidence,
  type BrowserEvidenceFileAccess,
} from '../src/services/browser-evidence.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'rea');
const CAPTURE_TEXT = readFileSync(path.join(FIXTURES, 'browser-scenario-capture.json'), 'utf8');
const SPEC_TEXT = readFileSync(path.join(FIXTURES, 'interface-spec.json'), 'utf8');
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

type Json = Record<string, any>;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

/** The settlement demo's spec with three planted drifts: a removed field, a renamed one, a removed endpoint. */
function driftedSpec(): Json {
  const spec = JSON.parse(SPEC_TEXT) as Json;
  const settle = spec.endpoints.find((endpoint: Json) => endpoint.path === '/api/orders/{id}/settle');
  settle.responseFields = settle.responseFields.filter((field: Json) => field.nameEn !== 'fee_amount');
  settle.responseFields.find((field: Json) => field.nameEn === 'net_amount').nameEn = 'netAmount';
  spec.endpoints = spec.endpoints.filter((endpoint: Json) => endpoint.path !== '/api/settlements');
  return spec;
}

/** A capture whose first captured JSON response body no longer matches its recorded SHA-256. */
function corruptedCapture(): string {
  const capture = JSON.parse(CAPTURE_TEXT) as Json;
  const target = capture.normalized_result.events.items.find((event: Json) => event.kind === 'network-content' && event.phase === 'response'
    && event.body?.state === 'captured' && /json/.test(event.body.media_type ?? ''));
  target.body.content = Buffer.from('{"tampered":true}').toString('base64');
  return JSON.stringify(capture);
}

/** Project files in memory, with the write rule `writeProjectFile` enforces. */
function memoryFiles(initial: Record<string, string>) {
  const store = new Map(Object.entries(initial));
  const writes: Array<{ name: string; overwrite: boolean; expectedContentSha256?: string | null | undefined }> = [];
  const access: BrowserEvidenceFileAccess = {
    list: async () => [...store].map(([name, text], index) => ({ name, size: Buffer.byteLength(text), mtime: 1000 + index, kind: 'code' })),
    read: async (name) => {
      const text = store.get(name);
      if (text === undefined) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      return { buffer: Buffer.from(text), name };
    },
    head: async (name, bytes) => Buffer.from(store.get(name) ?? '').subarray(0, bytes),
    write: async (name, body, options) => {
      writes.push({ name, overwrite: options.overwrite, expectedContentSha256: options.expectedContentSha256 });
      const current = store.get(name);
      if (options.expectedContentSha256 && (current === undefined || sha256(current) !== options.expectedContentSha256)) {
        throw Object.assign(new Error('file changed since it was loaded'), { code: 'ESTALE' });
      }
      if (!options.overwrite && current !== undefined) throw Object.assign(new Error('file already exists'), { code: 'EEXIST' });
      store.set(name, typeof body === 'string' ? body : body.toString('utf8'));
    },
  };
  return { access, store, writes };
}

const files = () => memoryFiles({
  'evidence/capture.json': CAPTURE_TEXT,
  'docs/settlement.interface-spec.json': SPEC_TEXT,
  'docs/drifted.interface-spec.json': JSON.stringify(driftedSpec()),
});

describe('decoding an REA browser capture', () => {
  const decoded = readBrowserEvidence(Buffer.from(CAPTURE_TEXT), 'evidence/capture.json');

  it('summarizes the scenario, its completeness and what the capture retained', () => {
    expect(decoded.source).toMatchObject({
      file: 'evidence/capture.json',
      origin: 'http://127.0.0.1:4318',
      steps: 12,
      completedSteps: 12,
      transactions: 8,
      apiTransactions: 6,
      droppedEvents: 0,
      captured: { requestBodies: true, responseBodies: true },
      completeness: { status: 'incomplete', missingSections: ['events'], truncatedSections: [] },
    });
    expect(decoded.source.evidenceId).toMatch(/^ev_/);
    expect(decoded.source.limitations.length).toBeGreaterThan(0);
  });

  it('groups events into transactions with method, generalizable path, status and decoded bodies', () => {
    expect(decoded.transactions.map((tx) => `${tx.method} ${tx.path} ${tx.status} ${tx.resourceType}`)).toEqual([
      'GET / 200 document',
      'GET /app.js 200 script',
      'GET /api/orders 200 fetch',
      'POST /api/orders/1001/settle 201 fetch',
      'POST /api/orders/1001/settle 409 fetch',
      'POST /api/orders/1002/settle 409 fetch',
      'POST /api/orders/1003/settle 409 fetch',
      'GET /api/settlements 200 fetch',
    ]);
    const orders = decoded.transactions[2]!;
    expect(orders.request.state).toBe('not_exposed');
    expect(orders.response.state).toBe('captured');
    expect(orders.response.fields.map((field) => `${field.path}:${field.types.join('|')}`)).toEqual([
      'id:integer', 'customer_id:integer', 'status:string', 'gross_amount:integer', 'commission_bps:integer', 'settled_at:null', 'customer_name:string',
    ]);
    // The HTML document and script bodies are not JSON, so they establish no fields.
    expect(decoded.transactions[0]!.response).toMatchObject({ state: 'not-json', fields: [] });
    // Small JSON bodies keep their parsed example.
    expect(decoded.transactions[4]!.response.example).toEqual({ code: 'ALREADY_SETTLED' });
  });

  it('accepts the wrapped form `{ evidence }` that the evidence store writes', () => {
    const wrapped = readBrowserEvidence(Buffer.from(JSON.stringify({ evidence: JSON.parse(CAPTURE_TEXT) })), 'wrapped.json');
    expect(wrapped.transactions).toHaveLength(8);
  });

  it('refuses a file that is not an REA browser capture', () => {
    expect(() => readBrowserEvidence(Buffer.from('not json'), 'a.json')).toThrow(/not JSON/);
    expect(() => readBrowserEvidence(Buffer.from(JSON.stringify({ predicate_type: 'other', normalized_result: {} })), 'b.json'))
      .toThrow(BrowserEvidenceError);
    expect(() => readBrowserEvidence(Buffer.from('{}'), 'c.json')).toThrow(/rea\.browser-scenario-capture/);
  });

  it('marks a body whose bytes no longer match the recorded SHA-256 as integrity-failed, without fields', () => {
    const broken = readBrowserEvidence(Buffer.from(corruptedCapture()), 'evidence/capture.json');
    const failed = broken.transactions.filter((tx) => tx.response.state === 'integrity-failed');
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((tx) => tx.response.fields.length === 0 && tx.response.example === undefined)).toBe(true);
    // The other bodies are still read.
    expect(broken.transactions.some((tx) => tx.response.state === 'captured')).toBe(true);
  });

  it('records why a body is unavailable instead of treating it as empty', () => {
    const capture = JSON.parse(CAPTURE_TEXT) as Json;
    const items = capture.normalized_result.events.items as Json[];
    const content = items.find((event) => event.kind === 'network-content' && event.phase === 'response' && event.body?.state === 'captured' && /json/.test(event.body.media_type ?? ''))!;
    content.body = { state: 'unavailable', reason: 'body-size-limit' };
    const result = readBrowserEvidence(Buffer.from(JSON.stringify(capture)), 'evidence/capture.json');
    expect(result.transactions.some((tx) => tx.response.state === 'unavailable' && tx.response.reason === 'body-size-limit')).toBe(true);
  });
});

describe('finding browser evidence in a project', () => {
  it('lists only REA capture files, newest first, and skips specs and non-JSON files', async () => {
    const { access } = memoryFiles({
      'evidence/old.json': CAPTURE_TEXT,
      'evidence/new.json': CAPTURE_TEXT,
      'docs/settlement.interface-spec.json': SPEC_TEXT,
      'package.json': '{"name":"x"}',
      'notes.txt': CAPTURE_TEXT,
    });
    const list = await listBrowserEvidenceFiles(access);
    expect(list.map((entry) => entry.file)).toEqual(['evidence/new.json', 'evidence/old.json']);
    expect(list[0]).toMatchObject({ size: Buffer.byteLength(CAPTURE_TEXT) });
  });
});

describe('comparing a capture with a specification', () => {
  it('finds the settlement demo consistent with its spec, apart from the undocumented 409 codes', async () => {
    const { access } = files();
    const result = await crossCheckBrowserEvidenceFiles(access, { inputFile: 'docs/settlement.interface-spec.json', evidenceFiles: ['evidence/capture.json'] });
    expect(result.contentSha256).toBe(sha256(SPEC_TEXT));
    expect(result.inputFile).toBe('docs/settlement.interface-spec.json');
    expect(result.summary).toMatchObject({ documentedEndpoints: 3, exercisedEndpoints: 3, undocumentedEndpoints: 0, observedApiCalls: 6, errors: 0, warnings: 0, info: 1 });
    expect(result.findings.map((finding) => finding.kind)).toEqual(['undocumented-error']);
    expect(result.findings[0]!.details).toEqual(['409 code=ALREADY_SETTLED', '409 code=ORDER_NOT_PAID, status=CANCELLED', '409 code=ORDER_NOT_PAID, status=PENDING']);
    expect(result.coverage.map((entry) => `${entry.method} ${entry.path} ${entry.observed} ${entry.response.confirmed}/${entry.response.documented}`)).toEqual([
      'GET /api/orders 1 7/7', 'POST /api/orders/{id}/settle 4 5/5', 'GET /api/settlements 1 6/6',
    ]);
  });

  it('reports the planted drift: an undocumented endpoint, a missing field and a renamed one', async () => {
    const { access } = files();
    const result = await crossCheckBrowserEvidenceFiles(access, { inputFile: 'docs/drifted.interface-spec.json', evidenceFiles: ['evidence/capture.json'] });
    expect(result.findings.map((finding) => [finding.kind, finding.endpoint.method, finding.endpoint.path, finding.field ?? ''])).toEqual([
      ['undocumented-endpoint', 'GET', '/api/settlements', ''],
      ['undocumented-field', 'POST', '/api/orders/{id}/settle', 'fee_amount'],
      ['name-mismatch', 'POST', '/api/orders/{id}/settle', 'net_amount'],
      ['undocumented-error', 'POST', '/api/orders/{id}/settle', ''],
    ]);
    expect(result.findings.find((finding) => finding.kind === 'name-mismatch')).toMatchObject({ documentedField: 'netAmount', side: 'response' });
    expect(result.findings.filter((finding) => finding.kind === 'undocumented-error')[0]!.details).toContain('409 code=ALREADY_SETTLED');
    expect(result.summary).toMatchObject({ documentedEndpoints: 2, undocumentedEndpoints: 1, warnings: 3, errors: 0, info: 1 });
  });

  it('reports a corrupted body as an error and builds nothing from it', async () => {
    const { access } = memoryFiles({ 'evidence/capture.json': corruptedCapture(), 'docs/settlement.interface-spec.json': SPEC_TEXT });
    const result = await crossCheckBrowserEvidenceFiles(access, { inputFile: 'docs/settlement.interface-spec.json', evidenceFiles: ['evidence/capture.json'] });
    expect(result.summary.errors).toBeGreaterThan(0);
    expect(result.findings.filter((finding) => finding.kind === 'integrity-failed').every((finding) => finding.severity === 'error' && !finding.applicable)).toBe(true);
    expect(result.findings[0]!.kind).toBe('integrity-failed');
  });

  it('drafts a specification from the capture when no document is given', async () => {
    const { access } = files();
    const result = await crossCheckBrowserEvidenceFiles(access, { evidenceFiles: ['evidence/capture.json'] });
    expect(result).toMatchObject({ inputFile: '', contentSha256: '' });
    expect(result.summary).toMatchObject({ documentedEndpoints: 0, undocumentedEndpoints: 3 });
  });

  it('rejects empty, oversized and unsafe evidence lists and an unreadable document', async () => {
    const { access } = files();
    await expect(crossCheckBrowserEvidenceFiles(access, { evidenceFiles: [] })).rejects.toThrow(/at least one/);
    await expect(crossCheckBrowserEvidenceFiles(access, {})).rejects.toThrow(/at least one/);
    await expect(crossCheckBrowserEvidenceFiles(access, { evidenceFiles: Array.from({ length: 11 }, (_, i) => `e/${i}.json`) })).rejects.toThrow(/At most 10/);
    await expect(crossCheckBrowserEvidenceFiles(access, { evidenceFiles: ['../x.json'] })).rejects.toThrow(/project-relative/);
    await expect(crossCheckBrowserEvidenceFiles(access, { inputFile: '../x.json', evidenceFiles: ['evidence/capture.json'] })).rejects.toThrow(/project-relative/);
    await expect(crossCheckBrowserEvidenceFiles(access, { inputFile: 'docs/missing.interface-spec.json', evidenceFiles: ['evidence/capture.json'] })).rejects.toMatchObject({ code: 'ENOENT' });
    const bad = memoryFiles({ 'evidence/capture.json': CAPTURE_TEXT, 'docs/bad.interface-spec.json': '{"kind":"interface-spec"}' });
    await expect(crossCheckBrowserEvidenceFiles(bad.access, { inputFile: 'docs/bad.interface-spec.json', evidenceFiles: ['evidence/capture.json'] })).rejects.toBeInstanceOf(BrowserEvidenceError);
  });
});

describe('applying a capture to a specification', () => {
  const request = { inputFile: 'docs/drifted.interface-spec.json', evidenceFiles: ['evidence/capture.json'] };

  it('returns the updated document without touching the file unless asked to write', async () => {
    const { access, store, writes } = files();
    const before = store.get(request.inputFile);
    const result = await applyBrowserEvidenceFiles(access, request);
    expect(result.changes).toMatchObject({ endpointsAdded: 1, fieldsAdded: 7, fieldsRenamed: 1, notesAdded: 1, evidenceAttached: 2 });
    expect(result.written).toBeUndefined();
    expect(writes).toEqual([]);
    expect(store.get(request.inputFile)).toBe(before);
    expect(result.doc.endpoints.map((endpoint) => endpoint.path)).toEqual(['/api/orders', '/api/orders/{id}/settle', '/api/settlements']);
  });

  it('leaves no warning behind: applying, then comparing again, finds the spec in line with the capture', async () => {
    const { access, store } = files();
    const base = sha256(store.get(request.inputFile)!);
    const written = await applyBrowserEvidenceFiles(access, { ...request, write: true, baseContentSha256: base });
    expect(written.written).toEqual({ file: request.inputFile, contentSha256: sha256(store.get(request.inputFile)!) });
    const again = await crossCheckBrowserEvidenceFiles(access, request);
    expect(again.summary).toMatchObject({ warnings: 0, errors: 0, undocumentedEndpoints: 0 });
    expect(again.contentSha256).toBe(written.written!.contentSha256);
    const second = await applyBrowserEvidenceFiles(access, { ...request, write: true, baseContentSha256: again.contentSha256 });
    expect(second.changes).toMatchObject({ endpointsAdded: 0, fieldsAdded: 0, fieldsRenamed: 0, notesAdded: 0, evidenceAttached: 0 });
  });

  it('refuses to overwrite a document that changed since it was compared', async () => {
    const { access, store, writes } = files();
    const stale = sha256('an earlier version');
    const error = await applyBrowserEvidenceFiles(access, { ...request, write: true, baseContentSha256: stale }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BrowserEvidenceError);
    expect(error).toMatchObject({ status: 409, code: 'BROWSER_EVIDENCE_STALE' });
    // A missing hash is as stale as a wrong one.
    await expect(applyBrowserEvidenceFiles(access, { ...request, write: true })).rejects.toMatchObject({ status: 409 });
    expect(writes).toEqual([]);
    expect(store.get(request.inputFile)).toBe(JSON.stringify(driftedSpec()));
  });

  it('passes the hash it read to the write, so a change after the read is still caught', async () => {
    const { access, store, writes } = files();
    const racing: BrowserEvidenceFileAccess = {
      ...access,
      write: async (name, body, options) => {
        store.set(name, `${store.get(name)} `); // someone saves between the read and the write
        return access.write(name, body, options);
      },
    };
    const error = await applyBrowserEvidenceFiles(racing, { ...request, write: true, baseContentSha256: sha256(store.get(request.inputFile)!) }).catch((e: unknown) => e);
    expect(writes[0]).toMatchObject({ name: request.inputFile, overwrite: true, expectedContentSha256: sha256(JSON.stringify(driftedSpec())) });
    expect(classifyBrowserEvidenceError(error)).toMatchObject({ status: 409, code: 'BROWSER_EVIDENCE_STALE' });
  });

  it('writes a draft to a new file, and will not replace an existing one', async () => {
    const { access, store } = files();
    const result = await applyBrowserEvidenceFiles(access, { evidenceFiles: ['evidence/capture.json'], write: true, outputFile: 'docs/observed.interface-spec.json' });
    expect(result.written!.file).toBe('docs/observed.interface-spec.json');
    expect(JSON.parse(store.get('docs/observed.interface-spec.json')!)).toMatchObject({ kind: 'interface-spec', source: { collector: 'rea-browser' } });
    expect(result.doc.endpoints).toHaveLength(3);
    await expect(applyBrowserEvidenceFiles(access, { evidenceFiles: ['evidence/capture.json'], write: true, outputFile: 'docs/observed.interface-spec.json' }))
      .rejects.toMatchObject({ code: 'EEXIST' });
    await expect(applyBrowserEvidenceFiles(access, { evidenceFiles: ['evidence/capture.json'], write: true })).rejects.toThrow(/outputFile/);
  });

  it('applies only the chosen findings, writes notes in the requested language and keeps examples out by default', async () => {
    const { access } = files();
    const checked = await crossCheckBrowserEvidenceFiles(access, request);
    const rename = checked.findings.find((finding) => finding.kind === 'name-mismatch')!;
    const only = await applyBrowserEvidenceFiles(access, { ...request, findingIds: [rename.id], attachEvidence: false });
    expect(only.changes).toMatchObject({ endpointsAdded: 0, fieldsAdded: 0, fieldsRenamed: 1, notesAdded: 0, evidenceAttached: 0 });
    const english = await applyBrowserEvidenceFiles(access, { ...request, noteLanguage: 'en' });
    expect(english.doc.endpoints.find((endpoint) => endpoint.path === '/api/settlements')!.note).toMatch(/^Added from a recorded browser scenario/);
    // Captured bodies are real application data: the drafted endpoint carries no example unless asked.
    expect(english.doc.endpoints.find((endpoint) => endpoint.path === '/api/settlements')!.responseExample).toBeUndefined();
    expect(english.changes.examplesAdded).toBe(0);
    const withExamples = await applyBrowserEvidenceFiles(access, { ...request, includeExamples: true });
    expect(withExamples.changes.examplesAdded).toBeGreaterThan(0);
    expect(withExamples.doc.endpoints.find((endpoint) => endpoint.path === '/api/settlements')!.responseExample).toEqual([expect.objectContaining({ id: 1, order_id: 1001, net_amount: 9650 })]);
    await expect(applyBrowserEvidenceFiles(access, { ...request, findingIds: 'one' })).rejects.toThrow(/list of finding IDs/);
  });
});

describe('failure reporting', () => {
  it('maps file-system and conflict errors to the status the client acts on', () => {
    expect(classifyBrowserEvidenceError(new BrowserEvidenceError('x', 404, 'PROJECT_NOT_FOUND'))).toEqual({ status: 404, code: 'PROJECT_NOT_FOUND', message: 'x' });
    expect(classifyBrowserEvidenceError(Object.assign(new Error('gone'), { code: 'ENOENT' }))).toMatchObject({ status: 404, code: 'FILE_NOT_FOUND' });
    expect(classifyBrowserEvidenceError(Object.assign(new Error('changed'), { code: 'ESTALE' }))).toMatchObject({ status: 409, code: 'BROWSER_EVIDENCE_STALE' });
    expect(classifyBrowserEvidenceError(Object.assign(new Error('exists'), { code: 'EEXIST' }))).toMatchObject({ status: 409, code: 'BROWSER_EVIDENCE_CONFLICT' });
    expect(classifyBrowserEvidenceError(new Error('boom'))).toEqual({ status: 400, code: 'BROWSER_EVIDENCE_FAILED', message: 'boom' });
  });
});

describe('browser evidence HTTP routes (real server)', () => {
  let server: StartServerResult;
  let projectId: string;
  const url = (suffix: string) => `${server.url}/api/projects/${projectId}${suffix}`;
  const post = (suffix: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(url(suffix), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const upload = async (name: string, content: string) => {
    const response = await fetch(url('/files'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, content }) });
    expect(response.ok).toBe(true);
  };
  const read = async (name: string) => (await (await fetch(url(`/files/${name}`))).text());

  beforeAll(async () => {
    server = await startServer({ port: 0, returnServer: true }) as StartServerResult;
    projectId = randomUUID();
    const created = await fetch(`${server.url}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: projectId, name: 'browser-evidence' }) });
    expect(created.ok).toBe(true);
    await upload('evidence/capture.json', CAPTURE_TEXT);
    await upload('docs/drifted.interface-spec.json', JSON.stringify(driftedSpec(), null, 2));
    await upload('package.json', '{"name":"demo"}');
  }, 60_000);
  afterAll(async () => { await server?.shutdown(); server?.server.closeAllConnections?.(); });

  it('lists the capture and nothing else', async () => {
    const response = await fetch(url('/browser-evidence'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json() as { files: Array<{ file: string }> };
    expect(body.files.map((entry) => entry.file)).toEqual(['evidence/capture.json']);
  });

  it('compares through the route and reports the planted drift', async () => {
    const response = await post('/browser-evidence/cross-check', { inputFile: 'docs/drifted.interface-spec.json', evidenceFiles: ['evidence/capture.json'] });
    expect(response.status).toBe(200);
    const body = await response.json() as BrowserEvidenceCrossCheckResponse;
    expect(body.findings.map((finding) => finding.kind)).toEqual(['undocumented-endpoint', 'undocumented-field', 'name-mismatch', 'undocumented-error']);
    expect(body.contentSha256).toBe(sha256(await read('docs/drifted.interface-spec.json')));
    expect(body.transactions).toHaveLength(8);
  });

  it('writes with the compared hash, then a second write on the old hash is refused with 409', async () => {
    const compared = await (await post('/browser-evidence/cross-check', { inputFile: 'docs/drifted.interface-spec.json', evidenceFiles: ['evidence/capture.json'] })).json() as BrowserEvidenceCrossCheckResponse;
    const apply = { inputFile: 'docs/drifted.interface-spec.json', evidenceFiles: ['evidence/capture.json'], write: true, baseContentSha256: compared.contentSha256 };
    const first = await post('/browser-evidence/apply', apply);
    expect(first.status).toBe(200);
    const written = await first.json() as { written: { file: string; contentSha256: string }; changes: { endpointsAdded: number } };
    expect(written.changes.endpointsAdded).toBe(1);
    expect(sha256(await read('docs/drifted.interface-spec.json'))).toBe(written.written.contentSha256);

    const stale = await post('/browser-evidence/apply', apply);
    expect(stale.status).toBe(409);
    expect((await stale.json() as { error: { code: string } }).error.code).toBe('BROWSER_EVIDENCE_STALE');

    const again = await (await post('/browser-evidence/cross-check', { inputFile: 'docs/drifted.interface-spec.json', evidenceFiles: ['evidence/capture.json'] })).json() as BrowserEvidenceCrossCheckResponse;
    expect(again.summary).toMatchObject({ warnings: 0, undocumentedEndpoints: 0 });
  });

  it('rejects unsafe paths, a missing file, an unknown project and cross-origin writes', async () => {
    expect((await post('/browser-evidence/cross-check', { evidenceFiles: ['../x.json'] })).status).toBe(400);
    expect((await post('/browser-evidence/cross-check', { evidenceFiles: ['evidence/missing.json'] })).status).toBe(404);
    expect((await post('/browser-evidence/cross-check', { evidenceFiles: ['evidence/capture.json'] }, { origin: 'https://untrusted.example' })).status).toBe(403);
    expect((await post('/browser-evidence/apply', { evidenceFiles: ['evidence/capture.json'], write: true }, { origin: 'https://untrusted.example' })).status).toBe(403);
    const unknown = await fetch(`${server.url}/api/projects/${randomUUID()}/browser-evidence`);
    expect(unknown.status).toBe(404);
    expect((await fetch(url('/browser-evidence'), { headers: { origin: 'https://untrusted.example' } })).status).toBe(403);
  });
});
