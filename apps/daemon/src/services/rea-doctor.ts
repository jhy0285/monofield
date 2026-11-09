import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { REA_PACKAGE, satisfiesNodeRange, type ReaDoctorCheck, type ReaDoctorCheckId, type ReaDoctorResponse } from '@open-design/contracts';
import { isPinnedNpxRea, locateBundledRea, type BundledReaLookup } from './bundled-rea.js';

/**
 * What REA needs on this machine, checked in one place: the REA copy that ships with MonoField (when it is usable a
 * pinned REA entry runs it, and Node.js and npx are not needed), otherwise Node.js in the range REA's package declares
 * and npx (the MCP template runs `npx -y rea-agents@<version> --mcp`), a Chromium-family browser for browser capture,
 * the REA MCP server in MonoField's settings, and the optional engines some targets use. Executables are looked up on PATH and in
 * the usual install locations only; something installed elsewhere is reported missing, and nothing is installed here.
 *
 * Ghidra is found the way REA 6.7.0 finds it: through GHIDRA_INSTALL_DIR (and Java through JAVA_HOME), taken from the
 * REA MCP entry's environment or else from the process environment, not from PATH. REA validates both as non-empty
 * absolute paths when it starts, so an empty value stops REA altogether and is reported as such.
 */
export interface ReaDoctorDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** `node --version` of the Node.js on PATH (the one npx uses), or null when it does not run. */
  nodeVersion: () => Promise<string | null>;
  exists: (file: string) => Promise<boolean>;
  /** MonoField's saved MCP servers, with their environment values (the doctor reads only GHIDRA_INSTALL_DIR and JAVA_HOME). */
  mcpServers: () => Promise<Array<{ id: string; templateId?: string; transport?: string; enabled?: boolean; command?: string; args?: string[]; env?: Record<string, string> }>>;
  /** The REA copy inside MonoField. */
  bundled: () => BundledReaLookup;
  /** Settings: the AI uses REA in conversations. Absent or unreadable means on, the shipped default. */
  reaForAgents?: () => Promise<boolean>;
}

export function defaultReaDoctorDeps(mcpServers: ReaDoctorDeps['mcpServers'], reaForAgents: ReaDoctorDeps['reaForAgents'] = async () => true): ReaDoctorDeps {
  return {
    platform: process.platform,
    env: process.env,
    nodeVersion: () => new Promise((resolve) => {
      execFile('node', ['--version'], { timeout: 5000, windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout).trim() || null));
    }),
    exists: async (file) => { try { await access(file); return true; } catch { return false; } },
    mcpServers,
    bundled: () => locateBundledRea(),
    reaForAgents,
  };
}

