import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevelopmentVerificationService } from '../src/services/development-verification.js';
import { discoverVerificationChecks } from '../src/services/verification-discovery.js';
import { verificationSource } from '../src/services/verification-source.js';

describe('development verification with real commands and source', () => {
  let root: string, data: string, service: DevelopmentVerificationService;
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: root, encoding: 'utf8' }).trim();
  const packageWith = async (script: string) => writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: script, build: 'node -e "process.exit(0)"' } }));
  const settle = async (id: string) => {
    for (let count = 0; count < 100; count++) {
      const result = await service.status('p', '.', root, id, true);
      if (result.run?.state !== 'running') return service.status('p', '.', root, id);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('Verification did not finish');
  };
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mf-source-')); data = await mkdtemp(join(tmpdir(), 'mf-receipts-'));
    service = new DevelopmentVerificationService(data);
    git('init', '--quiet'); await packageWith('node --test test.cjs');
    await writeFile(join(root, 'sum.cjs'), 'module.exports = (a, b) => a - b;');
    await writeFile(join(root, 'test.cjs'), "const test = require('node:test'); const assert = require('node:assert/strict'); test('adds numbers', () => assert.equal(require('./sum.cjs')(2, 3), 5));");
    await writeFile(join(root, '.gitignore'), 'ignored.txt\n'); git('add', '.'); git('commit', '-qm', 'baseline');
  });
  afterEach(async () => { await service.shutdown(); await rm(root, { recursive: true, force: true }); await rm(data, { recursive: true, force: true }); vi.unstubAllEnvs(); });

  it('discovers exact manifest commands, but does not execute on discovery or accept arbitrary commands', async () => {
    const plan = await discoverVerificationChecks(root);
    expect(plan.map(c => [c.id, c.recommended])).toEqual([['node:test', true], ['node:build', false]]);
    expect(plan[0]).toMatchObject({ command: 'npm', args: ['run', 'test'], script: 'node --test test.cjs' });
    await expect(service.start('p', '.', root, ['node:inject'], undefined)).rejects.toThrow('no longer available');
    await expect(service.start('p', '.', root, [], undefined)).rejects.toThrow('Select');
  });
  it('records a real failing assertion, prepares bounded repair data, then verifies the corrected source', async () => {
    const failed = await service.start('p', '.', root, ['node:test'], undefined);
    const failure = await settle(failed.id);
    expect(failure.verified).toBe(false); expect(failure.run?.state).toBe('failed');
    expect(failure.run?.steps[0]?.exitCode).toBe(1); expect(failure.run?.steps[0]?.output).toContain('adds numbers');
    const repair = await service.repair('p', '.', root, failed.id, '덧셈 오류를 수정해 주세요');
    expect(repair.prompt).toContain('npm run test'); expect(repair.prompt).toContain('덧셈 오류'); expect(repair.prompt).toContain('diagnostic data');
    await writeFile(join(root, 'sum.cjs'), 'module.exports = (a, b) => a + b;');
    const passed = await service.start('p', '.', root, ['node:test'], undefined);
    const result = await settle(passed.id);
    expect(result.verified).toBe(true); expect(result.run?.steps[0]?.exitCode).toBe(0);
    expect(result.history.map(r => r.state)).toEqual(['passed', 'failed']);
    await expect(service.repair('p', '.', root, passed.id, '')).rejects.toThrow('completed failed');
  });
  it('invalidates a passing receipt for edits, new files, deletions and Git HEAD changes', async () => {
    await writeFile(join(root, 'sum.cjs'), 'module.exports = (a, b) => a + b;');
    const run = await service.start('p', '.', root, ['node:test'], undefined); expect((await settle(run.id)).verified).toBe(true);
    await writeFile(join(root, 'extra.cjs'), '// new source');
    expect((await service.status('p', '.', root)).freshness).toBe('stale');
    await rm(join(root, 'extra.cjs')); expect((await service.status('p', '.', root)).verified).toBe(true);
    await rm(join(root, 'sum.cjs')); expect((await service.status('p', '.', root)).verified).toBe(false);
    await writeFile(join(root, 'sum.cjs'), 'module.exports = (a, b) => a + b;'); git('add', '.'); git('commit', '-qm', 'fixed');
    expect((await service.status('p', '.', root)).freshness).toBe('stale');
  });
  it('does not attest source that changed while passing commands ran', async () => {
    await packageWith('node -e "setTimeout(() => process.exit(0), 400)"');
    const run = await service.start('p', '.', root, ['node:test'], undefined);
    await writeFile(join(root, 'sum.cjs'), 'module.exports = 9;');
    const result = await settle(run.id);
    expect(result.run?.state).toBe('passed'); expect(result.run?.stableSource).toBe(false); expect(result.verified).toBe(false); expect(result.freshness).toBe('stale');
  });
  it('enforces worktree ownership, terminates timeouts, and never treats timeout as a pass', async () => {
    await packageWith('node -e "setInterval(() => {}, 100)"');
    const run = await service.start('p', '.', root, ['node:test'], 100);
    await expect(service.start('other', '.', root, ['node:test'], 100)).rejects.toMatchObject({ status: 409 });
    const result = await settle(run.id);
    expect(result.run?.steps[0]?.state).toBe('timed-out'); expect(result.verified).toBe(false);
  });
  it('cancels actual running checks and frees the workspace for another run', async () => {
    await packageWith('node -e "setInterval(() => {}, 100)"');
    const run = await service.start('p', '.', root, ['node:test', 'node:build'], undefined);
    await service.cancel('p', '.', run.id);
    const result = await settle(run.id); expect(result.run?.state).toBe('cancelled'); expect(result.verified).toBe(false);
    expect(result.run?.steps.every(s => s.state === 'cancelled')).toBe(true);
    const next = await service.start('p', '.', root, ['node:build'], undefined); expect((await settle(next.id)).run?.state).toBe('passed');
  });
  it('bounds command output and redacts inherited credentials before persistence and repair', async () => {
    vi.stubEnv('VERIFICATION_TEST_TOKEN', 'real-secret-value-for-test');
    await packageWith('node -e "console.log(\'x\'.repeat(100000)); console.log(process.env.VERIFICATION_TEST_TOKEN); process.exit(1)"');
    const run = await service.start('p', '.', root, ['node:test'], undefined); const result = await settle(run.id);
    const step = result.run!.steps[0]!;
    expect(step.outputTruncated).toBe(true); expect(Buffer.byteLength(step.output)).toBeLessThanOrEqual(32 * 1024 + 3);
    expect(step.output).toContain('[redacted]'); expect(step.output).not.toContain('real-secret-value-for-test');
    expect((await service.repair('p', '.', root, run.id, '')).prompt.length).toBeLessThan(11_000);
  });
  it('fails closed for non-Git folders and symlink sources', async () => {
    await rm(join(root, '.git'), { recursive: true });
    await packageWith('node -e "process.exit(0)"');
    const run = await service.start('p', '.', root, ['node:test'], undefined); const result = await settle(run.id);
    expect(result.run?.state).toBe('passed'); expect(result.freshness).toBe('unknown'); expect(result.verified).toBe(false);
    if (process.platform !== 'win32') {
      git('init', '--quiet'); await symlink(join(root, 'sum.cjs'), join(root, 'linked.cjs'));
      expect((await verificationSource(root)).digest).toBeNull();
    }
  });
  it('reloads terminal receipts and marks a saved unfinished run interrupted after daemon loss', async () => {
    const run = await service.start('p', '.', root, ['node:test'], undefined); await settle(run.id);
    const restarted = new DevelopmentVerificationService(data);
    expect((await restarted.status('p', '.', root)).run?.state).toBe('failed');
    const names = await readdir(join(data, 'verification'));
    const target = join(data, 'verification', names[0]!); const rows = JSON.parse(await readFile(target, 'utf8'));
    rows[0].state = 'running'; rows[0].endedAt = null; await writeFile(target, JSON.stringify(rows));
    const result = await restarted.status('p', '.', root); expect(result.run?.state).toBe('interrupted'); expect(result.verified).toBe(false);
  });
});
