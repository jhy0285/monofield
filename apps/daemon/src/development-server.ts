import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, promises as fs, readdirSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { createCommandInvocation } from '@open-design/platform';
import type {
  DevelopmentConfigsResponse,
  DevelopmentRunConfig,
  DevelopmentServerStartRequest,
  DevelopmentServerStatus,
} from '@open-design/contracts';
import type {
  DesktopDevelopmentProcessInput,
  DesktopDevelopmentProcessResult,
} from '@open-design/sidecar-proto';
import { resolveDevelopmentProjectRoot } from './development-projects.js';

const CANDIDATE_DIRS = ['', 'frontend', 'client', 'web', 'app', 'packages/web'];
const MAX_LOG_LINES = 120;
const DEFAULT_READY_TIMEOUT_MS = 60_000;
const JAVA_READY_TIMEOUT_MS = 120_000;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const RUN_CONFIG_CACHE_TTL_MS = 5 * 60_000;

type RunConfigCacheEntry = {
  expiresAt: number;
  value: DevelopmentConfigsResponse;
};

const runConfigCache = new Map<string, RunConfigCacheEntry>();
const runConfigDetectionInFlight = new Map<string, Promise<DevelopmentConfigsResponse>>();

type RuntimeRecord = DevelopmentServerStatus & {
  child: ChildProcess | null;
  desktopManaged: boolean;
  stopping: boolean;
};

function configId(parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 18);
}

function validatedApplicationArgs(input: unknown): string[] {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 32) throw Object.assign(new Error('applicationArgs must contain at most 32 values'), { status: 400 });
  return input.map((value) => {
    if (typeof value !== 'string' || value.length > 512 || value.includes('\0')) {
      throw Object.assign(new Error('Each application argument must be a string of at most 512 characters'), { status: 400 });
    }
    return value;
  });
}

export function applyDevelopmentRunOverrides(
  config: DevelopmentRunConfig,
  overrides?: DevelopmentServerStartRequest['overrides'],
): DevelopmentRunConfig {
  if (!overrides) return config;
  const applicationArgs = validatedApplicationArgs(overrides.applicationArgs);
  const requestedProfile = overrides.profile === undefined ? (config.profile ?? '') : overrides.profile.trim();
  if (requestedProfile && !/^[A-Za-z0-9_.-]+(?:,[A-Za-z0-9_.-]+)*$/.test(requestedProfile)) {
    throw Object.assign(new Error('Spring profiles may contain letters, numbers, dots, underscores, hyphens, and commas only'), { status: 400 });
  }

  let args = [...config.args];
  if (config.framework === 'Spring Boot') {
    const isMaven = args.includes('spring-boot:run');
    const isGradle = args.includes('bootRun');
    if (isMaven) {
      args = args.filter((value) => !value.startsWith('-Dspring-boot.run.profiles=') && !value.startsWith('-Dspring-boot.run.arguments='));
      if (requestedProfile) args.push(`-Dspring-boot.run.profiles=${requestedProfile}`);
      if (applicationArgs.length > 0) args.push(`-Dspring-boot.run.arguments=${applicationArgs.join(' ')}`);
    } else if (isGradle) {
      args = args.filter((value) => !value.startsWith('--args='));
      const springArgs = [
        ...(requestedProfile ? [`--spring.profiles.active=${requestedProfile}`] : []),
        ...applicationArgs,
      ];
      if (springArgs.length > 0) args.push(`--args=${springArgs.join(' ')}`);
    } else {
      args.push(...applicationArgs);
    }
  } else {
    args.push(...applicationArgs);
  }

  if (args.length === config.args.length
    && args.every((value, index) => value === config.args[index])
    && requestedProfile === (config.profile ?? '')) return config;
  const { profile: _detectedProfile, ...configWithoutProfile } = config;
  return {
    ...configWithoutProfile,
    id: configId([config.id, requestedProfile, ...applicationArgs]),
    args,
    ...(requestedProfile ? { profile: requestedProfile } : {}),
  };
}

async function exists(target: string): Promise<boolean> {
  try { await fs.access(target); return true; } catch { return false; }
}

async function firstExisting(paths: string[]): Promise<string | null> {
  const candidates = await Promise.all(paths.map(async (candidate) => await exists(candidate) ? candidate : null));
  return candidates.find((candidate): candidate is string => candidate != null) ?? null;
}

async function discoverSpringProfiles(root: string): Promise<Array<{ name: string; path: string; text: string }>> {
  const candidates = [root, path.join(root, 'src', 'main', 'resources')];
  const discovered = new Map<string, { name: string; path: string; text: string }>();
  for (const directory of candidates) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = /^application-([A-Za-z0-9_-]+)\.(?:ya?ml|properties)$/i.exec(entry.name);
      const name = match?.[1];
      if (!name || discovered.has(name)) continue;
      const absolutePath = path.join(directory, entry.name);
      discovered.set(name, {
        name,
        path: relativeCwd(root, absolutePath),
        text: await readTextBounded(absolutePath),
      });
    }
  }
  return [...discovered.values()].sort((left, right) => {
    if (left.name === 'local') return -1;
    if (right.name === 'local') return 1;
    if (left.name === 'dev') return -1;
    if (right.name === 'dev') return 1;
    if (left.name === 'prod') return -1;
    if (right.name === 'prod') return 1;
    return left.name.localeCompare(right.name);
  });
}

