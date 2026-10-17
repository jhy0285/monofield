import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type StartServerResult } from '../src/server.js';

const execute = promisify(execFile);
describe('verification HTTP and CLI on an imported workspace', () => {
  let server: StartServerResult, root: string, projectId: string;
  const cli = (args: string[]) => execute(process.execPath, [resolve('dist/cli.js'), 'verify', ...args, '--project', projectId, '--json', '--daemon-url', server.url]);
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'mf-check-api-'));
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test acceptance.cjs' } }));
    await writeFile(join(root, 'answer.cjs'), 'module.exports = 41;');
    await writeFile(join(root, 'acceptance.cjs'), "require('node:test')('answer is correct', () => require('node:assert/strict').equal(require('./answer.cjs'), 42));");
    server = await startServer({ port: 0, returnServer: true }) as StartServerResult;
    const response = await fetch(`${server.url}/api/import/folder`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseDir: root, name: 'Verification integration' }) });
    expect(response.ok).toBe(true); projectId = ((await response.json()) as { project: { id: string } }).project.id;
  }, 30_000);
  afterAll(async () => { await server?.shutdown(); server?.server.closeAllConnections?.(); if (server?.server.listening) await new Promise<void>(resolve => server.server.close(() => resolve())); if (root) await rm(root, { recursive: true, force: true }); });
  const api = (suffix = '', method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(`${server.url}/api/projects/${projectId}/development/verification${suffix}`, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  it('rejects external origins and module traversal and executes no commands when discovering', async () => {
    expect((await api('', 'POST', { checkIds: ['node:test'] }, { origin: 'https://untrusted.invalid' })).status).toBe(403);
    expect((await api('/plan?projectPath=../')).status).toBeGreaterThanOrEqual(400);
    expect(JSON.parse((await cli(['plan'])).stdout).checks[0]).toMatchObject({ id: 'node:test', command: 'npm' });
    expect(((await (await api()).json()) as { run: unknown }).run).toBeNull();
  });
  it('exposes the same model-free advice through HTTP, CLI file and stdin without executing', async () => {
    const prompt = join(root, 'advice.txt'); await writeFile(prompt, 'Check responsive checkout UI');
    const fileAdvice = JSON.parse((await cli(['suggest', '--prompt-file', prompt, '--mode', 'rules'])).stdout);
    expect(fileAdvice).toMatchObject({ evaluationAttempts: 0, suggestedCheckIds: ['node:test'],
      manualReview: ['browser', 'keyboard', 'responsive', 'contrast'] });
    expect(fileAdvice.snapshotSha256).toMatch(/^[a-f0-9]{64}$/);
    const stdinAdvice = await new Promise<string>((resolveDone, reject) => {
      const child = execFile(process.execPath, [resolve('dist/cli.js'), 'verify', 'suggest', '--prompt-file', '-', '--project', projectId,
        '--json', '--daemon-url', server.url], (err, stdout) => err ? reject(err) : resolveDone(stdout));
      child.stdin!.end('Check responsive checkout UI');
    });
    expect(JSON.parse(stdinAdvice).suggestedCheckIds).toEqual(fileAdvice.suggestedCheckIds);
    expect(((await (await api()).json()) as { run: unknown }).run).toBeNull();
    expect((await api('/advice', 'POST', { request: 'x', mode: 'model' }, { origin: 'https://untrusted.invalid' })).status).toBe(403);
    expect((await api('/advice', 'POST', { request: 'x', mode: 'rules', projectPath: '../' })).status).toBeGreaterThanOrEqual(400);
    expect((await api('/advice', 'POST', { request: '', mode: 'rules' })).status).toBe(400);
    await writeFile(join(root, 'answer.cjs'), 'module.exports = 40;');
    const denied = await api('', 'POST', { checkIds: fileAdvice.suggestedCheckIds, expectedAdviceSnapshotSha256: fileAdvice.snapshotSha256 });
    expect(denied.status).toBe(409);
    const cliDenied = await cli(['run', '--checks', 'node:test', '--advice-snapshot', fileAdvice.snapshotSha256]).then(() => null, e => e);
    expect(cliDenied?.code).toBe(1);
    expect(((await (await api()).json()) as { run: unknown }).run).toBeNull();
    await writeFile(join(root, 'answer.cjs'), 'module.exports = 41;');
  });
  it('returns failure as a machine-readable receipt and a nonzero CLI exit, then prepares a repair request', async () => {
    const failure = await cli(['run', '--checks', 'node:test', '--wait']).then(() => { throw new Error('Expected failing CLI'); }, e => e);
    expect(failure.code).toBe(1);
    const result = JSON.parse(failure.stdout); expect(result.run.state).toBe('failed'); expect(result.verified).toBe(false);
    const prompt = join(root, 'request.txt'); await writeFile(prompt, '정답을 수정해 주세요');
    const repair = JSON.parse((await cli(['repair', '--run-id', result.run.id, '--prompt-file', prompt])).stdout);
    expect(repair.prompt).toContain('정답을 수정'); expect(repair.prompt).toContain('answer is correct');
    expect((await api('', 'POST', { checkIds: ['node:missing'] })).status).toBe(400);
  });
  it('verifies current code, exports the same receipt, and invalidates it after a source edit', async () => {
    await writeFile(join(root, 'answer.cjs'), 'module.exports = 42;');
    const result = JSON.parse((await cli(['run', '--checks', 'node:test', '--wait'])).stdout);
    expect(result.verified).toBe(true); expect(result.run.sourceBefore.digest).toBe(result.run.sourceAfter.digest);
    const exported = JSON.parse((await cli(['export', '--run-id', result.run.id])).stdout);
    expect(exported.run.id).toBe(result.run.id); expect(exported.verified).toBe(true);
    await writeFile(join(root, 'answer.cjs'), 'module.exports = 43;');
    const changed = JSON.parse((await cli(['status'])).stdout); expect(changed.freshness).toBe('stale'); expect(changed.verified).toBe(false);
  });
});
