import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { startServer, type StartServerResult } from '../src/server.js';

const execute = promisify(execFile);
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('reference board HTTP and CLI surfaces', () => {
  let server: StartServerResult, root: string, projectId: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'refs-route-cli-'));
    server = await startServer({ port: 0, returnServer: true }) as StartServerResult;
    projectId = randomUUID();
    const created = await fetch(`${server.url}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: projectId, name: 'refs' }) });
    expect(created.ok).toBe(true);
  }, 30_000);
  afterAll(async () => {
    await server?.shutdown(); server?.server.closeAllConnections?.();
    if (root) await rm(root, { recursive: true, force: true });
  });
  const cli = (args: string[], input?: string) => {
    const child = execute(process.execPath, [path.resolve('dist/cli.js'), 'refs', ...args, '--daemon-url', server.url]);
    if (input !== undefined) { child.child.stdin?.end(input); }
    return child;
  };
  const api = (suffix = '') => `${server.url}/api/projects/${projectId}/references${suffix}`;

  it('keeps a browser reference with a large screenshot over HTTP and lists it through the CLI', async () => {
    // A screenshot well over the global 4 MB JSON limit (padding after the PNG end is ignored by the type check).
    const big = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(5 * 1024 * 1024)]).toString('base64');
    const response = await fetch(api(), { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://shop.example/cart?session=abc', title: 'Cart', screenshotBase64: big, takes: ['flow'],
        outline: { regions: ['header', 'main'], tables: [{ columns: ['상품', '수량', '금액'], rows: 3 }] } }) });
    expect(response.status).toBe(201);
    const { item } = await response.json() as { item: { id: string; url: string; screenshot: { file: string } } };
    expect(item.url).toBe('https://shop.example/cart?session=%5Bredacted%5D');
    const raw = await fetch(`${server.url}/api/projects/${projectId}/raw/${item.screenshot.file}`);
    expect(raw.ok).toBe(true);
    const listed = JSON.parse((await cli(['list', '--project', projectId, '--json'])).stdout);
    expect(listed).toMatchObject({ folder: 'references', items: [{ id: item.id, title: 'Cart', takes: ['flow'] }] });
    const text = (await cli(['list', '--project', projectId])).stdout;
    expect(text).toContain('table 1: 3 columns (상품, 수량, 금액), 3 rows');
  });

  it('adds with a screenshot file, edits, applies with a prompt file from stdin and removes through the CLI', async () => {
    const shot = path.join(root, 'shot.png');
    await writeFile(shot, Buffer.from(PNG, 'base64'));
    const added = JSON.parse((await cli(['add', '--project', projectId, '--url', 'https://forms.example/join', '--note', '두 단계 가입', '--take', 'fields,flow', '--screenshot', shot, '--json'])).stdout);
    expect(added).toMatchObject({ source: 'cli', takes: ['flow', 'fields'], note: '두 단계 가입', screenshot: { mediaType: 'image/png' } });
    const edited = JSON.parse((await cli(['note', '--project', projectId, '--id', added.id, '--note', '세 단계로 수정', '--json'])).stdout);
    expect(edited.note).toBe('세 단계로 수정');
    const block = (await cli(['apply', '--project', projectId, '--id', added.id, '--target', 'src/pages/Join.tsx', '--prompt-file', '-'], '가입 화면을 이 흐름으로 바꿔줘\n둘째 줄')).stdout;
    expect(block).toContain('<reference-board-apply target="src/pages/Join.tsx" references="1">');
    expect(block).toContain('request: 가입 화면을 이 흐름으로 바꿔줘\n둘째 줄');
    expect(block).toContain('(sha256 verified)');
    const http = await (await fetch(api('/apply'), { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ referenceIds: [added.id], target: 'src/pages/Join.tsx', request: '가입 화면을 이 흐름으로 바꿔줘\n둘째 줄' }) })).json() as { block: string };
    expect(http.block).toBe(block.trimEnd());
    const removed = JSON.parse((await cli(['remove', '--project', projectId, '--id', added.id, '--json'])).stdout);
    expect(removed).toEqual({ removed: added.id, files: [added.screenshot.file] });
    await expect(cli(['apply', '--project', projectId, '--id', added.id])).rejects.toMatchObject({ stderr: expect.stringContaining(`No reference ${added.id}`) });
  });

  it('rejects cross-origin writes, bad input and unknown projects', async () => {
    const crossOrigin = await fetch(api(), { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://untrusted.example' }, body: JSON.stringify({ url: 'https://a.example' }) });
    expect(crossOrigin.status).toBe(403);
    const bad = await fetch(api(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'ftp://a.example' }) });
    expect(bad.status).toBe(400);
    const unknown = await fetch(`${server.url}/api/projects/${randomUUID()}/references`);
    expect(unknown.status).toBe(404);
    await expect(cli(['add', '--project', projectId])).rejects.toMatchObject({ stderr: expect.stringContaining('--url') });
  });
});
