import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatRunStatusResponse } from '@open-design/contracts';
import { startServer, type StartServerResult } from '../src/server.js';
import { readMemoryConfig, writeMemoryConfig } from '../src/memory.js';

describe('Codex native prompt cost', { timeout: 30_000 }, () => {
  let started: StartServerResult;
  let root: string;
  let capture: string;
  let projectId: string;
  let conversationId: string;
  let originalMemory: Awaited<ReturnType<typeof readMemoryConfig>>;

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'monofield-codex-cost-'));
    capture = path.join(root, 'capture.jsonl');
    const source = `const fs = require('node:fs');
if (process.argv.includes('--version')) { console.log('codex-cli 1.0.0-test'); process.exit(0); }
if (!process.argv.includes('exec')) process.exit(0);
let prompt = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', part => prompt += part);
process.stdin.on('end', () => {
  fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify({prompt,args:process.argv.slice(2)})+'\\n');
  console.log(JSON.stringify({type:'thread.started',thread_id:'native-cost-thread'}));
  console.log(JSON.stringify({type:'item.completed',item:{id:'message',type:'agent_message',text:'Done.'}}));
  console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:20,cached_input_tokens:10,output_tokens:2}}));
});`;
    const script = path.join(root, 'fake-codex.cjs');
    await writeFile(script, source);
    const binary = path.join(root, process.platform === 'win32' ? 'fake-codex.cmd' : 'fake-codex');
    await writeFile(binary, process.platform === 'win32' ? `@echo off\r\nnode "${script}" %*\r\n` : `#!/usr/bin/env node\n${source}`);
    if (process.platform !== 'win32') await chmod(binary, 0o755);
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('The test setup must provide isolated daemon storage.');
    originalMemory = await readMemoryConfig(dataDir);
    await writeMemoryConfig(dataDir, { enabled: false });
    started = await startServer({ port: 0, returnServer: true }) as StartServerResult;
    const config = await fetch(`${started.url}/api/app-config`, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customInstructions: '', agentCliEnv: { codex: { CODEX_BIN: binary } },
        privacyDecisionAt: 1, telemetry: { metrics: false, content: false, artifactManifest: false } }),
    });
    expect(config.ok).toBe(true);
    const created = await fetch(`${started.url}/api/import/folder`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseDir: root, name: 'Native Codex cost' }),
    });
    expect(created.ok).toBe(true);
    const imported = await created.json() as { project: { id: string }; conversationId: string };
    projectId = imported.project.id; conversationId = imported.conversationId;
  });

  afterAll(async () => {
    if (started) { await started.shutdown?.(); started.server.close(); started.server.closeAllConnections?.(); }
    if (originalMemory && process.env.OD_DATA_DIR) await writeMemoryConfig(process.env.OD_DATA_DIR, originalMemory);
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function run(currentPrompt: string, extra: Record<string, unknown> = {}) {
    const response = await fetch(`${started.url}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'codex', projectId, conversationId, sessionMode: 'chat',
        message: `## user\n${currentPrompt}`, currentPrompt, titleGeneration: { enabled: true }, ...extra }),
    });
    expect(response.ok).toBe(true);
    const body = await response.text();
    const captures = (await readFile(capture, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as { prompt: string; args: string[] });
    const runs = await fetch(`${started.url}/api/runs?conversationId=${conversationId}`).then((result) => result.json()) as { runs: ChatRunStatusResponse[] };
    return { capture: captures.at(-1)!, body, runs: runs.runs };
  }

  it('adds zero prompt characters on a plain create and resume turn, including local title generation', async () => {
    const first = '주문 API의 타입을 확인해줘. 외부 API로 코드를 전송하지 마.';
    const created = await run(first);
    expect(created.capture.prompt).toBe(first);
    expect(created.runs[0]?.promptContext).toMatchObject({ profile: 'codex-native', addedCharacters: 0 });
    expect(created.capture.args).toContain('-C');
    expect(created.body).toContain('conversation_title');
    const second = '앞서 지정한 제약을 유지하고 오류만 수정해줘.';
    const resumed = await run(second, { message: `## user\n${first}\n\n## assistant\nDone.\n\n## user\n${second}` });
    expect(resumed.capture.prompt).toBe(second);
    expect(resumed.capture.args).toContain('resume');
    expect(resumed.runs.some((item) => item.promptCache?.hit === true)).toBe(true);
    const runRecord = resumed.runs.find((item) => item.promptContext?.requestCharacters === second.length);
    expect(runRecord).toBeDefined();
    const cliPath = process.env.OD_DAEMON_CLI_PATH;
    if (!cliPath) throw new Error('The test setup must build the daemon CLI.');
    const cli = await promisify(execFile)(process.execPath, [cliPath, 'run', 'info', runRecord!.id,
      '--daemon-url', started.url, '--json'], { encoding: 'utf8', timeout: 10_000 });
    expect(JSON.parse(cli.stdout).promptContext).toEqual(runRecord!.promptContext);
  });

  it('retains a selected file target instead of treating attached context as disposable', async () => {
    await writeFile(path.join(root, 'orders.ts'), 'export const id = 1;');
    const result = await run('이 파일을 검토해줘.', { attachments: ['orders.ts'] });
    expect(result.capture.prompt).toContain('orders.ts');
    expect(result.capture.prompt).toContain('이 파일을 검토해줘.');
    expect(result.capture.prompt).not.toContain('Root snapshot:');
    expect(result.capture.prompt.length).toBeLessThan(700);
  });

  it('announces changed or removed instructions without erasing conversation constraints', async () => {
    const selected = await run('Apply the selected convention.', { systemPrompt: 'Use the selected A_STYLE convention for this turn.' });
    expect(selected.capture.prompt).toContain('A_STYLE');
    const cleared = await run('The next task has no selected convention.');
    expect(cleared.capture.prompt).toContain('Previously supplied MonoField context is historical');
    expect(cleared.capture.prompt).toContain("Continue honoring the user's conversation constraints");
    expect(cleared.capture.prompt).not.toContain('A_STYLE');
  });
});
