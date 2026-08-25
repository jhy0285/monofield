import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { gitWorkspaceDiff, gitWorkspaceStatus, parseGitPorcelain } from '../src/git-workspace.js';

describe('Git workspace reader', () => {
  let root = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'open-agent-git-'));
    execFileSync('git', ['init', '--quiet'], { cwd: root, windowsHide: true });
    await writeFile(join(root, 'tracked.txt'), 'one\n', 'utf8');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: root, windowsHide: true });
    execFileSync('git', ['-c', 'user.name=MonoField Test', '-c', 'user.email=test@open-agent.local', 'commit', '--quiet', '-m', 'baseline'], { cwd: root, windowsHide: true });
    await writeFile(join(root, 'tracked.txt'), 'two\n', 'utf8');
    await writeFile(join(root, 'untracked.txt'), 'hello\nworld\n', 'utf8');
    await writeFile(join(root, 'staged.txt'), 'ready\n', 'utf8');
    execFileSync('git', ['add', 'staged.txt'], { cwd: root, windowsHide: true });
  });

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  test('parses working, staged, and untracked changes', async () => {
    const status = await gitWorkspaceStatus(root);
    expect(status.repository).toBe(true);
    expect(status.files.find((file) => file.path === 'tracked.txt')).toMatchObject({ staged: false, unstaged: true, status: 'modified' });
    expect(status.files.find((file) => file.path === 'staged.txt')).toMatchObject({ staged: true, unstaged: false, status: 'added' });
    expect(status.files.find((file) => file.path === 'untracked.txt')).toMatchObject({ staged: false, unstaged: true, status: 'untracked' });
  });

  test('returns tracked and untracked text patches without shell interpolation', async () => {
    const tracked = await gitWorkspaceDiff(root, 'tracked.txt', 'working');
    expect(tracked.patch).toContain('-one');
    expect(tracked.patch).toContain('+two');

    const untracked = await gitWorkspaceDiff(root, 'untracked.txt', 'working');
    expect(untracked.patch).toContain('--- /dev/null');
    expect(untracked.patch).toContain('+hello');
    expect(untracked.patch).toContain('+world');
  });

  test('rejects paths outside the selected working folder', async () => {
    await expect(gitWorkspaceDiff(root, '../secret.txt', 'working')).rejects.toThrow('Invalid Git path');
  });

  test('parses NUL-delimited rename records', () => {
    expect(parseGitPorcelain('R  new-name.ts\0old-name.ts\0')).toEqual([
      expect.objectContaining({ path: 'new-name.ts', oldPath: 'old-name.ts', status: 'renamed', staged: true }),
    ]);
  });
});
