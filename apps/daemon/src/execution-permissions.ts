import {
  normalizeExecutionPermissionLevel,
  resolveExecutionPermissions,
  type ExecutionPermissionLevel,
  type ExecutionPermissionsResponse,
} from '@open-design/contracts';
import { isWindowsProcessElevated } from '@open-design/platform';

import { readAppConfig, writeAppConfig } from './app-config.js';
import { codexFullAccessFromEnv } from './runtimes/defs/codex.js';

// A process cannot gain or lose its administrator token while it runs, so the
// daemon probes once. The daemon is a child of MonoField Desktop and inherits
// its token, which makes this the desktop's elevation too.
let elevationProbe: Promise<boolean | null> | null = null;

export function processElevation(): Promise<boolean | null> {
  elevationProbe ??= isWindowsProcessElevated();
  return elevationProbe;
}

export function resetProcessElevationProbeForTests(): void {
  elevationProbe = null;
}

export function buildExecutionPermissionsResponse(
  level: ExecutionPermissionLevel,
  options: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; elevated?: boolean | null } = {},
): ExecutionPermissionsResponse {
  const platform = options.platform ?? process.platform;
  const codexSandboxLockedByEnv = codexFullAccessFromEnv(options.env ?? process.env);
  return {
    level,
    effective: resolveExecutionPermissions(level, {
      codexFullAccessFromEnv: codexSandboxLockedByEnv,
      platform,
    }),
    codexSandboxLockedByEnv,
    elevated: options.elevated ?? null,
    platform,
  };
}

export async function readExecutionPermissions(
  dataDir: string,
  options: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; elevation?: () => Promise<boolean | null> } = {},
): Promise<ExecutionPermissionsResponse> {
  const config = await readAppConfig(dataDir);
  const elevated = await (options.elevation ?? processElevation)();
  return buildExecutionPermissionsResponse(
    normalizeExecutionPermissionLevel(config.executionPermissionLevel),
    { ...options, elevated },
  );
}

export async function writeExecutionPermissionLevel(
  dataDir: string,
  level: ExecutionPermissionLevel,
  options: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; elevation?: () => Promise<boolean | null> } = {},
): Promise<ExecutionPermissionsResponse> {
  await writeAppConfig(dataDir, { executionPermissionLevel: level });
  return readExecutionPermissions(dataDir, options);
}
