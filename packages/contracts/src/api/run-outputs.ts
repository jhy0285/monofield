// Work log and results: what was asked of an AI tool, which tool did it, how it ended and what it used, and the
// files each run left behind. The daemon keeps a copy of every file a run created or changed, so a result can be
// found by request, tool or format, previewed, and put back after a later run overwrote it.
//
// Pure TypeScript: shared by the daemon, the web app and the `monofield outputs` / `monofield usage` CLI.

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
