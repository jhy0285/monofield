import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DetectedAgent } from '../../src/runtimes/types.js';

const detectionMocks = vi.hoisted(() => ({
  batch: vi.fn(),
  streamResults: [] as DetectedAgent[],
  streamCalls: [] as Array<{ env: unknown; options: unknown }>,
}));

vi.mock('../../src/runtimes/detection.js', () => ({
  detectAgents: detectionMocks.batch,
  detectAgentsStream: async function* (env: unknown, options: unknown) {
    detectionMocks.streamCalls.push({ env, options });
    for (const agent of detectionMocks.streamResults) yield agent;
  },
}));

import {
  clearAgentDetectionCache,
  detectAgents,
  detectAgentsStream,
} from '../../src/runtimes/detection-cache.js';
import { AGENT_DEFS } from '../../src/runtimes/registry.js';

function detectedAgents(version: string): DetectedAgent[] {
  return AGENT_DEFS.map((def) => ({
    id: def.id,
    name: def.name,
    bin: def.bin,
    versionArgs: def.versionArgs,
    streamFormat: def.streamFormat,
    models: [],
    modelsSource: 'fallback',
    available: def.id === 'codex',
    version,
  }));
}

describe('agent detection cache', () => {
  beforeEach(() => {
    clearAgentDetectionCache();
    detectionMocks.batch.mockReset();
    detectionMocks.streamResults = [];
    detectionMocks.streamCalls = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces concurrent batch scans and reuses the completed snapshot', async () => {
    let resolveScan: ((agents: DetectedAgent[]) => void) | undefined;
    detectionMocks.batch.mockReturnValue(
      new Promise<DetectedAgent[]>((resolve) => {
        resolveScan = resolve;
      }),
    );

    const first = detectAgents({ codex: { CODEX_BIN: 'codex-test' } });
    const concurrent = detectAgents({ codex: { CODEX_BIN: 'codex-test' } });

    expect(detectionMocks.batch).toHaveBeenCalledTimes(1);
    resolveScan?.(detectedAgents('1.0.0'));
    await expect(first).resolves.toEqual(await concurrent);

    const cached = await detectAgents({ codex: { CODEX_BIN: 'codex-test' } });
    expect(cached.find((agent) => agent.id === 'codex')?.version).toBe('1.0.0');
    expect(detectionMocks.batch).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a snapshot after the configured CLI environment changes', async () => {
    detectionMocks.batch
      .mockResolvedValueOnce(detectedAgents('first-config'))
      .mockResolvedValueOnce(detectedAgents('second-config'));

    const first = await detectAgents({ codex: { CODEX_BIN: 'codex-one' } });
    const second = await detectAgents({ codex: { CODEX_BIN: 'codex-two' } });

    expect(first.find((agent) => agent.id === 'codex')?.version).toBe('first-config');
    expect(second.find((agent) => agent.id === 'codex')?.version).toBe('second-config');
    expect(detectionMocks.batch).toHaveBeenCalledTimes(2);
  });

  it('returns stale batch data immediately while refreshing it in the background', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'));
    detectionMocks.batch.mockResolvedValueOnce(detectedAgents('1.0.0'));
    await detectAgents();

    let resolveRefresh: ((agents: DetectedAgent[]) => void) | undefined;
    detectionMocks.batch.mockReturnValueOnce(
      new Promise<DetectedAgent[]>((resolve) => {
        resolveRefresh = resolve;
      }),
    );
    vi.setSystemTime(new Date('2026-08-21T00:00:31.000Z'));

    const stale = await detectAgents();
    expect(stale.find((agent) => agent.id === 'codex')?.version).toBe('1.0.0');
    expect(detectionMocks.batch).toHaveBeenCalledTimes(2);

    resolveRefresh?.(detectedAgents('2.0.0'));
    await Promise.resolve();
    const refreshed = await detectAgents();
    expect(refreshed.find((agent) => agent.id === 'codex')?.version).toBe('2.0.0');
  });

  it('keeps streamed settings rescans fresh and shares the completed result with batch callers', async () => {
    detectionMocks.streamResults = detectedAgents('3.0.0');
    const streamed: DetectedAgent[] = [];
    for await (const agent of detectAgentsStream()) streamed.push(agent);

    expect(streamed).toHaveLength(AGENT_DEFS.length);
    const cached = await detectAgents();
    expect(cached.find((agent) => agent.id === 'codex')?.version).toBe('3.0.0');
    expect(detectionMocks.batch).not.toHaveBeenCalled();
  });

  it('forwards priority and concurrency to the fresh settings scan', async () => {
    detectionMocks.streamResults = detectedAgents('4.0.0');
    const options = { priorityAgentId: 'codex', concurrency: 4 };

    for await (const _agent of detectAgentsStream(
      { codex: { CODEX_BIN: 'codex-test' } },
      options,
    )) {
      // consume the stream
    }

    expect(detectionMocks.streamCalls).toEqual([{
      env: { codex: { CODEX_BIN: 'codex-test' } },
      options,
    }]);
  });
});
