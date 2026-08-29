import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import type { BoundedJsonObject, BoundedJsonValue } from '../live-artifacts/schema.js';
import {
  credentialVaultKey,
  deleteCredential,
  readCredential,
  writeCredential,
} from '../credential-vault.js';
import { hardenCredentialFileSync } from '../credential-file-security.js';

import {
  classifyConnectorToolSafety,
  connectorDefinitionToDetail,
  type ConnectorDetail,
  type ConnectorCatalogDefinition,
  type ConnectorCatalogToolDefinition,
  type ConnectorToolSafety,
  type ConnectorStatus,
} from './catalog.js';
import { composioConnectorProvider, getStaticComposioCatalogDefinitions, type ComposioAuthConfigPrepareResult, type ComposioConnectionStart } from './composio.js';

export interface ConnectorExecuteRequest {
  connectorId: string;
  toolName: string;
  input: BoundedJsonObject;
  expectedAccountLabel?: string;
}

export interface ConnectorExecuteResponse {
  ok: true;
  connectorId: string;
  accountLabel?: string;
  toolName: string;
  safety: ConnectorCatalogDefinition['tools'][number]['safety'];
  output: BoundedJsonValue;
  outputSummary?: string;
  metadata?: BoundedJsonObject;
}

export interface ConnectorConnectResult {
  connector: ConnectorDetail;
  auth?: Pick<ComposioConnectionStart, 'kind' | 'redirectUrl' | 'providerConnectionId' | 'expiresAt'>;
}

export interface ConnectorAuthConfigPrepareResponse {
  results: Record<string, ComposioAuthConfigPrepareResult>;
}

type PublicComposioConnectionStart = Pick<ComposioConnectionStart, 'kind' | 'redirectUrl' | 'providerConnectionId' | 'expiresAt'>;

function publicComposioAuthStart(auth: ComposioConnectionStart): PublicComposioConnectionStart {
  return {
    kind: auth.kind,
    ...(auth.redirectUrl === undefined ? {} : { redirectUrl: auth.redirectUrl }),
    ...(auth.providerConnectionId === undefined ? {} : { providerConnectionId: auth.providerConnectionId }),
    ...(auth.expiresAt === undefined ? {} : { expiresAt: auth.expiresAt }),
  };
}

function isMissingOrExpiredComposioOAuthState(error: unknown): boolean {
  return error instanceof ConnectorServiceError
    && error.code === 'CONNECTOR_EXECUTION_FAILED'
    && error.message === 'Composio OAuth state is missing or expired';
}

function boundedJsonValueIncludesAuthStaleSignal(value: BoundedJsonValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'number') return value === 401;
  if (typeof value === 'boolean') return false;
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    return normalized === '401'
      || /\bbad credentials\b/.test(normalized)
      || /\bunauthori[sz]ed\b/.test(normalized)
      || /\binvalid (?:access )?token\b/.test(normalized)
      || /\btoken (?:is )?expired\b/.test(normalized)
      || /\bexpired (?:access )?token\b/.test(normalized);
  }
  if (Array.isArray(value)) return value.some(boundedJsonValueIncludesAuthStaleSignal);
  return Object.values(value).some(boundedJsonValueIncludesAuthStaleSignal);
}

function isConnectorAuthStaleError(error: unknown, request: Pick<ConnectorExecuteRequest, 'connectorId' | 'toolName'>): boolean {
  if (!(error instanceof ConnectorServiceError) || error.code !== 'CONNECTOR_EXECUTION_FAILED') return false;
  const details = error.details;
  return details?.connectorId === request.connectorId
    && details.toolName === request.toolName
    && boundedJsonValueIncludesAuthStaleSignal(details.error);
}

function connectorAuthExpiredMessage(definition: ConnectorCatalogDefinition): string {
  return `${definition.name} authorization expired. Reconnect ${definition.name}.`;
}

function hasStoredComposioConnection(credential: ConnectorCredentialRecord | undefined, providerConnectionId: string): boolean {
  return credential?.credentials.provider === 'composio'
    && credential.credentials.providerConnectionId === providerConnectionId;
}

export type ConnectorServiceErrorCode =
  | 'CONNECTOR_NOT_FOUND'
  | 'CONNECTOR_AUTH_CONFIG_REQUIRED'
  | 'CONNECTOR_NOT_CONNECTED'
  | 'CONNECTOR_DISABLED'
  | 'CONNECTOR_TOOL_NOT_FOUND'
  | 'CONNECTOR_SAFETY_DENIED'
  | 'CONNECTOR_INPUT_SCHEMA_MISMATCH'
  | 'CONNECTOR_RATE_LIMITED'
  | 'CONNECTOR_OUTPUT_TOO_LARGE'
  | 'CONNECTOR_EXECUTION_FAILED';

export class ConnectorServiceError extends Error {
  constructor(
    readonly code: ConnectorServiceErrorCode,
    message: string,
    readonly status: number,
    readonly details?: BoundedJsonObject,
  ) {
    super(message);
    this.name = 'ConnectorServiceError';
  }
}

export interface ConnectorConnectionStatus {
  status: ConnectorStatus;
  accountLabel?: string;
  lastError?: string;
}

export interface ConnectorConnectionRecord extends ConnectorConnectionStatus {
  updatedAt: string;
}

export interface ConnectorDiscoveryResult {
  connectors: ConnectorDetail[];
  meta?: {
    provider: 'composio';
    refreshRequested?: boolean;
  };
}

