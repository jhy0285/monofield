import { readFile } from 'node:fs/promises';
import type { VerificationRun, VerificationStatus } from '@open-design/contracts';

export async function runVerificationCli(args: string[], helpers: {
  baseUrl: (flags: Record<string, unknown>) => Promise<string>;
  parseFlags: (args: string[], options: { string: Set<string>; boolean: Set<string> }) => Record<string, unknown>;
  positionalArgs: (args: string[], stringFlags: Set<string>) => string[];
}): Promise<void> {
  const strings = new Set(['daemon-url', 'project', 'project-path', 'checks', 'run-id', 'timeout-ms', 'prompt-file']);
  const flags = helpers.parseFlags(args, { string: strings, boolean: new Set(['json', 'help', 'wait']) });
  const [command = 'status'] = helpers.positionalArgs(args, strings);
  if (flags.help) {
    console.log('Usage: monofield verify <plan|run|status|cancel|repair|export> --project ID [--project-path PATH] [--checks node:test,node:typecheck] [--run-id ID] [--timeout-ms 120000] [--wait] [--prompt-file <path|->] [--json] [--daemon-url URL]'); return;
  }
  if (!['plan', 'run', 'status', 'cancel', 'repair', 'export'].includes(command)) throw new Error('Unknown verification command');
  if (typeof flags.project !== 'string' || !flags.project) throw new Error('--project is required');
  const base = `${(await helpers.baseUrl(flags)).replace(/\/$/, '')}/api/projects/${encodeURIComponent(flags.project)}/development/verification`;
  const query = new URLSearchParams();
  if (typeof flags['project-path'] === 'string') query.set('projectPath', flags['project-path']);
  if (typeof flags['run-id'] === 'string') query.set('runId', flags['run-id']);
  const call = async <T>(endpoint = '', method = 'GET', body?: unknown): Promise<T> => {
    const response = await fetch(`${base}${endpoint}${query.size ? `?${query}` : ''}`, { method,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    const result = await response.json() as { error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message ?? `Verification HTTP ${response.status}`);
    return result as T;
  };
  const scope = typeof flags['project-path'] === 'string' ? { projectPath: flags['project-path'] } : {};
  let result: unknown;
  if (command === 'plan') result = await call('/plan');
  else if (command === 'run') {
    if (typeof flags.checks !== 'string') throw new Error('--checks must name commands returned by verify plan');
    let run = await call<VerificationRun>('', 'POST', { ...scope, checkIds: flags.checks.split(','),
      ...(flags['timeout-ms'] === undefined ? {} : { timeoutMs: Number(flags['timeout-ms']) }) });
    query.set('runId', run.id);
    if (flags.wait) {
      while (run.state === 'running') {
        await new Promise(resolve => setTimeout(resolve, 300));
        query.set('live', '1'); run = (await call<VerificationStatus>()).run!;
      }
      query.delete('live'); result = await call<VerificationStatus>();
      if (!(result as VerificationStatus).verified) process.exitCode = 1;
    } else result = run;
  } else if (command === 'status' || command === 'export') result = await call<VerificationStatus>();
  else {
    if (typeof flags['run-id'] !== 'string') throw new Error('--run-id is required');
    let request = '';
    if (command === 'repair' && typeof flags['prompt-file'] === 'string') {
      if (flags['prompt-file'] === '-') { const parts: Buffer[] = []; for await (const p of process.stdin) parts.push(Buffer.from(p)); request = Buffer.concat(parts).toString('utf8'); }
      else request = await readFile(flags['prompt-file'], 'utf8');
    }
    result = await call(`/${encodeURIComponent(flags['run-id'])}/${command}`, 'POST', { ...scope, ...(command === 'repair' ? { request } : {}) });
  }
  // Receipts and repair prompts remain local until the caller explicitly forwards them.
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
