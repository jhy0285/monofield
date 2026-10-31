import {
  normalizeExecutionPermissionLevel,
  resolveExecutionPermissions,
  type ExecutionPermissionLevel,
  type ExecutionPermissionsResponse,
} from '@open-design/contracts';
import { readWindowsTokenInfo, type WindowsTokenInfo } from '@open-design/platform';

import { readAppConfig, writeAppConfig } from './app-config.js';
import { codexFullAccessFromEnv } from './runtimes/defs/codex.js';

// A process cannot gain or lose its administrator token, or change the account
// it runs as, while it runs, so the daemon probes once. The daemon is a child
// of MonoField Desktop and inherits its token, which makes this the desktop's
// elevation too.
let tokenProbe: Promise<WindowsTokenInfo> | null = null;

export function processTokenInfo(): Promise<WindowsTokenInfo> {
  tokenProbe ??= readWindowsTokenInfo();
  return tokenProbe;
}

export function resetProcessTokenProbeForTests(): void {
  tokenProbe = null;
}

type ExecutionPermissionsOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  token?: () => Promise<WindowsTokenInfo>;
};

export function buildExecutionPermissionsResponse(
  level: ExecutionPermissionLevel,
  options: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; elevated?: boolean | null; canElevate?: boolean | null } = {},
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
    canElevate: options.canElevate ?? null,
    platform,
  };
}

export async function readExecutionPermissions(
  dataDir: string,
  options: ExecutionPermissionsOptions = {},
): Promise<ExecutionPermissionsResponse> {
  const config = await readAppConfig(dataDir);
  const token = await (options.token ?? processTokenInfo)();
  return buildExecutionPermissionsResponse(
    normalizeExecutionPermissionLevel(config.executionPermissionLevel),
    {
      ...(options.env ? { env: options.env } : {}),
      ...(options.platform ? { platform: options.platform } : {}),
      elevated: token.elevated,
      canElevate: token.administratorAccount,
    },
  );
}

export async function writeExecutionPermissionLevel(
  dataDir: string,
  level: ExecutionPermissionLevel,
  options: ExecutionPermissionsOptions = {},
): Promise<ExecutionPermissionsResponse> {
  await writeAppConfig(dataDir, { executionPermissionLevel: level });
  return readExecutionPermissions(dataDir, options);
}
