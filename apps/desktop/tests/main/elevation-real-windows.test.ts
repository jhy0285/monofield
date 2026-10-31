import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildLauncherAfterQuitArgs, parseLauncherAfterQuitArgs } from "@open-design/launcher-proto";
import { launchWindowsElevated, readWindowsTokenInfo } from "@open-design/platform";

import { createDesktopElevation } from "../../src/main/elevation.js";

/**
 * Runs only on Windows (CI: the windows-latest job). Nothing is faked: the real
 * whoami.exe, the real Windows PowerShell and a real `Start-Process -Verb RunAs`
 * start a real process, which records the argv Windows handed it. A CI runner is
 * already an elevated administrator with no UAC prompt, so the prompt itself
 * (and a declined prompt) still needs a person at a desktop.
 */
describe.skipIf(process.platform !== "win32")("elevation on a real Windows host", () => {
  let root: string;
  let exe: string;
  let recorder: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "monofield elevation "));
    const appDir = join(root, "Mono'Field App");
    mkdirSync(appDir);
    // A copy of node.exe stands in for MonoField.exe, so the started process can
    // report what it received.
    exe = join(appDir, "MonoField.exe");
    copyFileSync(process.execPath, exe);
    recorder = join(root, "record argv.cjs");
    writeFileSync(
      recorder,
      "require('node:fs').writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));\n",
      "utf8",
    );
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reads the account and elevation state from the real whoami", async () => {
    const raw = execFileSync("whoami.exe", ["/groups", "/fo", "csv", "/nh"], { encoding: "utf8" });
    const version = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString()"],
      { encoding: "utf8" },
    ).trim();
    const token = await readWindowsTokenInfo();
    console.info("[real windows] powershell.exe", version, "token", JSON.stringify(token));
    console.info("[real windows] whoami /groups rows with S-1-16- or S-1-5-32-544:\n" +
      raw.split(/\r?\n/).filter((row) => /S-1-16-|S-1-5-32-544/.test(row)).join("\n"));
    // GitHub's Windows runners run as an administrator; the label tells elevated from filtered.
    expect(token.administratorAccount).toBe(true);
    expect(token.elevated).not.toBeNull();
    expect(raw).toMatch(/S-1-16-\d+/);
  }, 60_000);

  it("starts a real process through Windows PowerShell with every argument intact", async () => {
    const out = join(root, "argv.json");
    const passed = [
      "monofield://app/",
      "a value",
      "C:\\path with space\\",
      'he said "hi"',
      "",
      "back\\\\slash",
      ...buildLauncherAfterQuitArgs({ targetPid: 4242, timeoutMs: 120_000 }),
    ];
    const result = await launchWindowsElevated(exe, [recorder, out, ...passed]);
    expect(result).toEqual({ ok: true });
    for (let waited = 0; !existsSync(out) && waited < 30_000; waited += 250) await sleep(250);
    const received = JSON.parse(readFileSync(out, "utf8")) as string[];
    expect(received).toEqual(passed);
    expect(parseLauncherAfterQuitArgs(received)).toEqual({ targetPid: 4242, timeoutMs: 120_000 });
  }, 90_000);

  it("reports a missing executable as a failure, not a declined prompt", async () => {
    const gone = join(root, "gone", "MonoField.exe");
    expect(await launchWindowsElevated(gone, [])).toEqual({
      ok: false,
      reason: "failed",
      detail: `executable not found: ${gone}`,
    });
  }, 60_000);

  it("lets the desktop leave an already elevated process alone", async () => {
    const token = await readWindowsTokenInfo();
    const elevation = createDesktopElevation({
      argv: [exe],
      execPath: exe,
      packaged: true,
      pid: process.pid,
      platform: "win32",
    });
    if (token.elevated === true) {
      expect(await elevation?.relaunch()).toEqual({ ok: false, reason: "already-elevated" });
      expect(await elevation?.shouldRelaunchAtStartup(async () => true)).toBe(false);
    } else {
      // A non-elevated administrator would be asked; that needs a person at a desktop.
      expect(await elevation?.shouldRelaunchAtStartup(async () => true)).toBe(token.administratorAccount === true);
    }
  }, 60_000);
});
