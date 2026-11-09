import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ReaBrowserComparison, ReaCaseComparison } from '@open-design/contracts';
import { BrowserEvidenceError, type BrowserEvidenceFileAccess } from '../src/services/browser-evidence.js';
import { citeReaEvidence, jsonShape } from '../src/services/rea-cite.js';
import { accessibilityOutline, htmlText } from '../src/services/rea-evidence.js';
import { compareReaFiles, firstDifference, routeOf } from '../src/services/rea-compare.js';
import { runReaDoctor, type ReaDoctorDeps } from '../src/services/rea-doctor.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUDIO = path.join(HERE, 'fixtures', 'rea', 'studio');
const CAPTURE = path.join(HERE, 'fixtures', 'rea', 'browser-scenario-capture.json');
type Json = Record<string, any>;
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const readJson = (file: string): Json => JSON.parse(readFileSync(file, 'utf8'));

function memoryFiles(initial: Record<string, Json | string>) {
  const store = new Map<string, Buffer>(Object.entries(initial).map(([name, value]) => [name, Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))]));
  const access: BrowserEvidenceFileAccess = {
    list: async () => [...store].map(([name, buffer]) => ({ name, size: buffer.length, mtime: 1 })),
    read: async (name) => { const buffer = store.get(name); if (!buffer) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return { buffer, name }; },
    head: async (name, bytes) => store.get(name)!.subarray(0, bytes),
    write: async (name, body) => { store.set(name, typeof body === 'string' ? Buffer.from(body) : body); },
  };
  return { access, store };
}

/** The response body REA recorded for a transaction, decoded. */
function responseBody(capture: Json, transaction: string): Json {
  const events = capture.normalized_result.events.items as Json[];
  const response = events.find((event) => event.transaction_id === transaction && event.kind === 'response');
  const content = events.find((event) => event.kind === 'network-content' && event.phase === 'response' && event.source_event_sequence === response!.sequence);
  return JSON.parse(Buffer.from(content!.body.content, 'base64').toString('utf8'));
}

/** Replaces a step artifact's text and re-records its hash, the way a second REA run would have written it. */
function withArtifactText(capture: Json, stepIndex: number, artifact: 'dom' | 'accessibility', text: string): Json {
  const copy = structuredClone(capture);
  const value = copy.normalized_result.steps.find((step: Json) => step.step_index === stepIndex).artifacts[artifact].value;
  value.text = text; value.bytes = Buffer.byteLength(text); value.sha256 = sha256(Buffer.from(text));
  return copy;
}

