import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, promises as fs, readdirSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { createCommandInvocation } from '@open-design/platform';
import type {
  DevelopmentConfigsResponse,
  DevelopmentRunConfig,
  DevelopmentServerStatus,
} from '@open-design/contracts';
import type {
  DesktopDevelopmentProcessInput,
  DesktopDevelopmentProcessResult,
} from '@open-design/sidecar-proto';

const CANDIDATE_DIRS = ['', 'frontend', 'client', 'web', 'app', 'packages/web'];
const MAX_LOG_LINES = 120;
const READY_TIMEOUT_MS = 35_000;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

type RuntimeRecord = DevelopmentServerStatus & {
  child: ChildProcess | null;
  desktopManaged: boolean;
  stopping: boolean;
};

function configId(parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 18);
}

async function exists(target: string): Promise<boolean> {
  try { await fs.access(target); return true; } catch { return false; }
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const candidate of paths) if (await exists(candidate)) return candidate;
  return null;
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
  const port = explicit ? Number(explicit) : all.includes('vite') ? 5173 : all.includes('astro') ? 4321 : all.includes('angular') ? 4200 : all.includes('remix') ? 3000 : 3000;
  if (all.includes('next')) return { framework: 'Next.js', port };
  if (all.includes('vite')) return { framework: 'Vite', port };
  if (all.includes('astro')) return { framework: 'Astro', port };
  if (all.includes('react-scripts')) return { framework: 'Create React App', port };
  if (all.includes('@angular/cli') || all.includes('ng serve')) return { framework: 'Angular', port };
  if (all.includes('remix')) return { framework: 'Remix', port };
  return { framework: 'Node.js', port };
}

async function collectKnownFiles(root: string): Promise<Set<string>> {
  const names = new Set<string>();
  for (const rel of CANDIDATE_DIRS) {
    const dir = path.resolve(root, rel);
    if (!dir.startsWith(path.resolve(root))) continue;
    try {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        names.add((rel ? `${rel}/${entry.name}` : entry.name).replace(/\\/g, '/'));
      }
    } catch {
      // A conventional candidate directory is optional.
    }
  }
  return names;
}

function addUnique(target: DevelopmentRunConfig[], config: DevelopmentRunConfig): void {
  if (!target.some((candidate) => candidate.id === config.id)) target.push(config);
}

