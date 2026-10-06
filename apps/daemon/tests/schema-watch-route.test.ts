import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseSchemaSnapshot, DatabaseSchemaWatchState, DocumentGraphResponse } from '@open-design/contracts';
import { startServer, type StartServerResult } from '../src/server.js';
const execute = promisify(execFile);

describe('schema monitoring and dependency graph API/CLI', () => {
  let server: StartServerResult, root: string, projectId: string;
  let snapshot: DatabaseSchemaSnapshot = { tables: [{ schema: 'public', table: 'orders', columns: [{ name: 'id', type: 'integer', nullable: 'NO' }] }] };
  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'schema-watch-api-'));
    await writeFile(path.join(root, 'api.json'), JSON.stringify({ schemaVersion: 1, kind: 'interface-spec', source: { codebaseName: 'Orders' }, endpoints: [
      { method: 'GET', path: '/orders', interfaceId: 'IF-1', responseFields: [{ nameEn: 'id', evidenceRefs: [{ kind: 'database', ref: 'Order ID', database: { connectionId: 'db-test', schema: 'public', table: 'orders', column: 'id' } }] }] },
    ] }));
    await writeFile(path.join(root, 'screen.json'), JSON.stringify({ schemaVersion: 1, kind: 'screen-spec', name: 'Orders', screens: [
      { id: 'SCR-1', evidenceRefs: [{ kind: 'requirement', ref: 'Orders API', document: { path: 'api.json', itemId: 'IF-1' } }] },
    ] }));
    server = await startServer({ port: 0, returnServer: true, desktopDatabaseBroker: async (request) => {
      expect(request).toEqual({ action: 'schema-snapshot', connectionId: 'db-test', background: true }); return snapshot;
    } }) as StartServerResult;
    const imported = await fetch(`${server.url}/api/import/folder`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseDir: root, name: 'Dependency test' }) });
    const result = await imported.json() as { project: { id: string } }; projectId = result.project.id;
  });
  afterAll(async () => { await server?.shutdown(); server?.server.close(); server?.server.closeAllConnections?.(); if (root) await rm(root, { recursive: true, force: true }); });
  const base = () => `${server.url}/api/projects/${projectId}/database/schema-watch`;
  async function request(url: string, method: string, body?: unknown) {
    return fetch(url, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  it('requires a selected project DB and validates configuration before touching the broker', async () => {
    expect((await request(base(), 'PUT', { enabled: true, intervalSeconds: 1 })).status).toBe(400);
    expect((await request(base(), 'PUT', { enabled: true, intervalSeconds: 10 })).status).toBe(400);
    const patched = await request(`${server.url}/api/projects/${projectId}`, 'PATCH', { metadata: { databaseContext: { connectionId: 'db-test', useForDevelopment: true } } });
    expect(patched.ok).toBe(true);
  });
  it('captures changes, exposes the same graph through CLI and rejects stale acknowledgements', async () => {
    expect((await request(base(), 'PUT', { enabled: true, intervalSeconds: 60 })).ok).toBe(true);
    const first = await request(`${base()}/check`, 'POST').then((response) => response.json()) as { state: DatabaseSchemaWatchState };
    expect(first.state.status).toBe('current');
    snapshot = { tables: [{ schema: 'public', table: 'orders', columns: [{ name: 'id', type: 'text', nullable: 'NO' }] }] };
    const changed = await request(`${base()}/check`, 'POST').then((response) => response.json()) as { state: DatabaseSchemaWatchState };
    expect(changed.state.status).toBe('changed');
    const graphResponse = await request(`${server.url}/api/projects/${projectId}/documents/graph`, 'POST', {});
    expect(graphResponse.ok).toBe(true);
    const graph = await graphResponse.json() as DocumentGraphResponse;
    expect(graph.documents.sort()).toEqual(['api.json', 'screen.json']);
    expect(graph.impacts.map((impact) => graph.nodes.find((node) => node.id === impact.nodeId)?.itemId)).toEqual(['IF-1', 'SCR-1']);
    const cli = process.env.OD_DAEMON_CLI_PATH;
    if (!cli) throw new Error('The CLI must be built');
    const { stdout } = await execute(process.execPath, [cli, 'docs', 'graph', '--project', projectId, '--json', '--daemon-url', server.url]);
    expect((JSON.parse(stdout) as DocumentGraphResponse).impacts).toEqual(graph.impacts);
    const status = await execute(process.execPath, [cli, 'database', 'watch', projectId, 'status', '--json', '--daemon-url', server.url]);
    expect(JSON.parse(status.stdout).state.latestSha256).toBe(changed.state.latestSha256);
    expect((await request(`${base()}/acknowledge`, 'POST', { expectedSha256: first.state.latestSha256 })).status).toBe(409);
    expect((await request(`${base()}/acknowledge`, 'POST', { expectedSha256: changed.state.latestSha256 })).ok).toBe(true);
    expect((await request(base(), 'GET').then((response) => response.json()) as { state: DatabaseSchemaWatchState }).state.changes).toEqual([]);
    expect((await request(base(), 'PUT', { enabled: false, intervalSeconds: 60 })).ok).toBe(true);
  });
  it('rejects cross-project paths, malformed graphs and missing projects', async () => {
    expect((await request(`${server.url}/api/projects/${projectId}/documents/graph`, 'POST', { inputFiles: ['../outside.json'] })).status).toBe(400);
    expect((await request(`${server.url}/api/projects/${projectId}/documents/graph`, 'POST', { inputFiles: 'api.json' })).status).toBe(400);
    expect((await request(`${server.url}/api/projects/missing/database/schema-watch`, 'GET')).status).toBe(404);
  });
});
