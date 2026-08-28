import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import type {
  GitBranchMutationResponse,
  GitBranchRef,
  GitChangedFile,
  GitChangeStatus,
  GitDiffScope,
  GitWorkspaceBranchesResponse,
  GitWorkspaceDiffResponse,
  GitWorkspaceDirtyResponse,
  GitWorkspaceStatusResponse,
  GitWorkingTreeStrategy,
} from '@open-design/contracts';

const GIT_TIMEOUT_MS = 10_000;
export const GIT_PATCH_MAX_BYTES = 512 * 1024;

type GitResult = { stdout: string; stderr: string; code: number };

function runGit(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolveResult, reject) => {
    execFile(
      'git',
      ['--no-pager', ...args],
      {
        cwd,
        windowsHide: true,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        encoding: 'utf8',
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolveResult({ stdout, stderr, code: 0 });
          return;
        }
        const code = typeof error.code === 'number' ? error.code : 1;
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error('Git is not installed or is not available on PATH'));
          return;
        }
        resolveResult({ stdout: stdout ?? '', stderr: stderr ?? error.message, code });
      },
    );
  });
}

function statusKind(indexStatus: string, worktreeStatus: string): GitChangeStatus {
  const states = `${indexStatus}${worktreeStatus}`;
  if (states === '??') return 'untracked';
  if (states.includes('U') || states === 'AA' || states === 'DD') return 'conflicted';
  if (states.includes('R')) return 'renamed';
  if (states.includes('C')) return 'copied';
  if (states.includes('D')) return 'deleted';
  if (states.includes('A')) return 'added';
  if (states.includes('T')) return 'type-changed';
  return 'modified';
}

export function parseGitPorcelain(output: string): GitChangedFile[] {
  const records = output.split('\0');
  const files: GitChangedFile[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const indexStatus = record[0] ?? ' ';
    const worktreeStatus = record[1] ?? ' ';
    const path = record.slice(3);
    if (!path) continue;
    const renamedOrCopied = indexStatus === 'R' || indexStatus === 'C' || worktreeStatus === 'R' || worktreeStatus === 'C';
    const oldPath = renamedOrCopied ? records[index + 1] : undefined;
    if (renamedOrCopied && oldPath) index += 1;
    files.push({
      path,
      ...(oldPath ? { oldPath } : {}),
      status: statusKind(indexStatus, worktreeStatus),
      indexStatus,
      worktreeStatus,
      staged: indexStatus !== ' ' && indexStatus !== '?',
      unstaged: worktreeStatus !== ' ' || indexStatus === '?',
    });
  }
  return files;
}

export function parseGitNameStatus(output: string): GitChangedFile[] {
  const records = output.split('\0');
  const files: GitChangedFile[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const rawStatus = records[index];
    if (!rawStatus) continue;
    const kind = rawStatus[0] ?? 'M';
    const renamedOrCopied = kind === 'R' || kind === 'C';
    const firstPath = records[index + 1];
    const secondPath = renamedOrCopied ? records[index + 2] : undefined;
    if (!firstPath || (renamedOrCopied && !secondPath)) continue;
    index += renamedOrCopied ? 2 : 1;
    const filePath = secondPath ?? firstPath;
    files.push({
      path: filePath,
      ...(renamedOrCopied ? { oldPath: firstPath } : {}),
      status: kind === 'A' ? 'added'
        : kind === 'D' ? 'deleted'
          : kind === 'R' ? 'renamed'
            : kind === 'C' ? 'copied'
              : kind === 'T' ? 'type-changed'
                : 'modified',
      indexStatus: ' ',
      worktreeStatus: kind === 'A' ? 'A' : kind === 'D' ? 'D' : kind === 'T' ? 'T' : 'M',
      staged: false,
      unstaged: false,
    });
  }
  return files;
}

