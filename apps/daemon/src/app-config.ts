// Daemon-backed app preferences (onboarding state, agent/skill/DS selection).
//
// The web frontend pushes preferences here via PUT /api/app-config; the
// daemon persists them to <dataDir>/app-config.json (where dataDir defaults
// to <projectRoot>/.od but follows OD_DATA_DIR when set, keeping test and
// multi-namespace runs isolated). This survives browser storage resets and
// origin changes so onboarding and agent selection don't reappear unexpectedly.
//
// `agentCliEnv` is intentionally limited by allowlist below. It is the
// explicit low-level launch environment for Local CLI runs, separate from
// provider BYOK. API-key entries here configure the underlying CLI itself;
// BASE_URL is optional and, when omitted, the CLI uses its default endpoint.
// `agentCliEnvIntent` records when API-key entries were saved under that new
// CLI-override contract. Older builds labeled the same fields as proxy-only,
// so legacy standalone keys without a base URL are dropped unless this marker
// or a matching base URL proves that the user intended to activate them.
// These values are local-only and should not be logged or returned outside
// this machine.

import { readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import {
  STORED_AGENT_CLI_CREDENTIAL,
  isStoredAgentCliCredential as isBaseStoredAgentCliCredential,
} from '@open-design/contracts';
import { expandHomePrefix } from './home-expansion.js';
import {
  hardenCredentialFile,
  hardenCredentialFileSync,
} from './credential-file-security.js';
import {
  credentialVaultKey,
  credentialVaultKeyCandidates,
  deleteCredential,
  legacyCredentialVaultKey,
  readCredential,
  writeCredential,
} from './credential-vault.js';

import {
  readInstallationFile,
  readInstallationFileSync,
  resolveInstallationDir,
  writeInstallationFile,
  type InstallationFilePatch,
} from './installation.js';

// Plugin-system env knobs. See docs/plans/plugins-implementation.md F6 / F9.
// Phase 1 only reads them; the GC worker that enforces snapshot expiry lands
// in Phase 5. Centralized here to keep daemon modules from sprinkling magic
// numbers across the codebase.
export interface PluginEnvKnobs {
  // Hard ceiling on devloop iterations per stage (spec section 10.2).
  maxDevloopIterations: number;
  // Days before an unreferenced applied_plugin_snapshots row expires. A
  // value of 0 means "keep forever" (operators can opt out of GC entirely).
  snapshotUnreferencedTtlDays: number;
  // Optional cap on how long even a referenced snapshot stays around once
  // its run/conversation/project is terminal. Default unset -> unlimited.
  snapshotRetentionDays: number | null;
  // GC worker tick interval. Phase 5 reads this; Phase 1 just exposes the
  // knob through `od config get` so operators can plan ahead.
  snapshotGcIntervalMs: number;
}

function intFromEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function nullableIntFromEnv(key: string): number | null {
  const raw = process.env[key];
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

export function readPluginEnvKnobs(): PluginEnvKnobs {
  return {
    maxDevloopIterations:        intFromEnv('OD_MAX_DEVLOOP_ITERATIONS', 10),
    snapshotUnreferencedTtlDays: intFromEnv('OD_SNAPSHOT_UNREFERENCED_TTL_DAYS', 30),
    snapshotRetentionDays:       nullableIntFromEnv('OD_SNAPSHOT_RETENTION_DAYS'),
    snapshotGcIntervalMs:        intFromEnv('OD_SNAPSHOT_GC_INTERVAL_MS', 6 * 60 * 60 * 1000),
  };
}

export interface AgentModelPrefs {
  model?: string;
  reasoning?: string;
}

export type AgentCliEnvPrefs = Record<string, Record<string, string>>;
export type AgentCliEnvIntentPrefs = Record<string, { apiKeyOverride?: boolean }>;

export interface TelemetryPrefs {
  metrics?: boolean;
  content?: boolean;
  artifactManifest?: boolean;
}

export interface OrbitConfigPrefs {
  enabled: boolean;
  time: string;
  templateSkillId?: string | null;
}

export interface ProjectLocationPrefs {
  id: string;
  name: string;
  path: string;
}

export interface PetAtlasRowPrefs {
  index: number;
  id: string;
  frames: number;
  fps: number;
}

export interface PetAtlasPrefs {
  cols: number;
  rows: number;
  rowsDef: PetAtlasRowPrefs[];
}

export interface PetCustomPrefs {
  name: string;
  glyph: string;
  accent: string;
  greeting: string;
  imageUrl?: string;
  frames?: number;
  fps?: number;
  atlas?: PetAtlasPrefs;
}

export interface PetConfigPrefs {
  adopted: boolean;
  enabled: boolean;
  petId: string;
  custom: PetCustomPrefs;
}

export interface AppConfigPrefs {
  onboardingCompleted?: boolean;
  agentId?: string | null;
  agentModels?: Record<string, AgentModelPrefs>;
  agentCliEnv?: AgentCliEnvPrefs;
  agentCliEnvIntent?: AgentCliEnvIntentPrefs;
  skillId?: string | null;
  designSystemId?: string | null;
  disabledSkills?: string[];
  disabledDesignSystems?: string[];
  installationId?: string | null;
  telemetry?: TelemetryPrefs;
  privacyDecisionAt?: number | null;
  orbit?: OrbitConfigPrefs;
  customInstructions?: string | null;
  projectLocations?: ProjectLocationPrefs[];
  defaultProjectLocationId?: string | null;
  // Most-recently-used local working directories the user granted the agent
  // read access to from the Home composer. Become a project's
  // `metadata.linkedDirs` (read-only `--add-dir` awareness, no Design Files
  // import). Stored most-recent-first; capped at RECENT_LINKED_DIRS_MAX.
  recentLinkedDirs?: string[];
  pet?: PetConfigPrefs;
}

// Cap on how many recent working directories we remember. Keeps the picker's
// "Recent" submenu short and the config file bounded.
export const RECENT_LINKED_DIRS_MAX = 5;

const ALLOWED_KEYS: ReadonlySet<keyof AppConfigPrefs> = new Set([
  'onboardingCompleted',
  'agentId',
  'agentModels',
  'agentCliEnv',
  'agentCliEnvIntent',
  'skillId',
  'designSystemId',
  'disabledSkills',
  'disabledDesignSystems',
  'installationId',
  'telemetry',
  'privacyDecisionAt',
  'orbit',
  'customInstructions',
  'projectLocations',
  'defaultProjectLocationId',
  'recentLinkedDirs',
  'pet',
] as const);

function configFile(dataDir: string): string {
  return path.join(dataDir, 'app-config.json');
}

export function appConfigDir(projectRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.MONOFIELD_DATA_DIR ?? env.OD_DATA_DIR;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return path.join(projectRoot, '.monofield');
  }
  const expanded = expandHomePrefix(raw.trim());
  return path.isAbsolute(expanded) ? expanded : path.resolve(projectRoot, expanded);
}

const AGENT_MODEL_KEYS: ReadonlySet<string> = new Set(['model', 'reasoning']);

const TELEMETRY_KEYS: ReadonlySet<string> = new Set([
  'metrics',
  'content',
  'artifactManifest',
]);

function validateTelemetry(raw: unknown): TelemetryPrefs | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const result: Record<string, boolean> = Object.create(null);
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k === '__proto__' || k === 'constructor') continue;
    if (!TELEMETRY_KEYS.has(k)) continue;
    if (typeof v === 'boolean') result[k] = v;
  }
  return Object.keys(result).length > 0 ? (result as TelemetryPrefs) : undefined;
}

