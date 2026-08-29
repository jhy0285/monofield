import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  createGitWorkspaceBranch,
  gitWorkspaceBranches,
  gitWorkspaceDiff,
  gitWorkspaceStatus,
  parseGitNameStatus,
  parseGitPorcelain,
  switchGitWorkspaceBranch,
} from '../src/git-workspace.js';

describe('Git workspace reader', () => {
  let root = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'open-agent-git-'));
    execFileSync('git', ['init', '--quiet'], { cwd: root, windowsHide: true });
    await writeFile(join(root, 'tracked.txt'), 'one\n', 'utf8');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: root, windowsHide: true });
    execFileSync('git', ['-c', 'user.name=MonoField Test', '-c', 'user.email=test@open-agent.local', 'commit', '--quiet', '-m', 'baseline'], { cwd: root, windowsHide: true });
    execFileSync('git', ['branch', 'comparison-base'], { cwd: root, windowsHide: true });
    await writeFile(join(root, 'committed.txt'), 'committed on head\n', 'utf8');
    execFileSync('git', ['add', 'committed.txt'], { cwd: root, windowsHide: true });
    execFileSync('git', ['-c', 'user.name=MonoField Test', '-c', 'user.email=test@open-agent.local', 'commit', '--quiet', '-m', 'head work'], { cwd: root, windowsHide: true });
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

  test('lists branches and compares committed changes without checkout', async () => {
    const before = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
    const branches = await gitWorkspaceBranches(root);
    const comparison = branches.branches.find((branch) => branch.name === 'comparison-base');
    expect(branches.repository).toBe(true);
    expect(comparison).toMatchObject({ current: false, remote: false });

    const status = await gitWorkspaceStatus(root, comparison!.fullName);
    expect(status.comparisonBranch).toBe('comparison-base');
    expect(status.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'committed.txt', status: 'added' }),
    ]));

    const diff = await gitWorkspaceDiff(root, 'committed.txt', 'branch', comparison!.fullName);
    expect(diff.comparisonBranch).toBe('comparison-base');
    expect(diff.patch).toContain('+committed on head');
    expect(execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()).toBe(before);
  });

  test('parses NUL-delimited rename records', () => {
    expect(parseGitPorcelain('R  new-name.ts\0old-name.ts\0')).toEqual([
      expect.objectContaining({ path: 'new-name.ts', oldPath: 'old-name.ts', status: 'renamed', staged: true }),
    ]);
  });

  test('parses branch name-status records', () => {
    expect(parseGitNameStatus('R100\0old-name.ts\0new-name.ts\0M\0same.ts\0')).toEqual([
      expect.objectContaining({ path: 'new-name.ts', oldPath: 'old-name.ts', status: 'renamed' }),
      expect.objectContaining({ path: 'same.ts', status: 'modified' }),
    ]);
  });

  test('reuses a short status snapshot and bypasses it for an explicit refresh', async () => {
    await gitWorkspaceStatus(root, null, { refresh: true });
    const cachedPath = join(root, 'cache-refresh.txt');
    await writeFile(cachedPath, 'new\n', 'utf8');

    expect((await gitWorkspaceStatus(root)).files.some((file) => file.path === 'cache-refresh.txt')).toBe(false);
    expect((await gitWorkspaceStatus(root, null, { refresh: true })).files.some((file) => file.path === 'cache-refresh.txt')).toBe(true);

    await rm(cachedPath, { force: true });
    await gitWorkspaceStatus(root, null, { refresh: true });
  });
});

describe('Git workspace branch mutations', () => {
  let root = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'monofield-git-switch-'));
    execFileSync('git', ['init', '--quiet'], { cwd: root, windowsHide: true });
    await writeFile(join(root, 'base.txt'), 'base\n', 'utf8');
    execFileSync('git', ['add', 'base.txt'], { cwd: root, windowsHide: true });
    execFileSync('git', ['-c', 'user.name=MonoField Test', '-c', 'user.email=test@monofield.local', 'commit', '--quiet', '-m', 'baseline'], { cwd: root, windowsHide: true });
    execFileSync('git', ['branch', 'release'], { cwd: root, windowsHide: true });
  });

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  test('switches the actual working branch and creates a new branch', async () => {
    const switched = await switchGitWorkspaceBranch(root, 'refs/heads/release');
    expect(switched).toMatchObject({ previousBranch: expect.any(String), currentBranch: 'release', created: false, stashed: false });
    expect(execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()).toBe('release');

    const created = await createGitWorkspaceBranch(root, 'feature/orders');
    expect(created).toMatchObject({ previousBranch: 'release', currentBranch: 'feature/orders', created: true, stashed: false });
  });

  test('requires an explicit strategy for dirty files and can stash them before switching', async () => {
    await writeFile(join(root, 'dirty.txt'), 'not committed\n', 'utf8');
    await expect(switchGitWorkspaceBranch(root, 'refs/heads/release')).rejects.toThrow('Uncommitted changes exist');
    expect(execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()).toBe('feature/orders');

    const switched = await switchGitWorkspaceBranch(root, 'refs/heads/release', 'stash');
    expect(switched).toMatchObject({ previousBranch: 'feature/orders', currentBranch: 'release', stashed: true });
    expect(execFileSync('git', ['stash', 'list'], { cwd: root, encoding: 'utf8', windowsHide: true })).toContain('MonoField branch switch');
  });
});
