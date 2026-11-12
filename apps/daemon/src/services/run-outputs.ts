import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  RUN_REQUEST_MAX_CHARS,
  isRunOutputPath,
  runOutputFormat,
  type RunLogEntry,
  type RunLogListQuery,
  type RunLogListResponse,
  type RunLogStatus,
  type RunLogUsage,
  type RunOutput,
  type RunOutputChange,
  type RunOutputDetailResponse,
  type RunOutputFacet,
  type RunOutputListQuery,
  type RunOutputListResponse,
  type RunOutputRestoreResponse,
  type RunUsageBucket,
  type RunUsageSummaryResponse,
} from '@open-design/contracts';

type SqliteDb = Database.Database;

/**
 * The work log and the result shelf.
 *
 * A run is written down when it starts (what was asked, which tool) and closed when it ends (how it ended, what the
 * tool reported using). The project folder's result files are listed before the run and again after it; every file
 * that is new or whose bytes changed is copied into the daemon data root, addressed by content hash, and numbered as
 * the next version of its path. Copies are what make a result findable and restorable after a later run overwrote it.
 *
 * Two runs working in one folder at the same time cannot be told apart from a folder listing: a file both could have
 * written is kept once, under the run that ends first.
 */
export interface RunOutputStoreDeps {
  db: SqliteDb;
  /** The daemon data root (`RUNTIME_DATA_DIR`); copies live under `run-outputs/` in it. */
  dataDir: string;
  now?: () => number;
  /** The project's folder now, for comparing and restoring; defaults to the folder its latest run worked in. */
  projectRoot?: (projectId: string) => string | null;
}

export interface RunStart {
  runId: string;
  projectId: string | null;
  conversationId: string | null;
  agentId: string | null;
  agentName: string | null;
  model: string | null;
  request: string;
  /** The folder the tool works in; null when the run has no project folder (nothing is collected then). */
  root: string | null;
  /** A source tree: see `isRunOutputPath`. */
  development: boolean;
}

export interface RunFinish {
  runId: string;
  status: Exclude<RunLogStatus, 'running'>;
  usage: Partial<Omit<RunLogUsage, 'measured'>> | null;
}

export type RunOutputStore = ReturnType<typeof createRunOutputStore>;

export class RunOutputError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

/** Larger files are listed but not copied. */
const MAX_COPY_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 5000;
const MAX_VISITED = 20000;
/** Dependency and build folders. `out/` is not here: people and tools put results there. */
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'target', 'coverage', 'vendor', '__pycache__']);

interface Fingerprint { size: number; mtimeMs: number }
interface Baseline { root: string; projectId: string; development: boolean; files: Map<string, Fingerprint> }

function listResultFiles(root: string, development: boolean): Map<string, Fingerprint> {
  const files = new Map<string, Fingerprint>();
  let visited = 0;
  const walk = (dir: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.size >= MAX_FILES || (visited += 1) > MAX_VISITED) return;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Hidden files and folders are tool configuration (`.mcp.json`, `.claude/`), sometimes with credentials in them.
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name), relative);
      } else if (entry.isFile() && isRunOutputPath(relative, { development })) {
        try {
          const info = fs.statSync(path.join(dir, entry.name));
          files.set(relative, { size: info.size, mtimeMs: info.mtimeMs });
        } catch { /* removed while listing */ }
      }
    }
  };
  walk(root, '');
  return files;
}

function sha256Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    fs.createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