const AGENT_CLI_ENV_KEYS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['amr', new Set([
    'VELA_BIN',
    'VELA_API_URL',
    'VELA_LINK_URL',
    'VELA_RUNTIME_KEY',
    'VELA_OPENCODE_BIN',
    'OPEN_DESIGN_AMR_PROFILE',
    'OPENCODE_TEST_HOME',
  ])],
  ['aider', new Set(['AIDER_BIN'])],
  ['amp', new Set(['AMP_BIN'])],
  ['antigravity', new Set(['ANTIGRAVITY_BIN'])],
  ['claude', new Set(['CLAUDE_CONFIG_DIR', 'CLAUDE_BIN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'MMD_MODEL_ROUTES_FILE'])],
  ['codebuddy', new Set(['CODEBUDDY_BIN'])],
  ['codex', new Set(['CODEX_HOME', 'CODEX_BIN', 'OPENAI_BASE_URL', 'CODEX_API_KEY', 'OPENAI_API_KEY'])],
  ['copilot', new Set(['COPILOT_BIN'])],
  ['cursor-agent', new Set(['CURSOR_AGENT_BIN'])],
  ['deepseek', new Set(['DEEPSEEK_BIN'])],
  ['devin', new Set(['DEVIN_BIN'])],
  ['mimo', new Set(['MIMO_BIN'])],
  ['gemini', new Set(['GEMINI_BIN'])],
  ['grok-build', new Set(['GROK_BIN'])],
  ['hermes', new Set(['HERMES_BIN'])],
  ['kimi', new Set(['KIMI_BIN'])],
  ['kiro', new Set(['KIRO_BIN'])],
  ['kilo', new Set(['KILO_BIN'])],
  ['opencode', new Set(['OPENCODE_BIN'])],
  ['pi', new Set(['PI_BIN'])],
  ['qoder', new Set(['QODER_BIN'])],
  ['qwen', new Set(['QWEN_BIN'])],
  ['reasonix', new Set(['REASONIX_BIN'])],
  ['trae-cli', new Set(['TRAE_CLI_BIN'])],
  ['vibe', new Set(['VIBE_BIN'])],
]);

const AGENT_CLI_AUTH_ENV_KEYS: ReadonlyMap<string, {
  auth: ReadonlySet<string>;
  baseUrl: ReadonlySet<string>;
}> = new Map([
  ['amr', {
    auth: new Set(['VELA_RUNTIME_KEY']),
    baseUrl: new Set(['VELA_LINK_URL']),
  }],
  ['claude', {
    auth: new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']),
    baseUrl: new Set(['ANTHROPIC_BASE_URL']),
  }],
  ['codex', {
    auth: new Set(['CODEX_API_KEY', 'OPENAI_API_KEY']),
    baseUrl: new Set(['OPENAI_BASE_URL']),
  }],
]);

function isAgentCliCredentialKey(agentId: string, envKey: string): boolean {
  return AGENT_CLI_AUTH_ENV_KEYS.get(agentId)?.auth.has(envKey) === true;
}

function agentCliCredentialRef(dataDir: string, agentId: string, envKey: string): string {
  return credentialVaultKey('agent-cli-env', configFile(dataDir), `${agentId}.${envKey}`);
}

const STORED_AGENT_CLI_CREDENTIAL_REF_PREFIX = `${STORED_AGENT_CLI_CREDENTIAL}:ref:`;

function isStoredAgentCliCredential(value: unknown): value is string {
  return isBaseStoredAgentCliCredential(value)
    || (typeof value === 'string' && value.startsWith(STORED_AGENT_CLI_CREDENTIAL_REF_PREFIX));
}

function markerForAgentCliCredentialRef(ref: string): string {
  return `${STORED_AGENT_CLI_CREDENTIAL_REF_PREFIX}${ref}`;
}

function refFromAgentCliCredentialMarker(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith(STORED_AGENT_CLI_CREDENTIAL_REF_PREFIX)) return null;
  const ref = value.slice(STORED_AGENT_CLI_CREDENTIAL_REF_PREFIX.length).trim();
  return ref || null;
}

