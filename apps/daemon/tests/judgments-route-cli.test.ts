import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { startServer, type StartServerResult } from '../src/server.js';

const execute = promisify(execFile);
const SPEC = {
  schemaVersion: 1, kind: 'interface-spec', cover: { brand: '', docName: '', version: '', department: '' },
  source: { codebaseName: 'legacy-order', codebasePath: 'legacy-order', language: 'java', framework: 'spring-boot', collector: 'static-spring' },
  endpoints: [{ method: 'POST', path: '/api/v1/orders', interfaceId: 'IF-ORD-001', interfaceName: '주문 등록',
    requestFields: [{ nameEn: 'memberId', nameKo: '회원 ID', dataType: 'Long', required: 'Y' }, { nameEn: 'orderNo', nameKo: 'order No', dataType: 'String', required: 'N' }],
    responseFields: [{ nameEn: 'createdAt', nameKo: '삭제일시', dataType: 'String', required: 'Y' }] }],
};

describe('judgment HTTP and CLI surfaces (local protocol fixture)', () => {
  let server: StartServerResult, provider: Server, root: string, localUrl: string, projectId: string;
  const batches: Array<{ states: Array<Record<string, string>>; model: string }> = [];
  beforeAll(async () => {
    vi.stubEnv('TYPESAFE_API_KEY', '');
    root = await mkdtemp(path.join(tmpdir(), 'judgments-route-cli-'));
    provider = createServer(async (req, res) => {
      let raw = ''; for await (const part of req) raw += part;
      res.setHeader('content-type', 'application/json');
      if (req.url !== '/v1/systemone/batch') { res.statusCode = 404; res.end('{}'); return; }
      const body = JSON.parse(raw) as { states: Array<Record<string, string>>; questions: Record<string, unknown>; model: string };
      batches.push(body);
      const id = Object.keys(body.questions)[0]!;
      res.end(JSON.stringify({ results: body.states.map((state) => ({ model: 'fixture', usage: { input_tokens: 5, output_tokens: 0 },
        answers: { [id]: { type: 'noul', noul: JSON.stringify(state).includes('삭제일시') ? 0.08 : 0.93 } } })) }));
    });
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    const address = provider.address(); if (!address || typeof address === 'string') throw new Error('No fixture port');
    localUrl = `http://127.0.0.1:${address.port}`;
    server = await startServer({ port: 0, returnServer: true }) as StartServerResult;
    projectId = randomUUID();
    const created = await fetch(`${server.url}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: projectId, name: 'judgments' }) });
    expect(created.ok).toBe(true);
    const uploaded = await fetch(`${server.url}/api/projects/${projectId}/files`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'docs/orders.interface-spec.json', content: JSON.stringify(SPEC) }) });
    expect(uploaded.ok).toBe(true);
  }, 30_000);
  afterAll(async () => {
    try { await server?.shutdown(); server?.server.closeAllConnections?.(); await new Promise<void>((resolve) => provider?.close(() => resolve())); if (root) await rm(root, { recursive: true, force: true }); }
    finally { vi.unstubAllEnvs(); }
  });
  const cli = (command: string, args: string[]) => execute(process.execPath, [path.resolve('dist/cli.js'), command, ...args, '--daemon-url', server.url]);

  it('checks a spec through the CLI with rules first and the local batch endpoint for the rest', async () => {
    await cli('jev', ['configure', '--backend', 'local', '--local-url', localUrl, '--model', 'fixture-judge', '--json']);
    const result = JSON.parse((await cli('judge', ['check', '--project', projectId, '--input', 'docs/orders.interface-spec.json', '--json'])).stdout);
    expect(result).toMatchObject({ ok: true, backend: 'local', model: 'fixture-judge', modelStatus: 'answered', summary: { total: 4, flag: 1, review: 3, pass: 0 }, advisory: true });
    expect(result.items.find((i: { subject: { identifier?: string } }) => i.subject.identifier === 'orderNo')).toMatchObject({ verdict: 'flag', source: 'rule', reason: 'untranslated' });
    expect(result.items.find((i: { subject: { identifier?: string } }) => i.subject.identifier === 'createdAt')).toMatchObject({ verdict: 'review', probability: 0.08, reason: 'observe' });
    // One batch per kind; the rule-decided label is never sent.
    expect(batches.map((b) => b.states.length).sort()).toEqual([1, 2]);
    expect(batches.flatMap((b) => b.states).some((s) => s.korean_label === 'order No')).toBe(false);
    expect(batches.every((b) => b.model === 'fixture-judge')).toBe(true);
  });

  it('records labels, reports the scorecard, refuses an unsupported policy and exports datasets', async () => {
    const label = JSON.parse((await cli('judge', ['feedback', '--kind', 'field-label', '--identifier', 'createdAt', '--label', '삭제일시', '--correct', 'no', '--probability', '0.08', '--json'])).stdout);
    expect(label).toMatchObject({ kind: 'field-label', correct: false, probability: 0.08, backend: 'local', model: 'fixture-judge' });
    const card = JSON.parse((await cli('judge', ['scorecard', '--json'])).stdout);
    expect(card.scores.find((s: { kind: string; model: string }) => s.kind === 'field-label' && s.model === 'fixture-judge')).toMatchObject({ labels: 1, incorrectItems: 1, suggested: null, mode: 'observe' });
    await expect(cli('judge', ['policy', '--kind', 'field-label', '--apply'])).rejects.toMatchObject({ stderr: expect.stringContaining('Not enough labelled evidence') });
    const out = path.join(root, 'labels.jsonl');
    expect(JSON.parse((await cli('judge', ['export', '--out', out])).stdout)).toEqual({ out, lines: 1 });
    expect(JSON.parse((await readFile(out, 'utf8')).trim())).toMatchObject({ state: { identifier: 'createdAt', korean_label: '삭제일시' }, expected: { match: false } });
    const seed = path.join(root, 'heldout.jsonl');
    const seeded = JSON.parse((await cli('judge', ['export', '--seed', 'heldout', '--out', seed])).stdout);
    expect(seeded.lines).toBeGreaterThan(300);
  });

  it('rejects cross-origin writes and malformed checks', async () => {
    const response = await fetch(`${server.url}/api/judgments/feedback`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://untrusted.example' }, body: '{}' });
    expect(response.status).toBe(403);
    const bad = await fetch(`${server.url}/api/projects/${projectId}/judgments/check`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inputFile: '../x.json' }) });
    expect(bad.status).toBe(400);
    const badKinds = await fetch(`${server.url}/api/projects/${projectId}/judgments/check`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inputFile: 'docs/orders.interface-spec.json', kinds: ['nope'] }) });
    expect(badKinds.status).toBe(400);
  });
});
