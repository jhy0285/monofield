import { execAgentFile } from './invocation.js';
import { AGENT_DEFS } from './registry.js';
import {
  DEFAULT_MODEL_OPTION,
  getRememberedLiveModels,
  rememberLiveModels,
} from './models.js';
import { applyAgentLaunchEnv, resolveAgentLaunch } from './launch.js';
import { spawnEnvForAgent } from './env.js';
import { probeAgentAuthStatus } from './auth.js';
import { agentCapabilities } from './capabilities.js';
import { installMetaForAgent } from './metadata.js';
import { resolveAmrProfile } from '../integrations/vela.js';
import {
  buildAuthDiagnostic,
  buildExecutableDiagnostic,
  buildNotInvocableDiagnostic,
  type NotInvocableCause,
} from './diagnostics.js';
import type {
  AgentDiagnostic,
  DetectedAgent,
  RuntimeAgentDef,
  RuntimeCapabilityMap,
  RuntimeModelSource,
  RuntimeModelOption,
} from './types.js';

type FetchedRuntimeModels = {
  models: RuntimeModelOption[];
  source: RuntimeModelSource;
};

export function mergeLiveModelsWithFallbacks(
  liveModels: RuntimeModelOption[],
  fallbackModels: RuntimeModelOption[],
): RuntimeModelOption[] {
  const byId = new Map<string, RuntimeModelOption>();
  const defaultModel =
    liveModels.find((model) => model.id === DEFAULT_MODEL_OPTION.id)
    ?? fallbackModels.find((model) => model.id === DEFAULT_MODEL_OPTION.id)
    ?? DEFAULT_MODEL_OPTION;
  byId.set(defaultModel.id, defaultModel);

  // Live-only entries are future discoveries, so place them before the
  // reviewed recommendations without requiring a MonoField release.
  const fallbackIds = new Set(fallbackModels.map((model) => model.id));
  for (const model of liveModels) {
    if (model.id !== DEFAULT_MODEL_OPTION.id && !fallbackIds.has(model.id)) {
      byId.set(model.id, model);
    }
  }
  // Reviewed entries retain their intended quality/latency order and prevent
  // an older CLI catalog from hiding a newly supported model.
  for (const model of fallbackModels) {
    if (model.id !== DEFAULT_MODEL_OPTION.id && !byId.has(model.id)) {
      byId.set(model.id, model);
    }
  }
  for (const model of liveModels) {
    if (model.id !== DEFAULT_MODEL_OPTION.id && !byId.has(model.id)) {
      byId.set(model.id, model);
    }
  }
  return [...byId.values()];
}

function surfaceFetchedModels(
  def: RuntimeAgentDef,
  models: RuntimeModelOption[],
): RuntimeModelOption[] {
  return def.augmentLiveModelsWithFallbacks
    ? mergeLiveModelsWithFallbacks(models, def.fallbackModels)
    : models;
}

function amrModelScopeFromEnv(env: NodeJS.ProcessEnv): string {
  return resolveAmrProfile(env);
}

function withRememberedAmrModels(
  def: RuntimeAgentDef,
  env: NodeJS.ProcessEnv,
  modelResult: FetchedRuntimeModels,
): FetchedRuntimeModels {
  if (def.id !== 'amr' || modelResult.models.length > 0) return modelResult;
  const rememberedModels = getRememberedLiveModels(def.id, amrModelScopeFromEnv(env));
  if (rememberedModels.length === 0) return modelResult;
  return { models: rememberedModels, source: 'live' };
}

