import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { providerUsage as usage, cumulativeDelta as delta, type Usage } from '../lib/token-benchmark/usage.js';
import { completedAnswer, summarizeSamples, type Sample } from '../lib/token-benchmark/scoring.js';

// Real executions only. No fake provider, tokenizer estimate or invented usage.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.resolve(process.env.MONOFIELD_BENCH_OUTPUT || path.join(repository, '.tmp/token-efficiency/results', randomUUID()));
const model = process.env.MONOFIELD_BENCH_MODEL || 'gpt-6.1-sol';
const pairs = Number(process.env.MONOFIELD_BENCH_PAIRS || '3');
if (!Number.isInteger(pairs) || pairs < 1 || pairs > 5) throw new Error('Pairs must be 1..5.');
const prompts = {
  first: 'Remember the code BENCH_A7 for this conversation. Reply exactly BENCH_A7. Do not invoke tools.',
  resume: 'Reply only with the code I asked you to remember in the previous turn. Do not invoke tools.',
  review: 'Read totals.ts. Which function incorrectly omits the last array element? Reply only with its function name. Do not modify files or invoke external tools.',
};
const samples: Sample[] = [];
const checks: Array<{ lane: string; status: string; usage: Usage | null; answer?: string; error?: string }> = [];
const checkOnly = process.argv.includes('--check');
const metadata = { schemaVersion: 2, answerScoring: 'final completed assistant message; full transcript format scored separately', model, reasoning: 'low', pairs, prompts, codexVersion: '', loginStatus: '', mode: checkOnly ? 'check' : 'benchmark',
  baseline: 'Direct CLI with plugins disabled, matching MonoField catalog policy; inherited auth/config unchanged',
  cache: 'Provider cached input is included in input; no invented cache flush or dollar estimate',
  plannedModelTurns: checkOnly ? 2 : pairs * 6 + 1, pairedModelTurns: checkOnly ? 0 : pairs * 6 };
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'plan.json'), JSON.stringify(metadata, null, 2));
if (!process.argv.includes('--run') && !checkOnly) {
  process.stdout.write(JSON.stringify({ status: 'prepared', ...metadata, output }, null, 2) + '\n');
  process.exit(0);
}

const namespace = `token-bench-${randomUUID().slice(0, 8)}`;
const fixture = path.resolve(process.env.MONOFIELD_BENCH_FIXTURE || path.join(output, namespace, 'fixture'));
const daemonEnv = { ...process.env, OD_DATA_DIR: path.join(output, namespace, 'daemon-data'),
  OD_CODEX_SANDBOX: 'workspace-write', OD_CODEX_DISABLE_PLUGINS: '1', MONOFIELD_CODEX_ENABLE_EXTERNAL_PLUGINS: '0' };