export async function detectDevelopmentRunConfigs(root: string): Promise<DevelopmentConfigsResponse> {
  const resolvedRoot = path.resolve(root);
  const files = await collectKnownFiles(resolvedRoot);
  const configs: DevelopmentRunConfig[] = [];

  for (const rel of CANDIDATE_DIRS) {
    const cwd = path.resolve(resolvedRoot, rel);
    const packagePath = path.join(cwd, 'package.json');
    if (!files.has((rel ? `${rel}/package.json` : 'package.json').replace(/\\/g, '/'))) continue;
    const pkg = await readJson(packagePath);
    const scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts as Record<string, unknown> : {};
    const scriptName = ['dev', 'start', 'serve', 'preview'].find((name) => typeof scripts[name] === 'string' && String(scripts[name]).trim());
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
  if (rootFile('manage.py')) {
    addUnique(configs, runConfig({ label: 'Django development server', kind: 'python', framework: 'Django', cwd: '.', command: 'python', args: ['manage.py', 'runserver', '127.0.0.1:8000'], source: 'manage.py', port: 8000 }));
  } else {
    const pythonManifest = rootFile('pyproject.toml') || rootFile('requirements.txt');
    const pythonText = pythonManifest
      ? await fs.readFile(path.join(resolvedRoot, rootFile('pyproject.toml') ? 'pyproject.toml' : 'requirements.txt'), 'utf8').catch(() => '')
      : '';
    if (/uvicorn|fastapi/i.test(pythonText) && (rootFile('main.py') || rootFile('app.py'))) {
      const module = rootFile('main.py') ? 'main:app' : 'app:app';
      addUnique(configs, runConfig({ label: 'FastAPI · Uvicorn', kind: 'python', framework: 'FastAPI', cwd: '.', command: 'python', args: ['-m', 'uvicorn', module, '--reload', '--host', '127.0.0.1', '--port', '8000'], source: rootFile('pyproject.toml') ? 'pyproject.toml' : 'requirements.txt', port: 8000 }));
    } else if (/flask/i.test(pythonText) && (rootFile('app.py') || rootFile('main.py'))) {
      const module = rootFile('app.py') ? 'app' : 'main';
      addUnique(configs, runConfig({ label: 'Flask development server', kind: 'python', framework: 'Flask', cwd: '.', command: 'python', args: ['-m', 'flask', '--app', module, 'run', '--debug', '--host', '127.0.0.1', '--port', '5000'], source: rootFile('pyproject.toml') ? 'pyproject.toml' : 'requirements.txt', port: 5000 }));
    }
  }
  if (rootFile('go.mod')) addUnique(configs, runConfig({ label: 'Go application', kind: 'go', framework: 'Go', cwd: '.', command: 'go', args: ['run', '.'], source: 'go.mod', port: 8080 }));
  const pomText = rootFile('pom.xml') ? await readTextBounded(path.join(resolvedRoot, 'pom.xml')) : '';
  const gradleFile = rootFile('build.gradle.kts') ? 'build.gradle.kts' : rootFile('build.gradle') ? 'build.gradle' : null;
  const gradleText = gradleFile ? await readTextBounded(path.join(resolvedRoot, gradleFile)) : '';
  const baseSpringConfigPath = await firstExisting(['application.yml', 'application.yaml', 'application.properties'].flatMap((name) => [
    path.join(resolvedRoot, name),
    path.join(resolvedRoot, 'src', 'main', 'resources', name),
  ]));
  const baseSpringText = baseSpringConfigPath ? await readTextBounded(baseSpringConfigPath) : '';
  const activeProfile = springActiveProfile(baseSpringText) ?? 'local';
  const profileSpringConfigPath = await firstExisting([
    `application-${activeProfile}.yml`,
    `application-${activeProfile}.yaml`,
    `application-${activeProfile}.properties`,
  ].flatMap((name) => [
    path.join(resolvedRoot, name),
    path.join(resolvedRoot, 'src', 'main', 'resources', name),
  ]));
  const profileSpringText = profileSpringConfigPath ? await readTextBounded(profileSpringConfigPath) : '';
  const detectedSpringPort = springPort(profileSpringText) ?? springPort(baseSpringText) ?? 8080;
  const detectedSpringContextPath = springContextPath(profileSpringText) || springContextPath(baseSpringText);
  if (pomText && /spring-boot|org\.springframework\.boot/i.test(pomText)) {
    const wrapper = process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw';
    const hasWrapper = rootFile(wrapper);
    addUnique(configs, runConfig({
      label: `Spring Boot · ${hasWrapper ? 'Maven Wrapper' : 'Maven'}`,
      kind: 'java',
      framework: 'Spring Boot',
      cwd: '.',
      command: hasWrapper ? path.join(resolvedRoot, wrapper) : 'mvn',
      args: ['spring-boot:run'],
      source: 'pom.xml',
      port: detectedSpringPort,
      urlPath: detectedSpringContextPath,
      dependenciesReady: await exists(path.join(resolvedRoot, 'target')),
    }));
  }
  if (gradleText && /org\.springframework\.boot|spring-boot/i.test(gradleText)) {
    const wrapper = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
    const hasWrapper = rootFile(wrapper);
    addUnique(configs, runConfig({
      label: `Spring Boot · ${hasWrapper ? 'Gradle Wrapper' : 'Gradle'}`,
      kind: 'java',
      framework: 'Spring Boot',
      cwd: '.',
      command: hasWrapper ? path.join(resolvedRoot, wrapper) : 'gradle',
      args: ['bootRun'],
      source: gradleFile ?? 'build.gradle',
      port: detectedSpringPort,
      urlPath: detectedSpringContextPath,
      dependenciesReady: await exists(path.join(resolvedRoot, 'build')),
    }));
  }
  const csproj = [...files].find((name) => !name.includes('/') && name.toLowerCase().endsWith('.csproj'));
  if (csproj) addUnique(configs, runConfig({ label: '.NET application', kind: 'dotnet', framework: 'ASP.NET Core', cwd: '.', command: 'dotnet', args: ['run', '--project', csproj], source: csproj, port: 5000 }));
  if (rootFile('Cargo.toml')) addUnique(configs, runConfig({ label: 'Rust application', kind: 'rust', framework: 'Rust', cwd: '.', command: 'cargo', args: ['run'], source: 'Cargo.toml', port: 8000 }));
  if (configs.length === 0 && rootFile('index.html')) addUnique(configs, runConfig({ label: 'Static web server', kind: 'static', framework: 'Static HTML', cwd: '.', command: 'python', args: ['-m', 'http.server', '8000', '--bind', '127.0.0.1'], source: 'index.html', port: 8000 }));

  return { configs, recommendedConfigId: configs[0]?.id ?? null, scannedAt: new Date().toISOString() };
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
  const first = process.platform === 'win32'
    ? candidates.find((candidate) => !/[\\/]Microsoft[\\/]WindowsApps[\\/]/i.test(candidate)) ?? candidates[0]
    : candidates[0];
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

  status(projectId: string): DevelopmentServerStatus {
    const record = this.records.get(projectId);
    if (!record) return { projectId, state: 'idle', config: null, pid: null, url: null, startedAt: null, error: null, logs: [] };
    const { child: _child, desktopManaged: _desktopManaged, stopping: _stopping, ...status } = record;
    return { ...status, logs: [...status.logs] };
  }

  async statusAsync(projectId: string): Promise<DevelopmentServerStatus> {
    const record = this.records.get(projectId);
    if (!record?.desktopManaged || this.desktopProcessBroker == null) return this.status(projectId);
    const managed = await this.desktopProcessBroker({ action: 'status', ownerPid: process.pid, projectId });
    record.pid = managed.pid;
    // The desktop broker keeps a bounded rolling buffer. Re-parse its tail on
    // every status poll so a URL emitted after the buffer wrapped is still
    // discovered; duplicate parsing is harmless and keeps no secret cursor.
    if (managed.logs.length > 0) appendLog(record, managed.logs.slice(-20).join('\n'));
    record.logs = managed.logs.slice(-MAX_LOG_LINES);
    record.error = managed.error;
    if (!managed.running && (record.state === 'starting' || record.state === 'ready')) {
      record.state = record.stopping ? 'idle' : 'failed';
      record.error ??= 'The development server exited';
    }
    return this.status(projectId);
  }

  async start(projectId: string, root: string, configIdValue: string): Promise<DevelopmentServerStatus> {
    await this.statusAsync(projectId);
    const current = this.records.get(projectId);
    if (current?.pid && current.state !== 'failed') return this.status(projectId);
    if (current?.pid) await this.stop(projectId);
    const detected = await detectDevelopmentRunConfigs(root);
    const config = detected.configs.find((candidate) => candidate.id === configIdValue);
    if (!config) throw new Error('The selected run configuration is no longer available; detect configurations again');
    const cwd = path.resolve(root, config.cwd === '.' ? '' : config.cwd);
    const relative = path.relative(path.resolve(root), cwd);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Run configuration escaped the project folder');
    const executable = executablePath(config.command);
    const invocation = createCommandInvocation({ command: executable, args: config.args, env: process.env });
    const record: RuntimeRecord = {
      projectId,
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
    this.records.set(projectId, record);
    if (process.platform === 'win32') {
      if (this.desktopProcessBroker == null) {
        record.state = 'failed';
        record.error = 'MonoField desktop process management is required to run a Windows development server';
        return this.status(projectId);
      }
      try {
        const managed = await this.desktopProcessBroker({
          action: 'start',
          args: invocation.args,
          command: invocation.command,
          cwd,
          ownerPid: process.pid,
          port: config.port,
          projectId,
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
      if (record.stopping) {
        record.state = 'idle';
        record.error = null;
      } else if (record.state !== 'failed') {
        record.state = 'failed';
        record.error = `Development server exited (${signal ?? code ?? 'unknown'})`;
      }
    });
    }
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline && record.pid && record.state !== 'failed') {
      if (record.desktopManaged) await this.statusAsync(projectId);
      if (record.url && await urlReady(record.url)) {
        record.state = 'ready';
        return this.status(projectId);
      }
      await delay(350);
    }
    if (record.state !== 'ready') {
      const timeoutError = record.error ?? `The server did not become reachable within ${Math.round(READY_TIMEOUT_MS / 1000)} seconds`;
      if (record.desktopManaged && record.pid && this.desktopProcessBroker) {
        record.stopping = true;
        await this.desktopProcessBroker({ action: 'terminate', ownerPid: process.pid, projectId });
        record.pid = null;
        record.stopping = false;
      } else if (record.child) {
        record.stopping = true;
        await terminateTree(record.child);
        record.child = null;
        record.pid = null;
        record.stopping = false;
      }
      record.state = 'failed';
      record.error = timeoutError;
    }
    return this.status(projectId);
  }

  async stop(projectId: string): Promise<DevelopmentServerStatus> {
    const record = this.records.get(projectId);
    if (!record?.pid) return this.status(projectId);
    record.stopping = true;
    if (record.desktopManaged) {
      if (this.desktopProcessBroker == null) throw new Error('MonoField desktop process management is unavailable');
      await this.desktopProcessBroker({ action: 'terminate', ownerPid: process.pid, projectId });
    } else if (record.child) {
      await terminateTree(record.child);
    }
    record.child = null;
    record.pid = null;
    record.state = 'idle';
    record.error = null;
    return this.status(projectId);
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.records.keys()].map((projectId) => this.stop(projectId)));
  }
}
