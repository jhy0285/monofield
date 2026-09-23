import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { DevelopmentVerificationService, verificationFingerprint } from '../src/services/development-verification.js';

const exec = promisify(execFile);
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'monofield-verification-'));
  dirs.push(root);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    packageManager: 'pnpm@10.33.2',
    scripts: { test: 'node pass.cjs', 'test:fail': 'node fail.cjs', dev: 'node pass.cjs' },
  }));
  await writeFile(path.join(root, 'pass.cjs'), 'setTimeout(() => console.log("verified"), 150);');
  await writeFile(path.join(root, 'fail.cjs'), 'console.error("assertion failed"); process.exit(1);');
  const git = (...args: string[]) => exec('git', args, { cwd: root, windowsHide: true });
  await git('init');
  await git('add', '.');
  await git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
  return { root, git };
}
async function finished(service: DevelopmentVerificationService, root: string) {
  for (let count = 0; count < 150; count++) {
    const result = await service.status(root);
    if (result.run?.state !== 'running') return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Verification did not finish');
}
it('runs real package scripts and marks a passing result stale after a source edit', async () => {
  const { root } = await fixture();
  const service = new DevelopmentVerificationService();
  expect((await service.status(root)).scripts).toEqual(['test', 'test:fail']);
  await expect(service.start(root, 'dev')).rejects.toThrow('Select a');
  await service.start(root, 'test');
  await expect(service.start(root, 'test')).rejects.toMatchObject({ status: 409 });
  const result = await finished(service, root);
  expect(result.run).toMatchObject({ state: 'passed', exitCode: 0 });
  expect(result.run?.output).toContain('verified');
  expect(result.freshness).toBe('current');
  await writeFile(path.join(root, 'new-source.ts'), 'export const changed = true;');
  expect((await service.status(root)).freshness).toBe('stale');
  await service.start(root, 'test:fail');
  expect((await finished(service, root)).run).toMatchObject({ state: 'failed', exitCode: 1 });
}, 30_000);

it('invalidates evidence for staged-only changes and never certifies a non-Git folder', async () => {
  const { root, git } = await fixture();
  const before = await verificationFingerprint(root);
  expect(before).not.toBeNull();
  await writeFile(path.join(root, 'pass.cjs'), 'changed');
  await git('add', 'pass.cjs');
  await writeFile(path.join(root, 'pass.cjs'), 'setTimeout(() => console.log("verified"), 150);');
  expect(await verificationFingerprint(root)).not.toBe(before);
  const plain = await mkdtemp(path.join(os.tmpdir(), 'monofield-plain-'));
  dirs.push(plain);
  expect(await verificationFingerprint(plain)).toBeNull();
});