export type ConnectorCredentialMaterial = Record<string, unknown>;

export interface ConnectorCredentialRecord {
  schemaVersion: 1;
  connectorId: string;
  accountLabel: string;
  credentials: ConnectorCredentialMaterial;
  updatedAt: string;
}

export interface ConnectorCredentialStore {
  getSummary(connectorId: string): Omit<ConnectorCredentialRecord, 'credentials'> | undefined;
  get(connectorId: string): Promise<ConnectorCredentialRecord | undefined>;
  set(record: ConnectorCredentialRecord): Promise<void>;
  delete(connectorId: string): Promise<void>;
  deleteByProvider(provider: string): Promise<string[]>;
}

export interface ConnectorStatusServiceOptions {
  initialStatuses?: Record<string, ConnectorConnectionStatus>;
  credentialStore?: ConnectorCredentialStore;
}

const LOCAL_CONNECTOR_ACCOUNT_LABELS: Record<string, string> = {};

function nowIso(): string {
  return new Date().toISOString();
}

function cloneCredentialMaterial(credentials: ConnectorCredentialMaterial): ConnectorCredentialMaterial {
  return JSON.parse(JSON.stringify(credentials)) as ConnectorCredentialMaterial;
}

export class InMemoryConnectorCredentialStore implements ConnectorCredentialStore {
  private readonly records = new Map<string, ConnectorCredentialRecord>();

  getSummary(connectorId: string): Omit<ConnectorCredentialRecord, 'credentials'> | undefined {
    const record = this.records.get(connectorId);
    if (!record) return undefined;
    const { credentials: _credentials, ...summary } = record;
    return { ...summary };
  }

  async get(connectorId: string): Promise<ConnectorCredentialRecord | undefined> {
    const record = this.records.get(connectorId);
    return record === undefined ? undefined : { ...record, credentials: cloneCredentialMaterial(record.credentials) };
  }

  async set(record: ConnectorCredentialRecord): Promise<void> {
    this.records.set(record.connectorId, { ...record, credentials: cloneCredentialMaterial(record.credentials) });
  }

  async delete(connectorId: string): Promise<void> {
    this.records.delete(connectorId);
  }

  async deleteByProvider(provider: string): Promise<string[]> {
    const deleted: string[] = [];
    for (const [connectorId, record] of this.records.entries()) {
      if (record.credentials.provider === provider) {
        this.records.delete(connectorId);
        deleted.push(connectorId);
      }
    }
    return deleted;
  }
}

type StoredConnectorCredentialRecord = Omit<ConnectorCredentialRecord, 'credentials'> & {
  /** Legacy plaintext material. Removed only after a confirmed vault write. */
  credentials?: ConnectorCredentialMaterial;
  credentialRef?: string;
  provider?: string;
};