function freshAgentCliCredentialRef(dataDir: string, agentId: string, envKey: string): string {
  return `${agentCliCredentialRef(dataDir, agentId, envKey)}:v-${randomBytes(12).toString('hex')}`;
}

async function readAgentCliCredential(
  dataDir: string,
  agentId: string,
  envKey: string,
  marker: string,
): Promise<string | null> {
  const explicitRef = refFromAgentCliCredentialMarker(marker);
  if (explicitRef) return await readCredential(explicitRef);
  for (const ref of credentialVaultKeyCandidates('agent-cli-env', configFile(dataDir), `${agentId}.${envKey}`)) {
    const value = await readCredential(ref);
    if (value != null) return value;
  }
  return null;
}

function cloneAgentCliEnv(value: AgentCliEnvPrefs | undefined): AgentCliEnvPrefs | undefined {
  if (!value) return undefined;
  return Object.fromEntries(
    Object.entries(value).map(([agentId, env]) => [agentId, { ...env }]),
  );
}

/**
 * Never send Local CLI authentication material over the app-config API.
 * The marker is deliberately non-secret and tells Settings that a value can
 * be preserved or explicitly cleared without making it recoverable in the UI.
 */
export function maskAgentCliCredentials(config: AppConfigPrefs): AppConfigPrefs {
  if (!config.agentCliEnv) return config;
  let changed = false;
  const agentCliEnv = cloneAgentCliEnv(config.agentCliEnv)!;
  for (const [agentId, env] of Object.entries(agentCliEnv)) {
    for (const envKey of Object.keys(env)) {
      if (!isAgentCliCredentialKey(agentId, envKey)) continue;
      if (env[envKey] !== STORED_AGENT_CLI_CREDENTIAL) {
        env[envKey] = STORED_AGENT_CLI_CREDENTIAL;
        changed = true;
      }
    }
  }
  return changed ? { ...config, agentCliEnv } : config;
}

function isValidAgentModelEntry(v: unknown): v is AgentModelPrefs {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const obj = v as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (!AGENT_MODEL_KEYS.has(k)) return false;
    if (obj[k] !== undefined && typeof obj[k] !== 'string') return false;
  }
  return true;
}

function validateAgentModels(
  raw: unknown,
): Record<string, AgentModelPrefs> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const result: Record<string, AgentModelPrefs> = Object.create(null);
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k === '__proto__' || k === 'constructor') continue;
    if (isValidAgentModelEntry(v)) {
      result[k] = v;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function validateAgentCliEnv(raw: unknown): AgentCliEnvPrefs | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const result: AgentCliEnvPrefs = Object.create(null);
  for (const [agentId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (agentId === '__proto__' || agentId === 'constructor') continue;
    const allowed = AGENT_CLI_ENV_KEYS.get(agentId);
    if (!allowed || typeof value !== 'object' || value === null || Array.isArray(value)) {
      continue;
    }
    const env: Record<string, string> = Object.create(null);
    for (const [envKey, envValue] of Object.entries(value as Record<string, unknown>)) {
      if (!allowed.has(envKey)) continue;
      if (typeof envValue !== 'string') continue;
      const trimmed = envValue.trim();
      if (!trimmed) continue;
      env[envKey] = trimmed;
    }
    if (Object.keys(env).length > 0) result[agentId] = env;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function validateAgentCliEnvIntent(raw: unknown): AgentCliEnvIntentPrefs | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const result: AgentCliEnvIntentPrefs = Object.create(null);
  for (const [agentId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (agentId === '__proto__' || agentId === 'constructor') continue;
    if (!AGENT_CLI_ENV_KEYS.has(agentId)) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const obj = value as Record<string, unknown>;
    if (obj.apiKeyOverride === true) {
      result[agentId] = { apiKeyOverride: true };
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function isValidOrbitTime(time: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function validateOrbit(raw: unknown): OrbitConfigPrefs | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const enabled = typeof obj.enabled === 'boolean' ? obj.enabled : false;
  const time = typeof obj.time === 'string' && isValidOrbitTime(obj.time)
    ? obj.time
    : '08:00';
  const orbit: OrbitConfigPrefs = { enabled, time };

  if (Object.hasOwn(obj, 'templateSkillId')) {
    orbit.templateSkillId = typeof obj.templateSkillId === 'string' && obj.templateSkillId.trim()
      ? obj.templateSkillId.trim()
      : null;
  }

  return orbit;
}

const PET_IMAGE_MAX_CHARS = 3_000_000;

function boundedPetString(value: unknown, fallback: string, max: number): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : fallback;
}

function boundedPetInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function validatePetAtlas(raw: unknown): PetAtlasPrefs | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const cols = boundedPetInteger(obj.cols, 1, 1, 64);
  const rows = boundedPetInteger(obj.rows, 1, 1, 64);
  if (!Array.isArray(obj.rowsDef)) return undefined;
  const rowsDef = obj.rowsDef.slice(0, 64).flatMap((entry): PetAtlasRowPrefs[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    return [{
      index: boundedPetInteger(row.index, 0, 0, rows - 1),
      id: boundedPetString(row.id, 'idle', 64),
      frames: boundedPetInteger(row.frames, 1, 1, cols),
      fps: boundedPetInteger(row.fps, 8, 1, 60),
    }];
  });
  return rowsDef.length > 0 ? { cols, rows, rowsDef } : undefined;
}

function validatePet(raw: unknown): PetConfigPrefs | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const customObj = obj.custom && typeof obj.custom === 'object' && !Array.isArray(obj.custom)
    ? obj.custom as Record<string, unknown>
    : {};
  const custom: PetCustomPrefs = {
    name: boundedPetString(customObj.name, 'Buddy', 80),
    glyph: boundedPetString(customObj.glyph, '🦄', 32),
    accent: typeof customObj.accent === 'string' && /^#[0-9a-f]{6}$/iu.test(customObj.accent.trim())
      ? customObj.accent.trim().toLowerCase()
      : '#c96442',
    greeting: boundedPetString(customObj.greeting, 'Hi! I am here whenever you need me.', 240),
  };
  if (
    typeof customObj.imageUrl === 'string'
    && customObj.imageUrl.length <= PET_IMAGE_MAX_CHARS
    && /^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,/iu.test(customObj.imageUrl)
  ) {
    custom.imageUrl = customObj.imageUrl;
  }
  if (customObj.frames !== undefined) custom.frames = boundedPetInteger(customObj.frames, 1, 1, 128);
  if (customObj.fps !== undefined) custom.fps = boundedPetInteger(customObj.fps, 8, 1, 60);
  const atlas = validatePetAtlas(customObj.atlas);
  if (atlas) custom.atlas = atlas;
  return {
    adopted: obj.adopted === true,
    enabled: obj.enabled === true,
    petId: boundedPetString(obj.petId, 'mochi', 128),
    custom,
  };
}

function normalizeLocationId(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  if (/^[A-Za-z0-9._-]{1,128}$/.test(trimmed) && trimmed !== 'default') {
    return trimmed;
  }
  return fallback;
}

function autoProjectLocationId(pathKey: string): string {
  return `loc_${createHash('sha256').update(pathKey).digest('base64url').slice(0, 16)}`;
}

function validateProjectLocations(raw: unknown): ProjectLocationPrefs[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) return undefined;
  const result: ProjectLocationPrefs[] = [];
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.path !== 'string') continue;
    const expanded = expandHomePrefix(obj.path.trim());
    if (!expanded || !path.isAbsolute(expanded)) continue;
    const normalizedPath = path.normalize(expanded);
    const pathKey = process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
    if (seenPaths.has(pathKey)) continue;
    const id = normalizeLocationId(
      typeof obj.id === 'string' ? obj.id : '',
      autoProjectLocationId(pathKey),
    );
    if (seenIds.has(id)) continue;
    const rawName = typeof obj.name === 'string' ? obj.name.trim() : '';
    result.push({ id, name: rawName || path.basename(normalizedPath) || normalizedPath, path: normalizedPath });
    seenIds.add(id);
    seenPaths.add(pathKey);
  }
  return result;
}

