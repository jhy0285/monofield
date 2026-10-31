import type { OpenDesignHostActionResult } from "@open-design/host";
import {
  LAUNCHER_AFTER_QUIT_FLAG,
  LAUNCHER_AFTER_QUIT_TARGET_PID_ARG,
  LAUNCHER_AFTER_QUIT_TIMEOUT_MS_ARG,
  buildLauncherAfterQuitArgs,
} from "@open-design/launcher-proto";
import {
  launchWindowsElevated,
  readWindowsTokenInfo,
  type WindowsElevatedLaunchResult,
  type WindowsTokenInfo,
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
  readToken?: () => Promise<WindowsTokenInfo>;
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
   * A standard (non-administrator) account is refused with `not-administrator`:
   * UAC would ask for another account's credentials and open the app as that
   * other user, with different settings and projects.
   */
  relaunch(): Promise<OpenDesignHostActionResult>;
  /**
   * True when Settings asks for administrator rights at launch and this
   * process does not have them, on an account that can elevate as itself.
   * `readStartElevated` reads that setting from the daemon; any failure there
   * means "no".
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
  const readToken = deps.readToken ?? (() => readWindowsTokenInfo({ platform: deps.platform }));
  const launchElevated = deps.launchElevated
    ?? ((executable: string, args: readonly string[]) => launchWindowsElevated(executable, args, { platform: deps.platform }));
  // The token and the account cannot change while the process runs.
  let token: Promise<WindowsTokenInfo> | null = null;
  const currentToken = (): Promise<WindowsTokenInfo> => {
    token ??= readToken();
    return token;
  };

  return {
    async relaunch() {
      const { elevated, administratorAccount } = await currentToken();
      if (elevated === true) return { ok: false, reason: "already-elevated" };
      if (administratorAccount === false) return { ok: false, reason: "not-administrator" };
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
      const { elevated, administratorAccount } = await currentToken();
      if (elevated !== false || administratorAccount !== true) return false;
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
