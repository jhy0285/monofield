import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatRunStatusResponse } from '@open-design/contracts';
import { startServer, type StartServerResult } from '../src/server.js';

describe('required browser verification run status', { timeout: 30_000 }, () => {
  let started: StartServerResult;
  let fixture: string;
  let binary: string;
  let captureOk = true;
  beforeAll(async () => {
    fixture = await mkdtemp(path.join(os.tmpdir(), 'monofield-verification-run-'));
    const source = `if (process.argv.includes('--version')) { console.log('codex-cli 1.0.0-test'); process.exit(0); }
if (!process.argv.includes('exec')) process.exit(0);
process.stdin.resume();
process.stdin.on('end', () => {
  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'verification-thread' }));
  console.log(JSON.stringify({ type: 'item.completed', item: { id: 'message', type: 'agent_message', text: 'Ready for host verification.' } }));
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 3 } }));
});`;
    const script = path.join(fixture, 'fake-codex.cjs'); await writeFile(script, source);
    binary = path.join(fixture, process.platform === 'win32' ? 'fake-codex.cmd' : 'fake-codex');
    await writeFile(binary, process.platform === 'win32' ? `@echo off\r\nnode "${script}" %*\r\n` : `#!/usr/bin/env node\n${source}`);
    if (process.platform !== 'win32') await chmod(binary, 0o755);
    started = await startServer({ port: 0, returnServer: true, desktopBrowserAutomation: async (input) => ({
      action: input.action, sessionId: input.sessionId, ok: true,
      data: { results: ['navigate', 'page-info', 'snapshot', 'screenshot'].map((action) => ({ action, ok: action !== 'screenshot' || captureOk })) },
    }) }) as StartServerResult;
    await configure();
  });
  afterAll(async () => { await stop(); await rm(fixture, { recursive: true, force: true }); });

  async function stop() {
    if (started) { await started.shutdown?.(); started.server.close(); started.server.closeAllConnections?.(); }
  }
  async function configure() {
    const response = await fetch(`${started.url}/api/app-config`, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentCliEnv: { codex: { CODEX_BIN: binary } }, privacyDecisionAt: 1, telemetry: { metrics: false, content: false, artifactManifest: false } }),
    });
    expect(response.ok).toBe(true);
  }
  async function run(): Promise<ChatRunStatusResponse> {
    const projectId = `verify_${randomUUID()}`;
    const projectResponse = await fetch(`${started.url}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: 'Verification', metadata: { kind: 'prototype' }, skipDiscoveryBrief: true }),
    });
    expect(projectResponse.ok).toBe(true);
    const project = await projectResponse.json() as { conversationId: string };
    const response = await fetch(`${started.url}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      projectId, conversationId: project.conversationId, agentId: 'codex', sessionMode: 'chat', message: 'Verify the approved page.',
      browserVerification: { sessionId: 'browser_session_1234567890', origin: 'http://127.0.0.1:4173', url: 'http://127.0.0.1:4173/orders' },
    }) });
    expect(response.status).toBe(202);
    const created = await response.json() as { runId: string };
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const snapshot = await fetch(`${started.url}/api/runs/${created.runId}`).then((result) => result.json()) as ChatRunStatusResponse;
      if (['succeeded', 'failed', 'canceled'].includes(snapshot.status)) return snapshot;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Run did not settle.');
  }
  it('publishes successful capture with its limited verification scope', async () => {
    const result = await run();
    expect(result.status).toBe('succeeded');
    expect(result.verification).toMatchObject({ scope: 'browser-capture', ok: true, interactionActions: [] });
  });
  it('fails the run when the agent exits successfully but a required capture fails', async () => {
    captureOk = false;
    const result = await run();
    expect(result.status).toBe('failed'); expect(result.errorCode).toBe('BROWSER_VERIFICATION_FAILED');
    expect(result.verification?.ok).toBe(false);
  });
  it('fails required verification when there is no desktop browser backend', async () => {
    await stop();
    started = await startServer({ port: 0, returnServer: true }) as StartServerResult;
    await configure();
    const result = await run();
    expect(result.status).toBe('failed'); expect(result.errorCode).toBe('BROWSER_VERIFICATION_FAILED');
    expect(result.verification?.error).toContain('unavailable');
  });
});
