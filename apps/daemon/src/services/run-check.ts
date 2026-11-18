import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  InterfaceSpecCompatibilityChange,
  RunApiCheck,
  RunCheckFile,
  RunCheckSummary,
  RunTouchedChange,
  RunTouchedItem,
  RunTouchedKind,
} from '@open-design/contracts';
import { compareCodeTrees, git, touchesScannedSources, type RescanOptions } from './document-rescan.js';
import { analyzerFor } from './ontology/analyzers.js';
import { SKILLS_CWD_ALIAS } from '../cwd-aliases.js';
import type { ParsedUnit } from './ontology/model.js';

/**
 * The check after a run. When a run starts in a folder that belongs to a Git repository, the folder's state (tracked
 * and untracked files, `.gitignore` respected) is written as a Git tree; when it ends, again. The difference between
 * the two trees is what the run changed, whatever the person had already changed before it. Both snapshots use a
 * temporary index, so the person's index, branch and files are never touched; git keeps the hashed file contents as
 * loose objects until its next cleanup.
 *
 * The difference is then read two ways: Java, Kotlin and Spring XML changes are compared with the interface-spec
 * scanner (what a caller of the API would notice), and every changed file the code-ontology analyzers understand is
 * parsed on both sides to list the APIs, screens, tables and classes it added, removed or changed.
 */
export interface RunCheckRecord {
  summary: RunCheckSummary;
  files: RunCheckFile[];
  apiChanges: InterfaceSpecCompatibilityChange[];
  touched: RunTouchedItem[];
}

export interface RunChecksDeps {
  record: (runId: string, record: RunCheckRecord) => void;
  /** The interface-spec plugin's scripts folder, or null when it is not installed. */
  scriptsDir: () => Promise<string | null>;
  pythons?: RescanOptions['pythons'];
}

export type RunChecks = ReturnType<typeof createRunChecks>;

/**
 * What MonoField itself writes into a project folder for a run: staged skills, Claude Code's MCP config and Pi's
 * sessions. They are the run's plumbing, not its work, so they are kept out of both snapshots.
 */
export const RUNTIME_PATHS: readonly string[] = [SKILLS_CWD_ALIAS, '.mcp.json', '.pi/sessions'];
const RUNTIME_EXCLUDES = RUNTIME_PATHS.map((entry) => `:(exclude,glob)**/${entry}${entry.includes('.json') ? '' : '/**'}`);
const isRuntimePath = (file: string) => RUNTIME_PATHS.some((entry) => file === entry || file.startsWith(`${entry}/`));

const TOUCHED_KINDS = new Set<string>(['api', 'screen', 'table', 'class']);
const MAX_PARSED_FILES = 200;
const MAX_PARSED_BYTES = 512 * 1024;
const NO_TOUCHED: Record<RunTouchedKind, number> = { api: 0, screen: 0, table: 0, class: 0 };

/** The folder's current state as a Git tree, written through a copy of the index so only changed files are hashed. */
export async function snapshotTree(top: string): Promise<string> {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'monofield-snapshot-'));
  try {
    const index = path.join(scratch, 'index');
    const real = (await git(top, ['rev-parse', '--git-path', 'index'])).trim();
    await copyFile(path.resolve(top, real), index).catch(() => { /* a repository without commits has no index yet */ });
    const env = { GIT_INDEX_FILE: index };
    await git(top, ['add', '-A', '--', '.', ...RUNTIME_EXCLUDES], { env });
    return (await git(top, ['write-tree'], { env })).trim();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

const STATUS: Record<string, RunCheckFile['status']> = { A: 'added', C: 'added', M: 'modified', T: 'modified', D: 'deleted', R: 'renamed' };

/** Files that differ between two trees under `prefix`, relative to it. */
export async function changedFilesBetween(top: string, prefix: string, before: string, after: string): Promise<RunCheckFile[]> {
  const out = await git(top, ['diff', '--name-status', '-z', '-M', before, after, '--', prefix || '.']);
  const parts = out.split('\0');
  const files: RunCheckFile[] = [];
  const local = (name: string) => (prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name);
  for (let i = 0; i < parts.length;) {
    const code = parts[i] ?? '';
    if (!code) break;
    const status = STATUS[code[0]!] ?? 'modified';
    if (code[0] === 'R' || code[0] === 'C') {
      const from = parts[i + 1] ?? '';
      const to = parts[i + 2] ?? '';
      files.push(status === 'renamed' ? { path: local(to), status, from: local(from) } : { path: local(to), status });
      i += 3;
    } else {
      files.push({ path: local(parts[i + 1] ?? ''), status });
      i += 2;
    }
  }
  return files.filter((file) => file.path && !isRuntimePath(file.path));
}

/** A changed line that carries code: not blank, a lone brace or bracket, or a comment. */
function significant(line: string): boolean {
  const text = line.trim();
  return !!text && !/^[{}()[\];,]+$/.test(text) && !/^(\/\/|\/\*|\*|\*\/|<!--|-->|#)/.test(text);
}

/**
 * The lines the run edited in one file, on both sides, counting only lines that carry code. A pure insertion after a
 * method often makes git report that method's closing brace as new; ignoring braces and comments keeps that edit from
 * being charged to the method above it.
 */
async function editedLines(top: string, before: string, after: string, beforePath: string, afterPath: string): Promise<{ old: number[]; now: number[] }> {
  const out = await git(top, ['diff', '-U0', '--no-color', '--no-ext-diff', `${before}:${beforePath}`, `${after}:${afterPath}`]).catch(() => '');
  const edited = { old: [] as number[], now: [] as number[] };
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of out.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) { oldLine = Number(header[1]); newLine = Number(header[2]); inHunk = true; continue; }
    if (!inHunk) continue;
    if (line.startsWith('-')) { if (significant(line.slice(1))) edited.old.push(oldLine); oldLine += 1; }
    else if (line.startsWith('+')) { if (significant(line.slice(1))) edited.now.push(newLine); newLine += 1; }
  }
  return edited;
}