export class FileConnectorCredentialStore implements ConnectorCredentialStore {
  private readonly filePath: string;
  private readonly warnedMigrations = new Set<string>();

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'connectors', 'credentials.json');
  }

  getSummary(connectorId: string): Omit<ConnectorCredentialRecord, 'credentials'> | undefined {
    const record = this.readRecords()[connectorId];
    if (!record) return undefined;
    return {
      schemaVersion: 1,
      connectorId: record.connectorId,
      accountLabel: record.accountLabel,
      updatedAt: record.updatedAt,
    };
  }

  async get(connectorId: string): Promise<ConnectorCredentialRecord | undefined> {
    const records = await this.migrateLegacyRecords(this.readRecords());
    const stored = records[connectorId];
    if (!stored) return undefined;
    if (stored.credentials) {
      return this.materialize(stored, stored.credentials);
    }
    if (!records[connectorId]?.credentialRef) return undefined;
    const raw = await readCredential(records[connectorId]!.credentialRef!);
    if (!raw) return undefined;
    let credentials: ConnectorCredentialMaterial;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid connector credential');
      credentials = cloneCredentialMaterial(parsed as ConnectorCredentialMaterial);
    } catch {
      throw new Error('stored connector credential is invalid');
    }
    return this.materialize(records[connectorId]!, credentials);
  }

  async set(record: ConnectorCredentialRecord): Promise<void> {
    const records = await this.migrateLegacyRecords(this.readRecords());
    if (Object.values(records).some((entry) => entry.credentials)) {
      throw new Error('legacy connector credentials could not be migrated atomically');
    }
    const priorRef = records[record.connectorId]?.credentialRef;
    const ref = this.freshCredentialRef(record.connectorId);
    await writeCredential(ref, JSON.stringify(record.credentials));
    records[record.connectorId] = {
      schemaVersion: 1,
      connectorId: record.connectorId,
      accountLabel: record.accountLabel,
      updatedAt: record.updatedAt,
      credentialRef: ref,
      provider: typeof record.credentials.provider === 'string' ? record.credentials.provider : '',
    };
    try {
      this.writeRecords(records);
    } catch (error) {
      await deleteCredential(ref).catch(() => undefined);
      throw error;
    }
    if (priorRef) await deleteCredential(priorRef).catch(() => undefined);
  }

  async delete(connectorId: string): Promise<void> {
    const records = this.readRecords();
    if (records[connectorId] === undefined) return;
    const ref = records[connectorId]?.credentialRef;
    delete records[connectorId];
    this.writeRecords(records);
    if (ref) await deleteCredential(ref).catch(() => undefined);
  }

  async deleteByProvider(provider: string): Promise<string[]> {
    const records = this.readRecords();
    let changed = false;
    const deleted: string[] = [];
    const refs: string[] = [];
    for (const [connectorId, record] of Object.entries(records)) {
      const storedProvider = record.provider || (typeof record.credentials?.provider === 'string' ? record.credentials.provider : '');
      if (storedProvider === provider) {
        if (record.credentialRef) refs.push(record.credentialRef);
        delete records[connectorId];
        changed = true;
        deleted.push(connectorId);
      }
    }
    if (changed) this.writeRecords(records);
    await Promise.all(refs.map((ref) => deleteCredential(ref).catch(() => undefined)));
    return deleted;
  }

  private credentialRef(connectorId: string): string {
    return credentialVaultKey('connector', this.filePath, connectorId);
  }

  private freshCredentialRef(connectorId: string): string {
    return `${this.credentialRef(connectorId)}:v-${randomBytes(12).toString('hex')}`;
  }

  private async migrateLegacyRecords(
    records: Record<string, StoredConnectorCredentialRecord>,
  ): Promise<Record<string, StoredConnectorCredentialRecord>> {
    const legacy = Object.entries(records).filter(([, record]) => Boolean(record.credentials));
    if (legacy.length === 0) return records;
    const next = { ...records };
    const stagedRefs: string[] = [];
    const replacedRefs: string[] = [];
    try {
      for (const [connectorId, stored] of legacy) {
        const ref = this.freshCredentialRef(connectorId);
        await writeCredential(ref, JSON.stringify(stored.credentials));
        stagedRefs.push(ref);
        if (stored.credentialRef) replacedRefs.push(stored.credentialRef);
        next[connectorId] = {
          ...stored,
          credentialRef: ref,
          provider: String(stored.credentials?.provider ?? ''),
        };
        delete next[connectorId]!.credentials;
      }
      this.writeRecords(next);
      await Promise.all(replacedRefs.map((ref) => deleteCredential(ref).catch(() => undefined)));
      return next;
    } catch {
      await Promise.all(stagedRefs.map((ref) => deleteCredential(ref).catch(() => undefined)));
      for (const [connectorId] of legacy) {
        if (this.warnedMigrations.has(connectorId)) continue;
        this.warnedMigrations.add(connectorId);
        console.warn(`[connectors] credential migration deferred for ${connectorId}; legacy value was preserved`);
      }
      return records;
    }
  }

  private materialize(record: StoredConnectorCredentialRecord, credentials: ConnectorCredentialMaterial): ConnectorCredentialRecord {
    return {
      schemaVersion: 1,
      connectorId: record.connectorId,
      accountLabel: record.accountLabel,
      credentials: cloneCredentialMaterial(credentials),
      updatedAt: record.updatedAt,
    };
  }

  private readRecords(): Record<string, StoredConnectorCredentialRecord> {
    try {
      hardenCredentialFileSync(this.filePath);
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const records: Record<string, StoredConnectorCredentialRecord> = {};
      for (const [connectorId, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const raw = value as Record<string, unknown>;
        if (raw.schemaVersion !== 1 || raw.connectorId !== connectorId || typeof raw.accountLabel !== 'string' || typeof raw.updatedAt !== 'string') continue;
        const credentials = raw.credentials && typeof raw.credentials === 'object' && !Array.isArray(raw.credentials)
          ? cloneCredentialMaterial(raw.credentials as ConnectorCredentialMaterial)
          : undefined;
        const credentialRef = typeof raw.credentialRef === 'string' && raw.credentialRef.trim() ? raw.credentialRef.trim() : undefined;
        if (!credentials && !credentialRef) continue;
        records[connectorId] = {
          schemaVersion: 1,
          connectorId,
          accountLabel: raw.accountLabel,
          updatedAt: raw.updatedAt,
          ...(credentials ? { credentials } : {}),
          ...(credentialRef ? { credentialRef } : {}),
          ...(typeof raw.provider === 'string' ? { provider: raw.provider } : {}),
        };
      }
      return records;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return {};
      throw error;
    }
  }

  private writeRecords(records: Record<string, StoredConnectorCredentialRecord>): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOTSUP' && code !== 'EPERM' && code !== 'EINVAL') throw error;
    }
    const tempPath = `${this.filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(records, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, this.filePath);
    try { fs.chmodSync(this.filePath, 0o600); } catch { /* temp was created 0600 */ }
  }
}

function cloneStatus(status: ConnectorConnectionStatus): ConnectorConnectionStatus {
  return {
    status: status.status,
    ...(status.accountLabel === undefined ? {} : { accountLabel: status.accountLabel }),
    ...(status.lastError === undefined ? {} : { lastError: status.lastError }),
  };
}

function isAutoConnectedConnector(definition: ConnectorCatalogDefinition): boolean {
  const authentication = definition.authentication ?? (definition.provider === 'open-design' ? 'local' : 'oauth');
  return (authentication === 'local' || authentication === 'none') && definition.tools.every((tool) => tool.requiredScopes.length === 0);
}

function approvalRank(approval: ConnectorCatalogDefinition['minimumApproval']): number {
  switch (approval) {
    case 'auto':
      return 0;
    case 'confirm':
      return 1;
    case 'disabled':
      return 2;
    default:
      return 2;
  }
}

function stricterApproval(
  left: ConnectorCatalogDefinition['minimumApproval'] | undefined,
  right: ConnectorCatalogDefinition['minimumApproval'] | undefined,
): ConnectorCatalogDefinition['minimumApproval'] | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return approvalRank(left) >= approvalRank(right) ? left : right;
}

function runtimeSafetyForTool(tool: ConnectorCatalogToolDefinition): ConnectorToolSafety {
  const classified = classifyConnectorToolSafety(tool);
  if (classified.sideEffect !== 'read' || classified.approval !== 'auto') return classified;
  return tool.safety;
}

function assertJsonSchemaMatches(value: BoundedJsonValue, schema: BoundedJsonObject | undefined, path = 'input'): void {
  if (schema === undefined) return;
  const type = schema.type;
  if (typeof type === 'string') {
    const actualType = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    if (type === 'number') {
      if (typeof value !== 'number') throw new Error(`${path} must be a number`);
    } else if (type === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${path} must be an integer`);
    } else if (type !== actualType) {
      throw new Error(`${path} must be a ${type}`);
    }
  }
  if (type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
    const objectValue = value as BoundedJsonObject;
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : [];
    for (const key of required) {
      if (objectValue[key] === undefined) throw new Error(`${path}.${key} is required by connector input schema`);
    }
    const properties = schema.properties;
    const propertySchemas = properties !== null && typeof properties === 'object' && !Array.isArray(properties)
      ? properties as Record<string, BoundedJsonObject>
      : {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(objectValue)) {
        if (propertySchemas[key] === undefined) throw new Error(`${path}.${key} is not allowed by connector input schema`);
      }
    }
    for (const [key, childSchema] of Object.entries(propertySchemas)) {
      if (objectValue[key] !== undefined && childSchema !== null && typeof childSchema === 'object' && !Array.isArray(childSchema)) {
        assertJsonSchemaMatches(objectValue[key]!, childSchema, `${path}.${key}`);
      }
    }
  }
  if (type === 'string' && typeof value === 'string') {
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) throw new Error(`${path} exceeds connector input schema maxLength`);
  }
  if ((type === 'number' || type === 'integer') && typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) throw new Error(`${path} is below connector input schema minimum`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) throw new Error(`${path} exceeds connector input schema maximum`);
  }
}

