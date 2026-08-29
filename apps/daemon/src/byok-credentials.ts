import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  STORED_BYOK_API_KEY,
  type PublicByokCredentialsResponse,
  type SaveByokCredentialsRequest,
} from '@open-design/contracts';

import {
  credentialVaultKey,
  deleteCredential,
  readCredential,
  writeCredential,
} from './credential-vault.js';

type StoredEntry = { credentialRef: string; apiKeyTail?: string };
type StoredDocument = { credentials: Record<string, StoredEntry> };

const PROTOCOL_PATTERN = /^[a-z][a-z0-9_-]{0,47}$/;
const writeLocks = new Map<string, Promise<unknown>>();

function filePath(dataDir: string): string {
  return path.join(dataDir, 'byok-credentials.json');
}

function credentialRef(dataDir: string, protocol: string): string {
  return credentialVaultKey('byok', filePath(dataDir), protocol);
}

function freshCredentialRef(dataDir: string, protocol: string): string {
  return `${credentialRef(dataDir, protocol)}:v-${randomBytes(12).toString('hex')}`;
}

function normalizeProtocol(value: string): string {
  const protocol = value.trim().toLowerCase();
  if (!PROTOCOL_PATTERN.test(protocol)) throw new Error('invalid BYOK protocol');
  return protocol;
}

async function readDocument(dataDir: string): Promise<StoredDocument> {
  try {
    const parsed = JSON.parse(await readFile(filePath(dataDir), 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { credentials: {} };
    const raw = (parsed as { credentials?: unknown }).credentials;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { credentials: {} };
    const credentials: Record<string, StoredEntry> = {};
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!PROTOCOL_PATTERN.test(id) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      const ref = typeof record.credentialRef === 'string' ? record.credentialRef.trim() : '';
      if (!ref) continue;
      const tail = typeof record.apiKeyTail === 'string' ? record.apiKeyTail.slice(-4) : '';
      credentials[id] = { credentialRef: ref, ...(tail ? { apiKeyTail: tail } : {}) };
    }
    return { credentials };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { credentials: {} };
    throw new Error('BYOK credential metadata could not be read');
  }
}

async function writeDocument(dataDir: string, document: StoredDocument): Promise<void> {
  const file = filePath(dataDir);
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await chmod(directory, 0o700);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOTSUP' && code !== 'EPERM' && code !== 'EINVAL') throw error;
  }
  const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify(document, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, file);
  try {
    await chmod(file, 0o600);
  } catch {
    // The temp file was created 0600; chmod is defense in depth only.
  }
}

async function withLock<T>(dataDir: string, operation: () => Promise<T>): Promise<T> {
  const prior = writeLocks.get(dataDir) ?? Promise.resolve();
  const task = prior.catch(() => undefined).then(operation);
  writeLocks.set(dataDir, task);
  try {
    return await task;
  } finally {
    if (writeLocks.get(dataDir) === task) writeLocks.delete(dataDir);
  }
}

export async function readPublicByokCredentials(dataDir: string): Promise<PublicByokCredentialsResponse> {
  const document = await readDocument(dataDir);
  return {
    credentials: Object.fromEntries(
      Object.entries(document.credentials).map(([protocol, entry]) => [
        protocol,
        { configured: true, apiKeyTail: entry.apiKeyTail ?? '' },
      ]),
    ),
  };
}

export async function writeByokCredentials(
  dataDir: string,
  input: SaveByokCredentialsRequest,
): Promise<PublicByokCredentialsResponse> {
  return await withLock(dataDir, async () => {
    const prior = await readDocument(dataDir);
    const next: StoredDocument = { credentials: { ...prior.credentials } };
    const refsToDelete: string[] = [];
    const stagedRefs: string[] = [];
    let changed = false;

    try {
      for (const [rawProtocol, rawValue] of Object.entries(input.credentials ?? {})) {
        const protocol = normalizeProtocol(rawProtocol);
        if (typeof rawValue !== 'string') throw new Error('BYOK API key must be a string');
        if (rawValue === STORED_BYOK_API_KEY) continue;
        const value = rawValue.trim();
        const previous = prior.credentials[protocol];
        if (!value) {
          if (previous) {
            delete next.credentials[protocol];
            refsToDelete.push(previous.credentialRef);
            changed = true;
          }
          continue;
        }
        const ref = freshCredentialRef(dataDir, protocol);
        // Use a fresh immutable ref. A failed write or metadata rename leaves
        // the prior reference and its last-known-good secret untouched.
        await writeCredential(ref, value);
        stagedRefs.push(ref);
        if (previous) refsToDelete.push(previous.credentialRef);
        next.credentials[protocol] = { credentialRef: ref, apiKeyTail: value.slice(-4) };
        changed = true;
      }

      // Settings autosave may send the stored sentinel repeatedly. Avoid an
      // otherwise unnecessary metadata fsync/rename on every unchanged save.
      if (changed) await writeDocument(dataDir, next);
    } catch (error) {
      await Promise.all(stagedRefs.map((ref) => deleteCredential(ref).catch(() => undefined)));
      throw error;
    }
    await Promise.all(refsToDelete.map((ref) => deleteCredential(ref).catch(() => undefined)));
    return await readPublicByokCredentials(dataDir);
  });
}

export async function resolveByokApiKey(
  dataDir: string,
  protocol: string,
  supplied: unknown,
): Promise<string> {
  if (typeof supplied === 'string' && supplied !== STORED_BYOK_API_KEY) return supplied.trim();
  if (supplied !== STORED_BYOK_API_KEY) return '';
  const normalized = normalizeProtocol(protocol);
  const entry = (await readDocument(dataDir)).credentials[normalized];
  if (!entry) return '';
  return (await readCredential(entry.credentialRef))?.trim() ?? '';
}