describe('citing REA evidence', () => {
  const overview = readJson(path.join(STUDIO, 'browser-overview.json'));
  const capture = readJson(CAPTURE);

  it('cites a step: where it is, what it did, and its verified screenshot written next to the evidence', async () => {
    const { access, store } = memoryFiles({ 'evidence/browser-overview.json': overview });
    const citation = await citeReaEvidence(access, { file: 'evidence/browser-overview.json', target: { kind: 'step', index: 1 } });
    expect(citation).toMatchObject({ ok: true, pointer: 'steps[step_index=1]', label: 'step 1 overview-ready', files: ['evidence/rea-cite/browser-overview-step-1.png'], valuesIncluded: false });
    const lines = citation.block.split('\n');
    expect(lines[0]).toBe(`<rea-evidence file="evidence/browser-overview.json" evidence_id="${overview.evidence_id}" pointer="steps[step_index=1]">`);
    expect(lines.at(-1)).toBe('</rea-evidence>');
    expect(citation.block).toContain('source: capture_browser_scenario (rea.browser-scenario-capture) · REA rea-playwright-browser-scenario');
    expect(citation.block).toContain('item: step 1 "overview-ready" · wait_for · completed · 187 ms');
    expect(citation.block).toContain('page: / (http://127.0.0.1:4318/)');
    expect(citation.block).toMatch(/screenshot: evidence\/rea-cite\/browser-overview-step-1\.png \(image\/png, 52\.5 KB, sha256 307ecd926f4a… verified\)/);
    expect(sha256(store.get('evidence/rea-cite/browser-overview-step-1.png')!)).toBe('307ecd926f4ad82596254ddfdc4806e8274e15e7705d1fb93f687dca19f0886c');
  });

  it('cites the screen as an outline of headings and controls, and its text only when values are asked for', async () => {
    const { access } = memoryFiles({ 'e.json': overview });
    const plain = await citeReaEvidence(access, { file: 'e.json', target: { kind: 'step', index: 1 } });
    expect(plain.block).toContain('screen outline (accessibility snapshot; names kept for headings and controls only, values off):');
    expect(plain.block).toContain('    - heading "주문 목록" [level=2]');
    expect(plain.block).toContain('        - columnheader "수수료율 bps"');
    expect(plain.block).toContain('page HTML: captured, not quoted (values off)');
    expect(plain.block).not.toContain('데모상사');
    expect(plain.block).not.toContain('10,001');
    const full = await citeReaEvidence(access, { file: 'e.json', target: { kind: 'step', index: 1 }, includeValues: true });
    expect(full.block).toContain('accessibility snapshot excerpt:');
    expect(full.block).toContain('visible text excerpt (from the captured HTML):');
    expect(full.block).toContain('데모상사');
    expect(full.block).not.toContain('<style>');
  });

  it('does not export a screenshot whose bytes no longer match the recorded hash', async () => {
    const tampered = structuredClone(overview);
    const shot = tampered.normalized_result.steps[1].artifacts.screenshot.value;
    shot.data_base64 = `${shot.data_base64.slice(0, -8)}AAAAAAA=`;
    const { access, store } = memoryFiles({ 'e.json': tampered });
    const citation = await citeReaEvidence(access, { file: 'e.json', target: { kind: 'step', index: 1 } });
    expect(citation.files).toEqual([]);
    expect(citation.block).toContain('screenshot: recorded but not verified or not readable, not exported');
    expect([...store.keys()]).toEqual(['e.json']);
  });

  it('cites a request with the shape of its bodies, and their values only on request', async () => {
    const { access } = memoryFiles({ 'capture.json': capture });
    const body = responseBody(capture, 'request-4');
    expect(body).toMatchObject({ net_amount: 9650 });
    const value = '"net_amount": 9650';
    const citation = await citeReaEvidence(access, { file: 'capture.json', target: { kind: 'request', id: 'request-4' } });
    expect(citation.pointer).toBe('events.items[transaction_id=request-4]');
    expect(citation.block).toContain('item: POST /api/orders/1001/settle → 201 (fetch) · step 3');
    expect(citation.block).toContain('request body: application/json, 2 B, sha256 verified — shape {}');
    expect(citation.block).toContain(`response body: application/json`);
    expect(citation.block).toContain(`shape ${jsonShape(body)}`);
    expect(citation.block).not.toContain('9650');
    const full = await citeReaEvidence(access, { file: 'capture.json', target: { kind: 'request', id: 'request-4' }, includeValues: true });
    expect(full.block).toContain('response body excerpt:');
    expect(full.block).toContain(value);
  });

  it('cites a SQLite table with its declared constraints, and a trace path', async () => {
    const { access } = memoryFiles({ 'db.json': readFileSync(path.join(STUDIO, 'db-settlements.json'), 'utf8') });
    const table = await citeReaEvidence(access, { file: 'db.json', target: { kind: 'table', name: 'settlements' } });
    expect(table.pointer).toBe('schema.tables[name=settlements]');
    expect(table.block).toMatch(/item: SQLite table settlements · \d+ columns/);
    expect(table.block).toContain('foreign keys: order_id → orders.id');
    expect(table.block).toContain('constraints are read from the CREATE TABLE text');
    const whole = await citeReaEvidence(access, { file: 'db.json', target: { kind: 'file' } });
    expect(whole.block).toMatch(/item: the whole schema · SQLite/);
  });

  it('refuses an item the file does not have, and a target of the wrong kind', async () => {
    const { access } = memoryFiles({ 'capture.json': capture });
    await expect(citeReaEvidence(access, { file: 'capture.json', target: { kind: 'step', index: 99 } })).rejects.toMatchObject({ status: 404, code: 'REA_ITEM_NOT_FOUND' });
    await expect(citeReaEvidence(access, { file: 'capture.json', target: { kind: 'table', name: 'orders' } })).rejects.toMatchObject({ status: 400, code: 'REA_ITEM_INVALID' });
    await expect(citeReaEvidence(access, { file: 'capture.json', target: { kind: 'step', index: -1 } })).rejects.toBeInstanceOf(BrowserEvidenceError);
    await expect(citeReaEvidence(access, { file: '../x.json', target: { kind: 'file' } })).rejects.toBeInstanceOf(BrowserEvidenceError);
  });

  it('writes the structure of a value, never the value', () => {
    expect(jsonShape({ id: 7, status: 'paid', lines: [{ sku: 'A-1', qty: 2 }], note: null, ok: true })).toBe('{ id: number, status: string, lines: [{ sku: string, qty: number }], note: null, ok: boolean }');
    expect(jsonShape([])).toBe('[]');
    expect(jsonShape({})).toBe('{}');
  });

  it('reduces HTML to its visible text and a snapshot to its structure', () => {
    expect(htmlText('<html><head><title>t</title><style>p{}</style></head><body><h1>제목 &amp; 부제</h1><p>a<br>b</p><script>x()</script><table><tr><td>1</td><td>2</td></tr></table></body></html>'))
      .toBe('제목 & 부제\na\nb\n1 2');
    expect(accessibilityOutline('- main:\n  - heading "목록" [level=2]\n  - row "1001 홍길동":\n    - cell "1001"\n  - row "1002 김철수":\n    - cell "1002"\n  - text: 개인 메모\n  - button "저장"'))
      .toBe('- main:\n  - heading "목록" [level=2]\n  - row:\n    - cell\n  - row:\n    - cell\n  - text\n  - button "저장"');
    expect(accessibilityOutline('- list:\n  - listitem\n  - listitem\n  - listitem')).toBe('- list:\n  - listitem ×3');
  });
});

