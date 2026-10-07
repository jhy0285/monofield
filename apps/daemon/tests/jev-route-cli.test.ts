import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer, type StartServerResult } from '../src/server.js';

const execute = promisify(execFile);
describe('decision HTTP and CLI surfaces (local protocol fixture)', () => {
  let server: StartServerResult, provider: Server, root: string, localUrl: string;
  const received: Array<{ url: string; authorization: string | undefined; body: unknown }> = [];
  beforeAll(async () => {
    vi.stubEnv('TYPESAFE_API_KEY', '');
    root = await mkdtemp(path.join(tmpdir(), 'jev-route-cli-'));
    provider = createServer(async (req, res) => {
      let raw = ''; for await (const part of req) raw += part;
      const body = raw ? JSON.parse(raw) : null;
      received.push({ url: req.url ?? '', authorization: req.headers.authorization, body });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/models') { res.statusCode = 404; res.end('{}'); return; }
      if (req.url === '/health') { res.end(JSON.stringify({ status: 'ok', loaded: ['fixture-only'] })); return; }
      if (req.url !== '/v1/systemone') { res.statusCode = 404; res.end('{}'); return; }
      const answers = Object.fromEntries(Object.entries(body.questions as Record<string, { type: string; criteria?: Record<string, unknown> }>).map(([id, q]) => {
        if (q.type === 'noul') return [id, { type: 'noul', noul: 0.5 }];
        if (q.type === 'score') return [id, { type: 'score', score: 0, confidence: 1, legend: Object.fromEntries(Object.entries(q.criteria!)), probabilities: Object.fromEntries(Object.keys(q.criteria!).map((k, i) => [k, i === 0 ? 1 : 0])) }];
        const keys = Object.keys(q.criteria!); return [id, { type: 'choice', choice: keys[0], confidence: 1, probabilities: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 1 : 0])) }];
      }));
      res.end(JSON.stringify({ model: 'protocol-fixture', answers, usage: { input_tokens: 17, output_tokens: 0 } }));
    });
    await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
    const address = provider.address(); if (!address || typeof address === 'string') throw new Error('No fixture port');
    localUrl = `http://127.0.0.1:${address.port}`;
    server = await startServer({ port: 0, returnServer: true }) as StartServerResult;
  }, 30_000);
  afterAll(async () => { try { await server?.shutdown(); server?.server.closeAllConnections?.(); await new Promise<void>(resolve => provider?.close(() => resolve())); if (root) await rm(root, { recursive: true, force: true }); } finally { vi.unstubAllEnvs(); } });
  const cli = (args: string[]) => execute(process.execPath, [path.resolve('dist/cli.js'), 'jev', ...args, '--json', '--daemon-url', server.url]);
  const api = (endpoint: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(`${server.url}/api/jev/${endpoint}`, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  it('requires authentication for hosted requests and rejects cross-origin writes', async () => {
    const result = await api('triage', 'POST', { state: 'Fix login' }); expect(result.status).toBe(401);
    expect((await result.json() as { error: { code: string } }).error.code).toBe('AUTH_REQUIRED'); expect(received).toHaveLength(0);
    expect((await api('config', 'PUT', {}, { origin: 'https://untrusted.example' })).status).toBe(403);
  });
  it('configures and discovers local models through the same production routes as the UI', async () => {
    await cli(['configure', '--backend', 'local', '--local-url', localUrl, '--model', 'fixture-only']);
    const status = JSON.parse((await cli(['status'])).stdout); expect(status.config.backend).toBe('local'); expect(status.credentialSource).toBe('none');
    const models = JSON.parse((await cli(['models'])).stdout); expect(models).toEqual({ models: [{ name: 'fixture-only', description: 'Loaded model reported by the local server' }], source: 'local-health' });
  });
  it('reads UTF-8 long prompts from files and preserves the actual provider usage', async () => {
    const prompt = '로그인 오류를 수정해 주세요.';
    const file = path.join(root, 'request.txt'); await writeFile(file, prompt);
    const result = JSON.parse((await cli(['triage', '--prompt-file', file])).stdout);
    expect(result.backend).toBe('local'); expect(result.result.usage).toEqual({ input_tokens: 17, output_tokens: 0 });
    expect(received.at(-1)?.body).toMatchObject({ state: prompt, model: 'fixture-only' });
    expect(received.every(r => r.authorization === undefined)).toBe(true);
    expect((await api('triage', 'POST', { state: '' })).status).toBe(400);
  });
  it('handles custom typed requests without substituting a chat model or fabricating answers', async () => {
    const file = path.join(root, 'typed.json'); await writeFile(file, JSON.stringify({ model: 'fixture-only', state: { text: 'test' }, questions: { yes: { type: 'noul', instructions: 'Is this a test?' } } }));
    const result = JSON.parse((await cli(['decide', '--request-file', file])).stdout);
    expect(result.requestedModel).toBe('fixture-only'); expect(result.result.answers).toEqual({ yes: { type: 'noul', noul: 0.5 } });
    expect((await api('decide', 'POST', { model: 'fixture-only', state: 'test', questions: {} })).status).toBe(400);
  });
});
