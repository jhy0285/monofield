import { createHash } from 'node:crypto';
import path from 'node:path';

import type {
  DesktopCredentialVaultCommand,
  DesktopCredentialVaultResult,
} from '@open-design/sidecar-proto';

export type DesktopCredentialVaultBroker = (
  input: DesktopCredentialVaultCommand,
) => Promise<DesktopCredentialVaultResult>;

let broker: DesktopCredentialVaultBroker | null = null;

export class CredentialVaultUnavailableError extends Error {
  readonly code = 'DESKTOP_CREDENTIAL_VAULT_UNAVAILABLE';

  constructor(message = 'The encrypted credential vault is available only while MonoField Desktop is running.') {
    super(message);
    this.name = 'CredentialVaultUnavailableError';
  }
}

export interface CredentialVaultKeyOptions {
  /**
   * Override scope-path case handling for a known filesystem strategy.
   * Windows defaults to case-insensitive; other platforms preserve case.
   */
  caseInsensitiveScope?: boolean;
}

export function configureCredentialVaultBroker(next: DesktopCredentialVaultBroker | null): void {
  broker = next;
}

export function credentialVaultKey(
  namespace: string,
  scopePath: string,
  id: string,
  options: CredentialVaultKeyOptions = {},
): string {
  const caseInsensitiveScope = options.caseInsensitiveScope ?? process.platform === 'win32';
  const resolvedScope = path.resolve(scopePath);
  const scope = createHash('sha256')
    .update(caseInsensitiveScope ? resolvedScope.toLowerCase() : resolvedScope)
    .digest('hex')
    .slice(0, 24);
  const safeNamespace = namespace.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 48);
  const safeId = id.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 96);
  return `${safeNamespace}:${scope}:${safeId}`;
}

/**
 * Key format used before scope paths became case-sensitive on non-Windows platforms.
 * Persisted metadata keeps using its opaque reference; this helper lets migrations
 * explicitly probe the historical key when a reference must be reconstructed.
 */
export function legacyCredentialVaultKey(namespace: string, scopePath: string, id: string): string {
  return credentialVaultKey(namespace, scopePath, id, { caseInsensitiveScope: true });
}

/** Current key first, followed by the historical lower-cased key when distinct. */
export function credentialVaultKeyCandidates(namespace: string, scopePath: string, id: string): readonly string[] {
  const current = credentialVaultKey(namespace, scopePath, id);
  const legacy = legacyCredentialVaultKey(namespace, scopePath, id);
  return current === legacy ? [current] : [current, legacy];
}

function requireBroker(): DesktopCredentialVaultBroker {
  if (!broker) throw new CredentialVaultUnavailableError();
  return broker;
}

export async function credentialVaultAvailable(): Promise<boolean> {
  if (!broker) return false;
  try {
    const result = await broker({ action: 'available' });
    return result.action === 'available' && result.available;
  } catch {
    return false;
  }
}

export async function readCredential(key: string): Promise<string | null> {
  const result = await requireBroker()({ action: 'get', key });
  if (result.action !== 'get') throw new CredentialVaultUnavailableError('The credential vault returned an invalid response.');
  return result.value;
}

export async function writeCredential(key: string, value: string): Promise<void> {
  const result = await requireBroker()({ action: 'set', key, value });
  if (result.action !== 'set' || !result.stored) {
    throw new CredentialVaultUnavailableError('The credential vault did not confirm the write.');
  }
}

export async function deleteCredential(key: string): Promise<void> {
  const result = await requireBroker()({ action: 'delete', key });
  if (result.action !== 'delete') throw new CredentialVaultUnavailableError('The credential vault returned an invalid response.');
}
