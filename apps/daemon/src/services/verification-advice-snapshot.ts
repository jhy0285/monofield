import { createHash } from 'node:crypto';
import type { VerificationCheck, VerificationSource } from '@open-design/contracts';

/** A recommendation is bound to both Git-visible source and exact discovered commands. */
export function verificationAdviceSnapshot(projectPath: string, checks: VerificationCheck[], source: VerificationSource): string | null {
  if (!source.digest) return null;
  const catalog = checks.map(c => [c.id, c.kind, c.label, c.command, c.args, c.source, c.script, c.recommended])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash('sha256').update(JSON.stringify(['verification-advice-v1', projectPath, source.digest, catalog])).digest('hex');
}

export function assertVerificationAdviceSnapshot(expected: unknown, actual: string | null): void {
  if (expected === undefined) return;
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) {
    throw Object.assign(new Error('expectedAdviceSnapshotSha256 must be a SHA-256 digest'), { status: 400 });
  }
  if (!actual || actual !== expected) {
    throw Object.assign(new Error('Source or checks changed after the suggestion. Refresh checks and suggest again.'), { status: 409 });
  }
}