function defaultConnectedAccountLabel(definition: ConnectorCatalogDefinition): string {
  return LOCAL_CONNECTOR_ACCOUNT_LABELS[definition.id] ?? definition.name;
}

export class ConnectorStatusService {
  private readonly statuses = new Map<string, ConnectorConnectionRecord>();
  private credentialStore: ConnectorCredentialStore | undefined;

  constructor(options: ConnectorStatusServiceOptions = {}) {
    this.credentialStore = options.credentialStore;
    for (const [connectorId, status] of Object.entries(options.initialStatuses ?? {})) {
      this.statuses.set(connectorId, { ...cloneStatus(status), updatedAt: nowIso() });
    }
  }

  setCredentialStore(credentialStore: ConnectorCredentialStore): void {
    this.credentialStore = credentialStore;
  }

  async deleteCredentialsByProvider(provider: string): Promise<void> {
    const deleted = await this.credentialStore?.deleteByProvider(provider) ?? [];
    for (const connectorId of deleted) this.statuses.delete(connectorId);
  }

  getStatus(definition: ConnectorCatalogDefinition): ConnectorConnectionStatus {
    if (definition.disabled) return { status: 'disabled' };

    const stored = this.statuses.get(definition.id);
    if (stored) return cloneStatus(stored);

    const credentialRecord = this.credentialStore?.getSummary(definition.id);
    if (credentialRecord !== undefined) {
      return { status: 'connected', accountLabel: credentialRecord.accountLabel };
    }

    if (isAutoConnectedConnector(definition)) {
      return { status: 'connected', accountLabel: defaultConnectedAccountLabel(definition) };
    }

    return { status: 'available' };
  }

  listStatuses(): Record<string, ConnectorConnectionStatus> {
    return Object.fromEntries(
      Array.from(this.statuses.entries()).map(([connectorId, status]) => [connectorId, cloneStatus(status)]),
    );
  }

  async connect(definition: ConnectorCatalogDefinition, accountLabel?: string, credentials?: ConnectorCredentialMaterial): Promise<ConnectorConnectionStatus> {
    if (definition.disabled) return { status: 'disabled' };

    if (credentials !== undefined) {
      await this.credentialStore?.set({
        schemaVersion: 1,
        connectorId: definition.id,
        accountLabel: accountLabel ?? defaultConnectedAccountLabel(definition),
        credentials,
        updatedAt: nowIso(),
      });
    }

    const next: ConnectorConnectionRecord = {
      status: 'connected',
      accountLabel: accountLabel ?? defaultConnectedAccountLabel(definition),
      updatedAt: nowIso(),
    };
    this.statuses.set(definition.id, next);
    return cloneStatus(next);
  }

  async getCredential(connectorId: string): Promise<ConnectorCredentialRecord | undefined> {
    return await this.credentialStore?.get(connectorId);
  }

  async disconnect(definition: ConnectorCatalogDefinition): Promise<ConnectorConnectionStatus> {
    if (definition.disabled) return { status: 'disabled' };

    await this.credentialStore?.delete(definition.id);

    if (isAutoConnectedConnector(definition)) {
      this.statuses.delete(definition.id);
      return this.getStatus(definition);
    }

    const next: ConnectorConnectionRecord = { status: 'available', updatedAt: nowIso() };
    this.statuses.set(definition.id, next);
    return cloneStatus(next);
  }

