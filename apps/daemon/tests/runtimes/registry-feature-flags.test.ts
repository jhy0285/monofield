import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test('AMR stays absent from the default agent catalogue', async () => {
  vi.stubEnv('OD_ENABLE_AMR', undefined);
  vi.resetModules();
  const { AGENT_DEFS, getAgentDef } = await import('../../src/runtimes/registry.js');
  expect(AGENT_DEFS.some((agent) => agent.id === 'amr')).toBe(false);
  expect(getAgentDef('amr')).toBeNull();
  expect(getAgentDef('codex')).not.toBeNull();
});

test('explicitly enabling AMR exposes the real adapter', async () => {
  vi.stubEnv('OD_ENABLE_AMR', '1');
  vi.resetModules();
  const { AGENT_DEFS, getAgentDef } = await import('../../src/runtimes/registry.js');
  expect(AGENT_DEFS.filter((agent) => agent.id === 'amr')).toHaveLength(1);
  expect(getAgentDef('amr')).toMatchObject({ bin: 'vela', streamFormat: 'acp-json-rpc' });
});
