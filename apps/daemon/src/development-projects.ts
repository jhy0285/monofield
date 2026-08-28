import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { DevelopmentWorkspaceProject } from '@open-design/contracts';

const PROJECT_MARKERS = new Set([
  '.git',
  'package.json',
  'pyproject.toml',
  'Pipfile',
  'requirements.txt',
  'manage.py',
  'go.mod',
  'go.work',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'Cargo.toml',
  'index.html',
]);

const IGNORED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', '.idea', '.vscode',
  'node_modules', 'target', 'build', 'dist', 'out', 'coverage',
  '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache',
  '.next', '.nuxt', '.turbo', '.cache',
]);

const MAX_DISCOVERY_DEPTH = 4;
const MAX_SCANNED_DIRECTORIES = 400;
const MAX_DISCOVERY_TIME_MS = 1_500;
// Workspace topology changes far less often than the active module selector.
// Keep it warm for quick A -> B -> A switching; the explicit refresh action
// remains the source of truth when modules are added or removed.
const CACHE_TTL_MS = 5 * 60_000;

type CacheEntry = { expiresAt: number; value: DevelopmentWorkspaceProject[] };
const discoveryCache = new Map<string, CacheEntry>();
const discoveryInFlight = new Map<string, Promise<DevelopmentWorkspaceProject[]>>();

function relativePath(root: string, target: string): string {
  return path.relative(root, target).replace(/\\/g, '/') || '.';
}

function safeWorkspacePath(value: string): string | null {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!normalized || normalized === '.') return '.';
  if (path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) return null;
  if (/[*?{}[\]]/.test(normalized)) return null;
  return normalized;
}

async function readText(target: string, maxBytes = 512 * 1024): Promise<string> {
  try {
    const handle = await fs.open(target, 'r');
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return '';
  }
}

