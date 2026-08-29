import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import path from 'node:path';

export const CODEX_WINDOWS_SANDBOX_UNAVAILABLE =
  'CODEX_WINDOWS_SANDBOX_UNAVAILABLE';

export interface CodexWindowsSandboxCircuitState {
  observedAt: number;
  environmentFingerprint: string;
}

let circuitState: CodexWindowsSandboxCircuitState | null = null;

export function isCodexWindowsSandboxLogonFailureText(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  return /windows sandbox:\s*CreateProcessWithLogonW failed:\s*1385\b/i.test(value);
}

/**
 * Hash only stable, non-secret launch facts. The executable stat notices an
 * in-place CLI upgrade while the Windows identity/session fields notice a new
 * login or a different managed account. No username or path is exposed in
 * diagnostics; callers receive only this digest.
 */
export function codexWindowsSandboxEnvironmentFingerprint({
  binaryPath,
  binaryVersion,
  env = process.env,
  platform = process.platform,
}: {
  binaryPath?: string | null;
  binaryVersion?: string | null;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  platform?: NodeJS.Platform;
} = {}): string {
  let binaryStat = 'missing';
  if (binaryPath) {
    try {
      const stat = statSync(binaryPath);
      binaryStat = `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
    } catch {
      binaryStat = 'unreadable';
    }
  }
  const normalizedPath = binaryPath
    ? path.resolve(binaryPath).replace(/\\/g, '/').toLowerCase()
    : '';
  return createHash('sha256').update([
    platform,
    normalizedPath,
    binaryStat,
    binaryVersion?.trim() ?? '',
    env.SESSIONNAME ?? '',
    env.USERDOMAIN ?? '',
    env.USERNAME ?? '',
    env.USERPROFILE ?? '',
  ].join('\0')).digest('hex');
}

export function codexWindowsSandboxUnavailableMessage(
  circuitOpen = false,
): string {
  const prefix = circuitOpen
    ? 'Codex Windows safe execution remains paused because the same Codex binary and Windows session previously failed with Windows error 1385.'
    : 'Codex could not start its Windows safe execution sandbox (Windows error 1385 from CreateProcessWithLogonW: the sandbox account was not granted the required logon type).';
  return [
    prefix,
    'MonoField did not broaden filesystem access automatically, and it stopped this run to avoid repeated model calls and token usage.',
    'Update Codex CLI, then sign out of Windows or restart the PC and explicitly refresh the agent list before retrying.',
    'On a managed PC, ask an administrator to verify the sandbox account can use the required Windows logon policy, or switch this project to another installed CLI agent.',
  ].join(' ');
}

export function recordCodexWindowsSandboxLogonFailure(
  {
    environmentFingerprint,
    now = Date.now(),
  }: {
    environmentFingerprint: string;
    now?: number;
  },
): CodexWindowsSandboxCircuitState {
  circuitState = { observedAt: now, environmentFingerprint };
  return { ...circuitState };
}

export function currentCodexWindowsSandboxCircuit(
  options: {
    environmentFingerprint: string;
    platform?: NodeJS.Platform;
    dangerFullAccessExplicitlyEnabled?: boolean;
  },
): CodexWindowsSandboxCircuitState | null {
  const platform = options.platform ?? process.platform;
  if (
    platform !== 'win32' ||
    options.dangerFullAccessExplicitlyEnabled === true ||
    circuitState === null
  ) {
    return null;
  }
  if (circuitState.environmentFingerprint !== options.environmentFingerprint) {
    circuitState = null;
    return null;
  }
  return { ...circuitState };
}

/** Explicit agent refresh or a successful safe-execution diagnostic may reset it. */
export function resetCodexWindowsSandboxCircuit(): void {
  circuitState = null;
}

export function resetCodexWindowsSandboxCircuitForTests(): void {
  resetCodexWindowsSandboxCircuit();
}