let daemonUrl: string | null = null;
let ownedRuntime = false;
let stage = 'setup';
let runtimeCleanup: 'not-started' | 'pending' | 'succeeded' | 'failed' = 'not-started';
async function toolsDev(args: string[]) {
  const result = await promisify(execFile)(process.execPath, [path.join(repository, 'tools/dev/bin/tools-dev.mjs'),
    ...args, '--namespace', namespace, '--no-env-file', '--json'],
  { cwd: repository, env: daemonEnv, encoding: 'utf8', timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
  return JSON.parse(result.stdout);
}
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No local port.');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}
async function direct(prompt: string, label: string, session?: string): Promise<{ session: string; usage: Usage; answer: string; transcript: string; elapsedMs: number }> {
  const args = ['exec', ...(session ? ['resume'] : []), '--json', '--skip-git-repo-check', '--disable', 'plugins',
    '--model', model, '-c', 'model_reasoning_effort="low"',
    ...(session ? ['-c', 'sandbox_mode="workspace-write"', '-c', 'sandbox_workspace_write.network_access=true', session]
      : ['--sandbox', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true', '-C', fixture])];
  const start = Date.now();
  const child = spawn('codex', args, { cwd: fixture, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', denied = false;
  const timer = setTimeout(() => child.kill('SIGTERM'), 90_000);
  const stopOnDenial = (text: string) => {
    if (/HTTP CONNECT failed with status 403|Proxy connection failed.*403/.test(text)) {
      denied = true; child.kill('SIGTERM');
    }
  };
  child.stdout.on('data', part => { stdout += part; stopOnDenial(stdout); });
  child.stderr.on('data', part => { stderr += part; stopOnDenial(stderr); });
  child.stdin.end(prompt);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject); child.once('close', resolve);
  }).finally(() => clearTimeout(timer));
  await Promise.all([writeFile(path.join(output, `${label}.jsonl`), stdout),
    writeFile(path.join(output, `${label}.stderr`), stderr)]);
  if (denied) throw new Error('NETWORK_POLICY_DENIED: HTTP CONNECT 403. No usable provider usage.');
  const events = stdout.split('\n').filter(Boolean).map(line => JSON.parse(line));
  const completed = events.filter(event => event.type === 'turn.completed');
  if (code !== 0 || completed.length !== 1) throw new Error(`CLI turn did not complete (${label}, exit=${code}): ${events.find(event => event.type === 'turn.failed')?.error?.message ?? events.find(event => event.type === 'error')?.message ?? 'raw logs preserved'}`);
  const id = events.find(event => event.type === 'thread.started')?.thread_id;
  if (typeof id !== 'string') throw new Error('No upstream session ID.');
  if (session && id !== session) throw new Error('Resume changed the session ID; cumulative usage is not comparable.');
  return { session: id, usage: usage(completed[0].usage), elapsedMs: Date.now() - start,
    ...completedAnswer(events.filter(event => event.type === 'item.completed' && event.item?.type === 'agent_message')
      .map(event => event.item.text)) };
}
async function api(endpoint: string, body?: unknown, method = 'POST'): Promise<any> {
  const response = await fetch(`${daemonUrl}${endpoint}`, {
    method: body === undefined ? 'GET' : method, headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${endpoint}: ${JSON.stringify(result)}`);
  return result;
}
async function monofield(prompt: string, label: string, projectId: string, conversationId: string) {
  const start = Date.now();
  const response = await fetch(`${daemonUrl}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentId: 'codex', projectId, conversationId, model, reasoning: 'low', sessionMode: 'chat',
      currentPrompt: prompt, message: `## user\n${prompt}`, titleGeneration: { enabled: true } }),
    signal: AbortSignal.timeout(90_000) });
  const text = await response.text();
  await writeFile(path.join(output, `${label}.sse`), text);
  const events = text.split(/\r?\n\r?\n/).map(frame => {
    const event = /^event: (.+)$/m.exec(frame)?.[1];
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
    if (!event || !data) return null;
    return { event, data: JSON.parse(data) };
  }).filter(Boolean);
  const runList = await api(`/api/runs?conversationId=${conversationId}`);
  const run = runList.runs.sort((a: any, b: any) => b.createdAt - a.createdAt)[0];
  await writeFile(path.join(output, `${label}.run.json`), JSON.stringify(run, null, 2));
  const usageEvents = events.filter(event => event!.event === 'agent' && event!.data?.type === 'usage');
  if (!response.ok || run?.status !== 'succeeded' || usageEvents.length !== 1)
    throw new Error(`MonoField turn did not complete (${label}, status=${run?.status}): ${run?.error ?? 'No successful provider usage; raw SSE preserved.'}`);
  // Preserve app-added context so a valid measurement can expose overhead.
  const session = events.find(event => event!.event === 'agent' && event!.data?.sessionId)?.data.sessionId;
  if (typeof session !== 'string') throw new Error('No upstream MonoField Codex session ID.');
  // This Codex adapter emits one text_delta per whole completed assistant message.
  const answer = completedAnswer(events.filter(event => event!.event === 'agent' && event!.data?.type === 'text_delta')
    .map(event => event!.data.text ?? event!.data.delta ?? ''));
  return { usage: usage(usageEvents[0]!.data.usage), ...answer, session, elapsedMs: Date.now() - start, promptContext: run.promptContext };
}
async function save(status: string, error?: string) {
  const summary = summarizeSamples(samples, pairs);
  const result = { status, measuredAt: new Date().toISOString(), metadata, stage, runtimeCleanup, checks, samples, ...summary,
    ...(error ? { error } : {}), scope: 'Provider-reported tokens, no dollar price or universal cost guarantee.' };
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  if (status !== 'running') process.stdout.write(JSON.stringify({ status, stage, result: path.join(output, 'result.json'), completePairs: summary.completePairs }) + '\n');
}
try {
  await mkdir(fixture, { recursive: true });
  const fixtureFile = path.join(fixture, 'totals.ts');
  const fixtureContents = 'export function sumValues(values: number[]): number {\n  let total = 0;\n  for (let i = 0; i < values.length - 1; i++) total += values[i]!;\n  return total;\n}\n';
  const existing = await readFile(fixtureFile, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (existing !== null && existing !== fixtureContents) throw new Error('Fixture differs; refusing to overwrite existing totals.ts.');
  await writeFile(fixtureFile, fixtureContents);
  metadata.codexVersion = (await promisify(execFile)('codex', ['--version'])).stdout.trim();
  const login = await promisify(execFile)('codex', ['login', 'status']);
  metadata.loginStatus = `${login.stdout}${login.stderr}`.trim();
  stage = 'direct-readiness';
  try {
    const ready = await direct('Reply exactly OK. Do not invoke tools.', 'readiness');
    if (ready.answer !== 'OK') throw new Error('Readiness answer was not OK.');
    checks.push({ lane: 'direct', status: 'ready', usage: ready.usage, answer: ready.answer });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ lane: 'direct', status: 'blocked', usage: null, error: message });
    if (!checkOnly || /NETWORK_POLICY_DENIED/.test(message)) throw error;
  }
  stage = 'runtime-start';
  // Even a partially successful start may have left an owned sidecar.
  ownedRuntime = true;
  runtimeCleanup = 'pending';
  const started = await toolsDev(['start', 'daemon', '--daemon-port', String(await freePort())]);
  daemonUrl = started.daemon?.status?.url;
  if (!daemonUrl) throw new Error('The isolated tools-dev daemon has no URL.');
  await api('/api/app-config', { customInstructions: '', defaultDesignSystemId: null, privacyDecisionAt: Date.now(),
    telemetry: { metrics: false, content: false, artifactManifest: false } }, 'PUT');
  await api('/api/memory/config', { enabled: false, chatExtractionEnabled: false }, 'PATCH');
  stage = 'monofield-readiness';
  if (checkOnly) {
    const imported = await api('/api/import/folder', { baseDir: fixture, name: 'Token readiness check' });
    try {
      const ready = await monofield('Reply exactly OK. Do not invoke tools.', 'monofield-readiness', imported.project.id, imported.conversationId);
      if (ready.answer !== 'OK') throw new Error('Readiness answer was not OK.');
      checks.push({ lane: 'monofield', status: 'ready', usage: ready.usage, answer: ready.answer });
    } catch (error) {
      checks.push({ lane: 'monofield', status: 'blocked', usage: null, error: error instanceof Error ? error.message : String(error) });
    }
    const ready = checks.length === 2 && checks.every(check => check.status === 'ready');
    await save(ready ? 'ready' : 'blocked');
    if (!ready) process.exitCode = 1;
  } else {
    stage = 'paired-measurement';
    for (let pair = 0; pair < pairs; pair++) {
      const lanes = pair % 2 ? ['monofield', 'direct'] as const : ['direct', 'monofield'] as const;
      for (const lane of lanes) {
        let upstream: string | undefined, previous: Usage | null = null;
        const imported = lane === 'monofield' ? await api('/api/import/folder', { baseDir: fixture, name: `Token benchmark ${pair}` }) : null;
        for (const [task, prompt] of Object.entries(prompts)) {
          const label = `${pair}-${lane}-${task}`;
          const result = lane === 'direct'
            ? await direct(prompt, label, task !== 'first' ? upstream : undefined)
            : await monofield(prompt, label, imported.project.id, imported.conversationId);
          const turnUsage = lane === 'direct' && task !== 'first' ? delta(result.usage, previous) : result.usage;
          if (upstream && result.session !== upstream) throw new Error('The resumed lane changed its Codex session.');
          upstream = result.session;
          if (lane === 'direct') previous = result.usage;
          samples.push({ pair, lane, task, elapsedMs: result.elapsedMs, usage: turnUsage, answer: result.answer, transcript: result.transcript, sessionId: result.session,
            formatCompliant: result.transcript === (task === 'review' ? 'sumValues' : 'BENCH_A7'),
            correct: result.answer === (task === 'review' ? 'sumValues' : 'BENCH_A7'),
            ...('promptContext' in result ? { promptContext: result.promptContext } : {}) });
          await save('running');
          process.stdout.write(`${label}: ${turnUsage.total} tokens, correct=${samples.at(-1)!.correct}\n`);
        }
      }
    }
    const qualityPassed = samples.every(sample => sample.correct);
    await save(qualityPassed ? 'completed' : 'quality-failed');
    if (!qualityPassed) process.exitCode = 1;
  }
} catch (error) {
  await save('blocked', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (ownedRuntime) {
    try {
      await toolsDev(['stop', 'daemon']);
      runtimeCleanup = 'succeeded';
    } catch (error) {
      runtimeCleanup = 'failed';
      process.stderr.write(`Runtime cleanup failed: ${String(error)}\n`);
      process.exitCode = 1;
    }
    const resultFile = path.join(output, 'result.json');
    const result = JSON.parse(await readFile(resultFile, 'utf8'));
    await writeFile(resultFile, JSON.stringify({ ...result, runtimeCleanup }, null, 2));
  }
}
