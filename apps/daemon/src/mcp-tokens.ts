// Persistent OAuth-token storage for external HTTP / SSE MCP servers.
//
// Secret material lives in the Desktop safeStorage-backed credential vault.
// The daemon-side JSON file contains opaque references only. Legacy plaintext
// files are migrated vault-first and scrubbed only after every write succeeds.

import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import {
  credentialVaultKey,
  deleteCredential,
  readCredential,
  writeCredential,
} from './credential-vault.js';
import { hardenCredentialFile } from './credential-file-security.js';

export interface StoredMcpToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
  scope?: string;
  savedAt: number;
  tokenEndpoint?: string;
  clientId?: string;
  clientSecret?: string;
  authServerIssuer?: string;
  redirectUri?: string;
  resourceUrl?: string;
}

export interface McpTokensFile {
  servers: Record<string, StoredMcpToken>;
}

type StoredTokenReference = { credentialRef: string };
type StoredTokenReferencesFile = { servers: Record<string, StoredTokenReference> };

const EMPTY: McpTokensFile = { servers: {} };
const warnedMigrationFiles = new Set<string>();

function tokensFile(dataDir: string): string {
  return path.join(dataDir, 'mcp-tokens.json');
}

function tokenCredentialRef(dataDir: string, serverId: string): string {
  return credentialVaultKey('mcp-oauth', tokensFile(dataDir), serverId);
}