function localDay(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

interface OutputRow {
  id: string; runId: string | null; projectId: string; projectName: string | null; conversationId: string | null; path: string;
  version: number; versionCount: number; change: RunOutputChange; sha256: string; size: number; stored: number; createdAt: number;
  agentId: string | null; agentName: string | null; request: string | null;
}
interface RunRow {
  runId: string; projectId: string | null; projectName: string | null; conversationId: string | null; agentId: string | null;
  agentName: string | null; model: string | null; request: string; status: RunLogStatus; startedAt: number; finishedAt: number | null;
  inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalTokens: number; measured: number;
  outputCount: number;
}

const OUTPUT_SELECT = `
  SELECT o.id, o.run_id AS runId, o.project_id AS projectId, p.name AS projectName, r.conversation_id AS conversationId,
         o.rel_path AS path, o.version, o.change, o.sha256, o.size, o.stored, o.created_at AS createdAt,
         r.agent_id AS agentId, r.agent_name AS agentName, r.request,
         (SELECT COUNT(*) FROM run_outputs v WHERE v.project_id = o.project_id AND v.rel_path = o.rel_path) AS versionCount
    FROM run_outputs o
    LEFT JOIN run_log r ON r.run_id = o.run_id
    LEFT JOIN projects p ON p.id = o.project_id`;
const RUN_SELECT = `
  SELECT r.run_id AS runId, r.project_id AS projectId, p.name AS projectName, r.conversation_id AS conversationId,
         r.agent_id AS agentId, r.agent_name AS agentName, r.model, r.request, r.status, r.started_at AS startedAt,
         r.finished_at AS finishedAt, r.input_tokens AS inputTokens, r.output_tokens AS outputTokens,
         r.cache_read_tokens AS cacheReadTokens, r.cache_write_tokens AS cacheWriteTokens, r.total_tokens AS totalTokens,
         r.measured, r.output_count AS outputCount
    FROM run_log r
    LEFT JOIN projects p ON p.id = r.project_id`;

function toOutput(row: OutputRow): RunOutput {
  return {
    id: row.id, runId: row.runId, projectId: row.projectId, projectName: row.projectName, conversationId: row.conversationId,
    path: row.path, name: row.path.split('/').pop() ?? row.path, format: runOutputFormat(row.path) ?? 'document',
    version: row.version, versionCount: row.versionCount, latest: row.version === row.versionCount, change: row.change,
    sha256: row.sha256, size: row.size, stored: row.stored === 1, createdAt: row.createdAt,
    agentId: row.agentId, agentName: row.agentName, request: row.request ?? '',
  };
}

function toRun(row: RunRow): RunLogEntry {
  return {
    runId: row.runId, projectId: row.projectId, projectName: row.projectName, conversationId: row.conversationId,
    agentId: row.agentId, agentName: row.agentName, model: row.model, request: row.request, status: row.status,
    startedAt: row.startedAt, finishedAt: row.finishedAt, outputCount: row.outputCount,
    usage: {
      inputTokens: row.inputTokens, outputTokens: row.outputTokens, cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens, totalTokens: row.totalTokens, measured: row.measured === 1,
    },
  };
}

function facet(items: Array<{ id: string | null; label: string | null }>): RunOutputFacet[] {
  const counts = new Map<string, RunOutputFacet>();
  for (const item of items) {
    if (!item.id) continue;
    const found = counts.get(item.id);
    if (found) found.count += 1;
    else counts.set(item.id, { id: item.id, label: item.label ?? item.id, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function page<T>(items: T[], query: { limit?: number; offset?: number }): T[] {
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const limit = Math.min(500, Math.max(1, Math.floor(query.limit ?? 100)));
  return items.slice(offset, offset + limit);
}

export function createRunOutputStore(deps: RunOutputStoreDeps) {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const blobsDir = path.join(deps.dataDir, 'run-outputs', 'blobs');
  const baselines = new Map<string, Baseline>();

  db.exec(`
    CREATE TABLE IF NOT EXISTS run_log (
      run_id TEXT PRIMARY KEY,
      project_id TEXT,
      conversation_id TEXT,
      agent_id TEXT,
      agent_name TEXT,
      model TEXT,
      request TEXT NOT NULL DEFAULT '',
      root TEXT,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      measured INTEGER NOT NULL DEFAULT 0,
      output_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_run_log_started ON run_log(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_run_log_project ON run_log(project_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS run_outputs (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      project_id TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      version INTEGER NOT NULL,
      change TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      size INTEGER NOT NULL,
      stored INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, rel_path, version)
    );
    CREATE INDEX IF NOT EXISTS idx_run_outputs_created ON run_outputs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_run_outputs_run ON run_outputs(run_id);
  `);
  // Runs live in the daemon's memory, so a row still open when the store is created belongs to a daemon that stopped.
  db.prepare(`UPDATE run_log SET status = 'failed', finished_at = COALESCE(finished_at, ?) WHERE status = 'running'`).run(now());

  const blobPath = (sha: string) => path.join(blobsDir, sha.slice(0, 2), sha);
  const outputById = (id: string): RunOutput | null => {
    const row = db.prepare(`${OUTPUT_SELECT} WHERE o.id = ?`).get(id) as OutputRow | undefined;
    return row ? toOutput(row) : null;
  };
  const versionsOf = (projectId: string, relPath: string): RunOutput[] =>
    (db.prepare(`${OUTPUT_SELECT} WHERE o.project_id = ? AND o.rel_path = ? ORDER BY o.version DESC`).all(projectId, relPath) as OutputRow[]).map(toOutput);
  const rootOf = (projectId: string): string | null => {
    const known = deps.projectRoot?.(projectId);
    if (known) return known;
    const row = db.prepare(`SELECT root FROM run_log WHERE project_id = ? AND root IS NOT NULL ORDER BY started_at DESC LIMIT 1`).get(projectId) as { root: string } | undefined;
    return row?.root ?? null;
  };

  /** Copies `file` as the next version of `relPath`, unless its bytes are already the newest kept version. */
  async function keep(projectId: string, relPath: string, file: string, size: number, runId: string | null, change: RunOutputChange,
    skipWhenKept: 'newest' | 'any'): Promise<RunOutput | null> {
    const stored = size <= MAX_COPY_BYTES;
    const sha256 = stored ? await sha256Of(file) : '';
    const versions = versionsOf(projectId, relPath);
    if (stored && (skipWhenKept === 'any' ? versions.some((version) => version.sha256 === sha256) : versions[0]?.sha256 === sha256)) return null;
    if (stored) {
      const target = blobPath(sha256);
      if (!fs.existsSync(target)) {
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(file, target);
      }
    }
    const id = randomUUID();
    db.prepare(`INSERT INTO run_outputs (id, run_id, project_id, rel_path, version, change, sha256, size, stored, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, runId, projectId, relPath, (versions[0]?.version ?? 0) + 1, change, sha256, size, stored ? 1 : 0, now());
    return outputById(id);
  }

  function start(run: RunStart): void {
    db.prepare(`INSERT OR REPLACE INTO run_log (run_id, project_id, conversation_id, agent_id, agent_name, model, request, root, status, started_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)`)
      .run(run.runId, run.projectId, run.conversationId, run.agentId, run.agentName, run.model,
        run.request.replace(/\s+/g, ' ').trim().slice(0, RUN_REQUEST_MAX_CHARS), run.root, now());
    if (run.projectId && run.root) {
      baselines.set(run.runId, { root: run.root, projectId: run.projectId, development: run.development, files: listResultFiles(run.root, run.development) });
    }
  }

  async function finish(run: RunFinish): Promise<RunOutput[]> {
    const baseline = baselines.get(run.runId);
    baselines.delete(run.runId);
    const kept: RunOutput[] = [];
    if (baseline) {
      for (const [relPath, after] of listResultFiles(baseline.root, baseline.development)) {
        const before = baseline.files.get(relPath);
        if (before && before.size === after.size && before.mtimeMs === after.mtimeMs) continue;
        try {
          const output = await keep(baseline.projectId, relPath, path.join(baseline.root, relPath), after.size, run.runId, before ? 'modified' : 'created', 'newest');
          if (output) kept.push(output);
        } catch (error) {
          // A file that vanished or a project deleted mid-run loses its copy, never the run's record.
          console.warn(`[run-outputs] could not keep ${relPath}: ${(error as Error).message}`);
        }
      }
    }
    const usage = run.usage;
    const total = usage?.totalTokens ?? ((usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0));
    db.prepare(`UPDATE run_log SET status = ?, finished_at = ?, input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_write_tokens = ?,
                total_tokens = ?, measured = ?, output_count = ? WHERE run_id = ?`)
      .run(run.status, now(), usage?.inputTokens ?? 0, usage?.outputTokens ?? 0, usage?.cacheReadTokens ?? 0, usage?.cacheWriteTokens ?? 0,
        total, usage && total > 0 ? 1 : 0, kept.length, run.runId);
    return kept;
  }

  function list(query: RunOutputListQuery): RunOutputListResponse {
    const needle = query.q?.trim().toLowerCase() ?? '';
    const rows = (db.prepare(`${OUTPUT_SELECT} ORDER BY o.created_at DESC, o.version DESC LIMIT 50000`).all() as OutputRow[]).map(toOutput)
      .filter((output) => query.allVersions || query.runId || output.latest)
      .filter((output) => !needle || output.path.toLowerCase().includes(needle) || output.request.toLowerCase().includes(needle))
      .filter((output) => !query.runId || output.runId === query.runId);
    const matches = (output: RunOutput, skip?: 'project' | 'agent' | 'format') =>
      (skip === 'project' || !query.projectId || output.projectId === query.projectId)
      && (skip === 'agent' || !query.agentId || output.agentId === query.agentId)
      && (skip === 'format' || !query.format || output.format === query.format);
    const outputs = rows.filter((output) => matches(output));
    return {
      outputs: page(outputs, query),
      total: outputs.length,
      facets: {
        projects: facet(rows.filter((output) => matches(output, 'project')).map((output) => ({ id: output.projectId, label: output.projectName }))),
        agents: facet(rows.filter((output) => matches(output, 'agent')).map((output) => ({ id: output.agentId, label: output.agentName }))),
        formats: facet(rows.filter((output) => matches(output, 'format')).map((output) => ({ id: output.format, label: output.format }))),
      },
    };
  }

  function matchingRuns(query: RunLogListQuery): RunLogEntry[] {
    const needle = query.q?.trim().toLowerCase() ?? '';
    return (db.prepare(`${RUN_SELECT} ORDER BY r.started_at DESC, r.rowid DESC LIMIT 50000`).all() as RunRow[]).map(toRun)
      .filter((run) => (!query.projectId || run.projectId === query.projectId) && (!query.agentId || run.agentId === query.agentId)
        && (!query.status || run.status === query.status) && (query.from === undefined || run.startedAt >= query.from)
        && (query.to === undefined || run.startedAt < query.to) && (!needle || run.request.toLowerCase().includes(needle)));
  }

  function runs(query: RunLogListQuery): RunLogListResponse {
    const found = matchingRuns(query);
    return { runs: page(found, query), total: found.length };
  }

  function usage(query: Pick<RunLogListQuery, 'projectId' | 'agentId' | 'from' | 'to'>): RunUsageSummaryResponse {
    const found = matchingRuns(query);
    const empty = (key: string, label: string): RunUsageBucket =>
      ({ key, label, runs: 0, unmeasuredRuns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 });
    const add = (bucket: RunUsageBucket, run: RunLogEntry) => {
      bucket.runs += 1;
      if (!run.usage.measured) bucket.unmeasuredRuns += 1;
      bucket.inputTokens += run.usage.inputTokens;
      bucket.outputTokens += run.usage.outputTokens;
      bucket.cacheReadTokens += run.usage.cacheReadTokens;
      bucket.cacheWriteTokens += run.usage.cacheWriteTokens;
      bucket.totalTokens += run.usage.totalTokens;
    };
    const group = (keyOf: (run: RunLogEntry) => [string, string] | null) => {
      const buckets = new Map<string, RunUsageBucket>();
      for (const run of found) {
        const named = keyOf(run);
        if (!named) continue;
        if (!buckets.has(named[0])) buckets.set(named[0], empty(named[0], named[1]));
        add(buckets.get(named[0])!, run);
      }
      return [...buckets.values()];
    };
    const totals = { ...empty('all', 'all'), succeeded: 0, failed: 0, canceled: 0, running: 0, outputs: 0 };
    for (const run of found) {
      add(totals, run);
      totals[run.status] += 1;
      totals.outputs += run.outputCount;
    }
    const busiest = (a: RunUsageBucket, b: RunUsageBucket) => b.runs - a.runs || b.totalTokens - a.totalTokens || a.label.localeCompare(b.label);
    return {
      from: query.from ?? null,
      to: query.to ?? null,
      totals,
      byAgent: group((run) => run.agentId ? [run.agentId, run.agentName ?? run.agentId] : null).sort(busiest),
      byProject: group((run) => run.projectId ? [run.projectId, run.projectName ?? run.projectId] : null).sort(busiest),
      byDay: group((run) => [localDay(run.startedAt), localDay(run.startedAt)]).sort((a, b) => b.key.localeCompare(a.key)),
    };
  }

  async function content(id: string): Promise<Buffer | null> {
    const output = outputById(id);
    if (!output?.stored) return null;
    return readFile(blobPath(output.sha256)).catch(() => null);
  }

  async function detail(id: string): Promise<RunOutputDetailResponse | null> {
    const output = outputById(id);
    if (!output) return null;
    const root = rootOf(output.projectId);
    let current: RunOutputDetailResponse['current'] = 'missing';
    if (root) {
      const file = path.join(root, output.path);
      const info = await stat(file).catch(() => null);
      if (info?.isFile()) current = output.stored && info.size === output.size && await sha256Of(file) === output.sha256 ? 'same' : 'changed';
    }
    const run = output.runId ? db.prepare(`${RUN_SELECT} WHERE r.run_id = ?`).get(output.runId) as RunRow | undefined : undefined;
    return {
      output,
      versions: versionsOf(output.projectId, output.path),
      sameRun: output.runId
        ? (db.prepare(`${OUTPUT_SELECT} WHERE o.run_id = ? AND o.id <> ? ORDER BY o.rel_path`).all(output.runId, id) as OutputRow[]).map(toOutput)
        : [],
      current,
      run: run ? toRun(run) : null,
    };
  }

  /** Writes a kept version back into the project. What it replaces is kept first, unless those bytes are already kept. */
  async function restore(id: string, root?: string): Promise<RunOutputRestoreResponse> {
    const output = outputById(id);
    if (!output) throw new RunOutputError('Result not found.', 404, 'RUN_OUTPUT_NOT_FOUND');
    const bytes = await content(id);
    if (!bytes) throw new RunOutputError('This version was not copied (the file was too large), so it cannot be put back.', 409, 'RUN_OUTPUT_NOT_STORED');
    const folder = root ?? rootOf(output.projectId);
    if (!folder) throw new RunOutputError('The project folder is not known.', 409, 'RUN_OUTPUT_NO_PROJECT_FOLDER');
    const file = path.join(folder, output.path);
    const info = await stat(file).catch(() => null);
    const savedBefore = info?.isFile() ? await keep(output.projectId, output.path, file, info.size, null, 'before-restore', 'any') : null;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    return { restored: outputById(id)!, savedBefore };
  }

  /** Removes copies no result points to any more (their project was deleted). Returns how many were removed. */
  async function prune(): Promise<number> {
    const used = new Set((db.prepare(`SELECT DISTINCT sha256 FROM run_outputs WHERE stored = 1`).all() as Array<{ sha256: string }>).map((row) => row.sha256));
    let removed = 0;
    for (const shard of await readdir(blobsDir).catch(() => [] as string[])) {
      for (const name of await readdir(path.join(blobsDir, shard)).catch(() => [] as string[])) {
        if (used.has(name)) continue;
        await rm(path.join(blobsDir, shard, name), { force: true });
        removed += 1;
      }
    }
    return removed;
  }

  return { start, finish, list, runs, usage, content, detail, restore, prune, output: outputById };
}