export async function gitWorkspaceBranches(cwd: string): Promise<GitWorkspaceBranchesResponse> {
  const inside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
    return { repository: false, current: null, branches: [], generatedAt: new Date().toISOString() };
  }
  const [branch, refs] = await Promise.all([
    runGit(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    runGit(cwd, ['for-each-ref', '--format=%(refname)%00%(refname:short)%00%(upstream:short)', 'refs/heads', 'refs/remotes']),
  ]);
  if (refs.code !== 0) throw new Error(refs.stderr.trim() || 'Unable to list Git branches');
  const current = branch.code === 0 ? branch.stdout.trim() || null : null;
  const branches: GitBranchRef[] = refs.stdout.split(/\r?\n/).flatMap((line) => {
    const [fullName, name, upstream = ''] = line.split('\0');
    if (!fullName || !name || /^refs\/remotes\/[^/]+\/HEAD$/.test(fullName)) return [];
    return [{
      name,
      fullName,
      current: fullName === `refs/heads/${current ?? ''}`,
      remote: fullName.startsWith('refs/remotes/'),
      upstream: upstream || null,
    }];
  }).sort((left, right) => Number(right.current) - Number(left.current)
    || Number(left.remote) - Number(right.remote)
    || left.name.localeCompare(right.name));
  return { repository: true, current, branches, generatedAt: new Date().toISOString() };
}

async function resolveComparisonBranch(cwd: string, input: string): Promise<GitBranchRef> {
  const value = input.trim();
  if (!value) throw Object.assign(new Error('comparison branch is required'), { status: 400 });
  const response = await gitWorkspaceBranches(cwd);
  if (!response.repository) throw Object.assign(new Error('The selected working folder is not a Git repository'), { status: 409 });
  const branch = response.branches.find((candidate) => candidate.fullName === value || candidate.name === value);
  if (!branch) throw Object.assign(new Error('The selected Git branch is no longer available'), { status: 404 });
  return branch;
}

function gitMutationError(message: string, status = 409): Error {
  return Object.assign(new Error(message), { status });
}

