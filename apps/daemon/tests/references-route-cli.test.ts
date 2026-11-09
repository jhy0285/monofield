import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
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

// End to end with the REA copy that ships with MonoField and a real Chromium-family browser. Skipped where none is
// installed; set OD_TEST_CHROMIUM to an absolute browser path to run it elsewhere.
const CHROMIUM = process.env.OD_TEST_CHROMIUM ?? ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find((file) => existsSync(file));

describe.skipIf(!CHROMIUM)('reference flow recording with the bundled REA', () => {
  let server: StartServerResult, site: Server, siteUrl: string, projectId: string;
  beforeAll(async () => {
    site = createServer((req, res) => {
      if (req.url === '/api/orders') { res.setHeader('content-type', 'application/json'); res.end('[{"id":1001,"status":"PAID"},{"id":1002,"status":"PENDING"}]'); return; }
      res.setHeader('content-type', 'text/html; charset=utf-8');
      // "Our" screen: the same controls and wording in another order, but the search never asks the server.
      if (req.url === '/ours') {
        res.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>우리 주문</title></head><body><main><h1>우리 주문 화면</h1>'
          + '<label>주문번호 <input name="q"></label><button onclick="document.getElementById(\'out\').textContent=\'2건 조회됨\'">조회</button>'
          + '<p id="out"></p></main></body></html>');
        return;
      }
      res.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>주문</title></head><body><main><h1>주문</h1>'
        + '<label>주문번호 <input name="q"></label><button onclick="fetch(\'/api/orders\').then(r=>r.json()).then(d=>{document.getElementById(\'out\').textContent=d.length+\'건 조회됨\'})">조회</button>'
        + '<p id="out"></p></main></body></html>');
    });
    await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
    const address = site.address(); if (!address || typeof address === 'string') throw new Error('No site port');
    siteUrl = `http://127.0.0.1:${address.port}/`;
    server = await startServer({ port: 0, returnServer: true }) as StartServerResult;
    projectId = randomUUID();
    await fetch(`${server.url}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: projectId, name: 'flow' }) });
  }, 30_000);
  afterAll(async () => {
    await server?.shutdown(); server?.server.closeAllConnections?.();
    await new Promise<void>((resolve) => site?.close(() => resolve()));
  });
  const cli = (args: string[]) => execute(process.execPath, [path.resolve('dist/cli.js'), 'refs', ...args, '--daemon-url', server.url], { timeout: 180_000 });

  it('records typed steps through the CLI, keeps the evidence, and the card and REA Studio see it', async () => {
    const added = JSON.parse((await cli(['add', '--project', projectId, '--url', siteUrl, '--note', '조회 흐름', '--json'])).stdout);
    const result = JSON.parse((await cli(['record', '--project', projectId, '--id', added.id, '--fill', '주문번호=1001', '--click', '조회',
      '--wait-text', '2건 조회됨', '--browser', CHROMIUM!, '--json'])).stdout);
    expect(result.flow).toMatchObject({ file: `references/${added.id}.flow.json`, completed: 3, total: 3 });
    expect(result.flow.steps.map((step: { label: string }) => step.label)).toEqual(['type into "주문번호"', 'press button "조회"', 'wait for "2건 조회됨"']);
    expect(result.flow.apiCalls).toContainEqual({ method: 'GET', path: '/api/orders', status: 200 });
    expect(result.flow.steps[1]).toMatchObject({ status: 'completed', request: { kind: 'click', target: '조회', role: 'button' } });
    expect(result.flow.screenshot).toBe(`references/${added.id}.flow.png`);
    expect((await fetch(`${server.url}/api/projects/${projectId}/raw/${result.flow.screenshot}`)).ok).toBe(true);
    const listed = (await cli(['list', '--project', projectId])).stdout;
    expect(listed).toContain('api: GET /api/orders → 200');
    const view = await (await fetch(`${server.url}/api/projects/${projectId}/rea-evidence/view`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: result.flow.file }) })).json() as { kind: string; steps: unknown[] };
    expect(view.kind).toBe('browser');
    expect(view.steps.length).toBeGreaterThanOrEqual(3);
    const agent = (await cli(['record', '--project', projectId, '--id', added.id, '--click', '다음', '--for-agent'])).stdout;
    expect(agent).toContain('<reference-flow-request');
    await expect(cli(['record', '--project', projectId, '--id', added.id, '--fill', '비밀번호=x', '--browser', CHROMIUM!])).rejects.toMatchObject({ stderr: expect.stringContaining('does not type') });
  }, 200_000);

  it('replays the reference steps on our screen and reports where the pattern differs', async () => {
    const added = JSON.parse((await cli(['add', '--project', projectId, '--url', siteUrl, '--json'])).stdout);
    await cli(['record', '--project', projectId, '--id', added.id, '--fill', '주문번호=1001', '--click', '조회', '--wait-text', '2건 조회됨', '--browser', CHROMIUM!]);
    const differs = await cli(['compare', '--project', projectId, '--id', added.id, '--url', `${siteUrl}ours`, '--browser', CHROMIUM!])
      .then(() => null, (error: { code?: number; stdout?: string }) => error);
    expect(differs?.code).toBe(1);
    expect(differs?.stdout).toContain('our screen: ' + `${siteUrl}ours`);
    expect(differs?.stdout).toMatch(/press button "조회": fail \(calls\)/);
    expect(differs?.stdout).toContain('reference: completed, GET 2xx');
    expect(differs?.stdout).toContain('ours:      completed, no API call');
    const block = await cli(['compare', '--project', projectId, '--id', added.id, '--url', `${siteUrl}ours`, '--browser', CHROMIUM!, '--block']).then(() => '', (error: { stdout?: string }) => error.stdout ?? '');
    expect(block).toContain('<reference-flow-comparison');
    const same = JSON.parse((await cli(['compare', '--project', projectId, '--id', added.id, '--url', siteUrl, '--browser', CHROMIUM!, '--json'])).stdout);
    expect(same.remake.comparison.summary).toMatchObject({ fail: 0, missing: 0, extra: 0 });
    expect(same.block).toBe('');
  }, 300_000);

  it('reports a step that could not be done and exits with status 1', async () => {
    const added = JSON.parse((await cli(['add', '--project', projectId, '--url', siteUrl, '--json'])).stdout);
    const failed = await cli(['record', '--project', projectId, '--id', added.id, '--click', '없는 버튼', '--browser', CHROMIUM!]).then(() => null, (error: { code?: number; stdout?: string }) => error);
    expect(failed?.code).toBe(1);
    expect(failed?.stdout).toContain('press button "없는 버튼" → failed');
  }, 200_000);
});