  setError(definition: ConnectorCatalogDefinition, lastError: string, accountLabel?: string): ConnectorConnectionStatus {
    if (definition.disabled) return { status: 'disabled' };

    const next: ConnectorConnectionRecord = {
      status: 'error',
      ...(accountLabel === undefined ? {} : { accountLabel }),
      lastError,
      updatedAt: nowIso(),
    };
    this.statuses.set(definition.id, next);
    return cloneStatus(next);
  }

  async markAuthenticationExpired(definition: ConnectorCatalogDefinition, lastError: string, accountLabel?: string): Promise<ConnectorConnectionStatus> {
    await this.credentialStore?.delete(definition.id);
    return this.setError(definition, lastError, accountLabel);
  }

  clear(connectorId: string): void {
    this.statuses.delete(connectorId);
  }
}

export interface ConnectorExecutionContext {
  projectsRoot: string;
  projectId: string;
  runId?: string;
  purpose?: 'agent_preview' | 'artifact_refresh';
  signal?: AbortSignal;
}

export const CONNECTOR_MAX_OUTPUT_BYTES = 256 * 1024;
export const CONNECTOR_RUN_RATE_LIMIT_CALLS = 10;
export const CONNECTOR_RUN_RATE_LIMIT_WINDOW_MS = 60_000;
export const CONNECTOR_RUN_LIMIT_TTL_MS = 15 * 60_000;
export const CONNECTOR_RUN_TOTAL_CALL_LIMIT = 60;

const CONNECTOR_REDACTED_VALUE = '[redacted]';

const CONNECTOR_FORBIDDEN_OUTPUT_KEYS = new Set([
  'raw',
  'rawresponse',
  'payload',
  'body',
  'headers',
  'cookie',
  'authorization',
  'token',
  'secret',
  'credential',
  'password',
]);

interface ConnectorRunLimitState {
  windowStartedAt: number;
  lastSeenAt: number;
  windowCalls: number;
  totalCalls: number;
}

export interface ConnectorOutputProtectionResult {
  output: BoundedJsonValue;
  redacted: boolean;
  serializedBytes: number;
}

function connectorRunLimitKey(context: ConnectorExecutionContext): string {
  return `${context.projectId}\0${context.runId ?? `${context.purpose ?? 'agent_preview'}:no-run-id`}`;
}

function jsonSerializedBytes(value: BoundedJsonValue): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function isForbiddenConnectorOutputKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return CONNECTOR_FORBIDDEN_OUTPUT_KEYS.has(normalized) || /(?:token|secret|credential|password|authorization|cookie)/i.test(key);
}

function redactConnectorOutputValue(value: BoundedJsonValue): { value: BoundedJsonValue; redacted: boolean } {
  if (Array.isArray(value)) {
    let redacted = false;
    const next = value.map((item) => {
      const child = redactConnectorOutputValue(item);
      redacted = child.redacted || redacted;
      return child.value;
    });
    return { value: next, redacted };
  }
  if (value !== null && typeof value === 'object') {
    let redacted = false;
    const next: BoundedJsonObject = {};
    for (const [key, child] of Object.entries(value)) {
      if (isForbiddenConnectorOutputKey(key)) {
        next[key] = CONNECTOR_REDACTED_VALUE;
        redacted = true;
        continue;
      }
      const redactedChild = redactConnectorOutputValue(child);
      next[key] = redactedChild.value;
      redacted = redactedChild.redacted || redacted;
    }
    return { value: next, redacted };
  }
  return { value, redacted: false };
}

export function protectConnectorOutput(output: BoundedJsonValue): ConnectorOutputProtectionResult {
  const redacted = redactConnectorOutputValue(output);
  const serializedBytes = jsonSerializedBytes(redacted.value);
  if (serializedBytes > CONNECTOR_MAX_OUTPUT_BYTES) {
    throw new ConnectorServiceError('CONNECTOR_OUTPUT_TOO_LARGE', 'connector output exceeds max serialized size', 502, {
      maxSerializedBytes: CONNECTOR_MAX_OUTPUT_BYTES,
      serializedBytes,
    });
  }
  return { output: redacted.value, redacted: redacted.redacted, serializedBytes };
}

export class ConnectorService {
  private readonly runLimits = new Map<string, ConnectorRunLimitState>();

  constructor(private readonly statusService = new ConnectorStatusService()) {}

  setCredentialStore(credentialStore: ConnectorCredentialStore): void {
    this.statusService.setCredentialStore(credentialStore);
  }

  async deleteCredentialsByProvider(provider: string): Promise<void> {
    await this.statusService.deleteCredentialsByProvider(provider);
  }

  async listDefinitions(signal?: AbortSignal): Promise<ConnectorCatalogDefinition[]> {
    return composioConnectorProvider.listDefinitions(signal);
  }

  async listHydratedDefinitions(signal?: AbortSignal): Promise<ConnectorCatalogDefinition[]> {
    return composioConnectorProvider.listDefinitions(signal, { hydrateTools: true });
  }

  listFastDefinitions(): ConnectorCatalogDefinition[] {
    return composioConnectorProvider.getFastDefinitions();
  }