export function agentCliEnvForAgent(
  prefs: AgentCliEnvPrefs | undefined,
  agentId: string,
): Record<string, string> {
  if (!prefs || typeof agentId !== 'string') return {};
  const env = prefs[agentId];
  if (!env || typeof env !== 'object' || Array.isArray(env)) return {};
  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => !isStoredAgentCliCredential(value)),
  );
}

function normalizeAgentCliEnvPrefs(prefs: AppConfigPrefs): AppConfigPrefs {
  const agentCliEnv = prefs.agentCliEnv;
  if (!agentCliEnv) {
    if (!prefs.agentCliEnvIntent) return prefs;
    const next = { ...prefs };
    delete next.agentCliEnvIntent;
    return next;
  }

  let nextAgentCliEnv = agentCliEnv;
  let changed = false;

  for (const [agentId, keys] of AGENT_CLI_AUTH_ENV_KEYS) {
    const env = nextAgentCliEnv[agentId];
    if (!env) continue;
    const hasBaseUrl = Object.keys(env).some((key) => keys.baseUrl.has(key));
    const hasExplicitApiKeyIntent = prefs.agentCliEnvIntent?.[agentId]?.apiKeyOverride === true;
    if (hasBaseUrl || hasExplicitApiKeyIntent) continue;

    let nextEnv = env;
    for (const authKey of keys.auth) {
      if (!Object.prototype.hasOwnProperty.call(nextEnv, authKey)) continue;
      if (nextEnv === env) nextEnv = { ...env };
      delete nextEnv[authKey];
      changed = true;
    }
    if (nextEnv === env) continue;
    nextAgentCliEnv = { ...nextAgentCliEnv };
    if (Object.keys(nextEnv).length > 0) {
      nextAgentCliEnv[agentId] = nextEnv;
    } else {
      delete nextAgentCliEnv[agentId];
    }
  }

  let nextAgentCliEnvIntent = prefs.agentCliEnvIntent;
  if (nextAgentCliEnvIntent) {
    for (const agentId of Object.keys(nextAgentCliEnvIntent)) {
      if (nextAgentCliEnv[agentId]) continue;
      nextAgentCliEnvIntent = { ...nextAgentCliEnvIntent };
      delete nextAgentCliEnvIntent[agentId];
      changed = true;
    }
  }

  const normalizedAgentCliEnv = Object.keys(nextAgentCliEnv).length > 0 ? nextAgentCliEnv : undefined;
  const normalizedIntent = nextAgentCliEnvIntent && Object.keys(nextAgentCliEnvIntent).length > 0
    ? nextAgentCliEnvIntent
    : undefined;

  if (
    !changed &&
    normalizedAgentCliEnv === prefs.agentCliEnv &&
    normalizedIntent === prefs.agentCliEnvIntent
  ) {
    return prefs;
  }

  const next = { ...prefs };
  if (normalizedAgentCliEnv) {
    next.agentCliEnv = normalizedAgentCliEnv;
  } else {
    delete next.agentCliEnv;
  }
  if (normalizedIntent) {
    next.agentCliEnvIntent = normalizedIntent;
  } else {
    delete next.agentCliEnvIntent;
  }
  return next;
}