async function readJson(target: string): Promise<Record<string, any> | null> {
  try {
    const value = JSON.parse(await fs.readFile(target, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

async function readTextBounded(target: string): Promise<string> {
  try {
    const handle = await fs.open(target, 'r');
    try {
      const buffer = Buffer.alloc(MAX_MANIFEST_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return '';
  }
}

function springPort(configText: string): number | null {
  const property = /^\s*server\.port\s*[=:]\s*(?:\$\{[^}:]+:)?(\d{2,5})/im.exec(configText)?.[1];
  let yaml: string | undefined;
  const lines = configText.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const server = /^(\s*)server\s*:\s*(?:#.*)?$/i.exec(lines[index] ?? '');
    if (!server) continue;
    const serverIndent = server[1]?.length ?? 0;
    for (let nested = index + 1; nested < lines.length; nested += 1) {
      const line = lines[nested] ?? '';
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const indent = /^\s*/.exec(line)?.[0].length ?? 0;
      if (indent <= serverIndent) break;
      const port = /^\s*port\s*:\s*(?:\$\{[^}:]+:)?(\d{2,5})/i.exec(line)?.[1];
      if (port) { yaml = port; break; }
    }
    if (yaml) break;
  }
  const parsed = Number(property ?? yaml);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535 ? parsed : null;
}

function springActiveProfile(configText: string): string | null {
  const property = /^\s*spring\.profiles\.active\s*[=:]\s*([A-Za-z0-9_-]+)/im.exec(configText)?.[1];
  if (property) return property;
  const lines = configText.split(/\r?\n/);
  let springIndent: number | null = null;
  let profilesIndent: number | null = null;
  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indent = /^\s*/.exec(line)?.[0].length ?? 0;
    if (springIndent == null) {
      const spring = /^(\s*)spring\s*:\s*(?:#.*)?$/i.exec(line);
      if (spring) springIndent = spring[1]?.length ?? 0;
      continue;
    }
    if (indent <= springIndent) { springIndent = null; profilesIndent = null; continue; }
    if (profilesIndent == null) {
      const profiles = /^\s*profiles\s*:\s*(?:#.*)?$/i.exec(line);
      if (profiles) profilesIndent = indent;
      continue;
    }
    if (indent <= profilesIndent) { profilesIndent = null; continue; }
    const active = /^\s*active\s*:\s*["']?([A-Za-z0-9_-]+)/i.exec(line)?.[1];
    if (active) return active;
  }
  return null;
}

function relativeCwd(root: string, cwd: string): string {
  const value = path.relative(root, cwd).replace(/\\/g, '/');
  return value || '.';
}

function springContextPath(configText: string): string {
  const property = /^\s*server\.(?:servlet\.)?context-path\s*[=:]\s*([^\s#]+)/im.exec(configText)?.[1];
  let yaml: string | undefined;
  const lines = configText.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const server = /^(\s*)server\s*:\s*(?:#.*)?$/i.exec(lines[index] ?? '');
    if (!server) continue;
    const serverIndent = server[1]?.length ?? 0;
    let servletIndent: number | null = null;
    for (let nested = index + 1; nested < lines.length; nested += 1) {
      const line = lines[nested] ?? '';
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const indent = /^\s*/.exec(line)?.[0].length ?? 0;
      if (indent <= serverIndent) break;
      const direct = /^\s*context-path\s*:\s*["']?([^\s#"']+)/i.exec(line)?.[1];
      if (direct && (servletIndent == null || indent > servletIndent)) { yaml = direct; break; }
      if (/^\s*servlet\s*:\s*(?:#.*)?$/i.test(line)) servletIndent = indent;
      else if (servletIndent != null && indent <= servletIndent) servletIndent = null;
    }
    if (yaml) break;
  }
  const value = String(property ?? yaml ?? '').trim();
  if (!value || value === '/' || /[\s?#]/.test(value)) return '';
  return `/${value.replace(/^\/+|\/+$/g, '')}`;
}

type DetectionRunConfigInput = Omit<DevelopmentRunConfig, 'id' | 'url'> & { urlPath?: string };

function runConfig(input: DetectionRunConfigInput): DevelopmentRunConfig {
  const { urlPath = '', ...config } = input;
  return {
    ...config,
    id: configId([config.kind, config.cwd, config.command, ...config.args]),
    url: `http://127.0.0.1:${config.port}${urlPath}`,
  };
}

function packageManagerFor(root: string, cwd: string, files: Set<string>): 'pnpm' | 'npm' | 'yarn' | 'bun' {
  const candidates = [cwd, root];
  for (const candidate of candidates) {
    const prefix = relativeCwd(root, candidate);
    const rel = (name: string) => prefix === '.' ? name : `${prefix}/${name}`;
    if (files.has(rel('pnpm-lock.yaml'))) return 'pnpm';
    if (files.has(rel('yarn.lock'))) return 'yarn';
    if (files.has(rel('bun.lockb')) || files.has(rel('bun.lock'))) return 'bun';
    if (files.has(rel('package-lock.json'))) return 'npm';
  }
  return 'npm';
}

function packageArgs(manager: 'pnpm' | 'npm' | 'yarn' | 'bun', script: string): string[] {
  if (manager === 'yarn') return [script];
  return ['run', script];
}

function packageFramework(pkg: Record<string, any>, script: string): { framework: string; port: number } {
  const all = `${script} ${Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }).join(' ')}`.toLowerCase();
  const explicit = /(?:--port(?:=|\s+)|(?:^|\s)-p\s+|\bport=)(\d{2,5})/i.exec(script)?.[1];
  const port = explicit
    ? Number(explicit)
    : /vue-cli-service\s+serve/i.test(script) ? 8080
      : all.includes('vite') ? 5173
        : all.includes('astro') ? 4321
          : all.includes('angular') ? 4200
            : 3000;
  if (/vue-cli-service/i.test(script)) return { framework: 'Vue CLI', port };
  if (/react-scripts/i.test(script)) return { framework: 'Create React App', port };
  if (all.includes('next')) return { framework: 'Next.js', port };
  if (all.includes('vite')) {
    if (all.includes('vue') || all.includes('@vitejs/plugin-vue')) return { framework: 'Vue · Vite', port };
    if (all.includes('react') || all.includes('@vitejs/plugin-react')) return { framework: 'React · Vite', port };
    if (all.includes('svelte')) return { framework: 'Svelte · Vite', port };
    return { framework: 'Vite', port };
  }
  if (all.includes('astro')) return { framework: 'Astro', port };
  if (all.includes('@angular/cli') || all.includes('ng serve')) return { framework: 'Angular', port };
  if (all.includes('remix')) return { framework: 'Remix', port };
  return { framework: 'Node.js', port };
}

async function collectKnownFiles(root: string): Promise<Set<string>> {
  const names = new Set<string>();
  const directoryEntries = await Promise.all(CANDIDATE_DIRS.map(async (rel) => {
    const dir = path.resolve(root, rel);
    if (!dir.startsWith(path.resolve(root))) return { entries: [], rel };
    try {
      return { entries: await fs.readdir(dir, { withFileTypes: true }), rel };
    } catch {
      // A conventional candidate directory is optional.
      return { entries: [], rel };
    }
  }));
  for (const { entries, rel } of directoryEntries) {
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      names.add((rel ? `${rel}/${entry.name}` : entry.name).replace(/\\/g, '/'));
    }
  }
  return names;
}

function addUnique(target: DevelopmentRunConfig[], config: DevelopmentRunConfig): void {
  if (!target.some((candidate) => candidate.id === config.id)) target.push(config);
}

async function detectRunConfigsAtRoot(root: string): Promise<DevelopmentConfigsResponse> {
  const resolvedRoot = path.resolve(root);
  const files = await collectKnownFiles(resolvedRoot);
  const configs: DevelopmentRunConfig[] = [];

  for (const rel of CANDIDATE_DIRS) {
    const cwd = path.resolve(resolvedRoot, rel);
    const packagePath = path.join(cwd, 'package.json');
    if (!files.has((rel ? `${rel}/package.json` : 'package.json').replace(/\\/g, '/'))) continue;
    const pkg = await readJson(packagePath);
    const scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts as Record<string, unknown> : {};
    const scriptName = ['dev', 'start', 'serve', 'preview'].find((name) => typeof scripts[name] === 'string' && String(scripts[name]).trim())
      ?? Object.keys(scripts).find((name) => /^(?:dev|start|serve)(?:[:.].+)$/.test(name) && typeof scripts[name] === 'string' && String(scripts[name]).trim());
    if (!pkg || !scriptName) continue;
    const script = String(scripts[scriptName]);
    const manager = packageManagerFor(resolvedRoot, cwd, files);
    const detected = packageFramework(pkg, script);
    addUnique(configs, runConfig({
      label: `${detected.framework} · ${manager} ${manager === 'yarn' ? scriptName : `run ${scriptName}`}`,
      kind: 'node',
      framework: detected.framework,
      cwd: relativeCwd(resolvedRoot, cwd),
      command: manager,
      args: packageArgs(manager, scriptName),
      source: `${relativeCwd(resolvedRoot, cwd)}/package.json#scripts.${scriptName}`,
      port: detected.port,
      packageManager: manager,
      dependenciesReady: await exists(path.join(cwd, 'node_modules')) || await exists(path.join(resolvedRoot, 'node_modules')),
    }));
  }

  const rootFile = (name: string) => files.has(name);
  const pythonManifestName = ['pyproject.toml', 'requirements.txt', 'Pipfile'].find(rootFile) ?? null;
  const pythonText = pythonManifestName
    ? await readTextBounded(path.join(resolvedRoot, pythonManifestName))
    : '';
  const usesPoetry = rootFile('poetry.lock') || /\[tool\.poetry(?:\]|\.)/i.test(pythonText);
  const usesPipenv = rootFile('Pipfile');
  const pythonCommand = usesPoetry ? 'poetry' : usesPipenv ? 'pipenv' : 'python';
  const pythonArgs = (args: string[]) => usesPoetry || usesPipenv ? ['run', 'python', ...args] : args;
  const pythonModuleArgs = (args: string[]) => usesPoetry || usesPipenv ? ['run', 'python', '-m', ...args] : ['-m', ...args];
  if (rootFile('manage.py')) {
    addUnique(configs, runConfig({ label: `Django · ${usesPoetry ? 'Poetry' : usesPipenv ? 'Pipenv' : 'Python'}`, kind: 'python', framework: 'Django', cwd: '.', command: pythonCommand, args: pythonArgs(['manage.py', 'runserver', '127.0.0.1:8000']), source: 'manage.py', port: 8000 }));
  } else {
    const entry = rootFile('streamlit_app.py') ? 'streamlit_app.py' : rootFile('app.py') ? 'app.py' : rootFile('main.py') ? 'main.py' : null;
    if (/streamlit/i.test(pythonText) && entry) {
      addUnique(configs, runConfig({ label: `Streamlit · ${usesPoetry ? 'Poetry' : usesPipenv ? 'Pipenv' : 'Python'}`, kind: 'python', framework: 'Streamlit', cwd: '.', command: pythonCommand, args: pythonModuleArgs(['streamlit', 'run', entry, '--server.address', '127.0.0.1', '--server.port', '8501']), source: pythonManifestName ?? entry, port: 8501 }));
    } else if (/gradio/i.test(pythonText) && entry) {
      addUnique(configs, runConfig({ label: `Gradio · ${usesPoetry ? 'Poetry' : usesPipenv ? 'Pipenv' : 'Python'}`, kind: 'python', framework: 'Gradio', cwd: '.', command: pythonCommand, args: pythonArgs([entry]), source: pythonManifestName ?? entry, port: 7860 }));
    } else if (/uvicorn|fastapi/i.test(pythonText) && (rootFile('main.py') || rootFile('app.py'))) {
      const module = rootFile('main.py') ? 'main:app' : 'app:app';
      addUnique(configs, runConfig({ label: `FastAPI · Uvicorn${usesPoetry ? ' · Poetry' : usesPipenv ? ' · Pipenv' : ''}`, kind: 'python', framework: 'FastAPI', cwd: '.', command: pythonCommand, args: pythonModuleArgs(['uvicorn', module, '--reload', '--host', '127.0.0.1', '--port', '8000']), source: pythonManifestName ?? 'main.py', port: 8000 }));
    } else if (/flask/i.test(pythonText) && (rootFile('app.py') || rootFile('main.py'))) {
      const module = rootFile('app.py') ? 'app' : 'main';
      addUnique(configs, runConfig({ label: `Flask · ${usesPoetry ? 'Poetry' : usesPipenv ? 'Pipenv' : 'Python'}`, kind: 'python', framework: 'Flask', cwd: '.', command: pythonCommand, args: pythonModuleArgs(['flask', '--app', module, 'run', '--debug', '--host', '127.0.0.1', '--port', '5000']), source: pythonManifestName ?? `${module}.py`, port: 5000 }));
    } else if (/gunicorn/i.test(pythonText) && (rootFile('app.py') || rootFile('main.py'))) {
      const module = rootFile('app.py') ? 'app:app' : 'main:app';
      const args = usesPoetry || usesPipenv ? ['run', 'gunicorn', module, '--reload', '--bind', '127.0.0.1:8000'] : [module, '--reload', '--bind', '127.0.0.1:8000'];
      addUnique(configs, runConfig({ label: `Gunicorn${usesPoetry ? ' · Poetry' : usesPipenv ? ' · Pipenv' : ''}`, kind: 'python', framework: 'Gunicorn', cwd: '.', command: usesPoetry ? 'poetry' : usesPipenv ? 'pipenv' : 'gunicorn', args, source: pythonManifestName ?? 'app.py', port: 8000 }));
    }
    const poetryScript = /\[tool\.poetry\.scripts\]([\s\S]*?)(?:\n\s*\[|$)/i.exec(pythonText)?.[1]
      ?.match(/^\s*([A-Za-z0-9_.-]+)\s*=/m)?.[1];
    if (usesPoetry && poetryScript) addUnique(configs, runConfig({ label: `Poetry script · ${poetryScript}`, kind: 'python', framework: 'Poetry', cwd: '.', command: 'poetry', args: ['run', poetryScript], source: 'pyproject.toml', port: 8000 }));
    const pipenvScript = /\[scripts\]([\s\S]*?)(?:\n\s*\[|$)/i.exec(pythonText)?.[1]
      ?.match(/^\s*([A-Za-z0-9_.-]+)\s*=/m)?.[1];
    if (usesPipenv && pipenvScript) addUnique(configs, runConfig({ label: `Pipenv script · ${pipenvScript}`, kind: 'python', framework: 'Pipenv', cwd: '.', command: 'pipenv', args: ['run', pipenvScript], source: 'Pipfile', port: 8000 }));
  }
  if (rootFile('go.mod')) {
    if (rootFile('.air.toml')) addUnique(configs, runConfig({ label: 'Go · Air live reload', kind: 'go', framework: 'Go · Air', cwd: '.', command: 'air', args: [], source: '.air.toml', port: 8080 }));
    const commandDirectories = await fs.readdir(path.join(resolvedRoot, 'cmd'), { withFileTypes: true }).catch(() => []);
    const goCommands = commandDirectories
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    let goCommandCount = 0;
    for (const name of goCommands) {
      if (!await exists(path.join(resolvedRoot, 'cmd', name, 'main.go'))) continue;
      goCommandCount += 1;
      addUnique(configs, runConfig({ label: `Go command · ${name}`, kind: 'go', framework: 'Go', cwd: '.', command: 'go', args: ['run', `./cmd/${name}`], source: `cmd/${name}/main.go`, port: 8080 }));
    }
    if (goCommandCount === 0) addUnique(configs, runConfig({ label: 'Go application', kind: 'go', framework: 'Go', cwd: '.', command: 'go', args: ['run', '.'], source: 'go.mod', port: 8080 }));
  }
  const makefileName = rootFile('Makefile') ? 'Makefile' : rootFile('makefile') ? 'makefile' : null;
  if (makefileName) {
    const makefile = await readTextBounded(path.join(resolvedRoot, makefileName));
    const target = ['dev', 'run', 'start', 'serve'].find((name) => new RegExp(`^${name}\\s*:`, 'm').test(makefile));
    if (target) addUnique(configs, runConfig({ label: `Makefile · ${target}`, kind: rootFile('go.mod') ? 'go' : pythonManifestName ? 'python' : 'static', framework: 'Make', cwd: '.', command: 'make', args: [target], source: `${makefileName}#${target}`, port: 8080 }));
  }
  const pomText = rootFile('pom.xml') ? await readTextBounded(path.join(resolvedRoot, 'pom.xml')) : '';
  const gradleFile = rootFile('build.gradle.kts') ? 'build.gradle.kts' : rootFile('build.gradle') ? 'build.gradle' : null;
  const gradleText = gradleFile ? await readTextBounded(path.join(resolvedRoot, gradleFile)) : '';
  const baseSpringConfigPath = await firstExisting(['application.yml', 'application.yaml', 'application.properties'].flatMap((name) => [
    path.join(resolvedRoot, name),
    path.join(resolvedRoot, 'src', 'main', 'resources', name),
  ]));
  const baseSpringText = baseSpringConfigPath ? await readTextBounded(baseSpringConfigPath) : '';
  const configuredActiveProfile = springActiveProfile(baseSpringText);
  const springProfiles = await discoverSpringProfiles(resolvedRoot);
  const preferredSpringProfile = configuredActiveProfile
    ?? (springProfiles.some((profile) => profile.name === 'local') ? 'local' : null);
  const springConfigCountBeforeDetection = configs.length;
  let preferredSpringConfigId: string | null = null;
  // When application.yml already activates a profile, the plain framework
  // command loads it without an extra CLI argument. Represent that effective
  // environment on the base configuration and omit a duplicate explicit
  // profile entry. Other profiles remain selectable like IntelliJ run configs.
  const springVariants = [
    null,
    ...springProfiles.filter((profile) => profile.name !== configuredActiveProfile),
  ] as Array<null | { name: string; path: string; text: string }>;
  if (pomText && /spring-boot|org\.springframework\.boot/i.test(pomText)) {
    const wrapper = process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw';
    const hasWrapper = rootFile(wrapper);
    for (const profile of springVariants) {
      const effectiveProfile = profile?.name ?? configuredActiveProfile;
      const effectiveProfileFile = profile
        ?? springProfiles.find((candidate) => candidate.name === configuredActiveProfile)
        ?? null;
      const config = runConfig({
        label: `Spring Boot · ${hasWrapper ? 'Maven Wrapper' : 'Maven'}${effectiveProfile ? ` · ${effectiveProfile}` : ''}`,
        kind: 'java',
        framework: 'Spring Boot',
        cwd: '.',
        command: hasWrapper ? path.join(resolvedRoot, wrapper) : 'mvn',
        args: profile ? ['spring-boot:run', `-Dspring-boot.run.profiles=${profile.name}`] : ['spring-boot:run'],
        source: effectiveProfileFile ? `pom.xml + ${effectiveProfileFile.path}` : 'pom.xml',
        ...(effectiveProfile ? { profile: effectiveProfile } : {}),
        port: springPort(effectiveProfileFile?.text ?? '') ?? springPort(baseSpringText) ?? 8080,
        urlPath: springContextPath(effectiveProfileFile?.text ?? '') || springContextPath(baseSpringText),
        dependenciesReady: await exists(path.join(resolvedRoot, 'target')),
      });
      addUnique(configs, config);
      if (effectiveProfile === preferredSpringProfile) preferredSpringConfigId = config.id;
    }
  }
  if (gradleText && /org\.springframework\.boot|spring-boot/i.test(gradleText)) {
    const wrapper = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
    const hasWrapper = rootFile(wrapper);
    for (const profile of springVariants) {
      const effectiveProfile = profile?.name ?? configuredActiveProfile;
      const effectiveProfileFile = profile
        ?? springProfiles.find((candidate) => candidate.name === configuredActiveProfile)
        ?? null;
      const config = runConfig({
        label: `Spring Boot · ${hasWrapper ? 'Gradle Wrapper' : 'Gradle'}${effectiveProfile ? ` · ${effectiveProfile}` : ''}`,
        kind: 'java',
        framework: 'Spring Boot',
        cwd: '.',
        command: hasWrapper ? path.join(resolvedRoot, wrapper) : 'gradle',
        args: profile ? ['bootRun', `--args=--spring.profiles.active=${profile.name}`] : ['bootRun'],
        source: `${gradleFile ?? 'build.gradle'}${effectiveProfileFile ? ` + ${effectiveProfileFile.path}` : ''}`,
        ...(effectiveProfile ? { profile: effectiveProfile } : {}),
        port: springPort(effectiveProfileFile?.text ?? '') ?? springPort(baseSpringText) ?? 8080,
        urlPath: springContextPath(effectiveProfileFile?.text ?? '') || springContextPath(baseSpringText),
        dependenciesReady: await exists(path.join(resolvedRoot, 'build')),
      });
      addUnique(configs, config);
      if (effectiveProfile === preferredSpringProfile) preferredSpringConfigId ??= config.id;
    }
  }
  const csproj = [...files].find((name) => !name.includes('/') && name.toLowerCase().endsWith('.csproj'));
  if (csproj) addUnique(configs, runConfig({ label: '.NET application', kind: 'dotnet', framework: 'ASP.NET Core', cwd: '.', command: 'dotnet', args: ['run', '--project', csproj], source: csproj, port: 5000 }));
  if (rootFile('Cargo.toml')) addUnique(configs, runConfig({ label: 'Rust application', kind: 'rust', framework: 'Rust', cwd: '.', command: 'cargo', args: ['run'], source: 'Cargo.toml', port: 8000 }));
  if (configs.length === 0 && rootFile('index.html')) addUnique(configs, runConfig({ label: 'Static web server', kind: 'static', framework: 'Static HTML', cwd: '.', command: 'python', args: ['-m', 'http.server', '8000', '--bind', '127.0.0.1'], source: 'index.html', port: 8000 }));

  return {
    configs,
    recommendedConfigId: springConfigCountBeforeDetection === 0 && preferredSpringConfigId
      ? preferredSpringConfigId
      : configs[0]?.id ?? null,
    scannedAt: new Date().toISOString(),
  };
}

async function detectRunConfigsCached(root: string, refresh: boolean): Promise<DevelopmentConfigsResponse> {
  const key = path.resolve(root);
  const cached = runConfigCache.get(key);
  if (!refresh && cached && cached.expiresAt > Date.now()) return cached.value;
  const active = runConfigDetectionInFlight.get(key);
  if (!refresh && active) return await active;
  const detection = detectRunConfigsAtRoot(key)
    .then((value) => {
      runConfigCache.set(key, { expiresAt: Date.now() + RUN_CONFIG_CACHE_TTL_MS, value });
      return value;
    })
    .finally(() => {
      if (runConfigDetectionInFlight.get(key) === detection) runConfigDetectionInFlight.delete(key);
    });
  runConfigDetectionInFlight.set(key, detection);
  return await detection;
}

export async function detectDevelopmentRunConfigs(workspaceRoot: string, projectPath?: string | null, refresh = false): Promise<DevelopmentConfigsResponse> {
  const selection = await resolveDevelopmentProjectRoot(workspaceRoot, projectPath, refresh);
  const detected = await detectRunConfigsCached(selection.root, refresh);
  return {
    ...detected,
    projects: selection.projects,
    activeProjectPath: selection.project.path,
  };
}

export function selectExecutableCandidate(
  candidates: string[],
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (platform !== 'win32') return candidates[0] ?? null;
  const installed = candidates.filter(
    (candidate) => !/[\\/]Microsoft[\\/]WindowsApps[\\/]/i.test(candidate),
  );
  const usable = installed.length > 0 ? installed : candidates;
  const executableExtensions = new Set(
    (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
      .split(';')
      .map((extension) => extension.trim().toLowerCase())
      .filter(Boolean),
  );
  // `where npm` can return both an extensionless POSIX shim and npm.cmd.
  // Windows CreateProcess cannot launch the extensionless shim directly, so
  // prefer a PATHEXT-backed candidate and let createCommandInvocation wrap
  // .cmd/.bat files safely under cmd.exe.
  return usable.find((candidate) => executableExtensions.has(path.extname(candidate).toLowerCase()))
    ?? usable[0]
    ?? null;
}

function executablePath(command: string): string {
  if (path.isAbsolute(command)) {
    if (existsSync(command)) return command;
    throw new Error(`${path.basename(command)} is missing or is not executable`);
  }
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(finder, [command], { encoding: 'utf8', windowsHide: true });
  const candidates = String(result.stdout ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  // Windows Store app-execution aliases can resolve before a real runtime and
  // open a placeholder process that never serves. Prefer an installed binary
  // when `where.exe` returns both.
  const first = selectExecutableCandidate(candidates);
  if (!first && process.platform === 'win32' && command.toLowerCase() === 'mvn') {
    const jetBrainsRoot = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'JetBrains');
    try {
      const bundled = readdirSync(jetBrainsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^IntelliJ IDEA/i.test(entry.name))
        .map((entry) => path.join(jetBrainsRoot, entry.name, 'plugins', 'maven', 'lib', 'maven3', 'bin', 'mvn.cmd'))
        .find((candidate) => existsSync(candidate));
      if (bundled) return bundled;
    } catch {
      // IntelliJ is an optional, read-only fallback for projects without mvnw.
    }
  }
  if (!first) throw new Error(`${command} is not installed or is not available on PATH. Add the build tool to PATH or commit its project wrapper.`);
  return first;
}

function safeRuntimeError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message.replace(/[\r\n]+/g, ' ').slice(0, 600);
}

function appendLog(record: RuntimeRecord, chunk: unknown): void {
  const lines = String(chunk).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  record.logs = [...record.logs, ...lines].slice(-MAX_LOG_LINES);
  for (const line of lines) {
    const match = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?[^\s]*/i.exec(line);
    if (match) record.url = match[0].replace('0.0.0.0', '127.0.0.1').replace('[::1]', '127.0.0.1');
  }
}

async function urlReady(url: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ready);
    };
    try {
      const parsed = new URL(url);
      const client = parsed.protocol === 'https:' ? https : http;
      const request = client.request(parsed, { agent: false, method: 'HEAD' }, (response) => {
        response.resume();
        finish(Boolean(response.statusCode && response.statusCode > 0 && response.statusCode < 600));
      });
      request.setTimeout(1_200, () => { request.destroy(); finish(false); });
      request.once('error', () => finish(false));
      request.end();
    } catch {
      finish(false);
    }
  });
}

async function localPortInUse(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (inUse: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(350, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export type DesktopDevelopmentProcessBroker = (
  input: DesktopDevelopmentProcessInput,
) => Promise<DesktopDevelopmentProcessResult>;

async function terminateTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) return;
  if (pid === process.pid) throw new Error('Refusing to stop the MonoField daemon as a development server');
  try { process.kill(-pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* already exited */ } }
}

export class DevelopmentServerService {
  private readonly records = new Map<string, RuntimeRecord>();

  constructor(private readonly desktopProcessBroker: DesktopDevelopmentProcessBroker | null = null) {}

  private runtimeKey(projectId: string, projectPath?: string | null): string {
    const normalizedPath = projectPath?.trim().replace(/\\/g, '/') || '.';
    return normalizedPath === '.' ? projectId : `${projectId}::${encodeURIComponent(normalizedPath)}`;
  }

  status(projectId: string, projectPath?: string | null): DevelopmentServerStatus {
    const normalizedPath = projectPath?.trim().replace(/\\/g, '/') || '.';
    const record = this.records.get(this.runtimeKey(projectId, normalizedPath));
    if (!record) return { projectId, projectPath: normalizedPath, state: 'idle', config: null, pid: null, url: null, startedAt: null, error: null, logs: [] };
    const { child: _child, desktopManaged: _desktopManaged, stopping: _stopping, ...status } = record;
    return { ...status, logs: [...status.logs] };
  }

  statuses(projectId: string): DevelopmentServerStatus[] {
    return [...this.records.values()]
      .filter((record) => record.projectId === projectId)
      .map((record) => this.status(projectId, record.projectPath))
      .sort((left, right) => (left.projectPath ?? '.').localeCompare(right.projectPath ?? '.'));
  }

  async statusAsync(projectId: string, projectPath?: string | null): Promise<DevelopmentServerStatus> {
    const normalizedPath = projectPath?.trim().replace(/\\/g, '/') || '.';
    const key = this.runtimeKey(projectId, normalizedPath);
    const record = this.records.get(key);
    if (!record?.desktopManaged || this.desktopProcessBroker == null) return this.status(projectId, normalizedPath);
    const managed = await this.desktopProcessBroker({ action: 'status', ownerPid: process.pid, projectId: key });
    record.pid = managed.pid;
    // The desktop broker keeps a bounded rolling buffer. Re-parse its tail on
    // every status poll so a URL emitted after the buffer wrapped is still
    // discovered; duplicate parsing is harmless and keeps no secret cursor.
    if (managed.logs.length > 0) appendLog(record, managed.logs.slice(-20).join('\n'));
    record.logs = managed.logs.slice(-MAX_LOG_LINES);
    // A later broker status can legitimately have no record after an exited
    // process was reaped. Do not erase the actionable exit/timeout reason that
    // MonoField already captured for the user.
    if (managed.error != null) record.error = managed.error;
    if (!managed.running && (record.state === 'starting' || record.state === 'ready')) {
      record.state = record.stopping ? 'idle' : 'failed';
      record.error ??= 'The development server exited';
    }
    return this.status(projectId, normalizedPath);
  }

  private async monitorStartup(projectId: string, projectPath: string, record: RuntimeRecord): Promise<void> {
    const key = this.runtimeKey(projectId, projectPath);
    // JVM applications often need a full compile plus framework/bootstrap and
    // database initialization before the HTTP port is reachable. Keep faster
    // runtimes bounded, but do not kill a healthy Spring Boot startup at the
    // old 35-second threshold.
    const readyTimeoutMs = record.config?.kind === 'java'
      ? JAVA_READY_TIMEOUT_MS
      : DEFAULT_READY_TIMEOUT_MS;
    const deadline = Date.now() + readyTimeoutMs;
    while (
      Date.now() < deadline
      && this.records.get(key) === record
      && record.pid
      && record.state === 'starting'
    ) {
      if (record.desktopManaged) await this.statusAsync(projectId, projectPath);
      if (record.state !== 'starting' || !record.pid) return;
      if (record.url && await urlReady(record.url)) {
        record.state = 'ready';
        return;
      }
      await delay(350);
    }
    if (this.records.get(key) !== record || record.state !== 'starting') return;

    const timeoutError = record.error ?? `The server did not become reachable within ${Math.round(readyTimeoutMs / 1000)} seconds`;
    record.stopping = true;
    try {
      if (record.desktopManaged && record.pid && this.desktopProcessBroker) {
        await this.desktopProcessBroker({ action: 'terminate', ownerPid: process.pid, projectId: key });
      } else if (record.child) {
        await terminateTree(record.child);
      }
    } finally {
      record.child = null;
      record.pid = null;
      record.stopping = false;
      record.state = 'failed';
      record.error = timeoutError;
    }
  }

  async start(
    projectId: string,
    root: string,
    configIdValue: string,
    projectPath?: string | null,
    overrides?: DevelopmentServerStartRequest['overrides'],
  ): Promise<DevelopmentServerStatus> {
    const selection = await resolveDevelopmentProjectRoot(root, projectPath);
    const selectedProjectPath = selection.project.path;
    const key = this.runtimeKey(projectId, selectedProjectPath);
    await this.statusAsync(projectId, selectedProjectPath);
    const detected = await detectRunConfigsAtRoot(selection.root);
    const detectedConfig = detected.configs.find((candidate) => candidate.id === configIdValue);
    if (!detectedConfig) throw new Error('The selected run configuration is no longer available; detect configurations again');
    const config = applyDevelopmentRunOverrides(detectedConfig, overrides);
    const current = this.records.get(key);
    if (current?.pid && current.state !== 'failed' && current.config?.id === config.id) {
      return this.status(projectId, selectedProjectPath);
    }
    // Each runnable module owns an independent record. Reconfiguring this
    // module stops only its previous process; sibling services keep running.
    if (current?.pid) await this.stop(projectId, selectedProjectPath);
    if (await localPortInUse(config.port)) {
      throw Object.assign(
        new Error(`Port ${config.port} is already in use by another process. MonoField did not open that unrelated server.`),
        { status: 409 },
      );
    }
    const cwd = path.resolve(selection.root, config.cwd === '.' ? '' : config.cwd);
    const relative = path.relative(path.resolve(selection.root), cwd);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Run configuration escaped the project folder');
    const executable = executablePath(config.command);
    const invocation = createCommandInvocation({ command: executable, args: config.args, env: process.env });
    const record: RuntimeRecord = {
      projectId,
      projectPath: selectedProjectPath,
      state: 'starting',
      config,
      pid: null,
      url: config.url,
      startedAt: new Date().toISOString(),
      error: null,
      logs: [],
      child: null,
      desktopManaged: process.platform === 'win32',
      stopping: false,
    };
    this.records.set(key, record);
    if (process.platform === 'win32') {
      if (this.desktopProcessBroker == null) {
        record.state = 'failed';
        record.error = 'MonoField desktop process management is required to run a Windows development server';
        return this.status(projectId, selectedProjectPath);
      }
      try {
        const managed = await this.desktopProcessBroker({
          action: 'start',
          args: invocation.args,
          command: invocation.command,
          cwd,
          ownerPid: process.pid,
          port: config.port,
          projectId: key,
          ...(invocation.windowsVerbatimArguments == null ? {} : { windowsVerbatimArguments: invocation.windowsVerbatimArguments }),
        });
        record.pid = managed.pid;
        record.logs = managed.logs;
        record.error = managed.error;
        if (!managed.running) record.state = 'failed';
      } catch (error) {
        record.state = 'failed';
        record.error = safeRuntimeError(error);
      }
    } else {
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env: { ...process.env, BROWSER: 'none', PORT: String(config.port) },
      // This branch is POSIX-only; a detached process group lets us terminate
      // the full development-server tree.
      detached: true,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    record.child = child;
    record.pid = child.pid ?? null;
    child.stdout?.on('data', (chunk) => appendLog(record, chunk));
    child.stderr?.on('data', (chunk) => appendLog(record, chunk));
    child.once('error', (error) => {
      record.state = 'failed';
      record.error = safeRuntimeError(error);
    });
    child.once('exit', (code, signal) => {
      record.child = null;
      record.pid = null;
      if (record.stopping || record.state === 'idle') {
        record.state = 'idle';
        record.error = null;
      } else if (record.state !== 'failed') {
        record.state = 'failed';
        record.error = `Development server exited (${signal ?? code ?? 'unknown'})`;
      }
    });
    }
    if (record.state === 'starting' && record.pid) {
      void this.monitorStartup(projectId, selectedProjectPath, record).catch((error) => {
        if (this.records.get(key) !== record || record.state !== 'starting') return;
        record.state = 'failed';
        record.error = safeRuntimeError(error);
      });
    }
    return this.status(projectId, selectedProjectPath);
  }

  async stop(projectId: string, projectPath?: string | null): Promise<DevelopmentServerStatus> {
    const normalizedPath = projectPath?.trim().replace(/\\/g, '/') || '.';
    const key = this.runtimeKey(projectId, normalizedPath);
    const record = this.records.get(key);
    if (!record?.pid) return this.status(projectId, normalizedPath);
    const previousState = record.state;
    record.stopping = true;
    // Change state before awaiting process termination so a concurrent startup
    // monitor cannot turn an intentional stop into a startup failure.
    record.state = 'idle';
    record.error = null;
    try {
      if (record.desktopManaged) {
        if (this.desktopProcessBroker == null) throw new Error('MonoField desktop process management is unavailable');
        await this.desktopProcessBroker({ action: 'terminate', ownerPid: process.pid, projectId: key });
      } else if (record.child) {
        await terminateTree(record.child);
      }
    } catch (error) {
      record.state = previousState;
      record.error = safeRuntimeError(error);
      throw error;
    } finally {
      record.stopping = false;
    }
    record.child = null;
    record.pid = null;
    return this.status(projectId, normalizedPath);
  }

  async stopAll(projectId: string): Promise<DevelopmentServerStatus[]> {
    const projectPaths = [...this.records.values()]
      .filter((record) => record.projectId === projectId)
      .map((record) => record.projectPath ?? '.');
    await Promise.allSettled(projectPaths.map((projectPath) => this.stop(projectId, projectPath)));
    return this.statuses(projectId);
  }

  async shutdown(): Promise<void> {
    const targets = [...this.records.values()].map((record) => ({
      projectId: record.projectId,
      projectPath: record.projectPath,
    }));
    await Promise.allSettled(targets.map((target) => this.stop(target.projectId, target.projectPath)));
  }
}
