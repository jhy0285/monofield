import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer, type StartServerResult } from '../src/server.js';

const execute = promisify(execFile);
const STUDIO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'rea', 'studio');
type Json = Record<string, any>;

describe('monofield rea files / show (real server, real REA evidence)', () => {
  let server: StartServerResult;
  let projectId: string;
  const cli = (...args: string[]) => execute(process.execPath, [path.resolve('dist/cli.js'), 'rea', ...args, '--daemon-url', server.url]);
  const show = async (file: string) => (await cli('show', '--project', projectId, '--file', `evidence/${file}`)).stdout;

  beforeAll(async () => {
    server = await startServer({ port: 0, returnServer: true }) as StartServerResult;
    projectId = randomUUID();
    expect((await fetch(`${server.url}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: projectId, name: 'rea-studio-cli' }) })).ok).toBe(true);
    for (const name of readdirSync(STUDIO)) {
      const response = await fetch(`${server.url}/api/projects/${projectId}/files`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `evidence/${name}`, content: readFileSync(path.join(STUDIO, name), 'utf8') }) });
      expect(response.ok).toBe(true);
    }
    await fetch(`${server.url}/api/projects/${projectId}/files`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'package.json', content: '{}' }) });
  }, 60_000);
  afterAll(async () => { await server?.shutdown(); server?.server.closeAllConnections?.(); });

  it('lists every REA evidence file with its kind', async () => {
    const listed = JSON.parse((await cli('files', '--project', projectId, '--json')).stdout) as { files: Array<{ file: string; kind: string }> };
    expect(listed.files).toHaveLength(6);
    const text = (await cli('files', '--project', projectId)).stdout;
    expect(text).toMatch(/browser\s+evidence\/browser-overview\.json/);
    expect(text).toMatch(/sqlite\s+evidence\/db-before\.json/);
    expect(text).toMatch(/static\s+evidence\/static\.json/);
    expect(text).not.toContain('package.json');
  });

  it('prints a browser capture: steps with timing and artifacts, then its requests', async () => {
    const text = await show('browser-overview.json');
    expect(text).toContain('capture_browser_scenario (browser)');
    expect(text).toContain('confidence observed · authority controlled-replay');
    expect(text).toMatch(/2 steps · \d+ requests/);
    expect(text).toMatch(/step\s+1 overview-ready\s+wait_for\s+187 ms\s+completed\s+\[screenshot dom a11y\]/);
    expect(text).toContain('limitations (');
  });

  it('prints a SQLite inspection with its keys and constraints, and a trace without overclaiming', async () => {
    const sqlite = await show('db-before.json');
    expect(sqlite).toContain('SQLite 3.53.3 · 4 tables');
    expect(sqlite).toContain('settlements(id PK, order_id NN');
    expect(sqlite).toContain('order_id → orders.id');
    expect(sqlite).toContain('UNIQUE(order_id)');
    expect(sqlite).toContain("CHECK(status IN ('PAID','PENDING','CANCELLED'))");
    const trace = await show('duplicate-trace.json');
    expect(trace).toContain('seed "ALREADY_SETTLED" (incoming) · no-match');
    expect(trace).toContain('does not show the feature is absent');
  });

  it('prints static analysis with its coverage and unknowns as REA gave them', async () => {
    const text = await show('static.json');
    expect(text).toContain('application coverage complete · semantic coverage unknown · 201 semantic unknowns');
    expect(text).toContain('graph: 17 nodes, 17 edges');
    expect(text).toMatch(/endpoint\s+\/api\/orders/);
    expect(text).toMatch(/unknown: \S+ × \d+/);
  });

  it('gives the whole view with --json and rejects bad input', async () => {
    const view = JSON.parse((await cli('show', '--project', projectId, '--file', 'evidence/db-before.json', '--json')).stdout) as Json;
    expect(view).toMatchObject({ ok: true, kind: 'sqlite', file: 'evidence/db-before.json' });
    await expect(cli('show', '--project', projectId)).rejects.toMatchObject({ stderr: expect.stringContaining('requires --file') });
    await expect(cli('show', '--project', projectId, '--file', 'package.json')).rejects.toMatchObject({ stderr: expect.stringContaining('not an REA evidence file') });
    await expect(cli('show', '--project', projectId, '--file', 'evidence/missing.json')).rejects.toMatchObject({ stderr: expect.stringContaining('does not exist') });
  });
});

describe('monofield rea cite / compare / doctor (real server)', () => {
  let server: StartServerResult;
  let projectId: string;
  const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'rea');
  const cli = (...args: string[]) => execute(process.execPath, [path.resolve('dist/cli.js'), 'rea', ...args, '--daemon-url', server.url]);
  const upload = async (name: string, content: string) => {
    const response = await fetch(`${server.url}/api/projects/${projectId}/files`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, content }) });
    expect(response.ok).toBe(true);
  };

  beforeAll(async () => {
    server = await startServer({ port: 0, returnServer: true }) as StartServerResult;
    projectId = randomUUID();
    expect((await fetch(`${server.url}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: projectId, name: 'rea-cite-compare-cli' }) })).ok).toBe(true);
    const capture = readFileSync(path.join(FIXTURES, 'browser-scenario-capture.json'), 'utf8');
    await upload('evidence/overview.json', readFileSync(path.join(STUDIO, 'browser-overview.json'), 'utf8'));
    await upload('evidence/original.json', capture);
    // The same scenario against a remake on another port, where one duplicate settlement now answers 200.
    const remake = JSON.parse(capture.replaceAll('http://127.0.0.1:4318', 'http://localhost:5173')) as Json;
    remake.normalized_result.events.items.find((event: Json) => event.transaction_id === 'request-5' && event.kind === 'response').status = 200;
    await upload('evidence/remake.json', JSON.stringify(remake));
    await upload('cases/original.json', JSON.stringify({ cases: [{ id: 'pan-0', input: { x: 0 }, output: -1 }, { id: 'pan-320', input: { x: 320 }, output: 0 }] }));
    await upload('cases/remake.json', JSON.stringify({ cases: [{ id: 'pan-0', input: { x: 0 }, output: -1 }, { id: 'pan-320', input: { x: 320 }, output: 0.02 }] }));
  }, 60_000);
  afterAll(async () => { await server?.shutdown(); server?.server.closeAllConnections?.(); });

  it('cite prints the same block the screen inserts, and writes the step screenshot into the project', async () => {
    const { stdout, stderr } = await cli('cite', '--project', projectId, '--file', 'evidence/overview.json', '--step', '1');
    expect(stdout).toMatch(/^<rea-evidence file="evidence\/overview\.json" evidence_id="ev_[0-9a-f]+" pointer="steps\[step_index=1\]">/);
    expect(stdout).toContain('    - heading "주문 목록" [level=2]');
    expect(stdout.trimEnd().endsWith('</rea-evidence>')).toBe(true);
    expect(stderr).toContain('written: evidence/rea-cite/overview-step-1.png');
    const listed = await (await fetch(`${server.url}/api/projects/${projectId}/files`)).json() as { files: Array<{ name: string }> };
    expect(listed.files.map((file) => file.name)).toContain('evidence/rea-cite/overview-step-1.png');
    const json = JSON.parse((await cli('cite', '--project', projectId, '--file', 'evidence/original.json', '--request', 'request-4', '--include-values', '--json')).stdout) as Json;
    expect(json).toMatchObject({ ok: true, pointer: 'events.items[transaction_id=request-4]', valuesIncluded: true });
    expect(json.block).toContain('"net_amount": 9650');
  });

  it('compare prints what differs and exits with 1 until the remake matches', async () => {
    const failed = await cli('compare', '--project', projectId, '--original', 'evidence/original.json', '--remake', 'evidence/remake.json').catch((error: { code: number; stdout: string }) => error);
    expect((failed as { code: number }).code).toBe(1);
    expect((failed as { stdout: string }).stdout).toContain('evidence/original.json → evidence/remake.json (browser steps): 11/12 pass · 1 fail · 0 missing in remake · 0 only in remake');
    expect((failed as { stdout: string }).stdout).toContain('POST /api/orders/{n}/settle: 409 → 200');
    const same = await cli('compare', '--project', projectId, '--original', 'evidence/original.json', '--remake', 'evidence/original.json');
    expect(same.stdout).toContain('12/12 pass');
    const cases = await cli('compare', '--project', projectId, '--original', 'cases/original.json', '--remake', 'cases/remake.json', '--tolerance', '0.05', '--json');
    expect(JSON.parse(cases.stdout)).toMatchObject({ kind: 'cases', tolerance: 0.05, summary: { total: 2, pass: 2 } });
    const listed = JSON.parse((await cli('files', '--project', projectId, '--json')).stdout) as { cases: Array<{ file: string }> };
    expect(listed.cases.map((entry) => entry.file).sort()).toEqual(['cases/original.json', 'cases/remake.json']);
    const probe = await (await fetch(`${server.url}/api/projects/${projectId}/rea-evidence/probe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: 'cases/remake.json' }) })).json();
    expect(probe).toEqual({ evidence: false, cases: true });
  });

  it('doctor reports every check through the same endpoint the settings screen uses', async () => {
    const result = JSON.parse((await cli('doctor', '--json')).stdout) as Json;
    expect(result).toMatchObject({ ok: true, package: { name: 'rea-agents', version: '6.7.0' } });
    expect(result.checks.map((check: Json) => check.id)).toEqual(['node', 'npx', 'mcp', 'browser', 'ghidra', 'native', 'java', 'jadx', 'apktool', 'tshark', 'adb']);
    const text = (await cli('doctor')).stdout;
    expect(text).toMatch(/^REA 6\.7\.0 \(rea-agents, Node \^22\.19\.0 \|\| \^24\.11\.0 \|\| >=26\.0\.0\) on \w+: (ready|not ready)/);
    expect(text).toContain('Looked on PATH and in the usual install locations only.');
  });
});