  getFastDefinition(connectorId: string): ConnectorCatalogDefinition | undefined {
    return this.listFastDefinitions().find((definition) => definition.id === connectorId);
  }

  async getDefinition(connectorId: string, signal?: AbortSignal): Promise<ConnectorCatalogDefinition | undefined> {
    return composioConnectorProvider.getDefinition(connectorId, signal);
  }

  async getHydratedDefinition(connectorId: string, signal?: AbortSignal): Promise<ConnectorCatalogDefinition | undefined> {
    return await composioConnectorProvider.getHydratedDefinition(connectorId, signal)
      ?? await this.getDefinition(connectorId, signal);
  }

  async getPreviewDefinition(connectorId: string, options: { toolsLimit: number; toolsCursor?: string; signal?: AbortSignal }): Promise<ConnectorCatalogDefinition | undefined> {
    return composioConnectorProvider.getPreviewDefinition(connectorId, options);
  }

  getStatus(definition: ConnectorCatalogDefinition): ConnectorConnectionStatus {
    return this.statusService.getStatus(definition);
  }

  async getCredential(connectorId: string): Promise<ConnectorCredentialRecord | undefined> {
    return await this.statusService.getCredential(connectorId);
  }

  async listConnectors(signal?: AbortSignal): Promise<ConnectorDetail[]> {
    return this.listFastDefinitions().map((definition) => this.toDetail(definition));
  }

  listConnectorStatuses(): Record<string, ConnectorConnectionStatus> {
    return {
      ...this.statusService.listStatuses(),
      ...Object.fromEntries(this.listFastDefinitions().map((definition) => [definition.id, this.getStatus(definition)])),
    };
  }

  async listConnectorDiscovery(options: { refresh?: boolean; hydrateTools?: boolean; signal?: AbortSignal } = {}): Promise<ConnectorDiscoveryResult> {
    if (options.refresh) composioConnectorProvider.clearDiscoveryCache();
    const definitions = options.refresh && !options.hydrateTools
      ? await composioConnectorProvider.refreshCatalog(options.signal)
      : options.hydrateTools
        ? await this.listHydratedDefinitions(options.signal)
        : await this.listDefinitions(options.signal);
    return {
      connectors: definitions.map((definition) => this.toDetail(definition)),
      meta: {
        provider: 'composio',
        ...(options.refresh ? { refreshRequested: true } : {}),
      },
    };
  }

