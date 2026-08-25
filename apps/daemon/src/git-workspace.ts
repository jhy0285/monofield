import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import type {
  GitChangedFile,
  GitChangeStatus,
  GitDiffScope,
  GitWorkspaceDiffResponse,
  GitWorkspaceStatusResponse,
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

export async function gitWorkspaceStatus(cwd: string): Promise<GitWorkspaceStatusResponse> {
  const inside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
    return { repository: false, branch: null, head: null, files: [], generatedAt: new Date().toISOString() };
  }
  const [status, branch, head] = await Promise.all([
    runGit(cwd, ['-c', 'status.relativePaths=true', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']),
    runGit(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    runGit(cwd, ['rev-parse', '--short=12', 'HEAD']),
  ]);
  if (status.code !== 0) throw new Error(status.stderr.trim() || 'Unable to read Git status');
  return {
    repository: true,
    branch: branch.code === 0 ? branch.stdout.trim() || null : null,
    head: head.code === 0 ? head.stdout.trim() || null : null,
    files: parseGitPorcelain(status.stdout),
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

export async function gitWorkspaceDiff(cwd: string, inputPath: string, scope: GitDiffScope): Promise<GitWorkspaceDiffResponse> {
  const path = safeRelativePath(cwd, inputPath);
  const status = await gitWorkspaceStatus(cwd);
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
    args.push('--', path);
    const result = await runGit(cwd, args);
    if (result.code !== 0) throw new Error(result.stderr.trim() || 'Unable to read Git diff');
    patch = result.stdout;
    binary = /(?:^|\n)Binary files /.test(patch);
  }
  const limited = truncatePatch(patch);
  return { path, scope, patch: limited.patch, binary, truncated: limited.truncated, maxPatchBytes: GIT_PATCH_MAX_BYTES };
}
