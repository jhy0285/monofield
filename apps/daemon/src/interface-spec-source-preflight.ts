import { constants } from 'node:fs';
import { access, open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export type InterfaceSpecSourcePreflight =
  | {
      ok: true;
      root: string;
      signal: string;
    }
  | {
      ok: false;
      root: string | null;
      reason: 'missing' | 'not-directory' | 'unreadable' | 'no-analyzable-source' | 'scan-limit';
      message: string;
    };

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.idea',
  '.next',
  '.nuxt',
  '.venv',
  '.vscode',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'vendor',
  'venv',
]);

const SOURCE_EXTENSIONS = new Set([
  '.cs',
  '.go',
  '.gql',
  '.graphql',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.kts',
  '.mjs',
  '.cjs',
  '.php',
  '.proto',
  '.py',
  '.rb',
  '.rs',
  '.scala',
  '.ts',
  '.tsx',
]);

const SOURCE_NAME_SIGNAL =
  /(?:^|[._-])(api|controller|dto|endpoint|handler|resource|route|router|schema|serializer|urls?|views?)(?:[._-]|$)/i;
const SOURCE_STEM_SIGNAL =
  /(?:api|controller|dto|endpoint|handler|resource|route|router|schema|serializer|urls?|views?)$/i;
const OPENAPI_NAME_SIGNAL = /(?:openapi|swagger).*(?:\.ya?ml|\.json)$/i;
const CONTENT_SIGNALS: Array<[string, RegExp]> = [
  ['Spring/JAX-RS route', /@(?:RequestMapping|GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|Path)\b/],
  ['NestJS controller', /@(Controller|Get|Post|Put|Patch|Delete)\s*\(/],
  ['Express/Fastify route', /\b(?:app|router|server|fastify)\s*\.\s*(?:get|post|put|patch|delete|route)\s*\(/i],
  ['Python web route', /@(?:app|router|blueprint|bp)\s*\.\s*(?:get|post|put|patch|delete|route)\s*\(/i],
  ['Django URL route', /\b(?:path|re_path)\s*\(/],
  ['Go HTTP route', /\b(?:Handle|HandleFunc|Methods)\s*\(/],
  ['ASP.NET route', /\[(?:HttpGet|HttpPost|HttpPut|HttpPatch|HttpDelete|Route)(?:\(|\])|\bMap(?:Get|Post|Put|Patch|Delete)\s*\(/],
  ['Ruby/PHP route', /\b(?:get|post|put|patch|delete)\s+["']\/|Route::(?:get|post|put|patch|delete)\s*\(/i],
  ['GraphQL/schema contract', /\b(?:type\s+(?:Query|Mutation)|service\s+\w+\s*\{|rpc\s+\w+\s*\()/],
];

const MAX_DEPTH = 10;
const MAX_DIRECTORY_ENTRIES = 6_000;
const MAX_SOURCE_FILES = 512;
const MAX_FILE_BYTES = 64 * 1024;

async function readPrefix(filePath: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(filePath, 'r');
    const buffer = Buffer.allocUnsafe(MAX_FILE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Bounded, read-only validation for the source-code interface-spec workflow.
 * This deliberately looks for route/controller/schema evidence, not merely an
 * existing directory, so an empty folder or MonoField's managed project folder
 * cannot unlock collection and guessed artifacts.
 */
export async function preflightInterfaceSpecSource(
  sourceDir: string,
): Promise<InterfaceSpecSourcePreflight> {
  const requestedRoot = path.resolve(sourceDir);
  let root: string;
  try {
    root = await realpath(requestedRoot);
  } catch {
    return {
      ok: false,
      root: null,
      reason: 'missing',
      message: 'The selected source folder does not exist.',
    };
  }

  let rootStat;
  try {
    rootStat = await stat(root);
  } catch {
    return {
      ok: false,
      root,
      reason: 'unreadable',
      message: 'The selected source folder cannot be read.',
    };
  }
  if (!rootStat.isDirectory()) {
    return {
      ok: false,
      root,
      reason: 'not-directory',
      message: 'The selected source path is not a directory.',
    };
  }
  try {
    await access(root, constants.R_OK);
  } catch {
    return {
      ok: false,
      root,
      reason: 'unreadable',
      message: 'The selected source folder cannot be read.',
    };
  }

  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  let queueIndex = 0;
  let visitedEntries = 0;
  let inspectedSourceFiles = 0;
  let hitLimit = false;

  while (queueIndex < queue.length) {
    const current = queue[queueIndex++];
    if (!current) break;
    let entries;
    try {
      entries = await readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      visitedEntries += 1;
      if (visitedEntries > MAX_DIRECTORY_ENTRIES) {
        hitLimit = true;
        break;
      }
      if (entry.isSymbolicLink()) continue;
      const entryPath = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < MAX_DEPTH && !IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) {
          queue.push({ dir: entryPath, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;

      if (OPENAPI_NAME_SIGNAL.test(entry.name)) {
        const contents = await readPrefix(entryPath);
        if (contents !== null && /["']?\b(?:openapi|swagger)\b["']?\s*:/i.test(contents)) {
          return { ok: true, root, signal: `OpenAPI contract: ${entryPath}` };
        }
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(extension)) continue;

      // Filename candidates are cheap and high-signal. Inspect them before
      // consuming the generic content quota so a large monorepo cannot hide a
      // controller/DTO behind hundreds of ordinary implementation files.
      const sourceStem = path.basename(entry.name, extension);
      const namedCandidate = SOURCE_NAME_SIGNAL.test(entry.name) || SOURCE_STEM_SIGNAL.test(sourceStem);
      if (namedCandidate) {
        const contents = await readPrefix(entryPath);
        if (contents !== null) return { ok: true, root, signal: `API source file: ${entryPath}` };
        continue;
      }

      if (inspectedSourceFiles >= MAX_SOURCE_FILES) {
        hitLimit = true;
        // Keep traversing the bounded directory-entry queue to find named or
        // OpenAPI candidates, but stop reading generic file contents.
        continue;
      }
      inspectedSourceFiles += 1;

      const contents = await readPrefix(entryPath);
      if (contents === null) continue;
      const contentSignal = CONTENT_SIGNALS.find(([, pattern]) => pattern.test(contents));
      if (contentSignal) {
        return { ok: true, root, signal: `${contentSignal[0]}: ${entryPath}` };
      }
    }
    // `hitLimit` means the generic content budget is exhausted, not that the
    // bounded directory walk should stop before high-signal filenames.
  }

  return {
    ok: false,
    root,
    reason: hitLimit ? 'scan-limit' : 'no-analyzable-source',
    message: hitLimit
      ? 'No analyzable API source was found within the bounded source scan.'
      : 'The selected folder does not contain readable route, controller, DTO, schema, or OpenAPI source.',
  };
}