  async getConnector(connectorId: string, signal?: AbortSignal): Promise<ConnectorDetail> {
    const definition = await this.getDefinition(connectorId, signal);
    if (!definition) {
      throw new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'connector not found', 404);
    }
    return this.toDetail(definition);
  }

  async getHydratedConnector(connectorId: string, signal?: AbortSignal): Promise<ConnectorDetail> {
    const definition = await this.getHydratedDefinition(connectorId, signal);
    if (!definition) {
      throw new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'connector not found', 404);
    }
    return this.toDetail(definition);
  }

  async getPreviewConnector(connectorId: string, options: { toolsLimit: number; toolsCursor?: string; signal?: AbortSignal }): Promise<ConnectorDetail> {
    const definition = await this.getPreviewDefinition(connectorId, options);
    if (!definition) {
      throw new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'connector not found', 404);
    }
    return this.toDetail(definition);
  }

  async prepareAuthConfigs(connectorIds: readonly string[], signal?: AbortSignal): Promise<ConnectorAuthConfigPrepareResponse> {
    const results: Record<string, ComposioAuthConfigPrepareResult> = {};
    const uniqueConnectorIds = [...new Set(connectorIds.map((id) => id.trim()).filter(Boolean))];

    await Promise.all(uniqueConnectorIds.map(async (connectorId) => {
      const definition = this.getFastDefinition(connectorId) ?? await this.getDefinition(connectorId, signal);
      if (!definition) {
        results[connectorId] = { status: 'error', message: 'connector not found' };
        return;
      }
      if (definition.authentication !== 'composio') {
        results[connectorId] = { status: 'error', message: 'connector is not backed by Composio' };
        return;
      }
      results[connectorId] = await composioConnectorProvider.prepareAuthConfig(definition, signal);
    }));

    return { results };
  }

  async connect(connectorId: string, options: { accountLabel?: string; credentials?: ConnectorCredentialMaterial; callbackUrl?: string; signal?: AbortSignal } = {}): Promise<ConnectorConnectResult> {
    const definition = this.getFastDefinition(connectorId) ?? await this.getDefinition(connectorId, options.signal);
    if (!definition) {
      throw new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'connector not found', 404);
    }

    let auth: ComposioConnectionStart | undefined;
    let detailDefinition = definition;
    if (definition.authentication === 'composio' && options.credentials === undefined) {
      if (!options.callbackUrl) {
        throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'callbackUrl is required for Composio connectors', 400, { connectorId });
      }
      auth = await composioConnectorProvider.connect(definition, options.callbackUrl, options.signal);
      if (auth.kind === 'redirect_required' || auth.kind === 'pending') {
        return { connector: this.toDetail(detailDefinition), auth: publicComposioAuthStart(auth) };
      }
      if (auth.credentials !== undefined) {
        options = { ...options, ...(auth.accountLabel === undefined ? {} : { accountLabel: auth.accountLabel }), credentials: auth.credentials };
      }
    }

    const status = await this.statusService.connect(detailDefinition, options.accountLabel, options.credentials);
    if (status.status === 'disabled') {
      throw new ConnectorServiceError('CONNECTOR_DISABLED', 'connector is disabled', 403);
    }
    return { connector: this.toDetail(detailDefinition), ...(auth === undefined ? {} : { auth: publicComposioAuthStart(auth) }) };
  }

  async disconnect(connectorId: string): Promise<ConnectorDetail> {
    const definition = this.getFastDefinition(connectorId) ?? await this.getDefinition(connectorId);
    if (!definition) {
      throw new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'connector not found', 404);
    }
    if (definition.authentication === 'composio') {
      await composioConnectorProvider.disconnect((await this.getCredential(connectorId))?.credentials);
    }
    await this.statusService.disconnect(definition);
    return this.toDetail(definition);
  }

  async cancelPendingAuthorization(connectorId: string): Promise<ConnectorDetail> {
    const definition = this.getFastDefinition(connectorId) ?? await this.getDefinition(connectorId);
    if (!definition) {
      throw new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'connector not found', 404);
    }
    if (definition.authentication === 'composio') {
      composioConnectorProvider.cancelPendingConnections(connectorId);
    }
    return this.toDetail(definition);
  }

  async completeComposioConnection(input: { connectorId: string; state: string; providerConnectionId?: string; status?: string; signal?: AbortSignal }): Promise<ConnectorDetail> {
    const definition = await this.getDefinition(input.connectorId, input.signal);
    if (!definition) {
      throw new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'connector not found', 404);
    }
    if (definition.authentication !== 'composio') {
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'connector is not backed by Composio', 400, { connectorId: input.connectorId });
    }
    try {
      const completed = await composioConnectorProvider.completeConnection({ definition, state: input.state, ...(input.providerConnectionId === undefined ? {} : { providerConnectionId: input.providerConnectionId }), ...(input.status === undefined ? {} : { status: input.status }), ...(input.signal === undefined ? {} : { signal: input.signal }) });
      await this.statusService.connect(definition, completed.accountLabel, completed.credentials);
      return this.toDetail(definition);
    } catch (error) {
      if (
        input.providerConnectionId !== undefined
        && isMissingOrExpiredComposioOAuthState(error)
        && hasStoredComposioConnection(await this.getCredential(input.connectorId), input.providerConnectionId)
      ) {
        return this.toDetail(definition);
      }
      throw error;
    }
  }

  async execute(request: ConnectorExecuteRequest, context: ConnectorExecutionContext): Promise<ConnectorExecuteResponse> {
    const fastDefinition = this.listFastDefinitions().find((candidate) => (
      candidate.id === request.connectorId &&
      candidate.allowedToolNames.includes(request.toolName) &&
      candidate.tools.some((tool) => tool.name === request.toolName)
    ));
    const definition = fastDefinition ?? await this.getHydratedDefinition(request.connectorId, context.signal);
    if (!definition) {
      throw new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'connector not found', 404);
    }
    const connector = this.toDetail(definition);
    if (connector.status === 'disabled') {
      throw new ConnectorServiceError('CONNECTOR_DISABLED', 'connector is disabled', 403);
    }
    if (connector.status !== 'connected') {
      throw new ConnectorServiceError('CONNECTOR_NOT_CONNECTED', 'connector is not connected', 403, {
        connectorId: request.connectorId,
        status: connector.status,
      });
    }
    if (request.expectedAccountLabel !== undefined && connector.accountLabel !== request.expectedAccountLabel) {
      throw new ConnectorServiceError('CONNECTOR_NOT_CONNECTED', 'connector account changed since refresh approval', 409, {
        connectorId: request.connectorId,
        expectedAccountLabel: request.expectedAccountLabel,
        currentAccountLabel: connector.accountLabel ?? null,
      });
    }
    if (!definition.allowedToolNames.includes(request.toolName)) {
      throw new ConnectorServiceError('CONNECTOR_TOOL_NOT_FOUND', 'connector tool is not allowed', 404, {
        connectorId: request.connectorId,
        toolName: request.toolName,
      });
    }
    const tool = definition.tools.find((candidate) => candidate.name === request.toolName);
    if (!tool) {
      throw new ConnectorServiceError('CONNECTOR_TOOL_NOT_FOUND', 'connector tool not found', 404);
    }
    const runtimeSafety = runtimeSafetyForTool(tool);
    const effectiveApproval = stricterApproval(stricterApproval(definition.minimumApproval, tool.safety.approval), runtimeSafety.approval);
    if (effectiveApproval !== 'auto' || runtimeSafety.sideEffect !== 'read') {
      throw new ConnectorServiceError('CONNECTOR_SAFETY_DENIED', 'connector tool is not auto-approved read-only by current safety policy', 403, {
        connectorId: request.connectorId,
        toolName: request.toolName,
        approvalPolicy: effectiveApproval ?? null,
        safety: { ...runtimeSafety },
      });
    }
    try {
      assertJsonSchemaMatches(request.input, tool.inputSchemaJson);
    } catch (error) {
      throw new ConnectorServiceError('CONNECTOR_INPUT_SCHEMA_MISMATCH', error instanceof Error ? error.message : String(error), 400, {
        connectorId: request.connectorId,
        toolName: request.toolName,
      });
    }

    this.enforceRunLimits(context);

    let providerOutput: BoundedJsonObject;
    try {
      providerOutput = await this.executeConnectorProviderTool(request, context, definition, tool);
    } catch (error) {
      if (isConnectorAuthStaleError(error, request)) {
        await this.statusService.markAuthenticationExpired(definition, connectorAuthExpiredMessage(definition), connector.accountLabel);
      }
      throw error;
    }
    const protectedOutput = protectConnectorOutput(providerOutput);
    const output = protectedOutput.output;
    const outputSummary = summarizeConnectorOutput(output);

    return {
      ok: true,
      connectorId: request.connectorId,
      ...(connector.accountLabel === undefined ? {} : { accountLabel: connector.accountLabel }),
      toolName: request.toolName,
      safety: { ...runtimeSafety },
      output,
      ...(outputSummary === undefined ? {} : { outputSummary }),
      metadata: {
        connectorId: request.connectorId,
        toolName: request.toolName,
        purpose: context.purpose ?? 'agent_preview',
        outputSerializedBytes: protectedOutput.serializedBytes,
        ...(protectedOutput.redacted ? { redacted: true } : {}),
        ...(context.runId === undefined ? {} : { runId: context.runId }),
      },
    };
  }

  protected async executeConnectorProviderTool(
    request: ConnectorExecuteRequest,
    context: ConnectorExecutionContext,
    resolvedDefinition?: ConnectorCatalogDefinition,
    resolvedTool?: ConnectorCatalogToolDefinition,
  ): Promise<BoundedJsonObject> {
    const definition = resolvedDefinition ?? await this.getHydratedDefinition(request.connectorId, context.signal);
    const tool = resolvedTool ?? definition?.tools.find((candidate) => candidate.name === request.toolName);
    if (definition?.authentication === 'composio' && tool) {
      return composioConnectorProvider.execute(definition, tool, request.input, (await this.getCredential(request.connectorId))?.credentials, context.signal);
    }

    throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'connector provider is not implemented', 501, {
      connectorId: request.connectorId,
      toolName: request.toolName,
    });
  }

  private enforceRunLimits(context: ConnectorExecutionContext): void {
    if (context.runId === undefined) return;

    const now = Date.now();
    this.pruneRunLimits(now);
    const key = connectorRunLimitKey(context);
    const current = this.runLimits.get(key);
    const state: ConnectorRunLimitState = current === undefined || now - current.windowStartedAt >= CONNECTOR_RUN_RATE_LIMIT_WINDOW_MS
      ? { windowStartedAt: now, lastSeenAt: now, windowCalls: 0, totalCalls: current?.totalCalls ?? 0 }
      : current;

    if (state.totalCalls >= CONNECTOR_RUN_TOTAL_CALL_LIMIT) {
      throw new ConnectorServiceError('CONNECTOR_RATE_LIMITED', 'connector tool run call limit exceeded', 429, {
        runId: context.runId ?? null,
        totalCallLimit: CONNECTOR_RUN_TOTAL_CALL_LIMIT,
      });
    }
    if (state.windowCalls >= CONNECTOR_RUN_RATE_LIMIT_CALLS) {
      throw new ConnectorServiceError('CONNECTOR_RATE_LIMITED', 'connector tool rate limit exceeded', 429, {
        runId: context.runId ?? null,
        rateLimit: CONNECTOR_RUN_RATE_LIMIT_CALLS,
        windowMs: CONNECTOR_RUN_RATE_LIMIT_WINDOW_MS,
      });
    }

    state.windowCalls += 1;
    state.totalCalls += 1;
    state.lastSeenAt = now;
    this.runLimits.set(key, state);
  }

  private pruneRunLimits(now = Date.now()): void {
    for (const [key, state] of this.runLimits.entries()) {
      if (now - state.lastSeenAt >= CONNECTOR_RUN_LIMIT_TTL_MS) this.runLimits.delete(key);
    }
  }

  private toDetail(definition: ConnectorCatalogDefinition): ConnectorDetail {
    const detail = connectorDefinitionToDetail(definition);
    const status = this.getStatus(definition);
    return {
      ...detail,
      status: status.status,
      ...(status.accountLabel === undefined ? {} : { accountLabel: status.accountLabel }),
      ...(status.lastError === undefined ? {} : { lastError: status.lastError }),
      ...(detail.auth === undefined ? {} : {
        auth: {
          ...detail.auth,
          configured: detail.auth.configured || (definition.authentication === 'composio' && composioConnectorProvider.isConfigured(definition)),
        },
      }),
    };
  }
}

export const connectorService = new ConnectorService();

export function configureConnectorCredentialStore(credentialStore: ConnectorCredentialStore): void {
  connectorService.setCredentialStore(credentialStore);
}

export async function deleteConnectorCredentialsByProvider(provider: string): Promise<void> {
  await connectorService.deleteCredentialsByProvider(provider);
}

function summarizeConnectorOutput(output: BoundedJsonValue): string | undefined {
  if (output === null || typeof output !== 'object' || Array.isArray(output)) return undefined;
  const maybeToolName = output.toolName;
  if (typeof maybeToolName === 'string') {
    if (typeof output.count === 'number') return `${maybeToolName}: ${output.count} result${output.count === 1 ? '' : 's'}`;
    if (typeof output.path === 'string') return `${maybeToolName}: ${output.path}`;
    if (typeof output.isRepository === 'boolean') return `${maybeToolName}: ${output.isRepository ? 'repository found' : 'not a repository'}`;
    return maybeToolName;
  }
  return undefined;
}
