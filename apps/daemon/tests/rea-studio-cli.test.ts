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
