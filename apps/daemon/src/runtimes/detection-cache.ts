import { createHash } from 'node:crypto';

import {
  detectAgents as detectAgentsFresh,
  detectAgentsStream as detectAgentsStreamFresh,
  type AgentDetectionStreamOptions,
} from './detection.js';
import { AGENT_DEFS } from './registry.js';
import type { DetectedAgent } from './types.js';

type ConfiguredAgentEnv = Record<string, Record<string, string>>;

type DetectionCacheEntry = {
  results: DetectedAgent[] | null;
  refreshedAt: number;
  lastAccessedAt: number;
  revision: number;
  refresh: Promise<DetectedAgent[]> | null;
};

// Agent detection is intentionally expensive: every installed adapter can run
// --version, --help, model-list, and auth-status probes. Chat-run analytics and
// fallback agent selection also call detectAgents(), so repeating those probes
// on every turn competes with the CLI process that is about to serve the user.
//
// The settings UI uses detectAgentsStream(), which always performs a fresh
// rescan. Batch callers get a short fresh window and stale-while-revalidate
// afterwards: once a complete result exists, they never block a chat turn on
// metadata probes. A changed daemon environment or per-agent configuration has
// a different hashed key and therefore still gets a cold, authoritative scan.
const DETECTION_CACHE_FRESH_MS = 30_000;
const DETECTION_CACHE_MAX_ENTRIES = 8;

const detectionCache = new Map<string, DetectionCacheEntry>();

function cloneConfiguredEnv(configuredEnvByAgent: ConfiguredAgentEnv): ConfiguredAgentEnv {
  return Object.fromEntries(
    Object.entries(configuredEnvByAgent).map(([agentId, env]) => [
      agentId,
      { ...env },
    ]),
  );
}

function sortedRecordEntries(
  record: Record<string, string | undefined>,
): Array<[string, string]> {
  return Object.entries(record)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .sort(([left], [right]) => left.localeCompare(right));
}

function cacheKey(configuredEnvByAgent: ConfiguredAgentEnv): string {
  const configuredEntries = Object.entries(configuredEnvByAgent)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([agentId, env]) => [agentId, sortedRecordEntries(env)]);
  // Hash instead of retaining a JSON string because configured CLI env may
  // contain API keys. The cache needs equality, never the original values.
  return createHash('sha256')
    .update(JSON.stringify({ configuredEntries, processEnv: sortedRecordEntries(process.env) }))
    .digest('hex');
}

function trimCache(): void {
  if (detectionCache.size <= DETECTION_CACHE_MAX_ENTRIES) return;
  const oldest = [...detectionCache.entries()]
    .sort(([, left], [, right]) => left.lastAccessedAt - right.lastAccessedAt)
    .slice(0, detectionCache.size - DETECTION_CACHE_MAX_ENTRIES);
  for (const [key] of oldest) detectionCache.delete(key);
}

function beginRefresh(
  key: string,
  configuredEnvByAgent: ConfiguredAgentEnv,
): Promise<DetectedAgent[]> {
  const previous = detectionCache.get(key);
  if (previous?.refresh) return previous.refresh;

  const revision = (previous?.revision ?? 0) + 1;
  const startedAt = Date.now();
  const refresh = detectAgentsFresh(cloneConfiguredEnv(configuredEnvByAgent))
    .then((results) => {
      const current = detectionCache.get(key);
      if (current?.revision === revision) {
        detectionCache.set(key, {
          results,
          refreshedAt: Date.now(),
          lastAccessedAt: Date.now(),
          revision,
          refresh: null,
        });
        trimCache();
      }
      return results;
    })
    .catch((error: unknown) => {
      const current = detectionCache.get(key);
      if (current?.revision === revision) {
        if (previous?.results) {
          detectionCache.set(key, {
            ...previous,
            lastAccessedAt: Date.now(),
            revision,
            refresh: null,
          });
        } else {
          detectionCache.delete(key);
        }
      }
      throw error;
    });

  detectionCache.set(key, {
    results: previous?.results ?? null,
    refreshedAt: previous?.refreshedAt ?? 0,
    lastAccessedAt: startedAt,
    revision,
    refresh,
  });
  trimCache();
  return refresh;
}

export async function detectAgents(
  configuredEnvByAgent: ConfiguredAgentEnv = {},
): Promise<DetectedAgent[]> {
  const key = cacheKey(configuredEnvByAgent);
  const cached = detectionCache.get(key);
  const now = Date.now();

  if (cached?.results) {
    cached.lastAccessedAt = now;
    if (now - cached.refreshedAt >= DETECTION_CACHE_FRESH_MS && !cached.refresh) {
      // Batch callers such as run analytics need availability metadata, not a
      // blocking rescan. Keep serving the last complete snapshot while the
      // next one refreshes in the background.
      void beginRefresh(key, configuredEnvByAgent).catch(() => {});
    }
    return cached.results;
  }

  return beginRefresh(key, configuredEnvByAgent);
}

export async function* detectAgentsStream(
  configuredEnvByAgent: ConfiguredAgentEnv = {},
  options: AgentDetectionStreamOptions = {},
): AsyncGenerator<DetectedAgent> {
  const key = cacheKey(configuredEnvByAgent);
  const startedRevision = (detectionCache.get(key)?.revision ?? 0) + 1;
  const byId = new Map<string, DetectedAgent>();
  let completed = false;

  // Streaming is the explicit rescan surface. It must stay live so an install,
  // login, or env change made outside MonoField appears as soon as the user
  // returns to Settings.
  try {
    for await (const agent of detectAgentsStreamFresh(
      cloneConfiguredEnv(configuredEnvByAgent),
      options,
    )) {
      byId.set(agent.id, agent);
      yield agent;
    }
    completed = true;
  } finally {
    if (completed && byId.size === AGENT_DEFS.length) {
      const results = AGENT_DEFS
        .map((def) => byId.get(def.id))
        .filter((agent): agent is DetectedAgent => Boolean(agent));
      detectionCache.set(key, {
        results,
        refreshedAt: Date.now(),
        lastAccessedAt: Date.now(),
        revision: startedRevision,
        refresh: null,
      });
      trimCache();
    }
  }
}

export function clearAgentDetectionCache(): void {
  detectionCache.clear();
}