function inferAgentCliEnvIntentForExplicitEnvWrite(prefs: AppConfigPrefs): AppConfigPrefs {
  if (!prefs.agentCliEnv) return prefs;
  let nextAgentCliEnvIntent = prefs.agentCliEnvIntent;
  let changed = false;

  for (const [agentId, keys] of AGENT_CLI_AUTH_ENV_KEYS) {
    const env = prefs.agentCliEnv[agentId];
    if (!env) continue;
    const hasBaseUrl = Object.keys(env).some((key) => keys.baseUrl.has(key));
    if (hasBaseUrl) continue;
    const hasAuthKey = Object.keys(env).some((key) => keys.auth.has(key));
    if (!hasAuthKey) continue;
    if (nextAgentCliEnvIntent?.[agentId]?.apiKeyOverride === true) continue;
    nextAgentCliEnvIntent = {
      ...(nextAgentCliEnvIntent ?? {}),
      [agentId]: { apiKeyOverride: true },
    };
    changed = true;
  }

  if (!changed || !nextAgentCliEnvIntent) return prefs;
  return { ...prefs, agentCliEnvIntent: nextAgentCliEnvIntent };
}

function applyConfigValue(
  target: Record<string, unknown>,
  key: keyof AppConfigPrefs,
  value: unknown,
): void {
  if (key === 'onboardingCompleted') {
    if (typeof value === 'boolean') target[key] = value;
    return;
  }
  if (key === 'agentId' || key === 'skillId' || key === 'designSystemId') {
    if (typeof value === 'string' || value === null) target[key] = value;
    return;
  }
  if (key === 'agentModels') {
    const validated = validateAgentModels(value);
    if (validated !== undefined) {
      target[key] = validated;
    } else {
      delete target[key];
    }
  }
  if (key === 'agentCliEnv') {
    const validated = validateAgentCliEnv(value);
    if (validated !== undefined) {
      target[key] = validated;
    } else {
      delete target[key];
    }
  }
  if (key === 'agentCliEnvIntent') {
    const validated = validateAgentCliEnvIntent(value);
    if (validated !== undefined) {
      target[key] = validated;
    } else {
      delete target[key];
    }
  }
  if (key === 'disabledSkills' || key === 'disabledDesignSystems') {
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      target[key] = value;
    } else {
      delete target[key];
    }
  }
  if (key === 'installationId') {
    if (typeof value === 'string' || value === null) target[key] = value;
    return;
  }
  if (key === 'telemetry') {
    const validated = validateTelemetry(value);
    if (validated !== undefined) {
      target[key] = validated;
    } else {
      delete target[key];
    }
  }
  if (key === 'privacyDecisionAt') {
    if (
      value === null ||
      (typeof value === 'number' && Number.isFinite(value) && value >= 0)
    ) {
      target[key] = value;
    } else {
      delete target[key];
    }
    return;
  }
  if (key === 'orbit') {
    const validated = validateOrbit(value);
    if (validated !== undefined) {
      target[key] = validated;
    } else {
      delete target[key];
    }
  }
  if (key === 'customInstructions') {
    if (typeof value === 'string') {
      target[key] = value.slice(0, 5000);
    } else if (value === null) {
      target[key] = value;
    }
    return;
  }
  if (key === 'projectLocations') {
    const validated = validateProjectLocations(value);
    if (validated !== undefined) {
      target[key] = validated;
    } else {
      delete target[key];
    }
    return;
  }
  if (key === 'defaultProjectLocationId') {
    if (typeof value === 'string') {
      target[key] = normalizeLocationId(value, 'default');
    } else if (value === null) {
      target[key] = null;
    } else {
      delete target[key];
    }
    return;
  }
  if (key === 'recentLinkedDirs') {
    if (Array.isArray(value)) {
      // Keep non-empty strings, trim, de-dupe preserving most-recent-first
      // order, and cap the list. Path existence/safety is enforced later by
      // validateLinkedDirs when the dir is actually attached to a project, so
      // a folder that was since deleted simply drops out at use time rather
      // than corrupting the whole config write here.
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const entry of value) {
        if (typeof entry !== 'string') continue;
        const trimmed = entry.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        cleaned.push(trimmed);
        if (cleaned.length >= RECENT_LINKED_DIRS_MAX) break;
      }
      target[key] = cleaned;
    } else {
      delete target[key];
    }
    return;
  }
  if (key === 'pet') {
    const validated = validatePet(value);
    if (validated !== undefined) {
      target[key] = validated;
    } else {
      delete target[key];
    }
    return;
  }
}

function filterAllowedKeys(obj: Record<string, unknown>): AppConfigPrefs {
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(obj)) {
    if (ALLOWED_KEYS.has(key as keyof AppConfigPrefs)) {
      applyConfigValue(result, key as keyof AppConfigPrefs, obj[key]);
    }
  }
  return normalizeAgentCliEnvPrefs(result as AppConfigPrefs);
}

// Fill in telemetry defaults when the saved config has no `telemetry`
// field at all. MonoField is local-first, so product telemetry is opt-in and
// defaults to off until the user explicitly enables it.
function applyTelemetryDefaults(prefs: AppConfigPrefs): AppConfigPrefs {
  if (prefs.telemetry === undefined) {
    return {
      ...prefs,
      telemetry: { metrics: false, content: false, artifactManifest: false },
    };
  }
  return prefs;
}

