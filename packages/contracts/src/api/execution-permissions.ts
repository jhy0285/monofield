/**
 * Execution permission DTOs for `GET/PUT /api/execution-permissions`.
 *
 * One global level decides what the local coding agents may touch, the way
 * Codex's own approval selector does: the level maps to a Codex sandbox mode,
 * a Claude Code permission mode, and (on Windows) whether MonoField itself
 * starts with administrator rights. The web Settings section and the
 * `monofield permissions` CLI both read and write this one shape.
 */

export const EXECUTION_PERMISSION_LEVELS = ['read-only', 'default', 'full'] as const;

export type ExecutionPermissionLevel = (typeof EXECUTION_PERMISSION_LEVELS)[number];

/** Level used when nothing was saved. It keeps the behavior MonoField shipped with. */
export const DEFAULT_EXECUTION_PERMISSION_LEVEL: ExecutionPermissionLevel = 'default';

export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

/** The Claude Code `--permission-mode` values MonoField passes. */
export type ClaudePermissionMode = 'plan' | 'bypassPermissions';

export interface ExecutionPermissionsEffective {
  codexSandbox: CodexSandboxMode;
  /** Codex network access inside its sandbox. Always true for `danger-full-access`. */
  codexNetwork: boolean;
  claudePermissionMode: ClaudePermissionMode;
  /** MonoField restarts with administrator rights at launch (Windows desktop only). */
  startElevated: boolean;
}

export interface ExecutionPermissionsResponse {
  level: ExecutionPermissionLevel;
  effective: ExecutionPermissionsEffective;
  /**
   * True when the daemon was started with `OD_CODEX_SANDBOX=danger-full-access`.
   * Codex then runs without a sandbox whatever the level says.
   */
  codexSandboxLockedByEnv: boolean;
  /**
   * Whether the running MonoField process has administrator rights. `null` where
   * it does not apply or could not be determined (macOS, Linux, a failed probe).
   */
  elevated: boolean | null;
  /** `process.platform` of the daemon, so clients can explain platform-only parts. */
  platform: string;
}

export interface UpdateExecutionPermissionsRequest {
  level: ExecutionPermissionLevel;
}

export function isExecutionPermissionLevel(value: unknown): value is ExecutionPermissionLevel {
  return typeof value === 'string'
    && (EXECUTION_PERMISSION_LEVELS as readonly string[]).includes(value);
}

export function normalizeExecutionPermissionLevel(value: unknown): ExecutionPermissionLevel {
  return isExecutionPermissionLevel(value) ? value : DEFAULT_EXECUTION_PERMISSION_LEVEL;
}

/**
 * What a level means for each tool. `codexFullAccessFromEnv` is the
 * administrator override (`OD_CODEX_SANDBOX=danger-full-access`); it widens
 * Codex only, and never narrows any level.
 */
export function resolveExecutionPermissions(
  level: ExecutionPermissionLevel,
  options: { codexFullAccessFromEnv?: boolean; platform?: string } = {},
): ExecutionPermissionsEffective {
  const codexSandbox: CodexSandboxMode = options.codexFullAccessFromEnv || level === 'full'
    ? 'danger-full-access'
    : level === 'read-only'
      ? 'read-only'
      : 'workspace-write';
  return {
    codexSandbox,
    codexNetwork: codexSandbox !== 'read-only',
    claudePermissionMode: level === 'read-only' ? 'plan' : 'bypassPermissions',
    startElevated: level === 'full' && options.platform === 'win32',
  };
}

/**
 * Whether MonoField Desktop has to restart for its administrator rights to
 * match the level: the level asks for elevation and the process lacks it, or
 * the process is elevated and the level no longer asks for it. False when the
 * elevation is unknown or does not apply.
 */
export function executionPermissionsNeedRestart(
  permissions: Pick<ExecutionPermissionsResponse, 'effective' | 'elevated'>,
): boolean {
  if (permissions.elevated == null) return false;
  return permissions.effective.startElevated !== permissions.elevated;
}