/**
 * Each API's lines in a file: from its mapping annotation to the line before the next API or class declaration that
 * starts after it. An approximation (analyzers record where a declaration starts, not where it ends) that is exact
 * for the usual one-handler-after-another controller.
 */
function apiRegions(unit: ParsedUnit, length: number): Map<string, [number, number]> {
  const starts = unit.nodes.filter((node) => node.kind === 'api' || node.kind === 'class').map((node) => node.evidence.line).sort((a, b) => a - b);
  const regions = new Map<string, [number, number]>();
  for (const node of unit.nodes) {
    if (node.kind !== 'api') continue;
    const next = starts.find((line) => line > node.evidence.line);
    regions.set(node.label, [node.evidence.line, next === undefined ? length : next - 1]);
  }
  return regions;
}

const inside = (line: number, region: [number, number] | undefined) => !!region && line >= region[0] && line <= region[1];

async function parseSide(file: string, text: string | null): Promise<{ unit: ParsedUnit; lines: number } | null> {
  if (text === null) return null;
  const analyzer = analyzerFor(file);
  if (!analyzer) return null;
  try {
    const unit = await analyzer.parse(file, text, createHash('sha256').update(text).digest('hex'));
    return { unit, lines: text.split('\n').length };
  } catch {
    return null;
  }
}

/** What the changed files declare, and how the run changed each declaration. */
export async function touchedBetween(top: string, prefix: string, before: string, after: string, files: RunCheckFile[]): Promise<RunTouchedItem[]> {
  const items = new Map<string, RunTouchedItem>();
  const add = (kind: RunTouchedKind, label: string, file: string, change: RunTouchedChange) => {
    const key = `${kind}\0${label}`;
    const seen = items.get(key);
    // A declaration that moved between files was neither added nor removed.
    if (seen && seen.change !== change) seen.change = 'changed';
    else if (!seen) items.set(key, { kind, label, path: file, change });
  };
  const read = async (tree: string, file: string) => {
    const text = await git(top, ['cat-file', 'blob', `${tree}:${prefix}${file}`]).catch(() => null);
    return text !== null && Buffer.byteLength(text) <= MAX_PARSED_BYTES ? text : null;
  };
  let parsed = 0;
  for (const file of files) {
    if (!analyzerFor(file.path)) continue;
    if (++parsed > MAX_PARSED_FILES) break;
    const beforePath = file.from ?? file.path;
    const old = file.status === 'added' ? null : await parseSide(beforePath, await read(before, beforePath));
    const now = file.status === 'deleted' ? null : await parseSide(file.path, await read(after, file.path));
    const declared = (side: { unit: ParsedUnit } | null) => new Map((side?.unit.nodes ?? [])
      .filter((node) => TOUCHED_KINDS.has(node.kind)).map((node) => [`${node.kind}\0${node.label}`, node.kind as RunTouchedKind]));
    const was = declared(old);
    const is = declared(now);
    const edits = old && now ? await editedLines(top, before, after, `${prefix}${beforePath}`, `${prefix}${file.path}`) : { old: [], now: [] };
    const oldRegions = old ? apiRegions(old.unit, old.lines) : new Map<string, [number, number]>();
    const newRegions = now ? apiRegions(now.unit, now.lines) : new Map<string, [number, number]>();
    for (const [key, kind] of is) {
      const label = key.slice(kind.length + 1);
      if (!was.has(key)) { add(kind, label, file.path, 'added'); continue; }
      if (kind !== 'api') { add(kind, label, file.path, 'changed'); continue; }
      // An API counts as changed only when the run edited its handler's lines.
      const oldRegion = oldRegions.get(label);
      const newRegion = newRegions.get(label);
      const edited = edits.now.some((line) => inside(line, newRegion)) || edits.old.some((line) => inside(line, oldRegion));
      if (edited) add(kind, label, file.path, 'changed');
    }
    for (const [key, kind] of was) if (!is.has(key)) add(kind, key.slice(kind.length + 1), beforePath, 'removed');
  }
  const order: Record<RunTouchedKind, number> = { api: 0, screen: 1, table: 2, class: 3 };
  return [...items.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.label.localeCompare(b.label));
}

