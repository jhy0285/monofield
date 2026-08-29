// Persistent xAI OAuth token storage backed by Desktop safeStorage.
// The local JSON file contains an opaque reference only. Legacy plaintext
// files are retained if migration fails and scrubbed only after the vault
// confirms the write.

import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import {
  credentialVaultKey,
  deleteCredential,
  readCredential,
  writeCredential,
} from '../credential-vault.js';
import { hardenCredentialFile } from '../credential-file-security.js';

export interface StoredXAIToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
  scope?: string;
  savedAt: number;
}

export interface XAITokensFile {
  token?: StoredXAIToken;
}

type StoredXAITokenReference = { credentialRef?: string };
const warnedMigrationFiles = new Set<string>();

function tokensFile(dataDir: string): string {
  return path.join(dataDir, 'xai-tokens.json');
}

function tokenCredentialRef(dataDir: string): string {
  return credentialVaultKey('xai-oauth', tokensFile(dataDir), 'token');
}

function freshTokenCredentialRef(dataDir: string): string {
  return `${tokenCredentialRef(dataDir)}:v-${randomBytes(12).toString('hex')}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

export function sanitizeTokensFile(raw: unknown): XAITokensFile {
  if (!isPlainObject(raw)) return {};
  const tok = sanitizeToken(raw.token);
  return tok ? { token: tok } : {};
}

function sanitizeToken(raw: unknown): StoredXAIToken | null {
  if (!isPlainObject(raw)) return null;
  const accessToken = typeof raw.accessToken === 'string' ? raw.accessToken.trim() : '';
  if (!accessToken) return null;
  const tokenType = typeof raw.tokenType === 'string' && raw.tokenType.trim() ? raw.tokenType.trim() : 'Bearer';
  const refreshToken = typeof raw.refreshToken === 'string' && raw.refreshToken.trim() ? raw.refreshToken.trim() : undefined;
  const scope = typeof raw.scope === 'string' && raw.scope.trim() ? raw.scope.trim() : undefined;
  const expiresAt = typeof raw.expiresAt === 'number' && Number.isFinite(raw.expiresAt) ? raw.expiresAt : undefined;
  const savedAt = typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? raw.savedAt : Date.now();
  return {
    accessToken,
    tokenType,
    savedAt,
    ...(refreshToken ? { refreshToken } : {}),
    ...(scope ? { scope } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
}

async function readRawFile(dataDir: string): Promise<unknown | null> {
  try {
    await hardenCredentialFile(tokensFile(dataDir));
    return JSON.parse(await readFile(tokensFile(dataDir), 'utf8')) as unknown;
  } catch (err: unknown) {
    const e = err as { code?: string; name?: string };
    if (e.code === 'ENOENT') return null;
    if (e.name === 'SyntaxError') {
      console.error('[xai-tokens] Corrupted JSON, returning empty');
      return null;
    }
    throw err;
  }
}

function sanitizeReference(raw: unknown): StoredXAITokenReference {
  if (!isPlainObject(raw)) return {};
  const credentialRef = typeof raw.credentialRef === 'string' ? raw.credentialRef.trim() : '';
  return credentialRef ? { credentialRef } : {};
}

async function writeReferenceFile(dataDir: string, next: StoredXAITokenReference): Promise<void> {
  const file = tokensFile(dataDir);
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try { await chmod(directory, 0o700); } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOTSUP' && code !== 'EPERM' && code !== 'EINVAL') throw err;
  }
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, file);
  } catch (err: unknown) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
  await chmod(file, 0o600).catch(() => undefined);
}

export async function readTokensFile(dataDir: string): Promise<XAITokensFile> {
  const raw = await readRawFile(dataDir);
  if (raw === null) return {};
  const legacy = sanitizeTokensFile(raw);
  if (legacy.token) {
    const ref = freshTokenCredentialRef(dataDir);
    const previousRef = sanitizeReference(raw).credentialRef;
    try {
      await writeCredential(ref, JSON.stringify(legacy.token));
      await writeReferenceFile(dataDir, { credentialRef: ref });
      if (previousRef) await deleteCredential(previousRef).catch(() => undefined);
    } catch {
      await deleteCredential(ref).catch(() => undefined);
      const file = tokensFile(dataDir);
      if (!warnedMigrationFiles.has(file)) {
        warnedMigrationFiles.add(file);
        console.warn('[xai-tokens] credential migration deferred; legacy value was preserved');
      }
    }
    return legacy;
  }
  const reference = sanitizeReference(raw);
  if (!reference.credentialRef) return {};
  const stored = await readCredential(reference.credentialRef);
  if (!stored) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored) as unknown;
  } catch {
    throw new Error('stored xAI OAuth credential is invalid');
  }
  const token = sanitizeToken(parsed);
  if (!token) throw new Error('stored xAI OAuth credential is invalid');
  return { token };
}

const writeLocks = new Map<string, Promise<unknown>>();

async function withLock<T>(dataDir: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(dataDir) ?? Promise.resolve();
  const task = prev.catch(() => undefined).then(fn);
  writeLocks.set(dataDir, task);
  try {
    return await task;
  } finally {
    if (writeLocks.get(dataDir) === task) writeLocks.delete(dataDir);
  }
}

export async function getXAIToken(dataDir: string): Promise<StoredXAIToken | null> {
  return (await readTokensFile(dataDir)).token ?? null;
}

export async function setXAIToken(dataDir: string, token: StoredXAIToken): Promise<void> {
  await withLock(dataDir, async () => {
    const sanitized = sanitizeToken(token);
    if (!sanitized) throw new Error('xAI OAuth token is invalid');
    const raw = await readRawFile(dataDir);
    const previousRef = sanitizeReference(raw).credentialRef;
    const ref = freshTokenCredentialRef(dataDir);
    await writeCredential(ref, JSON.stringify(sanitized));
    try {
      await writeReferenceFile(dataDir, { credentialRef: ref });
    } catch (error) {
      await deleteCredential(ref).catch(() => undefined);
      throw error;
    }
    if (previousRef) await deleteCredential(previousRef).catch(() => undefined);
  });
}

export async function clearXAIToken(dataDir: string): Promise<void> {
  await withLock(dataDir, async () => {
    const current = await readTokensFile(dataDir);
    if (!current.token) return;
    const raw = await readRawFile(dataDir);
    const previousRef = sanitizeReference(raw).credentialRef;
    await writeReferenceFile(dataDir, {});
    if (previousRef) await deleteCredential(previousRef).catch(() => undefined);
  });
}

export function isXAITokenExpired(token: StoredXAIToken, now: number = Date.now(), skew: number = 120_000): boolean {
  return typeof token.expiresAt === 'number' ? token.expiresAt - skew <= now : false;
}