function freshTokenCredentialRef(dataDir: string, serverId: string): string {
  return `${tokenCredentialRef(dataDir, serverId)}:v-${randomBytes(12).toString('hex')}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

export function sanitizeTokensFile(raw: unknown): McpTokensFile {
  if (!isPlainObject(raw)) return { servers: {} };
  const servers = raw.servers;
  if (!isPlainObject(servers)) return { servers: {} };
  const out: Record<string, StoredMcpToken> = {};
  for (const [id, value] of Object.entries(servers)) {
    if (id === '__proto__' || id === 'constructor') continue;
    const tok = sanitizeToken(value);
    if (tok) out[id] = tok;
  }
  return { servers: out };
}

function sanitizeToken(raw: unknown): StoredMcpToken | null {
  if (!isPlainObject(raw)) return null;
  const accessToken = typeof raw.accessToken === 'string' ? raw.accessToken.trim() : '';
  if (!accessToken) return null;
  const tokenType = typeof raw.tokenType === 'string' && raw.tokenType.trim() ? raw.tokenType.trim() : 'Bearer';
  const refreshToken = typeof raw.refreshToken === 'string' && raw.refreshToken.trim() ? raw.refreshToken.trim() : undefined;
  const scope = typeof raw.scope === 'string' && raw.scope.trim() ? raw.scope.trim() : undefined;
  const expiresAt = typeof raw.expiresAt === 'number' && Number.isFinite(raw.expiresAt) ? raw.expiresAt : undefined;
  const savedAt = typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? raw.savedAt : Date.now();
  const tokenEndpoint = typeof raw.tokenEndpoint === 'string' && raw.tokenEndpoint.trim() ? raw.tokenEndpoint.trim() : undefined;
  const clientId = typeof raw.clientId === 'string' && raw.clientId.trim() ? raw.clientId.trim() : undefined;
  const clientSecret = typeof raw.clientSecret === 'string' && raw.clientSecret.trim() ? raw.clientSecret.trim() : undefined;
  const authServerIssuer = typeof raw.authServerIssuer === 'string' && raw.authServerIssuer.trim() ? raw.authServerIssuer.trim() : undefined;
  const redirectUri = typeof raw.redirectUri === 'string' && raw.redirectUri.trim() ? raw.redirectUri.trim() : undefined;
  const resourceUrl = typeof raw.resourceUrl === 'string' && raw.resourceUrl.trim() ? raw.resourceUrl.trim() : undefined;
  return {
    accessToken,
    tokenType,
    savedAt,
    ...(refreshToken ? { refreshToken } : {}),
    ...(scope ? { scope } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(tokenEndpoint ? { tokenEndpoint } : {}),
    ...(clientId ? { clientId } : {}),
    ...(clientSecret ? { clientSecret } : {}),
    ...(authServerIssuer ? { authServerIssuer } : {}),
    ...(redirectUri ? { redirectUri } : {}),
    ...(resourceUrl ? { resourceUrl } : {}),
  };
}

function sanitizeReferenceFile(raw: unknown): StoredTokenReferencesFile {
  if (!isPlainObject(raw) || !isPlainObject(raw.servers)) return { servers: {} };
  const servers: Record<string, StoredTokenReference> = {};
  for (const [id, value] of Object.entries(raw.servers)) {
    if (id === '__proto__' || id === 'constructor' || !isPlainObject(value)) continue;
    const credentialRef = typeof value.credentialRef === 'string' ? value.credentialRef.trim() : '';
    if (credentialRef) servers[id] = { credentialRef };
  }
  return { servers };
}

async function readRawFile(dataDir: string): Promise<unknown | null> {
  try {
    await hardenCredentialFile(tokensFile(dataDir));
    return JSON.parse(await readFile(tokensFile(dataDir), 'utf8')) as unknown;
  } catch (err: unknown) {
    const e = err as { code?: string; name?: string };
    if (e.code === 'ENOENT') return null;
    if (e.name === 'SyntaxError') {
      console.error('[mcp-tokens] Corrupted JSON, returning empty');
      return null;
    }
    throw err;
  }
}

async function writeReferenceFile(dataDir: string, next: StoredTokenReferencesFile): Promise<void> {
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

async function persistAllToVault(
  dataDir: string,
  tokens: Record<string, StoredMcpToken>,
  stagedRefs: string[],
): Promise<StoredTokenReferencesFile> {
  const servers: Record<string, StoredTokenReference> = {};
  for (const [serverId, token] of Object.entries(tokens)) {
    const ref = freshTokenCredentialRef(dataDir, serverId);
    await writeCredential(ref, JSON.stringify(token));
    stagedRefs.push(ref);
    servers[serverId] = { credentialRef: ref };
  }
  return { servers };
}

async function replaceTokenReferences(
  dataDir: string,
  tokens: Record<string, StoredMcpToken>,
  prior: StoredTokenReferencesFile,
): Promise<StoredTokenReferencesFile> {
  let next: StoredTokenReferencesFile = { servers: {} };
  const stagedRefs: string[] = [];
  try {
    next = await persistAllToVault(dataDir, tokens, stagedRefs);
    await writeReferenceFile(dataDir, next);
  } catch (error) {
    await Promise.all(stagedRefs.map((ref) => deleteCredential(ref).catch(() => undefined)));
    throw error;
  }
  const retained = new Set(Object.values(next.servers).map(({ credentialRef }) => credentialRef));
  const stale = Object.values(prior.servers)
    .map(({ credentialRef }) => credentialRef)
    .filter((ref) => !retained.has(ref));
  await Promise.all(stale.map((ref) => deleteCredential(ref).catch(() => undefined)));
  return next;
}

async function resolveReferences(references: StoredTokenReferencesFile): Promise<McpTokensFile> {
  const servers: Record<string, StoredMcpToken> = {};
  for (const [serverId, reference] of Object.entries(references.servers)) {
    const raw = await readCredential(reference.credentialRef);
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new Error('stored MCP OAuth credential is invalid');
    }
    const token = sanitizeToken(parsed);
    if (!token) throw new Error('stored MCP OAuth credential is invalid');
    servers[serverId] = token;
  }
  return { servers };
}

export async function readTokensFile(dataDir: string): Promise<McpTokensFile> {
  const raw = await readRawFile(dataDir);
  if (raw === null) return { ...EMPTY, servers: {} };
  const legacy = sanitizeTokensFile(raw);
  if (Object.keys(legacy.servers).length > 0) {
    try {
      await replaceTokenReferences(dataDir, legacy.servers, sanitizeReferenceFile(raw));
    } catch {
      const file = tokensFile(dataDir);
      if (!warnedMigrationFiles.has(file)) {
        warnedMigrationFiles.add(file);
        console.warn('[mcp-tokens] credential migration deferred; legacy values were preserved');
      }
    }
    return legacy;
  }
  return await resolveReferences(sanitizeReferenceFile(raw));
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

export async function getToken(dataDir: string, serverId: string): Promise<StoredMcpToken | null> {
  return (await readTokensFile(dataDir)).servers[serverId] ?? null;
}

export async function setToken(dataDir: string, serverId: string, token: StoredMcpToken): Promise<void> {
  await withLock(dataDir, async () => {
    const sanitized = sanitizeToken(token);
    if (!sanitized) throw new Error('MCP OAuth token is invalid');
    const current = await readTokensFile(dataDir);
    const priorReferences = sanitizeReferenceFile(await readRawFile(dataDir));
    current.servers[serverId] = sanitized;
    await replaceTokenReferences(dataDir, current.servers, priorReferences);
  });
}

export async function clearToken(dataDir: string, serverId: string): Promise<void> {
  await withLock(dataDir, async () => {
    const current = await readTokensFile(dataDir);
    const priorReferences = sanitizeReferenceFile(await readRawFile(dataDir));
    if (!(serverId in current.servers)) return;
    delete current.servers[serverId];
    await replaceTokenReferences(dataDir, current.servers, priorReferences);
  });
}

export async function readAllTokens(dataDir: string): Promise<Record<string, StoredMcpToken>> {
  return (await readTokensFile(dataDir)).servers;
}

export function isTokenExpired(token: StoredMcpToken, now: number = Date.now(), skew: number = 30_000): boolean {
  return typeof token.expiresAt === 'number' ? token.expiresAt - skew <= now : false;
}