describe('comparing an original with its remake', () => {
  const capture = readJson(CAPTURE);

  /** The same scenario replayed against a remake: another origin and other order IDs. */
  function remakeOf(edit: (copy: Json) => void = () => {}): Json {
    const copy = JSON.parse(JSON.stringify(capture).replaceAll('http://127.0.0.1:4318', 'http://localhost:5173').replaceAll('/api/orders/1001/', '/api/orders/7/')) as Json;
    edit(copy);
    return copy;
  }

  it('passes every step when the remake behaves the same, with other IDs and another origin', async () => {
    const { access } = memoryFiles({ 'original.json': capture, 'remake.json': remakeOf() });
    const result = await compareReaFiles(access, { original: 'original.json', remake: 'remake.json' }) as ReaBrowserComparison & { summary: Json };
    expect(result.kind).toBe('browser');
    expect(result.summary).toEqual({ total: 12, pass: 12, fail: 0, missing: 0, extra: 0 });
    expect(result.steps[3]!.calls).toEqual([{ method: 'POST', route: '/api/orders/{n}/settle', original: [201], remake: [201], same: true }]);
    expect((result as unknown as { report: string }).report.split('\n')[0]).toBe('original.json → remake.json (browser steps): 12/12 pass · 0 fail · 0 missing in remake · 0 only in remake');
  });

  it('names what differs: a call status, an action, and a step the remake does not have', async () => {
    const remake = remakeOf((copy) => {
      const events = copy.normalized_result.events.items as Json[];
      events.find((event) => event.transaction_id === 'request-5' && event.kind === 'response')!.status = 200;
      copy.normalized_result.steps.find((step: Json) => step.step_index === 6).action = 'dblclick';
      copy.normalized_result.steps = copy.normalized_result.steps.filter((step: Json) => step.step_index !== 11);
    });
    const { access } = memoryFiles({ 'original.json': capture, 'remake.json': remake });
    const result = await compareReaFiles(access, { original: 'original.json', remake: 'remake.json' }) as ReaBrowserComparison & { summary: Json };
    expect(result.summary).toEqual({ total: 12, pass: 9, fail: 2, missing: 1, extra: 0 });
    const step = (id: string) => result.steps.find((row) => row.original?.id === id)!;
    expect(step('duplicate-settlement-result')).toMatchObject({ verdict: 'fail', differences: ['calls'] });
    expect(step('duplicate-settlement-result').calls).toEqual([{ method: 'POST', route: '/api/orders/{n}/settle', original: [409], remake: [200], same: false }]);
    expect(step('pending-rejected-click')).toMatchObject({ verdict: 'fail', differences: ['action'], remake: { action: 'dblclick' } });
    expect(step('settlements-loaded')).toMatchObject({ verdict: 'missing', remake: null });
  });

  it('compares the screens by their accessibility snapshot, and can leave that out', async () => {
    const overview = readJson(path.join(STUDIO, 'browser-overview.json'));
    const snapshot: string = overview.normalized_result.steps[1].artifacts.accessibility.value.text;
    const remake = withArtifactText(overview, 1, 'accessibility', snapshot.replace('heading "주문 목록" [level=2]', 'heading "Orders" [level=2]'));
    const { access } = memoryFiles({ 'a.json': overview, 'b.json': remake });
    const result = await compareReaFiles(access, { original: 'a.json', remake: 'b.json' }) as ReaBrowserComparison;
    expect(result.steps[1]).toMatchObject({ verdict: 'fail', differences: ['text'], screenshots: { original: true, remake: true },
      text: { compared: true, source: 'accessibility', onlyOriginal: ['heading "주문 목록" [level=2]'], onlyRemake: ['heading "Orders" [level=2]'] } });
    const withoutText = await compareReaFiles(access, { original: 'a.json', remake: 'b.json', compareText: false }) as ReaBrowserComparison & { summary: Json };
    expect(withoutText.summary.pass).toBe(2);
    expect(withoutText.textCompared).toBe(false);
  });

  it('falls back to the text of the captured HTML when there is no accessibility snapshot', async () => {
    const overview = readJson(path.join(STUDIO, 'browser-overview.json'));
    delete overview.normalized_result.steps[1].artifacts.accessibility;
    const html: string = overview.normalized_result.steps[1].artifacts.dom.value.text;
    const remake = withArtifactText(overview, 1, 'dom', html.replace('<h2>주문 목록</h2>', '<h2>Orders</h2>'));
    const { access } = memoryFiles({ 'a.json': overview, 'b.json': remake });
    const result = await compareReaFiles(access, { original: 'a.json', remake: 'b.json' }) as ReaBrowserComparison;
    expect(result.steps[1]!.text).toEqual({ compared: true, source: 'dom', onlyOriginal: ['주문 목록'], onlyRemake: ['Orders'] });
  });

  it('compares case results by id, with a tolerance for numbers, failures first', async () => {
    const original = { cases: [{ id: 'a', input: { x: 1 }, output: { pan: 0.5 } }, { id: 'b', output: [1, 2] }, { id: 'c', output: 3 }, { id: 'e', output: 'same' }] };
    const remake = { cases: [{ id: 'e', output: 'same' }, { id: 'a', output: { pan: 0.5004 } }, { id: 'b', output: [1, 3] }, { id: 'd', output: 1 }] };
    const { access } = memoryFiles({ 'cases/original.json': original, 'cases/remake.json': remake });
    const strict = await compareReaFiles(access, { original: 'cases/original.json', remake: 'cases/remake.json' }) as ReaCaseComparison & { summary: Json };
    expect(strict.kind).toBe('cases');
    expect(strict.summary).toEqual({ total: 5, pass: 1, fail: 2, missing: 1, extra: 1 });
    expect(strict.rows.map((row) => [row.key, row.verdict, row.at ?? null])).toEqual([['a', 'fail', '$.pan'], ['b', 'fail', '$[1]'], ['c', 'missing', null], ['d', 'extra', null], ['e', 'pass', null]]);
    const loose = await compareReaFiles(access, { original: 'cases/original.json', remake: 'cases/remake.json', tolerance: 0.001 }) as ReaCaseComparison & { summary: Json };
    expect(loose.rows.find((row) => row.key === 'a')!.verdict).toBe('pass');
  });

  it('matches cases by input when they have no id', async () => {
    const original = { cases: [{ input: { x: 1, y: 2 }, output: 3 }, { input: { x: 2, y: 2 }, output: 4 }] };
    const remake = { cases: [{ input: { y: 2, x: 2 }, output: 4 }, { input: { y: 2, x: 1 }, output: 3 }] };
    const { access } = memoryFiles({ 'o.json': original, 'r.json': remake });
    const result = await compareReaFiles(access, { original: 'o.json', remake: 'r.json' }) as ReaCaseComparison & { summary: Json };
    expect(result.summary).toMatchObject({ total: 2, pass: 2 });
  });

  it('refuses two files of different kinds, and a negative tolerance', async () => {
    const { access } = memoryFiles({ 'capture.json': capture, 'cases.json': { cases: [{ output: 1 }] } });
    await expect(compareReaFiles(access, { original: 'capture.json', remake: 'cases.json' })).rejects.toMatchObject({ status: 400, code: 'REA_COMPARE_MISMATCH' });
    await expect(compareReaFiles(access, { original: 'cases.json', remake: 'cases.json', tolerance: -1 })).rejects.toBeInstanceOf(BrowserEvidenceError);
  });

  it('normalizes IDs in routes and reports the first difference by JSON path', () => {
    expect(routeOf('/api/orders/1001/settle')).toBe('/api/orders/{n}/settle');
    expect(routeOf('/api/users/3f2a9c1e-0b4d-4c6e-9a1f-2b3c4d5e6f70')).toBe('/api/users/{id}');
    expect(routeOf('/api/v1/orders')).toBe('/api/v1/orders');
    expect(firstDifference({ a: [1, { b: 2 }] }, { a: [1, { b: 2.5 }] }, 0)).toBe('$.a[1].b');
    expect(firstDifference({ a: 1 }, { a: 1, 'odd key': 2 }, 0)).toBe('$["odd key"]');
    expect(firstDifference(1, 1.0000001, 0.001)).toBeNull();
  });
});

