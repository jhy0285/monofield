import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createTrafficFixture, featureRequest, refactorRequest } from '../resources/all-in-one.js';
import { checkTraffic } from '../lib/all-in-one/checks.js';
import { processTree } from '../lib/all-in-one/processes.js';
import { providerUsage, cumulativeDelta } from '../lib/token-benchmark/usage.js';
import { runToolsDevJson } from '../lib/tools-dev/cli.js';

// Opt-in real-provider benchmark. Not a CI smoke test; never substitutes mocks for observations.
const [command, target, ...args] = process.argv.slice(2);
if (!target) throw new Error('Usage: all-in-one.ts prepare <new-root> | direct|monofield <workspace> <output> <feature|refactor> --run [--resume-result <prior-feature.result.json>] | check <url> <output> | sample <output> <pid,...>. direct also accepts --active-module backend|frontend|.');
if (command === 'prepare') {
  await mkdir(path.dirname(path.resolve(target)), { recursive: true });
  await mkdir(target); // Requires a new directory; never overwrite an existing project.
  await createTrafficFixture(target);
  await mkdir(path.join(target, 'benchmark-prompts'), { recursive: true });
  await writeFile(path.join(target, 'benchmark-prompts/feature.txt'), featureRequest);
  await writeFile(path.join(target, 'benchmark-prompts/refactor.txt'), refactorRequest);
} else if (command === 'check') {
  if (!args[0]) throw new Error('Missing output file.');
  const checks = await checkTraffic(target);
  await writeFile(args[0], JSON.stringify({ at: new Date().toISOString(), checks, passed: checks.every(check => check.passed) }, null, 2));
  process.stdout.write(JSON.stringify({ checks: checks.length, failed: checks.filter(check => !check.passed).map(check => check.name) }) + '\n');
  if (checks.some(check => !check.passed)) process.exitCode = 1;
} else if (command === 'sample') {
  const roots = args[0]?.split(',').map(Number) ?? [];
  if (!roots.length || roots.some(pid => !Number.isInteger(pid) || pid < 1)) throw new Error('Positive PID roots required.');
  const known = new Map<number, string>();
  let stopped = false; process.on('SIGTERM', () => { stopped = true; }); process.on('SIGINT', () => { stopped = true; });
  while (!stopped) {
    const processes = await processTree(roots, known);
    await appendFile(target, JSON.stringify({ at: new Date().toISOString(), pssKiB: processes.reduce((sum, row) => sum + (row.pssKiB ?? 0), 0), incompletePss: processes.filter(row => row.pssKiB === null).length, rssKiB: processes.reduce((sum, row) => sum + row.rssKiB, 0), processes }) + '\n');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
} else if (command === 'monofield') {
  if (!args.includes('--run')) throw new Error('A real model call requires --run.');
  const output = args[0], task = args[1];
  if (!output || (task !== 'feature' && task !== 'refactor')) throw new Error('Output and feature|refactor required.');
  await mkdir(output, { recursive: true });
  const priorFile = args[args.indexOf('--resume-result') + 1];
  const prior = args.includes('--resume-result') && priorFile ? JSON.parse(await readFile(priorFile, 'utf8')) : null;
  if (args.includes('--resume-result') && (!prior?.namespace || !prior?.projectId || !prior?.conversationId)) {
    throw new Error('A completed MonoField result with namespace, projectId and conversationId is required.');
  }
  const namespace = prior?.namespace ?? `all-in-one-${randomUUID().slice(0, 8)}`;
  const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const suite = { root: output, dataDir: path.join(output, 'runtime'), codexHomeDir: process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), namespace, toolsDevRoot: path.join(repository, '.tmp/tools-dev', namespace) };
  const env = { OD_CODEX_SANDBOX: 'workspace-write', OD_CODEX_DISABLE_PLUGINS: '1', MONOFIELD_CODEX_ENABLE_EXTERNAL_PLUGINS: '0' };
  const lifecycle = (parts: string[]) => runToolsDevJson<any>(repository, suite, [...parts, '--namespace', namespace, '--no-env-file', '--json'], env);
  try {
    const started = await lifecycle(['start', 'daemon']);
    const base = started.daemon?.status?.url;
    if (!base) throw new Error('No daemon URL.');
    const api = async (route: string, body?: unknown, method = 'POST') => {
      const response = await fetch(base + route, { method: body === undefined ? 'GET' : method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const result = await response.json(); if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`); return result;
    };
    await api('/api/app-config', { customInstructions: '', defaultDesignSystemId: null, privacyDecisionAt: Date.now(), telemetry: { metrics: false, content: false, artifactManifest: false } }, 'PUT');
    await api('/api/memory/config', { enabled: false, chatExtractionEnabled: false }, 'PATCH');
    const imported = prior ? null : await api('/api/import/folder', { baseDir: target, name: 'Live all-in-one comparison' });
    const projectId = prior?.projectId ?? imported.project.id, conversationId = prior?.conversationId ?? imported.conversationId;
    const { project } = await api(`/api/projects/${projectId}`);
    await api(`/api/projects/${projectId}`, { metadata: { ...project.metadata, workMode: 'development', development: { ...project.metadata?.development, activeProjectPath: task === 'feature' ? 'backend' : 'frontend' } } }, 'PATCH');
    const prompt = task === 'feature' ? featureRequest : refactorRequest;
    const startedAt = new Date().toISOString(), start = performance.now();
    const response = await fetch(base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: 'codex', projectId, conversationId, model: 'gpt-6.1-sol', reasoning: 'low', sessionMode: 'chat', currentPrompt: prompt, message: `## user\n${prompt}` }), signal: AbortSignal.timeout(600_000) });
    const sse = await response.text(); await writeFile(path.join(output, `${task}.sse`), sse);
    const events = sse.split(/\r?\n\r?\n/).flatMap(frame => {
      const kind = /^event: (.+)$/m.exec(frame)?.[1]; const data = frame.split(/\r?\n/).filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
      return kind && data ? [{ kind, data: JSON.parse(data) }] : [];
    });
    const usageEvents = events.filter(event => event.kind === 'agent' && event.data.type === 'usage');
    const runs = await api(`/api/runs?conversationId=${conversationId}`);
    const run = runs.runs.sort((a: any, b: any) => b.createdAt - a.createdAt)[0];
    const usage = usageEvents.length === 1 ? providerUsage(usageEvents[0]!.data.usage) : null;
    await writeFile(path.join(output, `${task}.result.json`), JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), elapsedMs: performance.now() - start, prompt, namespace, projectId, conversationId, run, usage, transport: 'production MonoField daemon API; native UI assessed separately', model: 'gpt-6.1-sol', reasoning: 'low', module: task === 'feature' ? 'backend' : 'frontend' }, null, 2));
    if (!response.ok || run?.status !== 'succeeded' || !usage) process.exitCode = 1;
  } finally { await lifecycle(['stop', 'daemon']); }
} else if (command === 'direct') {
  if (!args.includes('--run')) throw new Error('A real model call requires --run.');
  const output = args[0], task = args[1];
  if (!output || (task !== 'feature' && task !== 'refactor')) throw new Error('Output and feature|refactor required.');
  await mkdir(output, { recursive: true });
  const prompt = task === 'feature' ? featureRequest : refactorRequest;
  const startedAt = new Date().toISOString(), start = performance.now();
  const priorFile = args[args.indexOf('--resume-result') + 1];
  const prior = args.includes('--resume-result') && priorFile ? JSON.parse(await readFile(priorFile, 'utf8')) : null;
  if (args.includes('--resume-result') && typeof prior?.threadId !== 'string') throw new Error('A completed prior result with threadId is required.');
  const module = args.includes('--active-module') ? args[args.indexOf('--active-module') + 1] : 'backend';
  if (module !== 'backend' && module !== 'frontend' && module !== '.') throw new Error('active-module must be backend, frontend or .');
  const cliArgs = ['exec', ...(prior ? ['resume'] : []), '--json', '--skip-git-repo-check', '--disable', 'plugins', '--model', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="low"',
    ...(prior ? ['-c', 'sandbox_mode="workspace-write"'] : ['--sandbox', 'workspace-write']),
    '-c', 'sandbox_workspace_write.network_access=true', '-c', `sandbox_workspace_write.writable_roots=${JSON.stringify([target])}`,
    ...(prior ? [prior.threadId] : ['-C', path.join(target, module)])];
  const child = spawn('codex', cliArgs, { cwd: path.join(target, module), env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', part => { stdout += part; }); child.stderr.on('data', part => { stderr += part; });
  child.stdin.end(prompt);
  const timer = setTimeout(() => child.kill('SIGTERM'), 600_000);
  const exit = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }).finally(() => clearTimeout(timer));
  await writeFile(path.join(output, `${task}.jsonl`), stdout); await writeFile(path.join(output, `${task}.stderr`), stderr);
  const events = stdout.split('\n').filter(Boolean).map(line => JSON.parse(line));
  const completed = events.filter(event => event.type === 'turn.completed');
  const cumulativeUsage = completed.length === 1 ? providerUsage(completed[0].usage) : null;
  const threadId = events.find(event => event.type === 'thread.started')?.thread_id;
  await writeFile(path.join(output, `${task}.result.json`), JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), elapsedMs: performance.now() - start, exit, prompt, threadId,
    cumulativeUsage, usage: cumulativeUsage && prior ? cumulativeDelta(cumulativeUsage, prior.cumulativeUsage) : cumulativeUsage,
    providerUsage: completed.map(event => event.usage), answers: events.filter(event => event.type === 'item.completed' && event.item?.type === 'agent_message').map(event => event.item.text), model: 'gpt-6.1-sol', reasoning: 'low' }, null, 2));
  if (exit !== 0 || completed.length !== 1) process.exitCode = 1;
} else throw new Error(`Unknown command: ${command}`);