async function currentBranch(cwd: string): Promise<string | null> {
  const result = await runGit(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return result.code === 0 ? result.stdout.trim() || null : null;
}

async function stashWorkingTree(cwd: string): Promise<string> {
  const result = await runGit(cwd, [
    'stash',
    'push',
    '--include-untracked',
    '--message',
    `MonoField branch switch ${new Date().toISOString()}`,
  ]);
  if (result.code !== 0) throw gitMutationError(result.stderr.trim() || 'Unable to temporarily store the current changes');
  const ref = await runGit(cwd, ['rev-parse', '--verify', 'refs/stash']);
  if (ref.code !== 0 || !ref.stdout.trim()) throw gitMutationError('Git did not create the requested stash');
  return ref.stdout.trim();
}

async function restoreStashAfterFailedSwitch(cwd: string, stashRef: string): Promise<string | null> {
  void stashRef;
  const result = await runGit(cwd, ['stash', 'pop', '--index']);
  return result.code === 0 ? null : result.stderr.trim() || result.stdout.trim() || 'Unable to restore the temporary stash';
}

async function prepareBranchMutation(
  cwd: string,
  strategy: GitWorkingTreeStrategy,
): Promise<{ previousBranch: string | null; stashRef: string | null }> {
  const dirty = await gitWorkspaceDirtyState(cwd);
  if (!dirty.repository) throw gitMutationError('The selected working folder is not a Git repository');
  if (dirty.dirty && strategy === 'reject') {
    throw gitMutationError('Uncommitted changes exist. Keep them or stash them before switching branches.');
  }
  return {
    previousBranch: await currentBranch(cwd),
    stashRef: dirty.dirty && strategy === 'stash' ? await stashWorkingTree(cwd) : null,
  };
}

export async function gitWorkspaceDirtyState(cwd: string): Promise<GitWorkspaceDirtyResponse> {
  const inside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') return { repository: false, dirty: false, changeCount: 0 };
  // Branch switching affects the entire worktree even when MonoField is focused
  // on one module. Check every repository change, not only the active module.
  const result = await runGit(cwd, ['-c', 'status.relativePaths=true', 'status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (result.code !== 0) throw gitMutationError(result.stderr.trim() || 'Unable to read Git status');
  const changeCount = parseGitPorcelain(result.stdout).length;
  return { repository: true, dirty: changeCount > 0, changeCount };
}

async function finishBranchMutation(
  cwd: string,
  result: GitResult,
  prepared: { previousBranch: string | null; stashRef: string | null },
  created: boolean,
): Promise<GitBranchMutationResponse> {
  if (result.code !== 0) {
    const restoreError = prepared.stashRef
      ? await restoreStashAfterFailedSwitch(cwd, prepared.stashRef)
      : null;
    const detail = result.stderr.trim() || result.stdout.trim() || 'Unable to switch Git branches';
    throw gitMutationError(restoreError ? `${detail} The temporary stash also could not be restored: ${restoreError}` : detail);
  }
  return {
    previousBranch: prepared.previousBranch,
    currentBranch: await currentBranch(cwd),
    created,
    stashed: Boolean(prepared.stashRef),
    ...(prepared.stashRef ? { stashRef: prepared.stashRef } : {}),
  };
}

export async function switchGitWorkspaceBranch(
  cwd: string,
  branchInput: string,
  strategy: GitWorkingTreeStrategy = 'reject',
): Promise<GitBranchMutationResponse> {
  const branch = await resolveComparisonBranch(cwd, branchInput);
  if (branch.current) {
    return {
      previousBranch: branch.name,
      currentBranch: branch.name,
      created: false,
      stashed: false,
    };
  }
  const prepared = await prepareBranchMutation(cwd, strategy);
  if (!branch.remote) {
    return finishBranchMutation(cwd, await runGit(cwd, ['switch', branch.name]), prepared, false);
  }

  const localName = branch.name.includes('/') ? branch.name.slice(branch.name.indexOf('/') + 1) : branch.name;
  const branches = await gitWorkspaceBranches(cwd);
  const existingLocal = branches.branches.find((candidate) => !candidate.remote && candidate.name === localName);
  const result = existingLocal
    ? await runGit(cwd, ['switch', existingLocal.name])
    : await runGit(cwd, ['switch', '--track', '--create', localName, branch.fullName]);
  return finishBranchMutation(cwd, result, prepared, !existingLocal);
}

export async function createGitWorkspaceBranch(
  cwd: string,
  nameInput: string,
  strategy: GitWorkingTreeStrategy = 'reject',
): Promise<GitBranchMutationResponse> {
  const name = nameInput.trim();
  if (!name) throw gitMutationError('Branch name is required', 400);
  const validation = await runGit(cwd, ['check-ref-format', '--branch', name]);
  if (validation.code !== 0) throw gitMutationError(validation.stderr.trim() || 'The branch name is invalid', 400);
  const branches = await gitWorkspaceBranches(cwd);
  if (!branches.repository) throw gitMutationError('The selected working folder is not a Git repository');
  if (branches.branches.some((candidate) => !candidate.remote && candidate.name === name)) {
    throw gitMutationError('A local branch with this name already exists');
  }
  const prepared = await prepareBranchMutation(cwd, strategy);
  return finishBranchMutation(cwd, await runGit(cwd, ['switch', '--create', name]), prepared, true);
}

export async function gitWorkspaceStatus(cwd: string, comparisonBranch?: string | null): Promise<GitWorkspaceStatusResponse> {
  const inside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
    return { repository: false, branch: null, head: null, files: [], generatedAt: new Date().toISOString() };
  }
  const selectedBranch = comparisonBranch ? await resolveComparisonBranch(cwd, comparisonBranch) : null;
  const [status, branch, head] = await Promise.all([
    selectedBranch
      ? runGit(cwd, ['diff', '--name-status', '-z', '--find-renames', `${selectedBranch.fullName}...HEAD`, '--', '.'])
      : runGit(cwd, ['-c', 'status.relativePaths=true', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']),
    runGit(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    runGit(cwd, ['rev-parse', '--short=12', 'HEAD']),
  ]);
  if (status.code !== 0) throw new Error(status.stderr.trim() || 'Unable to read Git status');
  return {
    repository: true,
    branch: branch.code === 0 ? branch.stdout.trim() || null : null,
    ...(selectedBranch ? { comparisonBranch: selectedBranch.name } : {}),
    head: head.code === 0 ? head.stdout.trim() || null : null,
    files: selectedBranch ? parseGitNameStatus(status.stdout) : parseGitPorcelain(status.stdout),
    generatedAt: new Date().toISOString(),
  };
}

function safeRelativePath(cwd: string, input: string): string {
  const normalizedInput = input.replace(/\\/g, '/');
  if (!normalizedInput || isAbsolute(input) || normalizedInput.split('/').includes('..')) {
    throw Object.assign(new Error('Invalid Git path'), { status: 400 });
  }
  const target = resolve(cwd, input);
  const rel = relative(resolve(cwd), target).replace(/\\/g, '/');
  if (!rel || rel.startsWith('../') || isAbsolute(rel)) {
    throw Object.assign(new Error('Git path must stay inside the project folder'), { status: 400 });
  }
  return rel;
}

function truncatePatch(patch: string): { patch: string; truncated: boolean } {
  const bytes = Buffer.byteLength(patch, 'utf8');
  if (bytes <= GIT_PATCH_MAX_BYTES) return { patch, truncated: false };
  let end = Math.min(patch.length, GIT_PATCH_MAX_BYTES);
  while (end > 0 && Buffer.byteLength(patch.slice(0, end), 'utf8') > GIT_PATCH_MAX_BYTES) end -= 1024;
  return { patch: `${patch.slice(0, end)}\n… diff truncated …\n`, truncated: true };
}

async function untrackedPatch(cwd: string, path: string): Promise<{ patch: string; binary: boolean }> {
  const data = await readFile(resolve(cwd, path));
  if (data.includes(0)) {
    return { patch: `diff --git a/${path} b/${path}\nnew file mode 100644\nBinary files /dev/null and b/${path} differ\n`, binary: true };
  }
  const text = data.toString('utf8');
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const body = lines.map((line) => `+${line}`).join('\n');
  return {
    patch: [
      `diff --git a/${path} b/${path}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${path}`,
      `@@ -0,0 +1,${lines.length} @@`,
      body,
      '',
    ].join('\n'),
    binary: false,
  };
}

export async function gitWorkspaceDiff(
  cwd: string,
  inputPath: string,
  scope: GitDiffScope,
  comparisonBranch?: string | null,
): Promise<GitWorkspaceDiffResponse> {
  const path = safeRelativePath(cwd, inputPath);
  const selectedBranch = scope === 'branch'
    ? await resolveComparisonBranch(cwd, comparisonBranch ?? '')
    : null;
  const status = await gitWorkspaceStatus(cwd, selectedBranch?.fullName);
  if (!status.repository) throw Object.assign(new Error('The selected working folder is not a Git repository'), { status: 409 });
  const file = status.files.find((candidate) => candidate.path === path);
  if (!file) throw Object.assign(new Error('The file is not present in the current Git changes'), { status: 404 });
  if (scope === 'staged' && !file.staged) throw Object.assign(new Error('The file has no staged changes'), { status: 409 });
  if (scope === 'working' && !file.unstaged) throw Object.assign(new Error('The file has no working tree changes'), { status: 409 });

  let patch: string;
  let binary = false;
  if (file.status === 'untracked') {
    ({ patch, binary } = await untrackedPatch(cwd, path));
  } else {
    const args = ['diff', '--no-ext-diff', '--no-color', '--unified=3', '--relative'];
    if (scope === 'staged') args.push('--cached');
    if (selectedBranch) args.push(`${selectedBranch.fullName}...HEAD`);
    args.push('--', path);
    const result = await runGit(cwd, args);
    if (result.code !== 0) throw new Error(result.stderr.trim() || 'Unable to read Git diff');
    patch = result.stdout;
    binary = /(?:^|\n)Binary files /.test(patch);
  }
  const limited = truncatePatch(patch);
  return {
    path,
    scope,
    ...(selectedBranch ? { comparisonBranch: selectedBranch.name } : {}),
    patch: limited.patch,
    binary,
    truncated: limited.truncated,
    maxPatchBytes: GIT_PATCH_MAX_BYTES,
  };
}
