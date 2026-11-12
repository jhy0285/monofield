import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  RunLogEntry, RunLogListResponse, RunOutput, RunOutputDetailResponse, RunOutputListResponse, RunOutputRestoreResponse,
  RunUsageBucket, RunUsageSummaryResponse,
} from '@open-design/contracts';

const OUTPUTS_USAGE = `Usage:
  monofield outputs list    [--project <id>] [--agent <id>] [--format document|sheet|slides|image|data|web|media] [--run <run-id>]
                            [--q <text>] [--all-versions] [--limit <n>] [--json]
  monofield outputs show    <output-id> [--json]
  monofield outputs get     <output-id> [--out <file>]
  monofield outputs restore <output-id> [--json]

The files AI runs left behind. Every run's new and changed result files (documents, sheets, slides, images, data) are
copied when the run ends, so a result stays available after a later run overwrote it.

list shows the newest version of each file, newest first; --q matches the file path and the request that produced it.
show prints one result with its versions, the run that made it and whether the project's file still equals it.
get writes that version's bytes to --out (default: the file's name in the current folder).
restore puts that version back into the project; what it replaces is kept first as a new version.`;

const USAGE_USAGE = `Usage:
  monofield usage      [--project <id>] [--agent <id>] [--days <n>] [--json]
  monofield usage runs [--project <id>] [--agent <id>] [--status running|succeeded|failed|canceled] [--q <text>] [--days <n>] [--limit <n>] [--json]

The work log. usage adds up runs and the tokens each AI tool reported, by tool, project and day (--days limits it to
the last n days). usage runs lists the requests themselves; --q searches the request text.
Token counts are what the tool reported for the run; a run whose tool reported nothing is counted as "no usage reported".`;

type Flags = Record<string, unknown>;
interface Helpers {
  baseUrl: (flags: Flags) => Promise<string>;
  parseFlags: (args: string[], options: { string: Set<string>; boolean: Set<string> }) => Flags;
  positionalArgs: (args: string[], stringFlags: Set<string>) => string[];
}

const when = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
const count = (value: number) => value.toLocaleString('en-US');
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatOutputLine(output: RunOutput): string {
  const version = output.versionCount > 1 ? ` v${output.version}/${output.versionCount}` : '';
  return `${output.id}  ${output.path}${version}  ${formatBytes(output.size)}  ${when(output.createdAt)}  ${output.agentName ?? '-'}  ${output.projectName ?? output.projectId}`
    + (output.request ? `\n    ${output.request}` : '');
}

export function formatRunLine(run: RunLogEntry): string {
  const tokens = run.usage.measured ? `${count(run.usage.totalTokens)} tokens` : 'no usage reported';
  return `${when(run.startedAt)}  ${run.status.padEnd(9)}  ${(run.agentName ?? '-').padEnd(12)}  ${tokens}  ${run.outputCount} file(s)  ${run.projectName ?? '-'}`
    + `\n    ${run.request || '(no request text)'}`;
}

function bucketLine(bucket: RunUsageBucket): string {
  const unmeasured = bucket.unmeasuredRuns ? `, ${bucket.unmeasuredRuns} with no usage reported` : '';
  return `  ${bucket.label}: ${bucket.runs} run(s)${unmeasured} · ${count(bucket.totalTokens)} tokens (input ${count(bucket.inputTokens)}, output ${count(bucket.outputTokens)}, cache read ${count(bucket.cacheReadTokens)})`;
}

export function formatUsage(summary: RunUsageSummaryResponse): string {
  const { totals } = summary;
  const lines = [
    `${totals.runs} run(s): ${totals.succeeded} succeeded, ${totals.failed} failed, ${totals.canceled} canceled, ${totals.running} running · ${totals.outputs} result file(s)`,
    `tokens: ${count(totals.totalTokens)} (input ${count(totals.inputTokens)}, output ${count(totals.outputTokens)}, cache read ${count(totals.cacheReadTokens)}, cache write ${count(totals.cacheWriteTokens)})`
      + (totals.unmeasuredRuns ? ` · ${totals.unmeasuredRuns} run(s) reported no usage` : ''),
  ];
  if (summary.byAgent.length) lines.push('by tool:', ...summary.byAgent.map(bucketLine));
  if (summary.byProject.length) lines.push('by project:', ...summary.byProject.map(bucketLine));
  if (summary.byDay.length) lines.push('by day:', ...summary.byDay.map(bucketLine));
  return lines.join('\n');
}

function search(pairs: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(pairs)) {
    if (typeof value === 'string' && value) params.set(key, value);
    else if (value === true) params.set(key, '1');
    else if (typeof value === 'number') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
  return payload;
}

const since = (days: unknown): number | undefined => {
  if (typeof days !== 'string' || !days) return undefined;
  const parsed = Number(days);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('--days takes a positive number.');
  return Date.now() - parsed * 24 * 60 * 60 * 1000;
};

