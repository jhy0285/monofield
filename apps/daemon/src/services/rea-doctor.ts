import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { REA_PACKAGE, satisfiesNodeRange, type ReaDoctorCheck, type ReaDoctorCheckId, type ReaDoctorResponse } from '@open-design/contracts';

/**
 * What REA needs on this machine, checked in one place: Node.js in the range REA's package declares, npx (the MCP
 * template runs `npx -y rea-agents@<version> --mcp`), a Chromium-family browser for browser capture, the REA MCP
 * server in MonoField's settings, and the optional engines some targets use. Executables are looked up on PATH and in
 * the usual install locations only; something installed elsewhere is reported missing, and nothing is installed here.
 */
export interface ReaDoctorDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** `node --version` of the Node.js on PATH (the one npx uses), or null when it does not run. */
  nodeVersion: () => Promise<string | null>;
  exists: (file: string) => Promise<boolean>;
  /** MonoField's saved MCP servers. */
  mcpServers: () => Promise<Array<{ id: string; templateId?: string; enabled?: boolean; command?: string; args?: string[] }>>;
}

export function defaultReaDoctorDeps(mcpServers: ReaDoctorDeps['mcpServers']): ReaDoctorDeps {
  return {
    platform: process.platform,
    env: process.env,
    nodeVersion: () => new Promise((resolve) => {
      execFile('node', ['--version'], { timeout: 5000, windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout).trim() || null));
    }),
    exists: async (file) => { try { await access(file); return true; } catch { return false; } },
    mcpServers,
  };
}

async function which(deps: ReaDoctorDeps, names: string[]): Promise<string | null> {
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

async function findBrowser(deps: ReaDoctorDeps): Promise<string | null> {
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

  const version = await deps.nodeVersion();
  if (!version) add('node', true, null);
  else if (satisfiesNodeRange(version, REA_PACKAGE.node)) add('node', true, version);
  else add('node', true, version, 'warn', 'outside-range');
  add('npx', true, await which(deps, ['npx']));

  const servers = await deps.mcpServers().catch(() => []);
  const rea = servers.find((server) => server.id === 'rea' || server.templateId === 'rea');
  if (!rea) add('mcp', true, null);
  else {
    const command = [rea.command, ...(rea.args ?? [])].filter(Boolean).join(' ');
    const pinned = (rea.args ?? []).find((arg) => arg.startsWith(`${REA_PACKAGE.name}@`));
    const note = rea.enabled === false ? 'disabled' : pinned && pinned !== `${REA_PACKAGE.name}@${REA_PACKAGE.version}` ? 'other-version' : !pinned ? 'custom-command' : undefined;
    add('mcp', true, command || rea.id, rea.enabled === false ? 'warn' : 'ok', note);
  }

  add('browser', false, await findBrowser(deps));
  add('native', false, await which(deps, ['ghidraRun', 'analyzeHeadless', 'idat64', 'idat', 'ida64', 'ida', 'hopper']));
  add('java', false, await which(deps, ['java']));
  add('jadx', false, await which(deps, ['jadx']));
  add('apktool', false, await which(deps, ['apktool']));
  add('tshark', false, await which(deps, ['tshark']));
  add('adb', false, await which(deps, ['adb']));

  const ready = checks.filter((check) => check.required).every((check) => check.status === 'ok');
  return { ok: true, ready, platform: deps.platform, package: REA_PACKAGE, checks };
}
