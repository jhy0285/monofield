import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readlink, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { VerificationSource } from '@open-design/contracts';

const exec = promisify(execFile);
const MAX_FILES = 20_000;
const MAX_BYTES = 256 * 1024 * 1024;
const MAX_MS = 15_000;

/** No contents are saved. Ignored DBs, dependencies and external symlink targets are not attested. */
export async function verificationSource(cwd: string): Promise<VerificationSource> {
  const result: VerificationSource = { scope: 'git-visible-worktree', head: null, digest: null, fileCount: 0, reason: null };
  const started = Date.now();
  try {
    const options = { cwd, timeout: 10_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' as const,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } };
    const root = (await exec('git', ['rev-parse', '--show-toplevel'], options)).stdout.trim();
    result.head = await exec('git', ['rev-parse', '--verify', 'HEAD'], options).then(r => r.stdout.trim()).catch(() => null);
    const names = (await exec('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { ...options, cwd: root })).stdout;
    const files = [...new Set(names.split('\0').filter(Boolean))].sort();
    if (files.length > MAX_FILES) throw new Error(`Source snapshot exceeds ${MAX_FILES} files`);
    const hash = createHash('sha256').update(`source-v1\0${result.head ?? 'unborn'}\0`);
    let bytes = 0;
    for (const name of files) {
      if (Date.now() - started > MAX_MS) throw new Error('Source snapshot time limit reached');
      const target = resolve(root, name);
      const rel = relative(root, target);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error('Source path escapes the worktree');
      hash.update(`${name}\0`);
      let info;
      try { info = await lstat(target); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        hash.update('deleted\0'); continue;
      }
      if (info.isSymbolicLink()) {
        // Following a link could read user secrets outside the workspace. A link alone
        // cannot attest its changing target, so never award a current verified verdict.
        await readlink(target);
        throw new Error(`Symlink target is outside the source snapshot: ${name}`);
      }
      if (!info.isFile()) throw new Error(`Submodule or non-file source is not attested: ${name}`);
      const canonical = await realpath(target);
      if ((process.platform === 'win32' ? canonical.toLowerCase() !== target.toLowerCase() : canonical !== target)) throw new Error(`Source path contains a symlink: ${name}`);
      bytes += info.size;
      if (bytes > MAX_BYTES) throw new Error('Source snapshot exceeds 256 MiB');
      hash.update(`${info.mode & 0o777}\0${info.size}\0`);
      const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const opened = await handle.stat();
        if (opened.ino !== info.ino || opened.dev !== info.dev) throw new Error('Source changed before its snapshot could be read');
        const buffer = Buffer.alloc(64 * 1024);
        let count = 0;
        while (true) {
          if (Date.now() - started > MAX_MS) throw new Error('Source snapshot time limit reached');
          const read = await handle.read(buffer, 0, buffer.length, null);
          if (!read.bytesRead) break;
          count += read.bytesRead;
          if (count > info.size) throw new Error('Source changed while its snapshot was being read');
          hash.update(buffer.subarray(0, read.bytesRead));
        }
        const after = await handle.stat();
        if (count !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) throw new Error('Source changed while its snapshot was being read');
      } finally { await handle.close(); }
      hash.update('\0'); result.fileCount += 1;
    }
    result.digest = hash.digest('hex');
  } catch (error) {
    result.reason = (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? 'Git or a source file is unavailable'
      : error instanceof Error && error.message.startsWith('Command failed:')
        ? 'A Git-visible source snapshot is unavailable for this folder'
        : error instanceof Error ? error.message : 'Source snapshot unavailable';
  }
  return result;
}
