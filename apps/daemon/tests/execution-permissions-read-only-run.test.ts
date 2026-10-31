import type http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

/**
 * At the "Read only" execution permission level a run starts only for agents whose
 * CLI has a read-only mode MonoField maps. The check runs against the real server
 * with the agent list emptied, so a supported agent is not refused but then reports
 * that its binary is missing, and an unsupported one is refused first.
 */
describe('read-only execution permission level on a real chat run', () => {
  let server: http.Server;
  let baseUrl: string;
  let shutdown: (() => Promise<void> | void) | undefined;
  const originalPath = process.env.PATH;
  const originalAgentHome = process.env.OD_AGENT_HOME;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
      shutdown?: () => Promise<void> | void;
    };
    baseUrl = started.url;
    server = started.server;
    shutdown = started.shutdown;
  });

  afterEach(async () => {
    process.env.PATH = originalPath;
    if (originalAgentHome == null) delete process.env.OD_AGENT_HOME;
    else process.env.OD_AGENT_HOME = originalAgentHome;
    await setLevel('default');
  });

  afterAll(async () => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    await Promise.resolve(shutdown?.());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function setLevel(level: string) {
    const response = await fetch(`${baseUrl}/api/execution-permissions`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level }),
    });
    expect(response.status).toBe(200);
  }

  async function chat(agentId: string): Promise<string> {
    process.env.PATH = '';
    const home = mkdtempSync(join(tmpdir(), 'od-read-only-agent-home-'));
    tempDirs.push(home);
    process.env.OD_AGENT_HOME = home;
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId, message: 'hello' }),
    });
    expect(response.ok).toBe(true);
    return response.text();
  }

  it('refuses an agent with no confirmed read-only mode before starting it', async () => {
    await setLevel('read-only');
    for (const agentId of ['amp', 'cursor-agent', 'devin', 'qoder', 'trae-cli', 'kiro']) {
      const body = await chat(agentId);
      expect(body, agentId).toContain('AGENT_READ_ONLY_UNSUPPORTED');
      expect(body, agentId).toContain('Settings → Execution permissions');
      expect(body, agentId).not.toContain('AGENT_UNAVAILABLE');
    }
  }, 60_000);

  it('does not refuse the agents that map the read-only level', async () => {
    await setLevel('read-only');
    for (const agentId of ['claude', 'codex', 'gemini', 'qwen', 'codebuddy', 'copilot']) {
      const body = await chat(agentId);
      expect(body, agentId).not.toContain('AGENT_READ_ONLY_UNSUPPORTED');
    }
  }, 60_000);

  it('refuses nothing at the default and full levels', async () => {
    for (const level of ['default', 'full']) {
      await setLevel(level);
      const body = await chat('amp');
      expect(body, level).not.toContain('AGENT_READ_ONLY_UNSUPPORTED');
    }
  }, 60_000);
});