async function persistAppConfigFile(dataDir: string, config: AppConfigPrefs): Promise<void> {
  const file = configFile(dataDir);
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await chmod(directory, 0o700);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOTSUP' && code !== 'EPERM' && code !== 'EINVAL') throw error;
  }
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, file);
    try {
      await chmod(file, 0o600);
    } catch {
      // The temp file was created 0600; tolerate chmod-less volumes.
    }
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

function dropEmptyAgentCliEnvEntries(config: AppConfigPrefs): AppConfigPrefs {
  if (!config.agentCliEnv) return config;
  const agentCliEnv = cloneAgentCliEnv(config.agentCliEnv)!;
  for (const [agentId, env] of Object.entries(agentCliEnv)) {
    if (Object.keys(env).length === 0) delete agentCliEnv[agentId];
  }
  if (Object.keys(agentCliEnv).length > 0) return { ...config, agentCliEnv };
  const next = { ...config };
  delete next.agentCliEnv;
  return next;
}

function replaceAgentCliEnv(
  config: AppConfigPrefs,
  agentCliEnv: AgentCliEnvPrefs | undefined,
): AppConfigPrefs {
  const next = { ...config };
  if (agentCliEnv) next.agentCliEnv = agentCliEnv;
  else delete next.agentCliEnv;
  return next;
}

async function resolveStoredAgentCliCredentials(
  dataDir: string,
  config: AppConfigPrefs,
): Promise<AppConfigPrefs> {
  if (!config.agentCliEnv) return config;
  const runtime = cloneAgentCliEnv(config.agentCliEnv)!;
  const persisted = cloneAgentCliEnv(config.agentCliEnv)!;
  const stagedRefs: string[] = [];
  let migratedLegacy = false;
  let unavailableStoredCredential = false;

  try {
    for (const [agentId, env] of Object.entries(runtime)) {
      for (const [envKey, value] of Object.entries(env)) {
        if (!isAgentCliCredentialKey(agentId, envKey)) continue;
        if (isStoredAgentCliCredential(value)) {
          try {
            const secret = (await readAgentCliCredential(dataDir, agentId, envKey, value))?.trim() ?? '';
            if (secret) {
              env[envKey] = secret;
            } else {
              delete env[envKey];
              unavailableStoredCredential = true;
            }
          } catch {
            delete env[envKey];
            unavailableStoredCredential = true;
          }
          continue;
        }

        // Legacy app-config.json stored the CLI credential in plaintext. Stage
        // every value under a fresh ref, then scrub all plaintext in one
        // atomic metadata rename. A single failure rolls the entire batch back.
        const ref = freshAgentCliCredentialRef(dataDir, agentId, envKey);
        await writeCredential(ref, value);
        stagedRefs.push(ref);
        persisted[agentId]![envKey] = markerForAgentCliCredentialRef(ref);
        migratedLegacy = true;
      }
    }

    if (migratedLegacy) {
      await persistAppConfigFile(dataDir, { ...config, agentCliEnv: persisted });
    }
  } catch {
    await Promise.all(stagedRefs.map((ref) => deleteCredential(ref).catch(() => undefined)));
    console.warn('[app-config] Local CLI credential migration is waiting for the encrypted Desktop vault.');
    return dropEmptyAgentCliEnvEntries({ ...config, agentCliEnv: runtime });
  }
  if (unavailableStoredCredential) {
    console.warn('[app-config] One or more encrypted Local CLI credentials are currently unavailable.');
  }
  return dropEmptyAgentCliEnvEntries({ ...config, agentCliEnv: runtime });
}

export async function readAppConfig(dataDir: string): Promise<AppConfigPrefs> {
  const base = await resolveStoredAgentCliCredentials(
    dataDir,
    await readAppConfigFileOnly(dataDir),
  );
  // Channel-root installation file is the new authoritative source for the
  // identity bits that must survive a namespace-scoped data-dir wipe. It
  // lives outside `<namespace>/data/` so a reinstall of the same channel
  // (which might churn the namespace token, or eventually clear per-
  // namespace data) keeps the same id.
  //
  // Migration: when this daemon is the first to boot with installation.json
  // support and finds an existing installationId in the legacy app-config
  // path, mirror it forward exactly once so PostHog continues to see the
  // same person across the 0.7.x to 0.8.0 upgrade. Without this mirror, the
  // user count would double when 0.8.0 ships.
  const installationDir = resolveInstallationDir(dataDir);
  const installation = await readInstallationFile(installationDir);
  if (typeof installation.installationId === 'string' && installation.installationId.length > 0) {
    return applyTelemetryDefaults({ ...base, installationId: installation.installationId });
  }
  if (typeof base.installationId === 'string' && base.installationId.length > 0) {
    // Best-effort migration. A write failure here doesn't break the read;
    // we still serve the legacy id. The next write through writeAppConfig
    // will retry the mirror.
    try {
      await writeInstallationFile(installationDir, { installationId: base.installationId });
    } catch {
      // swallow; observability beats correctness on this path
    }
  }
  return applyTelemetryDefaults(base);
}

