import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  credentialVaultKey,
  deleteCredential,
  readCredential,
  writeCredential,
} from '../credential-vault.js';
import { hardenCredentialFileSync } from '../credential-file-security.js';

export interface ComposioConfig {
  authConfigIds: Record<string, string>;
}

export interface PublicComposioConfig {
  configured: boolean;
  apiKeyTail: string;
}

type StoredComposioConfig = ComposioConfig & {
  /** Legacy plaintext field. Preserved only when vault migration fails. */
  apiKey?: string;
  apiKeyTail?: string;
  credentialRef?: string;
};

let configFilePath = path.join(process.cwd(), '.od', 'connectors', 'composio-config.json');
const warnedMigrationPaths = new Set<string>();

export function configureComposioConfigStore(dataDir: string): void {
  configFilePath = path.join(dataDir, 'connectors', 'composio-config.json');
}

function composioCredentialRef(): string {
  return credentialVaultKey('composio', configFilePath, 'api-key');
}

function freshComposioCredentialRef(): string {
  return `${composioCredentialRef()}:v-${randomBytes(12).toString('hex')}`;
}

/** Non-secret metadata only. Call resolveComposioApiKey for authenticated work. */
export function readComposioConfig(): ComposioConfig {
  return { authConfigIds: readStoredConfig().authConfigIds };
}

export function hasStoredComposioApiKey(): boolean {
  const config = readStoredConfig();
  return Boolean(config.apiKey || config.credentialRef);
}

async function migrateLegacyConfig(): Promise<StoredComposioConfig> {
  const prior = readStoredConfig();
  const legacy = prior.apiKey?.trim();
  if (!legacy) return prior;
  const credentialRef = freshComposioCredentialRef();
  try {
    await writeCredential(credentialRef, legacy);
    const next: StoredComposioConfig = {
      credentialRef,
      apiKeyTail: legacy.slice(-4),
      authConfigIds: prior.authConfigIds,
    };
    writeRawConfig(next);
    if (prior.credentialRef) await deleteCredential(prior.credentialRef).catch(() => undefined);
    return next;
  } catch {
    await deleteCredential(credentialRef).catch(() => undefined);
    if (!warnedMigrationPaths.has(configFilePath)) {
      warnedMigrationPaths.add(configFilePath);
      console.warn('[composio-config] credential migration deferred; legacy value was preserved');
    }
    return prior;
  }
}

export async function resolveComposioApiKey(): Promise<string> {
  const config = await migrateLegacyConfig();
  if (config.apiKey) return config.apiKey;
  if (!config.credentialRef) return '';
  return (await readCredential(config.credentialRef)) ?? '';
}

export async function readPublicComposioConfig(): Promise<PublicComposioConfig> {
  const config = await migrateLegacyConfig();
  return {
    configured: Boolean(config.apiKey || config.credentialRef),
    apiKeyTail: config.apiKeyTail || config.apiKey?.slice(-4) || '',
  };
}

export async function writeComposioConfig(input: unknown): Promise<PublicComposioConfig> {
  const priorStored = await migrateLegacyConfig();
  const priorApiKey = priorStored.apiKey
    || (priorStored.credentialRef ? ((await readCredential(priorStored.credentialRef)) ?? '') : '');
  const record = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const hasApiKey = Object.prototype.hasOwnProperty.call(record, 'apiKey');
  const hasAuthConfigIds = Object.prototype.hasOwnProperty.call(record, 'authConfigIds');
  const apiKeyInput = normalizeOptionalString(record.apiKey) ?? '';
  const nextApiKey = hasApiKey ? apiKeyInput : priorApiKey;
  const apiKeyChanged = priorApiKey !== nextApiKey;
  const nextAuthConfigIds = apiKeyChanged
    ? {}
    : hasAuthConfigIds
      ? normalizeAuthConfigIds(record.authConfigIds)
      : priorStored.authConfigIds;
  const credentialRef = nextApiKey
    ? (apiKeyChanged || !priorStored.credentialRef ? freshComposioCredentialRef() : priorStored.credentialRef)
    : undefined;
  let stagedRef: string | undefined;

  if (credentialRef && (apiKeyChanged || !priorStored.credentialRef)) {
    // Store first. A failure leaves the legacy/non-secret file untouched.
    await writeCredential(credentialRef, nextApiKey);
    stagedRef = credentialRef;
  }
  const next: StoredComposioConfig = {
    ...(credentialRef ? { credentialRef, apiKeyTail: nextApiKey.slice(-4) } : {}),
    authConfigIds: nextAuthConfigIds,
  };
  try {
    writeRawConfig(next);
  } catch (error) {
    if (stagedRef) await deleteCredential(stagedRef).catch(() => undefined);
    throw error;
  }
  if (priorStored.credentialRef && priorStored.credentialRef !== credentialRef) {
    await deleteCredential(priorStored.credentialRef).catch(() => undefined);
  }
  return { configured: Boolean(credentialRef), apiKeyTail: next.apiKeyTail ?? '' };
}

export function setComposioAuthConfigId(connectorId: string, authConfigId: string): void {
  const normalizedConnectorId = normalizeOptionalString(connectorId);
  const normalizedAuthConfigId = normalizeOptionalString(authConfigId);
  if (!normalizedConnectorId || !normalizedAuthConfigId) return;
  const prior = readStoredConfig();
  writeRawConfig({
    ...prior,
    authConfigIds: {
      ...prior.authConfigIds,
      [normalizedConnectorId]: normalizedAuthConfigId,
    },
  });
}

export function deleteComposioAuthConfigId(connectorId: string): void {
  const normalizedConnectorId = normalizeOptionalString(connectorId);
  if (!normalizedConnectorId) return;
  const prior = readStoredConfig();
  if (prior.authConfigIds[normalizedConnectorId] === undefined) return;
  const authConfigIds = { ...prior.authConfigIds };
  delete authConfigIds[normalizedConnectorId];
  writeRawConfig({ ...prior, authConfigIds });
}

function readRawConfig(): unknown {
  try {
    hardenCredentialFileSync(configFilePath);
    return JSON.parse(fs.readFileSync(configFilePath, 'utf8')) as unknown;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return {};
    throw error;
  }
}

function readStoredConfig(): StoredComposioConfig {
  const raw = readRawConfig();
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const apiKey = normalizeOptionalString(record.apiKey);
  const credentialRef = normalizeOptionalString(record.credentialRef);
  const apiKeyTail = normalizeOptionalString(record.apiKeyTail)?.slice(-4);
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(credentialRef ? { credentialRef } : {}),
    ...(apiKeyTail ? { apiKeyTail } : {}),
    authConfigIds: normalizeAuthConfigIds(record.authConfigIds),
  };
}

function writeRawConfig(config: StoredComposioConfig): void {
  const directory = path.dirname(configFilePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOTSUP' && code !== 'EPERM' && code !== 'EINVAL') throw error;
  }
  const tempPath = `${configFilePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, configFilePath);
  try { fs.chmodSync(configFilePath, 0o600); } catch { /* temp was created 0600 */ }
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeAuthConfigIds(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const next: Record<string, string> = {};
  for (const [connectorId, authConfigId] of Object.entries(value as Record<string, unknown>)) {
    const normalizedConnectorId = normalizeOptionalString(connectorId);
    const normalizedAuthConfigId = normalizeOptionalString(authConfigId);
    if (normalizedConnectorId && normalizedAuthConfigId) next[normalizedConnectorId] = normalizedAuthConfigId;
  }
  return next;
}