describe('the REA setup check', () => {
  const linuxDeps = (overrides: Partial<ReaDoctorDeps> = {}, present: string[] = []): ReaDoctorDeps => ({
    platform: 'linux',
    env: { PATH: '/usr/bin:/opt/tools/bin' },
    nodeVersion: async () => 'v24.11.1',
    exists: async (file) => present.includes(file),
    mcpServers: async () => [{ id: 'rea', templateId: 'rea', enabled: true, command: 'npx', args: ['-y', 'rea-agents@6.7.0', '--mcp'] }],
    bundled: () => ({ available: false, reason: 'not-installed', found: null }),
    ...overrides,
  });

  it('is ready when Node.js is in range, npx is on PATH and the REA MCP server is enabled', async () => {
    const result = await runReaDoctor(linuxDeps({}, ['/usr/bin/npx', '/usr/bin/chromium', '/opt/tools/bin/jadx']));
    expect(result).toMatchObject({ ok: true, ready: true, platform: 'linux', package: { name: 'rea-agents', version: '6.7.0' } });
    const by = Object.fromEntries(result.checks.map((check) => [check.id, check]));
    expect(by.node).toEqual({ id: 'node', required: true, found: 'v24.11.1', status: 'ok' });
    expect(by.npx).toMatchObject({ status: 'ok', found: '/usr/bin/npx' });
    expect(by.mcp).toMatchObject({ status: 'ok', found: 'npx -y rea-agents@6.7.0 --mcp' });
    expect(by.browser).toMatchObject({ status: 'ok', required: false, found: '/usr/bin/chromium' });
    expect(by.jadx).toMatchObject({ status: 'ok', found: '/opt/tools/bin/jadx' });
    expect(by.native).toMatchObject({ status: 'missing', required: false });
    expect(by.ghidra).toEqual({ id: 'ghidra', required: false, found: null, status: 'missing', note: 'not-set' });
    expect(result.checks.map((check) => check.id)).toEqual(['bundled', 'node', 'npx', 'mcp', 'browser', 'ghidra', 'native', 'java', 'jadx', 'apktool', 'tshark', 'adb']);
    expect(by.bundled).toEqual({ id: 'bundled', required: false, found: null, status: 'missing', note: 'not-installed' });
    expect(result.bundled).toBeNull();
  });

  it('is not ready when a required item is missing or out of range, and says why', async () => {
    const missing = await runReaDoctor(linuxDeps({ nodeVersion: async () => null, mcpServers: async () => [] }));
    expect(missing.ready).toBe(false);
    // REA reaches conversations without a saved entry now, so the conversation link is never "missing"; without the
    // bundled copy it runs through npx, which is what is missing here.
    expect(missing.checks.filter((check) => check.status === 'missing').map((check) => check.id)).toEqual(['bundled', 'node', 'npx', 'browser', 'ghidra', 'native', 'java', 'jadx', 'apktool', 'tshark', 'adb']);
    expect(missing.checks.find((check) => check.id === 'mcp')).toMatchObject({ status: 'ok', found: 'npx -y rea-agents@6.7.0 --mcp' });
    const old = await runReaDoctor(linuxDeps({ nodeVersion: async () => 'v20.18.0', mcpServers: async () => [{ id: 'rea', templateId: 'rea', enabled: false, command: 'npx', args: ['-y', 'rea-agents@6.4.0', '--mcp'] }] }, ['/usr/bin/npx']));
    expect(old.ready).toBe(false);
    expect(old.checks.find((check) => check.id === 'node')).toMatchObject({ status: 'warn', note: 'outside-range', found: 'v20.18.0' });
    // A saved entry is used whatever its own switch says; the setting decides. Another REA version is still named.
    expect(old.checks.find((check) => check.id === 'mcp')).toMatchObject({ status: 'ok', note: 'other-version' });
    const off = await runReaDoctor(linuxDeps({ mcpServers: async () => [], reaForAgents: async () => false }, ['/usr/bin/npx']));
    expect(off.checks.find((check) => check.id === 'mcp')).toEqual({ id: 'mcp', required: false, found: null, status: 'warn', note: 'agents-off' });
  });

  it('finds Ghidra and Java the way REA does: GHIDRA_INSTALL_DIR and JAVA_HOME, the REA entry first, not PATH', async () => {
    const rea = (env: Record<string, string>) => async () => [{ id: 'rea', templateId: 'rea', enabled: true, command: 'npx', args: ['-y', 'rea-agents@6.7.0', '--mcp'], env }];
    const set = await runReaDoctor(linuxDeps({ env: { PATH: '/usr/bin', GHIDRA_INSTALL_DIR: '/srv/old-ghidra' }, mcpServers: rea({ GHIDRA_INSTALL_DIR: '/opt/ghidra_11.3_PUBLIC', JAVA_HOME: '/usr/lib/jvm/jdk-21' }) },
      ['/usr/bin/npx', '/opt/ghidra_11.3_PUBLIC/support/analyzeHeadless', '/usr/lib/jvm/jdk-21/bin/java', '/usr/bin/ghidraRun']));
    const by = Object.fromEntries(set.checks.map((check) => [check.id, check]));
    expect(by.ghidra).toEqual({ id: 'ghidra', required: false, found: '/opt/ghidra_11.3_PUBLIC', status: 'ok' });
    expect(by.java).toEqual({ id: 'java', required: false, found: '/usr/lib/jvm/jdk-21', status: 'ok' });
    expect(by.native).toMatchObject({ status: 'missing' }); // ghidraRun on PATH is not how REA finds Ghidra
    expect(set.ready).toBe(true);

    const fromSystem = await runReaDoctor(linuxDeps({ env: { PATH: '/usr/bin', GHIDRA_INSTALL_DIR: '/opt/ghidra' } }, ['/usr/bin/npx']));
    expect(fromSystem.checks.find((check) => check.id === 'ghidra')).toMatchObject({ status: 'warn', found: '/opt/ghidra', note: 'no-analyze-headless', required: false });

    // REA validates these as non-empty absolute paths when it starts, so a bad value stops REA altogether.
    const empty = await runReaDoctor(linuxDeps({ mcpServers: rea({ GHIDRA_INSTALL_DIR: '' }) }, ['/usr/bin/npx']));
    expect(empty.checks.find((check) => check.id === 'ghidra')).toMatchObject({ status: 'warn', required: true, note: 'empty-value' });
    expect(empty.ready).toBe(false);
    const relative = await runReaDoctor(linuxDeps({ mcpServers: rea({ JAVA_HOME: 'jdk-21' }) }, ['/usr/bin/npx']));
    expect(relative.checks.find((check) => check.id === 'java')).toMatchObject({ status: 'warn', required: true, note: 'not-absolute', found: 'jdk-21' });
    expect(relative.ready).toBe(false);
  });

  it('finds Windows executables through PATHEXT and Chrome in Program Files', async () => {
    const result = await runReaDoctor({
      platform: 'win32',
      env: { Path: 'C:\\nodejs;C:\\tools', PATHEXT: '.COM;.EXE;.CMD', ProgramFiles: 'C:\\Program Files' },
      nodeVersion: async () => 'v22.19.0',
      exists: async (file) => ['C:\\nodejs\\npx.cmd', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\tools\\adb.exe',
        'C:\\ghidra_11.3_PUBLIC\\support\\analyzeHeadless.bat'].includes(file),
      mcpServers: async () => [{ id: 'rea', templateId: 'rea', enabled: true, command: 'node', args: ['C:\\rea-yj\\scripts\\rea.mjs', '--mcp'], env: { GHIDRA_INSTALL_DIR: 'C:\\ghidra_11.3_PUBLIC' } }],
      // A custom command is the user's own REA: the copy inside MonoField does not replace it, so npx and Node.js stay required.
      bundled: () => ({ available: true, runtime: { entry: 'C:\\MonoField\\rea\\scripts\\rea.mjs', version: '6.7.0', command: 'C:\\MonoField\\MonoField.exe', env: { ELECTRON_RUN_AS_NODE: '1' }, nodeVersion: '24.11.1' } }),
    });
    const by = Object.fromEntries(result.checks.map((check) => [check.id, check]));
    expect(result.ready).toBe(true);
    expect(by.npx!.found).toBe('C:\\nodejs\\npx.cmd');
    expect(by.browser!.found).toBe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    expect(by.adb!.found).toBe('C:\\tools\\adb.exe');
    expect(by.mcp).toMatchObject({ status: 'ok', note: 'custom-command' });
    expect(by.node).toMatchObject({ required: true });
    expect(by.ghidra).toMatchObject({ status: 'ok', found: 'C:\\ghidra_11.3_PUBLIC' });
  });

  it('needs neither Node.js nor npx while the REA copy inside MonoField runs the pinned entry', async () => {
    const runtime = { entry: '/opt/MonoField/resources/app/node_modules/rea-agents/scripts/rea.mjs', version: '6.7.0', command: '/opt/MonoField/monofield', env: { ELECTRON_RUN_AS_NODE: '1' }, nodeVersion: '24.14.0' };
    const result = await runReaDoctor(linuxDeps({ nodeVersion: async () => null, bundled: () => ({ available: true, runtime }) }));
    const by = Object.fromEntries(result.checks.map((check) => [check.id, check]));
    expect(result.ready).toBe(true);
    expect(by.bundled).toEqual({ id: 'bundled', required: false, found: 'rea-agents 6.7.0 · Node.js 24.14.0', status: 'ok' });
    expect(by.node).toEqual({ id: 'node', required: false, found: null, status: 'missing', note: 'not-needed' });
    expect(by.npx).toMatchObject({ required: false, status: 'missing', note: 'not-needed' });
    expect(by.mcp).toMatchObject({ status: 'ok', note: 'built-in', found: 'npx -y rea-agents@6.7.0 --mcp' });
    expect(result.bundled).toEqual({ version: '6.7.0', command: '/opt/MonoField/monofield', args: [runtime.entry, '--mcp'], env: { ELECTRON_RUN_AS_NODE: '1' } });

    // Nothing saved: the built-in REA reaches conversations anyway, so REA is ready with no setup at all.
    const nothingSaved = await runReaDoctor(linuxDeps({ nodeVersion: async () => null, mcpServers: async () => [], bundled: () => ({ available: true, runtime }) }));
    expect(nothingSaved.ready).toBe(true);
    expect(nothingSaved.checks.find((check) => check.id === 'mcp')).toEqual({ id: 'mcp', required: true, found: 'rea-agents 6.7.0', status: 'ok', note: 'built-in' });
  });

  it('says why the copy inside MonoField cannot be used, and falls back to Node.js and npx', async () => {
    const result = await runReaDoctor(linuxDeps({ bundled: () => ({ available: false, reason: 'outside-range', found: '22.12.0' }) }, ['/usr/bin/npx']));
    const by = Object.fromEntries(result.checks.map((check) => [check.id, check]));
    expect(by.bundled).toEqual({ id: 'bundled', required: false, found: '22.12.0', status: 'warn', note: 'outside-range' });
    expect(by.node).toMatchObject({ required: true, status: 'ok' });
    expect(by.mcp!.note).toBeUndefined();
    expect(result.bundled).toBeNull();
  });
});
