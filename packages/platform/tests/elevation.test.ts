import { describe, expect, it } from "vitest";

import {
  buildWindowsElevatedLaunchArgs,
  isWindowsProcessElevated,
  launchWindowsElevated,
  parseWindowsWhoamiGroupsElevation,
} from "../src/index.js";

const MEDIUM_GROUPS = [
  '"Everyone","Well-known group","S-1-1-0","Mandatory group, Enabled by default, Enabled group"',
  '"BUILTIN\\Administrators","Alias","S-1-5-32-544","Group used for deny only"',
  '"Mandatory Label\\Medium Mandatory Level","Label","S-1-16-8192",""',
].join("\r\n");

const HIGH_GROUPS = [
  '"Everyone","Well-known group","S-1-1-0","Mandatory group, Enabled by default, Enabled group"',
  '"BUILTIN\\Administrators","Alias","S-1-5-32-544","Mandatory group, Enabled by default, Enabled group, Group owner"',
  '"Mandatory Label\\High Mandatory Level","Label","S-1-16-12288",""',
].join("\r\n");

describe("Windows elevation probe", () => {
  it("reads the integrity label from whoami /groups", () => {
    expect(parseWindowsWhoamiGroupsElevation(HIGH_GROUPS)).toBe(true);
    expect(parseWindowsWhoamiGroupsElevation(MEDIUM_GROUPS)).toBe(false);
    expect(parseWindowsWhoamiGroupsElevation('"Mandatory Label\\System Mandatory Level","Label","S-1-16-16384",""')).toBe(true);
    expect(parseWindowsWhoamiGroupsElevation("")).toBeNull();
  });

  it("does not count an administrators group used for deny only as elevation", () => {
    // A filtered admin token still lists BUILTIN\Administrators; only the label decides.
    expect(MEDIUM_GROUPS).toContain("S-1-5-32-544");
    expect(parseWindowsWhoamiGroupsElevation(MEDIUM_GROUPS)).toBe(false);
  });

  it("answers null off Windows and when the probe fails", async () => {
    let calls = 0;
    const run = async () => {
      calls += 1;
      return HIGH_GROUPS;
    };
    expect(await isWindowsProcessElevated({ platform: "linux", run })).toBeNull();
    expect(await isWindowsProcessElevated({ platform: "darwin", run })).toBeNull();
    expect(calls).toBe(0);
    expect(await isWindowsProcessElevated({ platform: "win32", run })).toBe(true);
    expect(await isWindowsProcessElevated({
      platform: "win32",
      run: async () => {
        throw new Error("whoami missing");
      },
    })).toBeNull();
  });
});

describe("Windows elevated launch", () => {
  it("asks UAC through Start-Process -Verb RunAs with quoted literals", () => {
    const args = buildWindowsElevatedLaunchArgs("C:\\Program Files\\Mono'Field\\MonoField.exe", [
      "--launcher-after-quit",
      "--launcher-after-quit-target-pid",
      "4242",
      "a value",
    ]);
    const script = args.at(-1) ?? "";
    expect(args.slice(0, 5)).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"]);
    expect(script).toContain("-FilePath 'C:\\Program Files\\Mono''Field\\MonoField.exe'");
    expect(script).toContain("-ArgumentList '--launcher-after-quit --launcher-after-quit-target-pid 4242 \"a value\"'");
    expect(script).toContain("-Verb RunAs");
    expect(script).toContain("catch { exit 1 }");
  });

  it("omits -ArgumentList when there are no arguments and rejects an empty path", () => {
    expect(buildWindowsElevatedLaunchArgs("C:\\MonoField.exe").at(-1)).not.toContain("-ArgumentList");
    expect(() => buildWindowsElevatedLaunchArgs("  ")).toThrow(/executable/);
  });

  it("reports a declined prompt separately from a failure", async () => {
    expect(await launchWindowsElevated("C:\\MonoField.exe", [], { platform: "linux" })).toEqual({
      ok: false,
      reason: "unsupported-platform",
    });
    expect(await launchWindowsElevated("C:\\MonoField.exe", [], { platform: "win32", run: async () => "" })).toEqual({ ok: true });
    expect(await launchWindowsElevated("C:\\MonoField.exe", [], {
      platform: "win32",
      run: async () => {
        throw Object.assign(new Error("Command failed"), { code: 1 });
      },
    })).toEqual({ ok: false, reason: "declined" });
    const failed = await launchWindowsElevated("C:\\MonoField.exe", [], {
      platform: "win32",
      run: async () => {
        throw Object.assign(new Error("spawn powershell.exe ENOENT"), { code: "ENOENT" });
      },
    });
    expect(failed).toMatchObject({ ok: false, reason: "failed" });
  });
});
