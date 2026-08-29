import { chmodSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

// Legacy releases persisted some credentials directly in JSON. Tighten both
// the containing directory and file before reading/migrating them so a vault
// outage does not leave the compatibility copy group/world-readable on POSIX.
// Windows and some network volumes do not implement POSIX mode bits; those
// failures are intentionally best-effort because the subsequent vault-first
// migration remains the authoritative protection and must not destroy data.
export async function hardenCredentialFile(file: string): Promise<void> {
  await Promise.all([
    fsp.chmod(path.dirname(file), 0o700).catch(() => undefined),
    fsp.chmod(file, 0o600).catch(() => undefined),
  ]);
}

export function hardenCredentialFileSync(file: string): void {
  try { chmodSync(path.dirname(file), 0o700); } catch { /* chmod-less volume */ }
  try { chmodSync(file, 0o600); } catch { /* missing file or chmod-less volume */ }
}