async function fetchModels(
  def: RuntimeAgentDef,
  resolvedBin: string,
  env: NodeJS.ProcessEnv,
): Promise<FetchedRuntimeModels> {
  if (typeof def.fetchModels === 'function') {
    try {
      const parsed = await def.fetchModels(resolvedBin, env);
      if (!parsed || parsed.length === 0) {
        return { models: def.fallbackModels, source: 'fallback' };
      }
      return { models: surfaceFetchedModels(def, parsed), source: 'live' };
    } catch {
      return { models: def.fallbackModels, source: 'fallback' };
    }
  }
  if (!def.listModels) {
    return { models: def.fallbackModels, source: 'fallback' };
  }
  try {
    const { stdout } = await execAgentFile(resolvedBin, def.listModels.args, {
      env,
      timeout: def.listModels.timeoutMs ?? 5000,
      // Models lists from popular CLIs (e.g. opencode) easily exceed the
      // default 1MB buffer once you include every openrouter model. Bump
      // it so we don't truncate the listing.
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = def.listModels.parse(String(stdout));
    // Empty / null parse result means the CLI didn't actually return a
    // usable list (e.g. cursor-agent's "No models available"); fall back
    // to the static hint so the picker isn't stuck on Default-only.
    if (!parsed || parsed.length === 0) {
      return { models: def.fallbackModels, source: 'fallback' };
    }
    return { models: surfaceFetchedModels(def, parsed), source: 'live' };
  } catch {
    return { models: def.fallbackModels, source: 'fallback' };
  }
}

type VersionProbeOutcome =
  | { kind: 'not-invocable'; cause: NotInvocableCause }
  | { kind: 'spawned'; version: string | null };

/**
 * Run the agent's `--version` probe and classify the result. The probe
 * has two distinct failure modes the catch arm has to discriminate:
 *
 *   - **Not invocable.** The OS rejected the spawn outright, OR the
 *     wrapper script spawned but its underlying interpreter / target
 *     failed. We split permission failures (EACCES / exit 126) from
 *     missing-target failures (ENOENT / ENOTDIR / exit 127) so Settings can
 *     offer permission-specific copy instead of treating every failure as a
 *     broken shim. We still mark the agent unavailable so Settings does not
 *     advertise a ghost entry (issue #658, lefarcen review P2 on PR #1301).
 *
 *   - **Spawned but `--version` was unhappy.** The binary itself ran
 *     (any other rejection: timeout, generic non-zero exit, stderr
 *     noise) so the CLI is invocable; we just can't read a version
 *     string. Adapters whose `--version` flag is unsupported land
 *     here and must keep working with `version: null`.
 *
 * `child_process.execFile` reports OS-level rejections with a string
 * `err.code` (`'ENOENT'`, `'EACCES'`, `'ENOTDIR'`) and non-zero exit
 * codes with a *numeric* `err.code` equal to the exit status, so the
 * two arms below are unambiguous.
 */
async function probeVersionAtPath(
  def: RuntimeAgentDef,
  resolved: string,
  env: NodeJS.ProcessEnv,
): Promise<VersionProbeOutcome> {
  try {
    const { stdout, stderr } = await execAgentFile(resolved, def.versionArgs, {
      env,
      // GUI-launched Windows CLIs commonly go through npm .CMD shims. A cold
      // Node + security-scanner start takes 5-7 seconds on otherwise healthy
      // installs, so the old 3-second default surfaced installed CLIs with a
      // blank version. Probes run concurrently and only for resolved binaries,
      // making 10 seconds a bounded but realistic cross-platform budget.
      timeout: def.versionProbeTimeoutMs ?? 10_000,
    });
    // A few Windows wrappers/native CLIs print their version to stderr while
    // still exiting successfully. Treat that as normal version output so the
    // Settings catalog does not show an installed agent with a blank version.
    const output = String(stdout).trim() || String(stderr).trim();
    const version = output ? (output.split(/\r?\n/)[0] ?? null) : null;
    return { kind: 'spawned', version };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (typeof code === 'string') {
      if (code === 'EACCES') {
        return { kind: 'not-invocable', cause: 'not-executable' };
      }
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return { kind: 'not-invocable', cause: 'missing-target' };
      }
    } else if (typeof code === 'number' && (code === 126 || code === 127)) {
      return {
        kind: 'not-invocable',
        cause: code === 126 ? 'not-executable' : 'missing-target',
      };
    }
    return { kind: 'spawned', version: null };
  }
}

function unavailableAgent(
  def: RuntimeAgentDef,
  diagnostics: AgentDiagnostic[] = [],
): DetectedAgent {
  return {
    ...stripFns(def),
    models: def.fallbackModels ?? [DEFAULT_MODEL_OPTION],
    modelsSource: 'fallback',
    available: false,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    ...installMetaForAgent(def.id),
  };
}

// Probe the agent's `--help` once and record which advertised flags the
// installed CLI supports, so buildArgs can consult the cache. Extracted from
// the main probe so it can run concurrently with model + auth probing instead
// of blocking them. Returns the capability map (or null when the agent
// declares no help/capability metadata or the probe failed).
async function probeCapabilities(
  def: RuntimeAgentDef,
  launchPath: string,
  env: NodeJS.ProcessEnv,
): Promise<RuntimeCapabilityMap | null> {
  if (!def.helpArgs || !def.capabilityFlags) return null;
  try {
    const { stdout } = await execAgentFile(launchPath, def.helpArgs, {
      env,
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const caps: RuntimeCapabilityMap = {};
    for (const [flag, key] of Object.entries(def.capabilityFlags)) {
      caps[key] = String(stdout).includes(flag);
    }
    return caps;
  } catch {
    // If --help fails, leave caps empty so buildArgs falls back to the safe
    // baseline (no optional flags).
    return {};
  }
}

async function probe(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string> = {},
): Promise<DetectedAgent> {
  // Detection must probe the exact path the runtime will spawn, not just the
  // PATH-visible shim. This is load-bearing for Codex under nvm/fnm/mise:
  // the discovered `codex` entry is often a `#!/usr/bin/env node` wrapper
  // that is not invocable from a GUI-launched app's stripped PATH, while the
  // launch resolver can still upgrade it to the packaged native Codex binary.
  // If detection probes the shim but chat/run spawns the native binary, the
  // UI incorrectly reports "not installed" until the user pins CODEX_BIN by
  // hand even though the real launch path is healthy.
  const launch = resolveAgentLaunch(def, configuredEnv);
  if (!launch.selectedPath || !launch.launchPath) {
    return unavailableAgent(def, [buildExecutableDiagnostic(def, configuredEnv)]);
  }
  const probeEnv = applyAgentLaunchEnv(
    spawnEnvForAgent(
      def.id,
      {
        ...process.env,
        ...(def.env || {}),
      },
      configuredEnv,
      undefined,
      { resolvedBin: launch.selectedPath },
    ),
    launch,
  );
  const outcome = await probeVersionAtPath(def, launch.launchPath, probeEnv);
  if (outcome.kind === 'not-invocable') {
    return unavailableAgent(def, [
      buildNotInvocableDiagnostic(def, launch, outcome.cause),
    ]);
  }
  // The version probe must finish first (it gates availability), but the
  // three post-version probes are independent reads — run them concurrently
  // so a single agent's detection wall is max(help, models, auth) ≈ 5s rather
  // than the sum ≈ 15s. `--help` capabilities are cached on `agentCapabilities`
  // for buildArgs to consult.
  const [caps, modelResult, auth] = await Promise.all([
    probeCapabilities(def, launch.launchPath, probeEnv),
    fetchModels(def, launch.launchPath, probeEnv),
    probeAgentAuthStatus(def, launch.launchPath, probeEnv),
  ]);
  const surfacedModelResult = withRememberedAmrModels(def, probeEnv, modelResult);
  if (caps) {
    agentCapabilities.set(def.id, caps);
  }
  const authDiagnostic = auth ? buildAuthDiagnostic(def, auth) : null;
  return {
    ...stripFns(def),
    models: surfacedModelResult.models,
    modelsSource: surfacedModelResult.source,
    available: true,
    path: launch.selectedPath,
    version: outcome.version,
    ...(auth
      ? {
          authStatus: auth.status,
          ...(auth.message ? { authMessage: auth.message } : {}),
        }
      : {}),
    ...(authDiagnostic ? { diagnostics: [authDiagnostic] } : {}),
    ...installMetaForAgent(def.id),
  };
}

function stripFns(
  def: RuntimeAgentDef,
): Omit<DetectedAgent, 'models' | 'modelsSource' | 'available' | 'path' | 'version'> {
  // Drop the buildArgs / listModels closures but keep declarative metadata
  // (reasoningOptions, streamFormat, name, bin, etc.). `models` is
  // populated separately by `fetchModels`, so we strip the static
  // `fallbackModels` slot here too. `helpArgs` / `capabilityFlags` /
  // `fallbackBins` / `maxPromptArgBytes` / `env` are probe-or-spawn-only
  // metadata and shouldn't bleed into the API response either.
  // `inactivityTimeoutMs` is a spawn-time hint for the chat-run watchdog
  // and is not part of the public AgentInfo contract — strip it here so
  // the runtime registry stays the only consumer.
  const {
    buildArgs,
    listModels,
    fetchModels,
    augmentLiveModelsWithFallbacks,
    fallbackModels,
    helpArgs,
    capabilityFlags,
    fallbackBins,
    versionProbeTimeoutMs,
    maxPromptArgBytes,
    env,
    inactivityTimeoutMs,
    authProbe,
    ...rest
  } = def;
  return rest;
}

async function safeProbe(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string> = {},
): Promise<DetectedAgent> {
  try {
    return await probe(def, configuredEnv);
  } catch {
    // Fault isolation (issue #2297): one adapter's probe blowing up
    // — e.g. a synchronous filesystem throw during PATH walking on a
    // packaged Windows daemon, or an async rejection from one of the
    // post-launch probes — must not collapse the whole agent picker.
    // Without this guard the bare `Promise.all` rejected and the
    // `/api/agents` catch arm returned `[]`, so the UI silently lost
    // every CLI option and fell back to BYOK / Cloud only.
    return unavailableAgent(def);
  }
}

function rememberDetectedLiveModels(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string>,
  agent: DetectedAgent,
): void {
  if (def.id === 'amr' && agent.models.length === 0) return;
  const scope = def.id === 'amr'
    ? amrModelScopeFromEnv({
        ...process.env,
        ...(def.env || {}),
        ...configuredEnv,
      })
    : null;
  rememberLiveModels(agent.id, agent.models, scope);
}

export async function detectAgents(
  configuredEnvByAgent: Record<string, Record<string, string>> = {},
) {
  const results = await Promise.all(
    AGENT_DEFS.map((def) => safeProbe(def, configuredEnvByAgent?.[def.id] ?? {})),
  );
  // Refresh the validation cache from whatever we just surfaced to the UI
  // so /api/chat can accept any model the user could have just picked,
  // including ones that only showed up after a CLI re-auth.
  for (const [index, agent] of results.entries()) {
    const def = AGENT_DEFS[index];
    if (!def) continue;
    rememberDetectedLiveModels(def, configuredEnvByAgent?.[def.id] ?? {}, agent);
  }
  return results;
}

export type AgentDetectionStreamOptions = {
  /** Probe this configured runtime first so the active model is ready early. */
  priorityAgentId?: string | null;
  /** Bound child-process fan-out to avoid competing with the user's first run. */
  concurrency?: number;
};

// Streaming variant: yields each agent the moment its probe settles, in
// completion order rather than registry order, so the UI can paint a card
// as soon as it resolves instead of waiting for the slowest CLI. The model
// validation cache is refreshed per-agent (same effect as the batch path,
// just incrementally). `detectAgents` keeps the array contract for callers
// that don't care about incremental delivery (cache warm, analytics, chat).
export async function* detectAgentsStream(
  configuredEnvByAgent: Record<string, Record<string, string>> = {},
  options: AgentDetectionStreamOptions = {},
): AsyncGenerator<DetectedAgent> {
  const priorityAgentId = options.priorityAgentId?.trim() || null;
  const orderedDefs = priorityAgentId
    ? [
        ...AGENT_DEFS.filter((def) => def.id === priorityAgentId),
        ...AGENT_DEFS.filter((def) => def.id !== priorityAgentId),
      ]
    : [...AGENT_DEFS];
  const requestedConcurrency = Number.isFinite(options.concurrency)
    ? Math.floor(options.concurrency ?? orderedDefs.length)
    : orderedDefs.length;
  const concurrency = Math.max(1, Math.min(orderedDefs.length, requestedConcurrency));
  let nextIndex = 0;
  let taskId = 0;
  const pending = new Map<number, Promise<{ taskId: number; agent: DetectedAgent }>>();

  const launchNext = () => {
    const def = orderedDefs[nextIndex];
    if (!def) return;
    nextIndex += 1;
    const currentTaskId = taskId;
    taskId += 1;
    const configuredEnv = configuredEnvByAgent?.[def.id] ?? {};
    pending.set(
      currentTaskId,
      safeProbe(def, configuredEnv).then((agent) => {
        rememberDetectedLiveModels(def, configuredEnv, agent);
        return { taskId: currentTaskId, agent };
      }),
    );
  };

  for (let index = 0; index < concurrency; index += 1) launchNext();
  while (pending.size > 0) {
    const { taskId: settledTaskId, agent } = await Promise.race(pending.values());
    pending.delete(settledTaskId);
    yield agent;
    launchNext();
  }
}