async function directoryChildren(target: string): Promise<string[]> {
  try {
    return (await fs.readdir(target, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

async function expandWorkspacePattern(root: string, pattern: string): Promise<string[]> {
  const normalized = pattern.trim().replace(/^['"]|['"]$/g, '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!normalized || normalized.startsWith('!') || normalized.split('/').includes('..')) return [];
  const segments = normalized.split('/').filter(Boolean);
  let candidates = [{ absolute: root, relative: '' }];
  for (const segment of segments) {
    if (segment === '**') return [];
    const next: typeof candidates = [];
    for (const candidate of candidates) {
      if (segment === '*') {
        for (const child of await directoryChildren(candidate.absolute)) {
          next.push({ absolute: path.join(candidate.absolute, child), relative: [candidate.relative, child].filter(Boolean).join('/') });
        }
      } else if (!/[*?{}[\]]/.test(segment)) {
        next.push({ absolute: path.join(candidate.absolute, segment), relative: [candidate.relative, segment].filter(Boolean).join('/') });
      }
    }
    candidates = next;
    if (candidates.length > 200) candidates = candidates.slice(0, 200);
  }
  return candidates.map((candidate) => candidate.relative).filter(Boolean);
}

async function explicitWorkspacePaths(root: string): Promise<Set<string>> {
  const patterns = new Set<string>();
  const [packageJson, pnpmWorkspace, pom, settingsGradle, settingsGradleKts, goWork] = await Promise.all([
    readText(path.join(root, 'package.json')),
    readText(path.join(root, 'pnpm-workspace.yaml')),
    readText(path.join(root, 'pom.xml')),
    readText(path.join(root, 'settings.gradle')),
    readText(path.join(root, 'settings.gradle.kts')),
    readText(path.join(root, 'go.work')),
  ]);
  try {
    const pkg = JSON.parse(packageJson) as { workspaces?: string[] | { packages?: string[] } };
    const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
    for (const value of workspaces ?? []) if (typeof value === 'string') patterns.add(value);
  } catch {
    // package.json is optional.
  }
  for (const match of pnpmWorkspace.matchAll(/^\s*-\s*['"]?([^'"#]+)['"]?\s*$/gm)) patterns.add(match[1]!.trim());

  for (const match of pom.matchAll(/<module>\s*([^<]+?)\s*<\/module>/g)) patterns.add(match[1]!.trim());

  const gradle = `${settingsGradle}\n${settingsGradleKts}`;
  for (const match of gradle.matchAll(/include\s*\(?([^\n)]+)/g)) {
    for (const token of match[1]!.split(',')) {
      const value = token.trim().replace(/^['"]|['"]$/g, '').replace(/^:/, '').replace(/:/g, '/');
      if (value) patterns.add(value);
    }
  }

  for (const match of goWork.matchAll(/^\s*(?:use\s+)?(\.\.?\/[\w./-]+)\s*$/gm)) patterns.add(match[1]!.trim());

  const expanded = new Set<string>();
  for (const pattern of patterns) {
    for (const result of await expandWorkspacePattern(root, pattern)) {
      const safe = safeWorkspacePath(result);
      if (safe && safe !== '.') expanded.add(safe);
    }
  }
  return expanded;
}

async function markersAt(directory: string): Promise<string[]> {
  try {
    const names = await fs.readdir(directory);
    const markers = names.filter((name) => PROJECT_MARKERS.has(name) || name.toLowerCase().endsWith('.csproj'));
    return markers.sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

async function scanDevelopmentProjects(root: string): Promise<DevelopmentWorkspaceProject[]> {
  const explicit = await explicitWorkspacePaths(root);
  const queue: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];
  for (const relative of explicit) queue.push({ directory: path.resolve(root, relative), depth: MAX_DISCOVERY_DEPTH });
  const visited = new Set<string>();
  const projects = new Map<string, DevelopmentWorkspaceProject>();
  const deadline = Date.now() + MAX_DISCOVERY_TIME_MS;

  while (queue.length > 0 && visited.size < MAX_SCANNED_DIRECTORIES && Date.now() < deadline) {
    const batch: Array<{ absolute: string; depth: number; relative: string }> = [];
    while (queue.length > 0 && batch.length < 16 && visited.size < MAX_SCANNED_DIRECTORIES) {
      const current = queue.shift()!;
      const absolute = path.resolve(current.directory);
      const relative = relativePath(root, absolute);
      if (relative.startsWith('../') || path.isAbsolute(relative) || visited.has(absolute)) continue;
      visited.add(absolute);
      batch.push({ absolute, depth: current.depth, relative });
    }
    const scanned = await Promise.all(batch.map(async (current) => {
      try {
        const entries = await fs.readdir(current.absolute, { withFileTypes: true });
        return {
          ...current,
          children: entries
            .filter((entry) => entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name))
            .map((entry) => entry.name)
            .sort((left, right) => left.localeCompare(right)),
          markers: entries
            .map((entry) => entry.name)
            .filter((name) => PROJECT_MARKERS.has(name) || name.toLowerCase().endsWith('.csproj'))
            .sort((left, right) => left.localeCompare(right)),
        };
      } catch {
        return { ...current, children: [] as string[], markers: [] as string[] };
      }
    }));
    for (const current of scanned) {
      if (current.markers.length > 0) {
        projects.set(current.relative, {
          path: current.relative,
          label: current.relative === '.' ? path.basename(root) : path.basename(current.absolute),
          markers: current.markers,
        });
      }
      // A nested Git root is an IntelliJ-style module boundary. Its internal
      // package folders belong to that module unless a workspace manifest
      // explicitly points at them, so do not flood the selector with public/
      // test fixtures and leaf packages.
      if (current.relative !== '.' && current.markers.includes('.git') && !explicit.has(current.relative)) continue;
      if (current.depth >= MAX_DISCOVERY_DEPTH) continue;
      for (const child of current.children) {
        queue.push({ directory: path.join(current.absolute, child), depth: current.depth + 1 });
      }
    }
  }

  for (const relative of explicit) {
    if (projects.has(relative)) continue;
    const markers = await markersAt(path.resolve(root, relative));
    if (markers.length > 0) projects.set(relative, { path: relative, label: path.basename(relative), markers });
  }

  const value = [...projects.values()].sort((left, right) => {
    if (left.path === '.') return -1;
    if (right.path === '.') return 1;
    return left.path.localeCompare(right.path);
  });
  const result = value.length > 0 ? value : [{ path: '.', label: path.basename(root), markers: [] }];
  discoveryCache.set(root, { expiresAt: Date.now() + CACHE_TTL_MS, value: result });
  return result;
}

export async function discoverDevelopmentProjects(workspaceRoot: string, refresh = false): Promise<DevelopmentWorkspaceProject[]> {
  const root = path.resolve(workspaceRoot);
  const cached = discoveryCache.get(root);
  if (!refresh && cached && cached.expiresAt > Date.now()) return cached.value;
  const running = discoveryInFlight.get(root);
  if (running) return running;
  const scan = scanDevelopmentProjects(root).finally(() => {
    if (discoveryInFlight.get(root) === scan) discoveryInFlight.delete(root);
  });
  discoveryInFlight.set(root, scan);
  return scan;
}

export async function resolveDevelopmentProjectRoot(workspaceRoot: string, requestedPath?: string | null, refresh = false): Promise<{ root: string; project: DevelopmentWorkspaceProject; projects: DevelopmentWorkspaceProject[] }> {
  const root = path.resolve(workspaceRoot);
  const projects = await discoverDevelopmentProjects(root, refresh);
  const safeRequested = requestedPath == null ? null : safeWorkspacePath(requestedPath);
  if (requestedPath != null && safeRequested == null) throw Object.assign(new Error('Invalid development project path'), { status: 400 });
  const runnableMarker = (candidate: DevelopmentWorkspaceProject) => candidate.markers.some((marker) => marker !== '.git');
  const rootProject = projects.find((candidate) => candidate.path === '.');
  const project = (safeRequested ? projects.find((candidate) => candidate.path === safeRequested) : null)
    ?? (rootProject && runnableMarker(rootProject) ? rootProject : null)
    ?? projects.find(runnableMarker)
    ?? rootProject
    ?? projects[0]!;
  const selectedRoot = path.resolve(root, project.path === '.' ? '' : project.path);
  const relative = path.relative(root, selectedRoot);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw Object.assign(new Error('Development project escaped the workspace'), { status: 400 });
  return { root: selectedRoot, project, projects };
}
