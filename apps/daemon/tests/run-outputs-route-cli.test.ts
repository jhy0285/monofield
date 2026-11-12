import type { Server } from 'node:http';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunLogListResponse, RunOutputDetailResponse, RunOutputListResponse, RunUsageSummaryResponse } from '@open-design/contracts';
import { startServer } from '../src/server.js';

const execute = promisify(execFile);
type Started = { url: string; server: Server; shutdown?: () => Promise<void> | void };

// The whole path a person takes: ask an AI tool for something in a project, the tool writes files, and afterwards
// the files and the request are found on the result shelf and in the work log, over HTTP and through the CLI.
// The tool is a stand-in `codex` that writes what its prompt names; everything else is the real daemon.
describe.skipIf(process.platform === 'win32')('run outputs through a real run, HTTP and CLI', { timeout: 120_000 }, () => {
  let started: Started;
  let dir: string;
  let projectId: string;
  let conversationId: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'monofield-run-outputs-e2e-'));
    const bin = path.join(dir, 'fake-codex');
    // Writes `report.md` with the last line of the prompt, so each request leaves different bytes.
    await writeFile(bin, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli 1.0.0-test'); process.exit(0); }
if (args[0] === 'debug' && args[1] === 'models') { console.log(JSON.stringify({ models: [] })); process.exit(0); }
if (args[0] === 'login' && args[1] === 'status') { console.log('Logged in using ChatGPT'); process.exit(0); }
if (!args.includes('exec')) { process.exit(0); }
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', () => {
  const marker = /REPORT:([^\\n]+)/g;
  let found, last = 'empty';
  while ((found = marker.exec(stdin))) last = found[1].trim();
  fs.writeFileSync('report.md', '# ' + last + '\\n');
  fs.writeFileSync('notes.py', 'print(1)\\n');
  console.log(JSON.stringify({ type: 'thread.started', thread_id: 't1' }));
  console.log(JSON.stringify({ type: 'turn.started' }));
  console.log(JSON.stringify({ type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'report.md written' } }));
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1200, cached_input_tokens: 1000, output_tokens: 300 } }));
});
`, 'utf8');
    await chmod(bin, 0o755);

    started = await startServer({ port: 0, returnServer: true }) as Started;
    const config = await fetch(`${started.url}/api/app-config`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'codex', agentCliEnv: { codex: { CODEX_BIN: bin } }, telemetry: { metrics: false, content: false, artifactManifest: false }, privacyDecisionAt: Date.now() }),
    });
    expect(config.status).toBe(200);
    projectId = `run_outputs_${randomUUID()}`;
    const created = await fetch(`${started.url}/api/projects`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: '주문 시스템', metadata: { kind: 'prototype', workMode: 'creation' }, skipDiscoveryBrief: true }),
    });
    expect(created.status).toBe(200);
    conversationId = (await created.json() as { conversationId: string }).conversationId;
  }, 60_000);

  afterAll(async () => {
    await Promise.resolve(started?.shutdown?.());
    started?.server.closeAllConnections?.();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function ask(request: string): Promise<string> {
    const response = await fetch(`${started.url}/api/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId, conversationId, assistantMessageId: `assistant_${randomUUID()}`, clientRequestId: `client_${randomUUID()}`,
        agentId: 'codex', sessionMode: 'docs', message: request, currentPrompt: request,
      }),
    });
    expect(response.status).toBe(202);
    const { runId } = await response.json() as { runId: string };
    for (let waited = 0; waited < 60_000; waited += 100) {
      const run = await (await fetch(`${started.url}/api/runs/${runId}`)).json() as { status: string };
      if (['succeeded', 'failed', 'canceled'].includes(run.status)) {
        expect(run.status).toBe('succeeded');
        return runId;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('the run did not finish');
  }
  const get = async <T>(suffix: string) => (await fetch(`${started.url}${suffix}`)).json() as Promise<T>;
  /** The copy is taken right after the run reaches its final status. */
  async function outputsOf(runId: string): Promise<RunOutputListResponse> {
    for (let waited = 0; waited < 5_000; waited += 50) {
      const run = (await get<RunLogListResponse>('/api/run-log')).runs.find((entry) => entry.runId === runId);
      if (run && run.status !== 'running' && run.finishedAt) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return get<RunOutputListResponse>(`/api/run-outputs?runId=${runId}`);
  }
  const cli = (args: string[], cwd = dir) => execute(process.execPath, [path.resolve('dist/cli.js'), ...args, '--daemon-url', started.url], { cwd });

  it('shelves what two requests produced, serves the old version, and puts it back', async () => {
    const first = await ask('주문 보고서를 써 줘\nREPORT:first draft');
    const firstOutputs = await outputsOf(first);
    // the Python file the tool also wrote is source, not a result
    expect(firstOutputs.outputs.map((output) => [output.path, output.version, output.change, output.agentName])).toEqual([['report.md', 1, 'created', 'Codex CLI']]);
    expect(firstOutputs.outputs[0]!.request).toBe('주문 보고서를 써 줘 REPORT:first draft');

    const second = await ask('환불 절을 추가해 줘\nREPORT:second draft');
    expect((await outputsOf(second)).outputs.map((output) => [output.version, output.change])).toEqual([[2, 'modified']]);

    const shelf = await get<RunOutputListResponse>(`/api/run-outputs?projectId=${projectId}`);
    expect(shelf.outputs.map((output) => [output.path, output.version, output.versionCount])).toEqual([['report.md', 2, 2]]);
    expect((await get<RunOutputListResponse>(`/api/run-outputs?projectId=${projectId}&q=${encodeURIComponent('주문 보고서')}&allVersions=1`)).outputs.map((output) => output.version)).toEqual([1]);

    const old = firstOutputs.outputs[0]!;
    const content = await fetch(`${started.url}/api/run-outputs/${old.id}/content`);
    expect(await content.text()).toBe('# first draft\n');
    expect(content.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(content.headers.get('content-security-policy')).toContain('sandbox');
    expect(await get<RunOutputDetailResponse>(`/api/run-outputs/${old.id}`)).toMatchObject({ current: 'changed', run: { runId: first, usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 1000, measured: true } } });

    // CLI: the same endpoints
    const listed = JSON.parse((await cli(['outputs', 'list', '--project', projectId, '--all-versions', '--json'])).stdout) as RunOutputListResponse;
    expect(listed.outputs.map((output) => output.id)).toEqual([shelf.outputs[0]!.id, old.id]);
    expect((await cli(['outputs', 'list', '--project', projectId])).stdout).toContain('report.md v2/2');
    expect((await cli(['outputs', 'show', old.id])).stdout).toMatch(/project file now: changed[\s\S]*versions:[\s\S]*v1 /);
    const saved = (await cli(['outputs', 'get', old.id, '--out', path.join(dir, 'old-report.md')])).stdout.trim();
    expect(await readFile(saved, 'utf8')).toBe('# first draft\n');

    expect((await cli(['outputs', 'restore', old.id])).stdout).toContain('Restored report.md to v1.');
    expect(await (await fetch(`${started.url}/api/projects/${projectId}/raw/report.md`)).text()).toBe('# first draft\n');
    expect((await get<RunOutputDetailResponse>(`/api/run-outputs/${old.id}`)).current).toBe('same');
  });

  it('adds up the work log and finds a request by its words', async () => {
    const summary = await get<RunUsageSummaryResponse>(`/api/run-log/usage?projectId=${projectId}`);
    expect(summary.totals).toMatchObject({ runs: 2, succeeded: 2, unmeasuredRuns: 0, inputTokens: 2400, outputTokens: 600, cacheReadTokens: 2000, totalTokens: 3000, outputs: 2 });
    expect(summary.byAgent).toMatchObject([{ key: 'codex', label: 'Codex CLI', runs: 2 }]);

    expect((await cli(['usage', '--project', projectId])).stdout).toMatch(/2 run\(s\): 2 succeeded[\s\S]*tokens: 3,000 \(input 2,400, output 600, cache read 2,000/);
    const found = JSON.parse((await cli(['usage', 'runs', '--project', projectId, '--q', '환불', '--json'])).stdout) as RunLogListResponse;
    expect(found.runs.map((run) => run.request)).toEqual(['환불 절을 추가해 줘 REPORT:second draft']);
    expect((await fetch(`${started.url}/api/run-outputs/nope`)).status).toBe(404);
  });
});
