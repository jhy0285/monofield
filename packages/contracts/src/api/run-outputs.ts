// Work log and results: what was asked of an AI tool, which tool did it, how it ended and what it used, and the
// files each run left behind. The daemon keeps a copy of every file a run created or changed, so a result can be
// found by request, tool or format, previewed, and put back after a later run overwrote it.
//
// Pure TypeScript: shared by the daemon, the web app and the `monofield outputs` / `monofield usage` CLI.

import type {
  InterfaceSpecChangeLevel,
  InterfaceSpecCompatibilityChange,
} from '../docs/interface-spec-compatibility.js';

export type RunLogStatus = 'running' | 'succeeded' | 'failed' | 'canceled';

/**
 * Token counts as the AI tool reported them for the run. `inputTokens` is the whole prompt, cached part included;
 * `cacheReadTokens` and `cacheWriteTokens` say how much of it was read from or written to the provider's cache.
 * `measured` is false when the tool reported nothing.
 */
export interface RunLogUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  measured: boolean;
}

export interface RunLogEntry {
  runId: string;
  /** Counts up with every recorded run, so a run can be named in conversation ("run 28"). */
  number: number;
  /** The request thread this run belongs to: its conversation, numbered the first time a run was recorded in it. */
  issueNumber: number | null;
  issueTitle: string | null;
  /** The run ended by asking the person a question, so the thread waits for an answer. */
  needsReply: boolean;
  projectId: string | null;
  /** Null when the project was deleted since. */
  projectName: string | null;
  conversationId: string | null;
  agentId: string | null;
  agentName: string | null;
  model: string | null;
  /** What the person asked for, shortened to `RUN_REQUEST_MAX_CHARS`. */
  request: string;
  status: RunLogStatus;
  startedAt: number;
  finishedAt: number | null;
  usage: RunLogUsage;
  /** Files this run created or changed. */
  outputCount: number;
  /** What the run changed in the code, checked when it ended; null when the run had no code folder to check. */
  check: RunCheckSummary | null;
}

export const RUN_REQUEST_MAX_CHARS = 400;

export type RunOutputFormat = 'document' | 'sheet' | 'slides' | 'image' | 'data' | 'web' | 'media';
export const RUN_OUTPUT_FORMATS: readonly RunOutputFormat[] = ['document', 'sheet', 'slides', 'image', 'data', 'web', 'media'];

const FORMAT_BY_EXTENSION: Record<string, RunOutputFormat> = {
  md: 'document', txt: 'document', docx: 'document', doc: 'document', hwp: 'document', hwpx: 'document', pdf: 'document', rtf: 'document',
  xlsx: 'sheet', xls: 'sheet', csv: 'sheet', tsv: 'sheet',
  pptx: 'slides', ppt: 'slides',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image',
  json: 'data', yaml: 'data', yml: 'data', xml: 'data',
  html: 'web', htm: 'web',
  mp4: 'media', webm: 'media', mov: 'media', mp3: 'media', wav: 'media',
};

/** The kind of result a file is, by its extension, or null when it is not one (source code, binaries, lock files). */
export function runOutputFormat(filePath: string): RunOutputFormat | null {
  const name = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return FORMAT_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * Whether a run's change to `relativePath` is kept as a result. In a development project the folder is someone's
 * source tree and Git already holds its history, so configuration and page sources (`package.json`, `pom.xml`,
 * `index.html`) are not results there unless they sit under `docs/`.
 */
export function isRunOutputPath(relativePath: string, options: { development?: boolean } = {}): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const format = runOutputFormat(normalized);
  if (!format) return false;
  if (options.development && (format === 'data' || format === 'web')) return /(^|\/)docs\//.test(normalized);
  return true;
}

/** How this version came to be: the run made a new file, changed one, or it is the file as it stood before a restore. */
export type RunOutputChange = 'created' | 'modified' | 'before-restore';

export interface RunOutput {
  id: string;
  /** Null for a copy kept before a restore: no run made it. */
  runId: string | null;
  runNumber: number | null;
  issueNumber: number | null;
  issueTitle: string | null;
  projectId: string;
  projectName: string | null;
  conversationId: string | null;
  /** Project-relative path with forward slashes. */
  path: string;
  name: string;
  format: RunOutputFormat;
  /** 1 for the first copy kept of this path in this project, then 2, 3, … */
  version: number;
  /** How many versions of this path are kept. */
  versionCount: number;
  latest: boolean;
  change: RunOutputChange;
  sha256: string;
  size: number;
  /** False when the file was too large to copy; it is listed but cannot be previewed or restored. */
  stored: boolean;
  createdAt: number;
  agentId: string | null;
  agentName: string | null;
  request: string;
}

export interface RunOutputFacet { id: string; label: string; count: number }

export interface RunOutputListQuery {
  projectId?: string;
  /** One request thread. */
  conversationId?: string;
  runId?: string;
  agentId?: string;
  format?: RunOutputFormat;
  /** Matches the file path and the request text. */
  q?: string;
  /** Every kept version instead of the newest of each file. */
  allVersions?: boolean;
  limit?: number;
  offset?: number;
}

export interface RunOutputListResponse {
  outputs: RunOutput[];
  total: number;
  /** Counts over the same search without the facet's own filter, for the filter menus. */
  facets: { projects: RunOutputFacet[]; agents: RunOutputFacet[]; formats: RunOutputFacet[] };
}

/** How the file in the project compares with a kept version now. */
export type RunOutputCurrentState = 'same' | 'changed' | 'missing';

export interface RunOutputDetailResponse {
  output: RunOutput;
  /** Every kept version of this path, newest first. */
  versions: RunOutput[];
  /** The other files the same run left. */
  sameRun: RunOutput[];
  current: RunOutputCurrentState;
  run: RunLogEntry | null;
}

