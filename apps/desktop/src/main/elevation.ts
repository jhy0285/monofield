import type { OpenDesignHostActionResult } from "@open-design/host";
import {
  LAUNCHER_AFTER_QUIT_FLAG,
  LAUNCHER_AFTER_QUIT_TARGET_PID_ARG,
  LAUNCHER_AFTER_QUIT_TIMEOUT_MS_ARG,
  buildLauncherAfterQuitArgs,
} from "@open-design/launcher-proto";
import {
  isWindowsProcessElevated,
  launchWindowsElevated,
  type WindowsElevatedLaunchResult,
} from "@open-design/platform";

/**
 * How long the elevated instance waits for this one to quit before it starts
 * anyway. Shutting down closes the daemon and web sidecars, which can take a
 * while on a slow machine; the wait ends as soon as this process exits.
 */
export const ELEVATED_RELAUNCH_WAIT_MS = 120_000;

export type DesktopElevationDeps = {
  argv: readonly string[];
  execPath: string;
  isElevated?: () => Promise<boolean | null>;
  launchElevated?: (executable: string, args: readonly string[]) => Promise<WindowsElevatedLaunchResult>;
  packaged: boolean;
  pid: number;
  platform: NodeJS.Platform;
};

export type DesktopElevation = {
  /**
   * Starts a second copy of this app through the UAC prompt and resolves once
   * Windows has started it. The caller then quits; the new copy waits for this
   * process to exit (the launcher after-quit handshake) before it boots.
   */
  relaunch(): Promise<OpenDesignHostActionResult>;
  /**
   * True when Settings asks for administrator rights at launch and this
   * process does not have them. `readStartElevated` reads that setting from
   * the daemon; any failure there means "no".
   */
  shouldRelaunchAtStartup(readStartElevated: () => Promise<boolean>): Promise<boolean>;
};

/** This process's arguments without a previous after-quit handshake, plus a new one aimed at this pid. */
export function elevatedRelaunchArgs(argv: readonly string[], pid: number): string[] {
  const kept: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === LAUNCHER_AFTER_QUIT_FLAG) continue;
    if (arg === LAUNCHER_AFTER_QUIT_TARGET_PID_ARG || arg === LAUNCHER_AFTER_QUIT_TIMEOUT_MS_ARG) {
      index += 1;
      continue;
    }
    if (arg != null) kept.push(arg);
  }
  return [...kept, ...buildLauncherAfterQuitArgs({ targetPid: pid, timeoutMs: ELEVATED_RELAUNCH_WAIT_MS })];
}

/**
 * Administrator relaunch for the packaged Windows app. Returns null where it
 * cannot work: off Windows, and in tools-dev, whose Electron process is not a
 * standalone app that could be started again on its own.
 */
export function createDesktopElevation(deps: DesktopElevationDeps): DesktopElevation | null {
  if (deps.platform !== "win32" || !deps.packaged) return null;
  const isElevated = deps.isElevated ?? (() => isWindowsProcessElevated({ platform: deps.platform }));
  const launchElevated = deps.launchElevated
    ?? ((executable: string, args: readonly string[]) => launchWindowsElevated(executable, args, { platform: deps.platform }));
  let elevated: Promise<boolean | null> | null = null;
  const currentElevation = (): Promise<boolean | null> => {
    elevated ??= isElevated();
    return elevated;
  };

  return {
    async relaunch() {
      if ((await currentElevation()) === true) return { ok: false, reason: "already-elevated" };
      // argv[0] is the executable itself in a packaged app.
      const result = await launchElevated(deps.execPath, elevatedRelaunchArgs(deps.argv.slice(1), deps.pid));
      if (result.ok) return { ok: true };
      return {
        ok: false,
        reason: result.reason,
        ...(result.reason === "failed" && result.detail ? { details: result.detail } : {}),
      };
    },
    async shouldRelaunchAtStartup(readStartElevated) {
      if ((await currentElevation()) !== false) return false;
      try {
        return await readStartElevated();
      } catch {
        return false;
      }
    },
  };
}

/** Reads `effective.startElevated` from `GET /api/execution-permissions`. */
export async function readStartElevatedFromDaemon(
  daemonUrl: string | null,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<boolean> {
  if (daemonUrl == null || daemonUrl.length === 0) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 3_000);
  try {
    const response = await (options.fetch ?? fetch)(
      `${daemonUrl.replace(/\/$/, "")}/api/execution-permissions`,
      { signal: controller.signal },
    );
    if (!response.ok) return false;
    const body = (await response.json()) as { effective?: { startElevated?: unknown } };
    return body.effective?.startElevated === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