async function which(deps: Pick<ReaDoctorDeps, 'platform' | 'env' | 'exists'>, names: string[]): Promise<string | null> {
  const joiner = deps.platform === 'win32' ? path.win32 : path.posix;
  const dirs = (deps.env.PATH ?? deps.env.Path ?? '').split(deps.platform === 'win32' ? ';' : ':').filter(Boolean);
  const extensions = deps.platform === 'win32' ? (deps.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((ext) => ext.toLowerCase()) : [''];
  for (const name of names) {
    for (const dir of dirs) {
      for (const extension of extensions) {
        const candidate = joiner.join(dir, `${name}${extension}`);
        if (await deps.exists(candidate)) return candidate;
      }
    }
  }
  return null;
}

/** A Chromium-family browser REA can launch, from the usual install locations and PATH. */
export async function findBrowser(deps: Pick<ReaDoctorDeps, 'platform' | 'env' | 'exists'>): Promise<string | null> {
  const fixed: string[] = [];
  if (deps.platform === 'darwin') {
    fixed.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else if (deps.platform === 'win32') {
    const roots = [deps.env.ProgramFiles, deps.env['ProgramFiles(x86)'], deps.env.LOCALAPPDATA].filter((root): root is string => Boolean(root));
    for (const root of roots) {
      for (const relative of ['Google\\Chrome\\Application\\chrome.exe', 'Chromium\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe']) fixed.push(path.win32.join(root, relative));
    }
  }
  for (const candidate of fixed) if (await deps.exists(candidate)) return candidate;
  return which(deps, ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome', 'microsoft-edge', 'microsoft-edge-stable', 'msedge']);
}

export async function runReaDoctor(deps: ReaDoctorDeps): Promise<ReaDoctorResponse> {
  const checks: ReaDoctorCheck[] = [];
  const add = (id: ReaDoctorCheckId, required: boolean, found: string | null, status?: ReaDoctorCheck['status'], note?: string) =>
    checks.push({ id, required, found, status: status ?? (found ? 'ok' : 'missing'), ...(note ? { note } : {}) });

  const servers = await deps.mcpServers().catch(() => []);
  const rea = servers.find((server) => server.id === 'rea' || server.templateId === 'rea');
  const bundled = deps.bundled();
  // The REA template and `monofield rea configure` save the pinned npx command, which runs the bundled copy.
  const runsBundled = bundled.available && (!rea || isPinnedNpxRea(rea));
  if (bundled.available) add('bundled', false, `${REA_PACKAGE.name} ${bundled.runtime.version} · Node.js ${bundled.runtime.nodeVersion}`);
  else add('bundled', false, bundled.found, bundled.reason === 'not-installed' ? 'missing' : 'warn', bundled.reason);

  const version = await deps.nodeVersion();
  if (runsBundled) add('node', false, version, undefined, 'not-needed');
  else if (!version) add('node', true, null);
  else if (satisfiesNodeRange(version, REA_PACKAGE.node)) add('node', true, version);
  else add('node', true, version, 'warn', 'outside-range');
  const npx = await which(deps, ['npx']);
  if (runsBundled) add('npx', false, npx, undefined, 'not-needed');
  else add('npx', true, npx);

  // "The AI uses REA in conversations": the built-in REA reaches every conversation unless this is off; a saved REA entry
  // only adds its folders (or replaces the command, for a custom REA).
  const forAgents = deps.reaForAgents ? await deps.reaForAgents().catch(() => true) : true;
  if (!forAgents) add('mcp', false, null, 'warn', 'agents-off');
  else if (!rea) {
    const command = runsBundled ? `${REA_PACKAGE.name} ${REA_PACKAGE.version}` : `npx -y ${REA_PACKAGE.name}@${REA_PACKAGE.version} --mcp`;
    add('mcp', true, command, 'ok', runsBundled ? 'built-in' : undefined);
  } else {
    const command = [rea.command, ...(rea.args ?? [])].filter(Boolean).join(' ');
    const pinned = (rea.args ?? []).find((arg) => arg.startsWith(`${REA_PACKAGE.name}@`));
    const note = pinned && pinned !== `${REA_PACKAGE.name}@${REA_PACKAGE.version}` ? 'other-version'
      : !pinned ? 'custom-command' : runsBundled ? 'built-in' : undefined;
    add('mcp', true, command || rea.id, 'ok', note);
  }

  add('browser', false, await findBrowser(deps));

  // The REA entry's own environment wins over the process environment, as it does when the agent starts REA. REA checks
  // both values when it starts: an empty or relative one stops REA altogether, so it counts as required then.
  const joiner = deps.platform === 'win32' ? path.win32 : path.posix;
  const fromRea = (key: string) => (rea?.env && key in rea.env ? rea.env[key] : undefined);
  const pathSetting = async (id: 'ghidra' | 'java', value: string | undefined, probe: string[], fallback: () => Promise<string | null>) => {
    if (value === undefined) {
      const found = await fallback();
      return add(id, false, found, undefined, found || id !== 'ghidra' ? undefined : 'not-set');
    }
    if (value.trim() === '') return add(id, true, null, 'warn', 'empty-value');
    if (!joiner.isAbsolute(value)) return add(id, true, value, 'warn', 'not-absolute');
    const present = await deps.exists(joiner.join(value, ...probe));
    return add(id, false, value, present ? 'ok' : 'warn', present ? undefined : id === 'ghidra' ? 'no-analyze-headless' : 'no-java');
  };
  await pathSetting('ghidra', fromRea('GHIDRA_INSTALL_DIR') ?? deps.env.GHIDRA_INSTALL_DIR,
    ['support', deps.platform === 'win32' ? 'analyzeHeadless.bat' : 'analyzeHeadless'], async () => null);
  add('native', false, await which(deps, ['idat64', 'idat', 'ida64', 'ida', 'hopper']));
  await pathSetting('java', fromRea('JAVA_HOME') ?? deps.env.JAVA_HOME, ['bin', deps.platform === 'win32' ? 'java.exe' : 'java'],
    () => which(deps, ['java']));
  add('jadx', false, await which(deps, ['jadx']));
  add('apktool', false, await which(deps, ['apktool']));
  add('tshark', false, await which(deps, ['tshark']));
  add('adb', false, await which(deps, ['adb']));

  const ready = checks.filter((check) => check.required).every((check) => check.status === 'ok');
  return {
    ok: true, ready, platform: deps.platform, package: REA_PACKAGE, checks,
    bundled: bundled.available
      ? { version: bundled.runtime.version, command: bundled.runtime.command, args: [bundled.runtime.entry, '--mcp'], env: bundled.runtime.env }
      : null,
  };
}
