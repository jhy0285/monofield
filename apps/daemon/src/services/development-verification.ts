import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createCommandInvocation } from '@open-design/platform';
import type { DevelopmentVerificationResponse, DevelopmentVerificationRun } from '@open-design/contracts';

const exec = promisify(execFile);
const MAX_OUTPUT = 64 * 1024;
const supportedScript = /^(test|typecheck|lint|build|check)(:[\w-]+)?$/;

async function manifest(root: string): Promise<{ scripts: string[]; manager: string }> {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const scripts = Object.entries(pkg.scripts ?? {})
    .filter(([name, value]) => supportedScript.test(name) && typeof value === 'string')
    .map(([name]) => name);
  const declared = /^(npm|pnpm|yarn)@/.exec(pkg.packageManager ?? '')?.[1];
  let manager = declared ?? 'npm';
  if (!declared) {
    for (const [lock, candidate] of [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn']] as const) {
      try { await lstat(path.join(root, lock)); manager = candidate; break; } catch { /* optional */ }
    }
  }
  return { scripts, manager };
}

// Hash source files, including untracked additions, without reading symlink targets.
// Oversized/unreadable workspaces return unknown rather than a false current badge.
export async function verificationFingerprint(root: string): Promise<string | null> {
  try {
    const git = async (args: string[]) => (await exec('git', ['--no-pager', ...args], {
      cwd: root, windowsHide: true, timeout: 10_000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    })).stdout;
    const repo = (await git(['rev-parse', '--show-toplevel'])).trim();
    const realRepo = await realpath(repo);
    const hash = createHash('sha256');
    hash.update(await git(['rev-parse', 'HEAD']));
    hash.update(await git(['-C', repo, 'diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv']));
    const paths = [...new Set((await git(['-C', repo, 'ls-files', '--cached', '--others', '--exclude-standard', '--full-name', '-z'])).split('\0').filter(Boolean))].sort();
    if (paths.length > 5_000) return null;
    let bytes = 0;
    for (const name of paths) {
      const absolute = path.resolve(repo, name);
      const relative = path.relative(repo, absolute);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
      hash.update(name).update('\0');
      try {
        const stat = await lstat(absolute);
        hash.update(String(stat.mode)).update(':');
        if (stat.isSymbolicLink()) { hash.update('link:').update(await readlink(absolute)); continue; }
        if (!stat.isFile()) return null;
        // A symlink in a parent directory must not allow reads outside the repository.
        const resolved = await realpath(absolute);
        const realRelative = path.relative(realRepo, resolved);
        if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) return null;
        bytes += stat.size;
        if (bytes > 32 * 1024 * 1024) return null;
        const content = await readFile(absolute);
        hash.update(String(content.length)).update(':').update(content);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
        hash.update('deleted');
      }
      hash.update('\0');
    }
    return hash.digest('hex');
  } catch { return null; }
}

export class DevelopmentVerificationService {
  private records = new Map<string, DevelopmentVerificationRun>();
  private starting = new Set<string>();

  async status(root: string): Promise<DevelopmentVerificationResponse> {
    const scripts = await manifest(root).then(value => value.scripts).catch(() => []);
    const run = this.records.get(root) ?? null;
    const current = run?.state !== 'running' && run?.sourceFingerprint
      ? await verificationFingerprint(root) : null;
    return {
      scripts, run: run ? { ...run } : null,
      freshness: run?.sourceChangedDuringRun ? 'stale'
        : current && run?.sourceFingerprint ? (current === run.sourceFingerprint ? 'current' : 'stale') : 'unknown',
    };
  }

  async start(root: string, script: unknown): Promise<DevelopmentVerificationResponse> {
    if (this.starting.has(root) || this.records.get(root)?.state === 'running') {
      throw Object.assign(new Error('Verification is already running for this project.'), { status: 409 });
    }
    this.starting.add(root);
    try {
      const { scripts, manager } = await manifest(root);
      if (typeof script !== 'string' || !scripts.includes(script)) {
        throw new Error('Select a test, typecheck, lint, build, or check script from package.json.');
      }
      const before = await verificationFingerprint(root);
      const env = { ...process.env, CI: '1', FORCE_COLOR: '0' };
      const execPath = process.env.npm_execpath;
      let command = execPath && path.basename(execPath).startsWith(manager) ? execPath : manager;
      if (process.platform === 'win32' && command === manager) {
        const found = await exec('where.exe', [manager + '.cmd'], { windowsHide: true, timeout: 5_000 });
        command = found.stdout.trim().split(/\r?\n/)[0]!;
      }
      const invocation = createCommandInvocation({ command, args: ['run', script], env });
      const run: DevelopmentVerificationRun = {
        id: randomUUID(), script, command: manager + ' run ' + script, state: 'running',
        exitCode: null, output: '', truncated: false, startedAt: new Date().toISOString(),
        sourceFingerprint: before, sourceChangedDuringRun: false,
      };
      // Bound session-only history; never evict an active process.
      if (this.records.size >= 100) {
        const oldest = [...this.records].find(([, value]) => value.state !== 'running');
        if (oldest) this.records.delete(oldest[0]);
        else throw Object.assign(new Error('Too many active verifications.'), { status: 409 });
      }
      this.records.set(root, run);
      const child = spawn(invocation.command, invocation.args, {
        cwd: root, env, windowsHide: true, windowsVerbatimArguments: invocation.windowsVerbatimArguments,
        detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      });
      const append = (text: string) => {
        const room = MAX_OUTPUT - run.output.length;
        if (text.length > room) run.truncated = true;
        if (room > 0) run.output += text.slice(0, room);
      };
      child.stdout.setEncoding('utf8').on('data', append);
      child.stderr.setEncoding('utf8').on('data', append);
      let failed = false;
      const timer = setTimeout(() => {
        failed = true;
        append('\nVerification timed out after 120 seconds.\n');
        if (process.platform === 'win32' && child.pid) {
          void exec('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => child.kill());
        } else if (child.pid) {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        }
      }, 120_000);
      child.once('error', error => { failed = true; append(error.message); });
      child.once('close', (code) => {
        clearTimeout(timer);
        void (async () => {
          const after = await verificationFingerprint(root);
          run.sourceChangedDuringRun = before !== null && after !== null && before !== after;
          if (!after) run.sourceFingerprint = null;
          run.exitCode = code;
          run.finishedAt = new Date().toISOString();
          run.state = !failed && code === 0 ? 'passed' : 'failed';
        })();
      });
      return { scripts, run: { ...run }, freshness: 'unknown' };
    } finally { this.starting.delete(root); }
  }
}