export function createRunChecks(deps: RunChecksDeps) {
  interface Active { root: string; development: boolean; top: string | null; shared: boolean; begin: Promise<{ top: string; prefix: string; tree: string } | null> }
  const active = new Map<string, Active>();

  const pending = (shared: boolean): RunCheckSummary => ({ state: 'pending', reason: null, message: null, shared, files: 0, api: null, touched: { ...NO_TOUCHED } });

  /**
   * Snapshots the run's folder before the agent starts. Returns a promise the run service waits for (briefly), or
   * undefined when there is nothing to check.
   */
  function start(input: { runId: string; root: string | null; development: boolean }): Promise<void> | undefined {
    if (!input.root) return undefined;
    const root = input.root;
    const entry: Active = { root, development: input.development, top: null, shared: false, begin: Promise.resolve(null) };
    entry.begin = (async () => {
      const inside = (await git(root, ['rev-parse', '--is-inside-work-tree']).catch(() => '')).trim();
      if (inside !== 'true') {
        if (entry.development) deps.record(input.runId, { summary: { ...pending(false), state: 'skipped', reason: 'not-git' }, files: [], apiChanges: [], touched: [] });
        return null;
      }
      const top = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
      const prefix = (await git(root, ['rev-parse', '--show-prefix'])).trim();
      entry.top = top;
      for (const [id, other] of active) {
        if (id !== input.runId && other.top === top) { other.shared = true; entry.shared = true; }
      }
      deps.record(input.runId, { summary: pending(entry.shared), files: [], apiChanges: [], touched: [] });
      return { top, prefix, tree: await snapshotTree(top) };
    })();
    active.set(input.runId, entry);
    return entry.begin.then(() => undefined, () => undefined);
  }

  /** Reads what the run changed; runs after the run has ended and never fails it. */
  async function finish(runId: string): Promise<void> {
    const entry = active.get(runId);
    if (!entry) return;
    let started: { top: string; prefix: string; tree: string } | null;
    try {
      started = await entry.begin;
    } catch (error) {
      active.delete(runId);
      deps.record(runId, { summary: { ...pending(entry.shared), state: 'failed', reason: 'error', message: (error as Error).message }, files: [], apiChanges: [], touched: [] });
      return;
    }
    if (!started) { active.delete(runId); return; }
    try {
      // Snapshot first, before anything else can write to the folder.
      const after = await snapshotTree(started.top);
      active.delete(runId);
      const files = await changedFilesBetween(started.top, started.prefix, started.tree, after);
      let api: RunApiCheck | null = null;
      let apiChanges: InterfaceSpecCompatibilityChange[] = [];
      if (touchesScannedSources(files.flatMap((file) => (file.from ? [file.path, file.from] : [file.path])))) {
        const scriptsDir = await deps.scriptsDir();
        if (!scriptsDir) api = { checked: false, reason: 'no-scanner' };
        else {
          try {
            const compared = await compareCodeTrees({ codeRoot: entry.root, before: started.tree, after, scriptsDir, ...(deps.pythons ? { pythons: deps.pythons } : {}) });
            api = { checked: true, level: compared.report.level, counts: compared.report.counts, endpoints: compared.endpoints };
            apiChanges = compared.report.changes;
          } catch (error) {
            const code = (error as { code?: string }).code;
            api = code === 'NO_PYTHON' ? { checked: false, reason: 'no-python' }
              : code === 'NO_SCANNER' ? { checked: false, reason: 'no-scanner' }
                : { checked: false, reason: 'error', message: (error as Error).message.slice(0, 500) };
          }
        }
      }
      const touched = await touchedBetween(started.top, started.prefix, started.tree, after, files);
      const counts = { ...NO_TOUCHED };
      for (const item of touched) counts[item.kind] += 1;
      deps.record(runId, {
        summary: { state: 'done', reason: null, message: null, shared: entry.shared, files: files.length, api, touched: counts },
        files, apiChanges, touched,
      });
    } catch (error) {
      active.delete(runId);
      deps.record(runId, { summary: { ...pending(entry.shared), state: 'failed', reason: 'error', message: (error as Error).message.slice(0, 500) }, files: [], apiChanges: [], touched: [] });
    }
  }

  return { start, finish };
}
