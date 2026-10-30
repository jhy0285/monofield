import { describe, expect, it } from "vitest";

import { parseLauncherAfterQuitArgs } from "@open-design/launcher-proto";

import {
  ELEVATED_RELAUNCH_WAIT_MS,
  createDesktopElevation,
  elevatedRelaunchArgs,
  readStartElevatedFromDaemon,
} from "../../src/main/elevation.js";

const BASE = {
  argv: ["C:\\Program Files\\MonoField\\MonoField.exe", "monofield://app/"],
  execPath: "C:\\Program Files\\MonoField\\MonoField.exe",
  packaged: true,
  pid: 4242,
  platform: "win32" as const,
};

describe("desktop administrator relaunch", () => {
  it("is unavailable off Windows and in tools-dev", () => {
    expect(createDesktopElevation({ ...BASE, platform: "darwin" })).toBeNull();
    expect(createDesktopElevation({ ...BASE, platform: "linux" })).toBeNull();
    expect(createDesktopElevation({ ...BASE, packaged: false })).toBeNull();
  });

  it("hands the new copy an after-quit wait on this pid and drops a stale one", () => {
    const args = elevatedRelaunchArgs(
      ["monofield://app/", "--od-launcher-after-quit", "--od-launcher-target-pid", "77", "--od-launcher-timeout-ms", "5000"],
      4242,
    );
    expect(args[0]).toBe("monofield://app/");
    expect(parseLauncherAfterQuitArgs(args)).toEqual({ targetPid: 4242, timeoutMs: ELEVATED_RELAUNCH_WAIT_MS });
    expect(args.filter((arg) => arg === "--od-launcher-after-quit")).toHaveLength(1);
    expect(args).not.toContain("77");
  });

  it("starts the same executable through UAC and reports a declined prompt", async () => {
    const launches: Array<{ executable: string; args: readonly string[] }> = [];
    let answer: "accept" | "decline" = "accept";
    const elevation = createDesktopElevation({
      ...BASE,
      isElevated: async () => false,
      launchElevated: async (executable, args) => {
        launches.push({ executable, args });
        return answer === "accept" ? { ok: true } : { ok: false, reason: "declined" };
      },
    });
    expect(await elevation?.relaunch()).toEqual({ ok: true });
    expect(launches[0]?.executable).toBe(BASE.execPath);
    expect(parseLauncherAfterQuitArgs(launches[0]?.args ?? [])?.targetPid).toBe(4242);
    answer = "decline";
    expect(await elevation?.relaunch()).toEqual({ ok: false, reason: "declined" });
  });

  it("does not relaunch an instance that is already elevated", async () => {
    let launched = false;
    const elevation = createDesktopElevation({
      ...BASE,
      isElevated: async () => true,
      launchElevated: async () => {
        launched = true;
        return { ok: true };
      },
    });
    expect(await elevation?.relaunch()).toEqual({ ok: false, reason: "already-elevated" });
    expect(await elevation?.shouldRelaunchAtStartup(async () => true)).toBe(false);
    expect(launched).toBe(false);
  });

  it("relaunches at startup only when Settings asks for it and the probe says not elevated", async () => {
    const notElevated = createDesktopElevation({ ...BASE, isElevated: async () => false });
    expect(await notElevated?.shouldRelaunchAtStartup(async () => true)).toBe(true);
    expect(await notElevated?.shouldRelaunchAtStartup(async () => false)).toBe(false);
    expect(await notElevated?.shouldRelaunchAtStartup(async () => {
      throw new Error("daemon down");
    })).toBe(false);
    const unknown = createDesktopElevation({ ...BASE, isElevated: async () => null });
    expect(await unknown?.shouldRelaunchAtStartup(async () => true)).toBe(false);
  });

  it("reads effective.startElevated from the daemon and treats any failure as no", async () => {
    const reply = (body: unknown, status = 200) =>
      (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await readStartElevatedFromDaemon("http://127.0.0.1:1/", { fetch: reply({ effective: { startElevated: true } }) })).toBe(true);
    expect(await readStartElevatedFromDaemon("http://127.0.0.1:1", { fetch: reply({ effective: { startElevated: false } }) })).toBe(false);
    expect(await readStartElevatedFromDaemon("http://127.0.0.1:1", { fetch: reply({ error: "x" }, 500) })).toBe(false);
    expect(await readStartElevatedFromDaemon(null)).toBe(false);
    const urls: string[] = [];
    await readStartElevatedFromDaemon("http://127.0.0.1:9/", {
      fetch: (async (url: string) => {
        urls.push(url);
        throw new Error("refused");
      }) as unknown as typeof fetch,
    });
    expect(urls).toEqual(["http://127.0.0.1:9/api/execution-permissions"]);
  });
});