export interface RunOutputRestoreResponse {
  restored: RunOutput;
  /** The file as it stood before the restore, when it differed from every kept version. */
  savedBefore: RunOutput | null;
}

export interface RunLogListQuery {
  projectId?: string;
  conversationId?: string;
  agentId?: string;
  status?: RunLogStatus;
  /** Matches the request text. */
  q?: string;
  /** Epoch milliseconds, inclusive start and exclusive end. */
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}

export interface RunLogListResponse { runs: RunLogEntry[]; total: number }

export interface RunUsageBucket {
  /** Agent id, project id or a local day (`YYYY-MM-DD`). */
  key: string;
  label: string;
  runs: number;
  /** Runs whose tool reported no token counts; their tokens are not in the sums. */
  unmeasuredRuns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

export interface RunUsageSummaryResponse {
  from: number | null;
  to: number | null;
  totals: RunUsageBucket & { succeeded: number; failed: number; canceled: number; running: number; outputs: number };
  byAgent: RunUsageBucket[];
  byProject: RunUsageBucket[];
  byDay: RunUsageBucket[];
}

/**
 * Where a request thread stands, from its newest run: still working, waiting for the person's answer, finished, or
 * ended badly (failed or canceled).
 */
export type WorkIssueStatus = 'running' | 'needs-reply' | 'done' | 'failed';
export const WORK_ISSUE_STATUSES: readonly WorkIssueStatus[] = ['running', 'needs-reply', 'done', 'failed'];

/** One request thread on the board: a conversation with at least one recorded run. */
export interface WorkIssue {
  number: number;
  conversationId: string;
  projectId: string | null;
  projectName: string | null;
  /** The conversation's title, or the first request made in it. */
  title: string;
  status: WorkIssueStatus;
  runCount: number;
  outputCount: number;
  /** Tokens the tools reported over all runs of the thread. */
  totalTokens: number;
  lastRun: RunLogEntry;
  updatedAt: number;
}

export interface WorkQueueResponse {
  /** Newest activity first. */
  issues: WorkIssue[];
  /** Runs in progress right now, over all threads. */
  running: number;
  counts: Record<WorkIssueStatus, number>;
}

export function workIssueStatus(run: Pick<RunLogEntry, 'status' | 'needsReply'>): WorkIssueStatus {
  if (run.status === 'running') return 'running';
  if (run.status !== 'succeeded') return 'failed';
  return run.needsReply ? 'needs-reply' : 'done';
}

/**
 * The check after a run: the project folder is snapshotted as a Git tree when the run starts and when it ends (with a
 * temporary index, so the person's index and files are untouched), and the difference between the two is exactly what
 * the run changed. That difference is then read for API compatibility (Spring controllers, with the interface-spec
 * scanner) and for what the changed files declare (APIs, screens, tables, classes, with the code-ontology analyzers).
 */
export type RunCheckState = 'pending' | 'done' | 'skipped' | 'failed';
/** `not-git`: the folder is not in a Git repository. `restarted`: the app stopped before the check finished. */
export type RunCheckReason = 'not-git' | 'restarted' | 'error';
export type RunCheckFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';
export type RunTouchedKind = 'api' | 'screen' | 'table' | 'class';
export const RUN_TOUCHED_KINDS: readonly RunTouchedKind[] = ['api', 'screen', 'table', 'class'];
/**
 * `added` / `removed`: the declaration appeared or disappeared. `changed`: an API whose handler lines the run edited, or
 * a screen, table or class declared in a file the run edited.
 */
export type RunTouchedChange = 'added' | 'removed' | 'changed';

/** Whether callers of the project's HTTP API would notice the run's change. */
export type RunApiCheck =
  | { checked: true; level: InterfaceSpecChangeLevel | 'none'; counts: Record<InterfaceSpecChangeLevel, number>; endpoints: { before: number; after: number } }
  /** `no-python` / `no-scanner`: the comparison could not run here. `error`: it ran and failed (see `message`). */
  | { checked: false; reason: 'no-python' | 'no-scanner' | 'error'; message?: string };

export interface RunCheckSummary {
  state: RunCheckState;
  reason: RunCheckReason | null;
  /** Why it failed, as the tool reported it. */
  message: string | null;
  /** Another run worked in the same repository at the same time, so some of the changes may be that run's. */
  shared: boolean;
  /** Files the run added, changed, removed or renamed (in the project folder). */
  files: number;
  /** Null when no Java, Kotlin or Spring XML file changed: nothing a caller of the API could see. */
  api: RunApiCheck | null;
  touched: Record<RunTouchedKind, number>;
}

export interface RunCheckFile { path: string; status: RunCheckFileStatus; from?: string }
export interface RunTouchedItem { kind: RunTouchedKind; label: string; path: string; change: RunTouchedChange }

export interface RunCheckDetailResponse {
  runId: string;
  number: number;
  summary: RunCheckSummary;
  files: RunCheckFile[];
  apiChanges: InterfaceSpecCompatibilityChange[];
  touched: RunTouchedItem[];
}

/** The level a person should look at first, for a badge on the run's card. */
export function runCheckAttention(check: RunCheckSummary | null): 'breaking' | 'warning' | 'ok' | 'pending' | 'none' {
  if (!check) return 'none';
  if (check.state === 'pending') return 'pending';
  if (check.state !== 'done') return 'none';
  if (check.api?.checked && check.api.counts.breaking > 0) return 'breaking';
  if (check.api?.checked && check.api.counts.warning > 0) return 'warning';
  return 'ok';
}
