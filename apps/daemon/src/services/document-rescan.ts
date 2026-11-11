import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  compareInterfaceSpecDocuments,
  parseInterfaceSpecDocument,
  type InterfaceSpecCompatibilityReport,
  type InterfaceSpecDocument,
} from '@open-design/contracts';

const run = promisify(execFile);

/** Collectors whose output can be regenerated from code with the bundled scanner, and the script that does it. */
const RESCAN_SCANNERS: Record<string, string> = { 'static-spring': 'scan_spring.py' };
/** Files those scanners read; other changed files cannot change their output. */
const SCANNED_SOURCES = /\.(java|kt|xml)$/i;

export interface RescanOptions {
  /** The interface-spec plugin's `scripts` directory. */
  scriptsDir: string;
  /** Python launchers to try in order; the first that reports Python 3 is used. */
  pythons?: Array<{ command: string; args: string[] }>;
  timeoutMs?: number;
}

export interface RescanResult {
  report: InterfaceSpecCompatibilityReport;
  /** Route keys present in the current code. */
  currentRoutes: string[];
}

/** `METHOD /path` with path parameters by position, the key the compatibility comparison pairs endpoints by. */
export function routeKey(method: string, routePath: string): string {
  const normalized = routePath.trim().replace(/\{[^}/]*\}|:[A-Za-z_][\w-]*/g, '{}').replace(/\/+$/, '') || '/';
  return `${method.trim().toUpperCase()} ${normalized}`;
}

export function routeKeyOf(route: string): string {
  const [method = '', ...rest] = route.trim().split(/\s+/);
  return routeKey(method, rest.join(' '));
}

/** Why a document cannot be re-scanned, or null when it can. */
export function rescanBlocker(doc: InterfaceSpecDocument, repository: boolean, baselineRevision: string | null): string | null {
  if (!repository) return 'not a Git repository';
  if (!baselineRevision) return 'no baseline revision';
  const collector = doc.source.collector ?? '';
  if (!RESCAN_SCANNERS[collector]) return `the document was not made by a scanner that can re-read the code (collector: ${collector || 'none'})`;
  return null;
}

export function touchesScannedSources(changedFiles: string[]): boolean {
  return changedFiles.some((file) => SCANNED_SOURCES.test(file));
}

const defaultPythons = () => process.platform === 'win32'
  ? [{ command: 'python', args: [] }, { command: 'py', args: ['-3'] }, { command: 'python3', args: [] }]
  : [{ command: 'python3', args: [] }, { command: 'python', args: [] }];

const pythonCache = new Map<string, Promise<{ command: string; args: string[] } | null>>();

export function findPython(candidates = defaultPythons()): Promise<{ command: string; args: string[] } | null> {
  const key = JSON.stringify(candidates);
  let found = pythonCache.get(key);
  if (!found) {
    found = (async () => {
      for (const candidate of candidates) {
        try {
          const { stdout, stderr } = await run(candidate.command, [...candidate.args, '--version'], { timeout: 5_000, windowsHide: true });
          if (/Python 3\./.test(`${stdout}${stderr}`)) return candidate;
        } catch { /* try the next launcher */ }
      }
      return null;
    })();
    pythonCache.set(key, found);
  }
  return found;
}

async function git(cwd: string, args: string[], options: { env?: NodeJS.ProcessEnv; input?: string } = {}): Promise<string> {
  const child = execFile('git', ['--no-pager', ...args], {
    cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', ...options.env },
  });
  const done = new Promise<string>((resolve, reject) => {
    let out = '';
    let err = '';
    child.stdout?.on('data', (chunk) => { out += chunk; });
    child.stderr?.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(`git ${args[0]} failed: ${err.trim() || code}`)));
  });
  if (options.input !== undefined) child.stdin?.end(options.input);
  else child.stdin?.end();
  return done;
}

/**
 * The scanned sources of `revision` written under `dest`, without touching the user's index or working tree:
 * a temporary index file is filled with the revision's tree and checked out under a prefix.
 */
async function exportRevision(codeRoot: string, revision: string, scratch: string): Promise<string> {
  const top = (await git(codeRoot, ['rev-parse', '--show-toplevel'])).trim();
  const prefix = (await git(codeRoot, ['rev-parse', '--show-prefix'])).trim();
  const listing = await git(top, ['ls-tree', '-r', '-z', '--name-only', revision, '--', prefix || '.']);
  const files = listing.split('\0').filter((file) => file && SCANNED_SOURCES.test(file));
  const tree = path.join(scratch, 'tree');
  await mkdir(tree, { recursive: true });
  if (files.length) {
    const env = { GIT_INDEX_FILE: path.join(scratch, 'index') };
    await git(top, ['read-tree', revision], { env });
    await git(top, ['checkout-index', '-z', '--stdin', `--prefix=${tree.split(path.sep).join('/')}/`], { env, input: files.join('\0') });
  }
  return path.join(tree, prefix);
}

async function scan(python: { command: string; args: string[] }, script: string, codebase: string, out: string, timeout: number): Promise<InterfaceSpecDocument> {
  await run(python.command, [...python.args, script, '--codebase-path', codebase, '--codebase-name', 'rescan', '--out', out], {
    timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
  const parsed = parseInterfaceSpecDocument(JSON.parse(await readFile(out, 'utf8')));
  if (!parsed.ok) throw new Error(`the scanner output is not a valid interface spec: ${parsed.error}`);
  return parsed.doc;
}

/**
 * Re-reads the code at `revision` and the current working tree with the document's scanner and compares the two
 * from a caller's point of view. Throws with a readable reason when it cannot (no Python, scanner missing or failing).
 */
export async function rescanCode(options: {
  codeRoot: string; revision: string; doc: InterfaceSpecDocument; rescan: RescanOptions;
}): Promise<RescanResult> {
  const scriptName = RESCAN_SCANNERS[options.doc.source.collector ?? ''];
  if (!scriptName) throw new Error('no scanner for this document');
  const script = path.join(options.rescan.scriptsDir, scriptName);
  await access(script).catch(() => { throw new Error(`the scanner is not installed (${scriptName})`); });
  const python = await findPython(options.rescan.pythons);
  if (!python) throw new Error('Python 3 was not found');
  const timeout = options.rescan.timeoutMs ?? 120_000;
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'monofield-rescan-'));
  try {
    const baselineCode = await exportRevision(options.codeRoot, options.revision, scratch);
    const before = await scan(python, script, baselineCode, path.join(scratch, 'before.json'), timeout);
    const after = await scan(python, script, options.codeRoot, path.join(scratch, 'after.json'), timeout);
    return {
      report: compareInterfaceSpecDocuments(before, after),
      currentRoutes: after.endpoints.map((endpoint) => routeKey(endpoint.method, endpoint.path)),
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
