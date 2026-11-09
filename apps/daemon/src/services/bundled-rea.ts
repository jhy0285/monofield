import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { REA_PACKAGE, satisfiesNodeRange } from '@open-design/contracts';
import type { McpServerConfig, McpTemplate } from '../mcp-config.js';

/**
 * REA ships inside MonoField: `rea-agents` is a pinned dependency of the daemon (the lockfile records its hash), so a
 * conversation can start REA from the installation instead of downloading it with `npx` on first use. It runs on
 * MonoField's own runtime: Node.js in development, Electron told to act as Node.js in the packaged app.
 */
export interface BundledReaRuntime {
  /** REA's own launcher inside the installation (`scripts/rea.mjs`). */
  entry: string;
  version: string;
  /** The runtime that starts it. */
  command: string;
  /** Extra environment for that runtime: Electron needs ELECTRON_RUN_AS_NODE to behave as Node.js. */
  env: Record<string, string>;
  nodeVersion: string;
}

export type BundledReaLookup =
  | { available: true; runtime: BundledReaRuntime }
  | { available: false; reason: 'not-installed' | 'other-version' | 'outside-range'; found: string | null };

export interface BundledReaProbe {
  /** Absolute path of the installed `rea-agents/package.json`, or null when it cannot be resolved. */
  packageJson: () => string | null;
  readJson: (file: string) => { version?: unknown } | null;
  exists: (file: string) => boolean;
  execPath: string;
  nodeVersion: string;
  /** True when this process is Electron (the packaged app). */
  electron: boolean;
}

export function defaultBundledReaProbe(): BundledReaProbe {
  const require = createRequire(import.meta.url);
  return {
    packageJson: () => { try { return require.resolve('rea-agents/package.json'); } catch { return null; } },
    readJson: (file) => { try { return JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown }; } catch { return null; } },
    exists: existsSync,
    execPath: process.execPath,
    nodeVersion: process.versions.node,
    electron: typeof process.versions.electron === 'string',
  };
}

/** Finds the REA copy that ships with MonoField, and says why it cannot be used when it cannot. */
export function locateBundledRea(probe: BundledReaProbe = defaultBundledReaProbe()): BundledReaLookup {
  const manifest = probe.packageJson();
  const entry = manifest ? path.join(path.dirname(manifest), 'scripts', 'rea.mjs') : null;
  if (!manifest || !entry || !probe.exists(entry)) return { available: false, reason: 'not-installed', found: null };
  const version = probe.readJson(manifest)?.version;
  if (version !== REA_PACKAGE.version) {
    return { available: false, reason: 'other-version', found: typeof version === 'string' ? version : null };
  }
  if (!satisfiesNodeRange(probe.nodeVersion, REA_PACKAGE.node)) {
    return { available: false, reason: 'outside-range', found: probe.nodeVersion };
  }
  return {
    available: true,
    runtime: {
      entry,
      version,
      command: probe.execPath,
      env: probe.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {},
      nodeVersion: probe.nodeVersion,
    },
  };
}

/**
 * True for a server that starts exactly the pinned REA release through npx (`npx -y rea-agents@<pinned> --mcp`), which
 * is what the REA template and `monofield rea configure` save. A changed command, another version or extra arguments
 * are the user's own choice and are left alone.
 */
export function isPinnedNpxRea(server: { transport?: string | undefined; command?: string | undefined; args?: string[] | undefined }): boolean {
  if ((server.transport ?? 'stdio') !== 'stdio' || !server.command) return false;
  const command = path.basename(server.command.replace(/\\/g, '/')).toLowerCase().replace(/\.(cmd|exe)$/, '');
  if (command !== 'npx') return false;
  const rest = (server.args ?? []).filter((arg) => arg !== '-y' && arg !== '--yes');
  return rest.length === 2 && rest[0] === `${REA_PACKAGE.name}@${REA_PACKAGE.version}` && rest[1] === '--mcp';
}

/**
 * The servers a conversation gets, with every pinned npx REA entry pointed at the copy inside MonoField: the same
 * release, started without a download. Everything else, and everything when no usable copy is installed, is passed
 * through unchanged, so npx stays the fallback.
 */
export function withBundledRea<T extends McpServerConfig>(servers: T[], lookup: BundledReaLookup): T[] {
  if (!lookup.available) return servers;
  const { runtime } = lookup;
  return servers.map((server) => isPinnedNpxRea(server)
    ? { ...server, command: runtime.command, args: [runtime.entry, '--mcp'], env: { ...(server.env ?? {}), ...runtime.env } }
    : server);
}

/** The setting "the AI uses REA in conversations": on unless it was turned off. */
export function reaForAgentsEnabled(value: unknown): boolean {
  return value !== false;
}

const isReaEntry = (server: { id: string; templateId?: string | undefined }) => server.id === 'rea' || server.templateId === 'rea';

/**
 * The saved MCP servers a conversation starts from, with REA switched by the setting. On: a saved REA entry is used
 * and enabled (it may carry the Ghidra and Java folders), or, when there is none, the REA template's entry is added, so
 * REA needs no setup. Off: every REA entry is left out. Other servers are untouched.
 */
export function withReaForAgents<T extends McpServerConfig>(servers: T[], enabled: boolean, template: McpTemplate | undefined): T[] {
  if (!enabled) return servers.map((server) => (isReaEntry(server) ? { ...server, enabled: false } : server));
  if (servers.some(isReaEntry)) return servers.map((server) => (isReaEntry(server) ? { ...server, enabled: true } : server));
  if (!template?.command || !template.args) return servers;
  const entry = { id: 'rea', templateId: 'rea', label: template.label, transport: 'stdio', command: template.command, args: [...template.args], enabled: true } as McpServerConfig;
  return [...servers, entry as T];
}