// Synchronous mirror of readAppConfig for callers that cannot await, e.g.
// building the spawn env for the vela CLI inside the synchronous
// spawnEnvForAgent. It reuses the exact same parsing, validation and telemetry
// defaulting as the async path, so the consent decision and installationId can
// never drift from what the rest of the daemon (and the web analytics config)
// sees. The only intentional difference is that it skips the best-effort
// legacy to channel-root migration *write*, which is a side effect rather than
// part of the read result.
export function readAppConfigSync(dataDir: string): AppConfigPrefs {
  const base = readAppConfigFileOnlySync(dataDir);
  const installation = readInstallationFileSync(resolveInstallationDir(dataDir));
  if (
    typeof installation.installationId === 'string' &&
    installation.installationId.length > 0
  ) {
    return applyTelemetryDefaults({
      ...base,
      installationId: installation.installationId,
    });
  }
  return applyTelemetryDefaults(base);
}

function readAppConfigFileOnlySync(dataDir: string): AppConfigPrefs {
  try {
    hardenCredentialFileSync(configFile(dataDir));
    const parsed: unknown = JSON.parse(
      readFileSync(configFile(dataDir), 'utf8'),
    );
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return filterAllowedKeys(parsed as Record<string, unknown>);
    }
    return {};
  } catch (err: unknown) {
    const e = err as { code?: string; name?: string };
    if (e.code === 'ENOENT') return {};
    if (e.name === 'SyntaxError') return {};
    throw err;
  }
}

async function readAppConfigFileOnly(dataDir: string): Promise<AppConfigPrefs> {
  try {
    await hardenCredentialFile(configFile(dataDir));
    const raw = await readFile(configFile(dataDir), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return filterAllowedKeys(parsed as Record<string, unknown>);
    }
    console.warn('[app-config] Invalid shape in config file, returning empty');
    return {};
  } catch (err: unknown) {
    const e = err as { code?: string; name?: string; message?: string };
    if (e.code === 'ENOENT') return {};
    if (e.name === 'SyntaxError') {
      console.error('[app-config] Corrupted JSON, returning empty:', e.message);
      return {};
    }
    throw err;
  }
}

// Serialize concurrent writes to the same dataDir so the read-modify-write
// cycle doesn't lose updates when two PUT requests overlap.
const writeLocks = new Map<string, Promise<unknown>>();

export async function writeAppConfig(
  dataDir: string,
  partial: Record<string, unknown>,
): Promise<AppConfigPrefs> {
  const prev = writeLocks.get(dataDir) ?? Promise.resolve();
  const task = prev.catch(() => {}).then(() => doWrite(dataDir, partial));
  writeLocks.set(dataDir, task);
  try {
    return await task;
  } finally {
    if (writeLocks.get(dataDir) === task) writeLocks.delete(dataDir);
  }
}

