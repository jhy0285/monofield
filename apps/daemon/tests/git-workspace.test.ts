import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

describe('Git workspace nested modules', () => {
  let root = '';
  let backend = '';
  let frontend = '';
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'monofield-git-modules-'));
    backend = join(root, 'backend');
    frontend = join(root, 'frontend');
    await mkdir(backend);
    await mkdir(frontend);
    git('init', '--quiet');
    await writeFile(join(backend, 'server.txt'), 'backend before\n');
    await writeFile(join(frontend, 'server.txt'), 'frontend before\n');
    await writeFile(join(backend, 'old.txt'), 'renamed contents\n');
    git('add', '.');
    git('-c', 'user.name=MonoField Test', '-c', 'user.email=test@monofield.local', 'commit', '--quiet', '-m', 'baseline');
    git('branch', 'comparison-base');
    await writeFile(join(backend, 'committed.txt'), 'backend committed\n');
    await writeFile(join(frontend, 'committed.txt'), 'frontend committed\n');
    git('add', '.');
    git('-c', 'user.name=MonoField Test', '-c', 'user.email=test@monofield.local', 'commit', '--quiet', '-m', 'module features');
    await writeFile(join(backend, 'server.txt'), 'backend after\n');
    await writeFile(join(frontend, 'server.txt'), 'frontend after\n');
    await writeFile(join(backend, 'new.txt'), 'backend untracked\n');
    await writeFile(join(frontend, 'new.txt'), 'frontend untracked\n');
    git('mv', 'backend/old.txt', 'backend/renamed.txt');
  });

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  test('returns module-relative tracked, renamed and untracked paths with actual patches', async () => {
    const status = await gitWorkspaceStatus(backend, null, { refresh: true });
    expect(status.files.map((file) => file.path).sort()).toEqual(['new.txt', 'renamed.txt', 'server.txt']);
    expect(status.files.find((file) => file.path === 'renamed.txt')).toMatchObject({ oldPath: 'old.txt', staged: true });
    const tracked = await gitWorkspaceDiff(backend, 'server.txt', 'working');
    expect(tracked.patch).toContain('-backend before');
    expect(tracked.patch).toContain('+backend after');
    expect((await gitWorkspaceDiff(backend, 'new.txt', 'working')).patch).toContain('+backend untracked');
    expect((await gitWorkspaceDiff(backend, 'renamed.txt', 'staged')).patch).toContain('renamed contents');
  });

  test('keeps sibling and root status snapshots distinct without requiring refresh', async () => {
    await gitWorkspaceStatus(backend, null, { refresh: true });
    const sibling = await gitWorkspaceStatus(frontend);
    expect(sibling.files.map((file) => file.path).sort()).toEqual(['new.txt', 'server.txt']);
    const whole = await gitWorkspaceStatus(root);
    expect(whole.files).toHaveLength(5);
    expect(whole.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'backend/server.txt' }),
      expect.objectContaining({ path: 'frontend/server.txt' }),
    ]));
    expect((await gitWorkspaceDiff(frontend, 'server.txt', 'working')).patch).toContain('+frontend after');
  });

  test('uses module-relative paths for committed branch comparisons', async () => {
    const status = await gitWorkspaceStatus(backend, 'comparison-base', { refresh: true });
    expect(status.files.map((file) => file.path)).toEqual(['committed.txt']);
    expect((await gitWorkspaceDiff(backend, 'committed.txt', 'branch', 'comparison-base')).patch).toContain('+backend committed');
  });

  test('invalidates every module snapshot when a branch changes through a sibling', async () => {
    await gitWorkspaceStatus(backend, null, { refresh: true });
    await gitWorkspaceStatus(frontend);
    await gitWorkspaceStatus(root);
    await createGitWorkspaceBranch(frontend, 'feature/module-cache', 'keep');
    for (const cwd of [backend, frontend, root]) {
      expect((await gitWorkspaceStatus(cwd)).branch).toBe('feature/module-cache');
    }
  });
});