/** `monofield outputs …`, against /api/run-outputs. */
export async function runOutputsCli(args: string[], helpers: Helpers): Promise<void> {
  const strings = new Set(['daemon-url', 'project', 'agent', 'format', 'run', 'q', 'limit', 'out']);
  const flags = helpers.parseFlags(args, { string: strings, boolean: new Set(['json', 'help', 'all-versions']) });
  const [command, id, ...extra] = helpers.positionalArgs(args, strings);
  if (flags.help || !command || !['list', 'show', 'get', 'restore'].includes(command) || extra.length) {
    console.log(OUTPUTS_USAGE);
    if (!flags.help) throw new Error('Use monofield outputs <list|show|get|restore> --help.');
    return;
  }
  const root = `${(await helpers.baseUrl(flags)).replace(/\/$/, '')}/api/run-outputs`;
  if (command === 'list') {
    if (id) throw new Error('list takes no positional argument.');
    const result = await call<RunOutputListResponse>(root + search({
      projectId: flags.project, agentId: flags.agent, format: flags.format, runId: flags.run, q: flags.q, allVersions: flags['all-versions'], limit: flags.limit,
    }));
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else if (!result.outputs.length) console.log('No results yet. Files appear here after an AI run creates or changes them.');
    else console.log([...result.outputs.map(formatOutputLine), result.total > result.outputs.length ? `… ${result.total - result.outputs.length} more (use --limit)` : ''].filter(Boolean).join('\n'));
    return;
  }
  if (!id) throw new Error(`${command} requires an output id (see monofield outputs list).`);
  const one = `${root}/${encodeURIComponent(id)}`;
  if (command === 'show') {
    const detail = await call<RunOutputDetailResponse>(one);
    if (flags.json) { console.log(JSON.stringify(detail, null, 2)); return; }
    const { output } = detail;
    console.log([
      formatOutputLine(output),
      `  project file now: ${detail.current}${output.stored ? '' : ' · this version was too large to copy'}`,
      `  sha256: ${output.sha256 || '-'}`,
      ...(detail.run ? [`  run: ${formatRunLine(detail.run).replace(/\n\s+/, ' — ')}`] : []),
      ...(detail.versions.length > 1 ? ['  versions:', ...detail.versions.map((version) => `    v${version.version}  ${version.id}  ${when(version.createdAt)}  ${version.change}  ${version.agentName ?? '-'}`)] : []),
      ...(detail.sameRun.length ? ['  same run:', ...detail.sameRun.map((other) => `    ${other.id}  ${other.path}`)] : []),
    ].join('\n'));
    return;
  }
  if (command === 'get') {
    const detail = await call<RunOutputDetailResponse>(one);
    const response = await fetch(`${one}/content?download=1`);
    if (!response.ok) throw new Error(detail.output.stored ? `HTTP ${response.status}` : 'This version was too large to copy.');
    const target = path.resolve(typeof flags.out === 'string' && flags.out ? flags.out : detail.output.name);
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
    console.log(target);
    return;
  }
  const restored = await call<RunOutputRestoreResponse>(`${one}/restore`, { method: 'POST' });
  if (flags.json) console.log(JSON.stringify(restored, null, 2));
  else console.log(`Restored ${restored.restored.path} to v${restored.restored.version}.`
    + (restored.savedBefore ? ` What it replaced is kept as v${restored.savedBefore.version} (${restored.savedBefore.id}).` : ''));
}

/** `monofield usage …`, against /api/run-log. */
export async function runUsageCli(args: string[], helpers: Helpers): Promise<void> {
  const strings = new Set(['daemon-url', 'project', 'agent', 'status', 'q', 'days', 'limit']);
  const flags = helpers.parseFlags(args, { string: strings, boolean: new Set(['json', 'help']) });
  const [command, ...extra] = helpers.positionalArgs(args, strings);
  if (flags.help || (command && command !== 'runs') || extra.length) {
    console.log(USAGE_USAGE);
    if (!flags.help) throw new Error('Use monofield usage [runs] --help.');
    return;
  }
  const root = `${(await helpers.baseUrl(flags)).replace(/\/$/, '')}/api/run-log`;
  const filters = { projectId: flags.project, agentId: flags.agent, from: since(flags.days) };
  if (command === 'runs') {
    const result = await call<RunLogListResponse>(root + search({ ...filters, status: flags.status, q: flags.q, limit: flags.limit }));
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else if (!result.runs.length) console.log('No runs recorded.');
    else console.log([...result.runs.map(formatRunLine), result.total > result.runs.length ? `… ${result.total - result.runs.length} more (use --limit)` : ''].filter(Boolean).join('\n'));
    return;
  }
  const summary = await call<RunUsageSummaryResponse>(`${root}/usage${search(filters)}`);
  console.log(flags.json ? JSON.stringify(summary, null, 2) : formatUsage(summary));
}