async function prepareAgentCliCredentialsForWrite(input: {
  dataDir: string;
  existingRuntime: AppConfigPrefs;
  existingPersisted: AppConfigPrefs;
  next: AppConfigPrefs;
  partial: Record<string, unknown>;
}): Promise<{
  persisted: AppConfigPrefs;
  runtime: AppConfigPrefs;
  refsToDelete: string[];
  stagedRefs: string[];
}> {
  const runtimeEnv = cloneAgentCliEnv(input.next.agentCliEnv);
  let persistedEnv = cloneAgentCliEnv(input.next.agentCliEnv);
  const partialHasAgentEnv = Object.prototype.hasOwnProperty.call(input.partial, 'agentCliEnv');
  const partialEnv = partialHasAgentEnv ? validateAgentCliEnv(input.partial.agentCliEnv) : undefined;
  const refsToDelete = new Set<string>();
  const clearRefs = new Set<string>();
  const stagedRefs: string[] = [];
  let migrationFailed = false;
  let hasExplicitNewSecret = false;

  const agents = new Set([
    ...Object.keys(input.existingPersisted.agentCliEnv ?? {}),
    ...Object.keys(input.next.agentCliEnv ?? {}),
  ]);
  for (const agentId of agents) {
    const keys = new Set([
      ...Object.keys(input.existingPersisted.agentCliEnv?.[agentId] ?? {}),
      ...Object.keys(input.next.agentCliEnv?.[agentId] ?? {}),
    ]);
    for (const envKey of keys) {
      if (!isAgentCliCredentialKey(agentId, envKey)) continue;
      const nextValue = input.next.agentCliEnv?.[agentId]?.[envKey];
      const persistedBefore = input.existingPersisted.agentCliEnv?.[agentId]?.[envKey];
      const runtimeBefore = input.existingRuntime.agentCliEnv?.[agentId]?.[envKey];
      const previousRef = refFromAgentCliCredentialMarker(persistedBefore)
        ?? (isBaseStoredAgentCliCredential(persistedBefore)
          ? legacyCredentialVaultKey('agent-cli-env', configFile(input.dataDir), `${agentId}.${envKey}`)
          : null);
      const explicitlySupplied = partialHasAgentEnv
        ? partialEnv?.[agentId]?.[envKey]
        : undefined;

      if (!nextValue) {
        if (previousRef) {
          refsToDelete.add(previousRef);
          clearRefs.add(previousRef);
        }
        continue;
      }

      if (isStoredAgentCliCredential(nextValue)) {
        if (isStoredAgentCliCredential(persistedBefore)) {
          if (runtimeBefore && !isStoredAgentCliCredential(runtimeBefore)) {
            runtimeEnv![agentId]![envKey] = runtimeBefore;
          } else {
            delete runtimeEnv?.[agentId]?.[envKey];
          }
          persistedEnv![agentId]![envKey] = persistedBefore!;
          continue;
        }

        // A transport marker can refer to a legacy plaintext value when the
        // previous migration was deferred. Encrypt that value first; if the
        // Desktop vault is still unavailable, preserve the legacy copy rather
        // than replacing it with an unusable marker.
        if (runtimeBefore && !isStoredAgentCliCredential(runtimeBefore)) {
          try {
            const ref = freshAgentCliCredentialRef(input.dataDir, agentId, envKey);
            await writeCredential(ref, runtimeBefore);
            stagedRefs.push(ref);
            runtimeEnv![agentId]![envKey] = runtimeBefore;
            persistedEnv![agentId]![envKey] = markerForAgentCliCredentialRef(ref);
          } catch {
            migrationFailed = true;
            runtimeEnv![agentId]![envKey] = runtimeBefore;
            persistedEnv![agentId]![envKey] = runtimeBefore;
          }
        } else {
          delete runtimeEnv?.[agentId]?.[envKey];
          delete persistedEnv?.[agentId]?.[envKey];
        }
        continue;
      }

      if (isStoredAgentCliCredential(persistedBefore) && explicitlySupplied === undefined) {
        // The runtime view is hydrated, but this write did not touch the CLI
        // credential. Keep the existing reference without another vault IPC.
        persistedEnv![agentId]![envKey] = persistedBefore!;
        continue;
      }

      const isNewSecret = explicitlySupplied === nextValue
        && !isStoredAgentCliCredential(explicitlySupplied);
      hasExplicitNewSecret ||= isNewSecret;
      try {
        const ref = freshAgentCliCredentialRef(input.dataDir, agentId, envKey);
        await writeCredential(ref, nextValue);
        stagedRefs.push(ref);
        if (previousRef) refsToDelete.add(previousRef);
        persistedEnv![agentId]![envKey] = markerForAgentCliCredentialRef(ref);
      } catch (error) {
        if (isNewSecret) {
          await Promise.all(stagedRefs.map((ref) => deleteCredential(ref).catch(() => undefined)));
          throw error;
        }
        // Existing legacy plaintext must remain recoverable when migration is
        // impossible (for example, a standalone web daemon without Electron).
        persistedEnv![agentId]![envKey] = nextValue;
        migrationFailed = true;
      }
    }
  }

  if (migrationFailed) {
    await Promise.all(stagedRefs.map((ref) => deleteCredential(ref).catch(() => undefined)));
    if (hasExplicitNewSecret) {
      throw new Error('Local CLI credentials could not be stored atomically');
    }
    // Do not partially scrub a legacy file. Restore every pre-existing
    // credential field while allowing unrelated preference edits to persist.
    for (const [agentId, env] of Object.entries(input.existingPersisted.agentCliEnv ?? {})) {
      for (const [envKey, value] of Object.entries(env)) {
        if (!isAgentCliCredentialKey(agentId, envKey)) continue;
        persistedEnv ??= {};
        persistedEnv[agentId] ??= {};
        persistedEnv[agentId]![envKey] = value;
      }
    }
    console.warn('[app-config] Local CLI credential migration is waiting for the encrypted Desktop vault.');
  }

  const runtime = dropEmptyAgentCliEnvEntries(replaceAgentCliEnv(input.next, runtimeEnv));
  const persisted = dropEmptyAgentCliEnvEntries(replaceAgentCliEnv(input.next, persistedEnv));
  return {
    persisted,
    runtime,
    refsToDelete: [...(migrationFailed ? clearRefs : refsToDelete)],
    stagedRefs: migrationFailed ? [] : stagedRefs,
  };
}

async function doWrite(
  dataDir: string,
  partial: Record<string, unknown>,
): Promise<AppConfigPrefs> {
  const existing = await readAppConfig(dataDir);
  const existingPersisted = await readAppConfigFileOnly(dataDir);
  const next: Record<string, unknown> = { ...existing };
  for (const key of Object.keys(partial)) {
    if (!ALLOWED_KEYS.has(key as keyof AppConfigPrefs)) continue;
    applyConfigValue(next, key as keyof AppConfigPrefs, partial[key]);
  }
  const nextWithInferredIntent = Object.prototype.hasOwnProperty.call(partial, 'agentCliEnv')
    ? inferAgentCliEnvIntentForExplicitEnvWrite(next as AppConfigPrefs)
    : next as AppConfigPrefs;
  const normalizedNext = normalizeAgentCliEnvPrefs(nextWithInferredIntent);
  const secured = await prepareAgentCliCredentialsForWrite({
    dataDir,
    existingRuntime: existing,
    existingPersisted,
    next: normalizedNext,
    partial,
  });
  try {
    await persistAppConfigFile(dataDir, secured.persisted);
  } catch (error) {
    await Promise.all(secured.stagedRefs.map((ref) => deleteCredential(ref).catch(() => undefined)));
    throw error;
  }
  await Promise.all(
    secured.refsToDelete.map((ref) => deleteCredential(ref).catch(() => undefined)),
  );
  // Mirror the identity bits to the channel-root installation file so they
  // survive a namespace-scoped data-dir wipe. Only fires when the caller
  // explicitly touched `installationId` (avoiding noisy writes on every
  // unrelated app-config update). A write failure here doesn't roll back
  // the app-config write; the next read merges them transparently.
  if (Object.prototype.hasOwnProperty.call(partial, 'installationId')) {
    const id = secured.persisted.installationId;
    // Caller explicitly touched installationId; mirror the outcome
    // (including the clear case) to installation.json so a future read
    // doesn't keep serving the old value out of the channel-root file.
    // "Delete my data" relies on this clear path.
    const installPatch: InstallationFilePatch = {
      installationId: typeof id === 'string' && id.length > 0 ? id : null,
    };
    try {
      await writeInstallationFile(resolveInstallationDir(dataDir), installPatch);
    } catch {
      // swallow; install file mirroring is best-effort; the canonical
      // app-config write already succeeded.
    }
  }
  return secured.runtime;
}
