import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  codexWindowsSandboxEnvironmentFingerprint,
  recordCodexWindowsSandboxLogonFailure,
  resetCodexWindowsSandboxCircuitForTests,
} from '../src/codex-windows-sandbox.js';
import { startServer } from '../src/server.js';

type StartedServer = {
  url: string;
  server: Server;
  shutdown?: () => Promise<void> | void;
};

type RunStatus = {
  id: string;
  status: string;
  errorCode: string | null;
  eventsLogPath: string;
};

type RunEvent = {
  event: string;
  data: Record<string, unknown>;
};

describe('host-owned artifact fallback runtime', { timeout: 120_000 }, () => {
  const originalSandbox = process.env.OD_CODEX_SANDBOX;
  let started: StartedServer | null = null;
  let fixtureDir: string | null = null;

  afterEach(async () => {
    resetCodexWindowsSandboxCircuitForTests();
    await Promise.resolve(started?.shutdown?.());
    if (started?.server) {
      await new Promise<void>((resolve) => started?.server.close(() => resolve()));
    }
    started = null;
    if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
    fixtureDir = null;
    if (originalSandbox === undefined) delete process.env.OD_CODEX_SANDBOX;
    else process.env.OD_CODEX_SANDBOX = originalSandbox;
  });

  it.skipIf(process.platform !== 'win32')(
    'bypasses an open native circuit exactly once with the no-tools artifact contract',
    async () => {
      fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'monofield-artifact-fallback-'));
      const promptLog = path.join(fixtureDir, 'prompts.jsonl');
      const codexBin = await writeFakeCodex(fixtureDir, promptLog);
      delete process.env.OD_CODEX_SANDBOX;

      started = await startServer({ port: 0, returnServer: true }) as StartedServer;
      await putConfig(started.url, {
        agentId: 'codex',
        agentCliEnv: { codex: { CODEX_BIN: codexBin } },
        telemetry: { metrics: false, content: false, artifactManifest: false },
        privacyDecisionAt: Date.now(),
      });

      // Model a prior CreateProcessWithLogonW/1385 failure. The filesystem
      // attempt must be skipped; the replacement text_artifact attempt must
      // still spawn even though the native circuit is open.
      recordCodexWindowsSandboxLogonFailure({
        environmentFingerprint: codexWindowsSandboxEnvironmentFingerprint({
          binaryPath: codexBin,
        }),
      });
      const run = await createAndWaitForRun(started.url);

      expect(run.status).toBe('succeeded');
      expect(run.errorCode).toBeNull();
      const attempts = (await readFile(promptLog, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as {
          stdin: string;
          args: string[];
          cwd: string;
          toolToken: string | null;
          projectId: string | null;
        });
      expect(attempts).toHaveLength(1);
      expect(attempts[0].stdin).toContain('# API mode — no tools available');
      expect(attempts[0].stdin).toContain('## Text-artifact handoff');
      expect(attempts[0].stdin).not.toContain('## Filesystem handoff');
      expect(attempts[0].args).toContain('shell_tool');
      expect(attempts[0].args).toContain('unified_exec');
      expect(attempts[0].args).toContain('mcp_servers={}');
      expect(attempts[0].toolToken).toBeNull();
      expect(attempts[0].projectId).toBeNull();
      expect(attempts[0].cwd.replace(/\\/g, '/')).toContain('/runtime/text-artifact/');

      const events = await readRunEvents(run.eventsLogPath);
      expect(events.filter((event) => (
        event.event === 'diagnostic'
        && event.data.type === 'artifact_delivery_fallback_started'
      ))).toHaveLength(1);
      expect(events.some((event) => (
        event.event === 'error'
        && (event.data.code === 'CODEX_WINDOWS_SANDBOX_UNAVAILABLE'
          || (event.data.error as { code?: unknown } | undefined)?.code === 'CODEX_WINDOWS_SANDBOX_UNAVAILABLE')
      ))).toBe(false);
    },
  );
});

async function writeFakeCodex(dir: string, promptLog: string): Promise<string> {
  const source = `const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli 1.0.0-test'); process.exit(0); }
if (args[0] === 'debug' && args[1] === 'models') { console.log(JSON.stringify({ models: [] })); process.exit(0); }
if (args[0] === 'login' && args[1] === 'status') { console.log('Logged in using ChatGPT'); process.exit(0); }
if (!args.includes('exec')) { process.exit(0); }
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', () => {
  fs.appendFileSync(${JSON.stringify(promptLog)}, JSON.stringify({
    stdin,
    args,
    cwd: process.cwd(),
    toolToken: process.env.MONOFIELD_TOOL_TOKEN || null,
    projectId: process.env.MONOFIELD_PROJECT_ID || null,
  }) + '\\n');
  const artifact = '<artifact identifier="runtime-proof" type="text/html" title="Runtime proof"><!doctype html><html><head><title>Proof</title></head><body><main><h1>Recovered</h1></main></body></html></artifact>';
  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'artifact-fallback-thread' }));
  console.log(JSON.stringify({ type: 'turn.started' }));
  console.log(JSON.stringify({ type: 'item.completed', item: { id: 'artifact-message', type: 'agent_message', text: artifact } }));
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 12, cached_input_tokens: 0, output_tokens: 4 } }));
});
`;
  const scriptPath = path.join(dir, 'fake-codex.js');
  await writeFile(scriptPath, source, 'utf8');
  if (process.platform === 'win32') {
    const cmdPath = path.join(dir, 'fake-codex.cmd');
    await writeFile(cmdPath, '@echo off\r\nnode "%~dp0fake-codex.js" %*\r\n', 'utf8');
    return cmdPath;
  }
  const binPath = path.join(dir, 'fake-codex');
  await writeFile(binPath, `#!/usr/bin/env node\n${source}`, 'utf8');
  await chmod(binPath, 0o755);
  return binPath;
}

async function putConfig(url: string, patch: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${url}/api/app-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  expect(response.status).toBe(200);
}

async function createAndWaitForRun(url: string): Promise<RunStatus> {
  const projectId = `artifact_fallback_${randomUUID()}`;
  const projectResponse = await fetch(`${url}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: projectId,
      name: 'Artifact fallback runtime',
      metadata: { kind: 'prototype', workMode: 'creation' },
      skipDiscoveryBrief: true,
    }),
  });
  expect(projectResponse.status).toBe(200);
  const project = await projectResponse.json() as { conversationId: string };
  const response = await fetch(`${url}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId,
      conversationId: project.conversationId,
      assistantMessageId: `assistant_${randomUUID()}`,
      clientRequestId: `client_${randomUUID()}`,
      agentId: 'codex',
      sessionMode: 'docs',
      message: 'Create a complete dashboard document.',
      currentPrompt: 'Create a complete dashboard document.',
    }),
  });
  expect(response.status).toBe(202);
  const created = await response.json() as { runId: string };
  return waitForRun(url, created.runId);
}

async function waitForRun(url: string, runId: string): Promise<RunStatus> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    const response = await fetch(`${url}/api/runs/${encodeURIComponent(runId)}`);
    expect(response.status).toBe(200);
    const run = await response.json() as RunStatus;
    if (['succeeded', 'failed', 'canceled'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`run ${runId} did not finish`);
}

async function readRunEvents(file: string): Promise<RunEvent[]> {
  const raw = await readFile(file, 'utf8');
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunEvent);
}
