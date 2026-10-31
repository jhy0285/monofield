import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { parseLauncherAfterQuitArgs, buildLauncherAfterQuitArgs } from "@open-design/launcher-proto";
import { launchWindowsElevated, readWindowsTokenInfo } from "@open-design/platform";

import { createDesktopElevation } from "../../src/main/elevation.js";

/**
 * A fake Windows host for the real spawn path. `whoami.exe` and `powershell.exe`
 * are scripts on PATH, so `execFile` in @open-design/platform runs for real.
 * `powershell.exe` hands the generated command to a real PowerShell (pwsh) with
 * one change: `Start-Process`, the cmdlet that would raise a UAC prompt, is a
 * stand-in that records what it was asked to start and can refuse like a
 * declined prompt. It proves the command's syntax, quoting, exit codes and the
 * data flow through platform and desktop. It does not prove UAC itself.
 */
function findPwsh(): string | null {
  const candidates = [process.env.MONOFIELD_TEST_PWSH, "pwsh"].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "1"], {
      encoding: "utf8",
      env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "1" },
    });
    if (probe.status === 0) return candidate;
  }
  return null;
}

const pwsh = process.platform === "win32" ? null : findPwsh();

const UAC_SHIM = `function Start-Process {
  [CmdletBinding()]
  param([string]$FilePath, [string]$ArgumentList, [string]$Verb)
  [pscustomobject]@{ FilePath = $FilePath; ArgumentList = $ArgumentList; Verb = $Verb } |
    ConvertTo-Json -Compress | Set-Content -LiteralPath $env:FAKE_UAC_LOG -Encoding utf8
  if ($env:FAKE_UAC -eq 'decline') {
    throw [System.InvalidOperationException]::new('This command cannot be run due to the error: The operation was canceled by the user.')
  }
}
`;

const WHOAMI = `#!/usr/bin/env bash
case "$FAKE_WHOAMI" in
  admin)
    printf '%s\\r\\n' '"Everyone","Well-known group","S-1-1-0","Mandatory group, Enabled by default, Enabled group"' \\
      '"BUILTIN\\Administrators","Alias","S-1-5-32-544","Group used for deny only"' \\
      '"Mandatory Label\\Medium Mandatory Level","Label","S-1-16-8192",""' ;;
  standard)
    printf '%s\\r\\n' '"Everyone","Well-known group","S-1-1-0","Mandatory group, Enabled by default, Enabled group"' \\
      '"BUILTIN\\Users","Alias","S-1-5-32-545","Mandatory group, Enabled by default, Enabled group"' \\
      '"Mandatory Label\\Medium Mandatory Level","Label","S-1-16-8192",""' ;;
  elevated)
    printf '%s\\r\\n' '"BUILTIN\\Administrators","Alias","S-1-5-32-544","Mandatory group, Enabled by default, Enabled group, Group owner"' \\
      '"Mandatory Label\\High Mandatory Level","Label","S-1-16-12288",""' ;;
  localized)
    printf '%s\\r\\n' '"BUILTIN\\Administrators","별칭","S-1-5-32-544","거부 전용 그룹"' \\
      '"필수 레이블\\중간 필수 수준","레이블","S-1-16-8192",""' ;;
  broken) echo "whoami failed" >&2; exit 1 ;;
esac
`;

/** The documented CommandLineToArgvW rules: what a Windows process receives for a command-line string. */
function commandLineToArgv(commandLine: string): string[] {
  const argv: string[] = [];
  let index = 0;
  const length = commandLine.length;
  while (index < length) {
    while (index < length && (commandLine[index] === " " || commandLine[index] === "\t")) index += 1;
    if (index >= length) break;
    let current = "";
    let inQuote = false;
    while (index < length) {
      let backslashes = 0;
      while (index < length && commandLine[index] === "\\") {
        backslashes += 1;
        index += 1;
      }
      if (index < length && commandLine[index] === '"') {
        current += "\\".repeat(Math.floor(backslashes / 2));
        if (backslashes % 2 === 1) current += '"';
        else inQuote = !inQuote;
        index += 1;
        continue;
      }
      current += "\\".repeat(backslashes);
      if (index >= length) break;
      if (!inQuote && (commandLine[index] === " " || commandLine[index] === "\t")) break;
      current += commandLine[index];
      index += 1;
    }
    argv.push(current);
  }
  return argv;
}

describe.skipIf(pwsh == null)("elevation on a fake Windows host (real spawn, real PowerShell)", () => {
  let root: string;
  let uacLog: string;
  const saved = { PATH: process.env.PATH, FAKE_WHOAMI: process.env.FAKE_WHOAMI, FAKE_UAC: process.env.FAKE_UAC, FAKE_UAC_LOG: process.env.FAKE_UAC_LOG };
  const EXE = "C:\\Program Files\\Mono'Field\\MonoField.exe";

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "monofield-fake-windows-"));
    const bin = join(root, "bin");
    spawnSync("mkdir", ["-p", bin]);
    const shim = join(root, "uac-shim.ps1");
    writeFileSync(shim, UAC_SHIM, "utf8");
    writeFileSync(
      join(bin, "powershell.exe"),
      `#!/usr/bin/env bash
export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 DOTNET_CLI_TELEMETRY_OPTOUT=1 POWERSHELL_TELEMETRY_OPTOUT=1 POWERSHELL_UPDATECHECK=Off
args=("$@")
last=$(( \${#args[@]} - 1 ))
args[$last]=". '${shim}'; \${args[$last]}"
exec ${JSON.stringify(pwsh)} "\${args[@]}"
`,
      "utf8",
    );
    writeFileSync(join(bin, "whoami.exe"), WHOAMI, "utf8");
    chmodSync(join(bin, "powershell.exe"), 0o755);
    chmodSync(join(bin, "whoami.exe"), 0o755);
    process.env.PATH = `${bin}${delimiter}${saved.PATH ?? ""}`;
    uacLog = join(root, "uac.log");
    process.env.FAKE_UAC_LOG = uacLog;
  });

  beforeEach(() => {
    rmSync(uacLog, { force: true });
    process.env.FAKE_UAC = "accept";
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });

  const recorded = (): { FilePath: string; ArgumentList: string; Verb: string } =>
    JSON.parse(readFileSync(uacLog, "utf8").replace(/^\uFEFF/, ""));

  it("reads the account and elevation state from whoami output, including a translated Windows", async () => {
    const read = async (kind: string) => {
      process.env.FAKE_WHOAMI = kind;
      return readWindowsTokenInfo({ platform: "win32" });
    };
    expect(await read("admin")).toEqual({ elevated: false, administratorAccount: true });
    expect(await read("standard")).toEqual({ elevated: false, administratorAccount: false });
    expect(await read("elevated")).toEqual({ elevated: true, administratorAccount: true });
    // Names are translated on a Korean Windows; the SIDs and the integrity label are not.
    expect(await read("localized")).toEqual({ elevated: false, administratorAccount: true });
    expect(await read("broken")).toEqual({ elevated: null, administratorAccount: null });
  }, 30_000);

  it("hands a real PowerShell a command whose quoting survives for the new process", async () => {
    const args = [
      "monofield://app/",
      "a value",
      "C:\\path with space\\",
      'he said "hi"',
      "",
      "back\\\\slash",
      ...buildLauncherAfterQuitArgs({ targetPid: 4242, timeoutMs: 120_000 }),
    ];
    expect(await launchWindowsElevated(EXE, args, { platform: "win32" })).toEqual({ ok: true });
    const call = recorded();
    expect(call.Verb).toBe("RunAs");
    expect(call.FilePath).toBe(EXE);
    const received = commandLineToArgv(call.ArgumentList);
    expect(received).toEqual(args);
    expect(parseLauncherAfterQuitArgs(received)).toEqual({ targetPid: 4242, timeoutMs: 120_000 });
  }, 60_000);

  it("maps a refused UAC prompt to declined, and a missing PowerShell to failed", async () => {
    process.env.FAKE_UAC = "decline";
    expect(await launchWindowsElevated(EXE, [], { platform: "win32" })).toEqual({ ok: false, reason: "declined" });
    const path = process.env.PATH;
    process.env.PATH = "/usr/bin:/bin";
    try {
      const result = await launchWindowsElevated(EXE, [], { platform: "win32" });
      expect(result).toMatchObject({ ok: false, reason: "failed" });
    } finally {
      process.env.PATH = path;
    }
  }, 60_000);

  it("lets the desktop restart an administrator account, and only that account", async () => {
    const make = () =>
      createDesktopElevation({
        argv: ["C:\\MonoField\\MonoField.exe", "monofield://app/"],
        execPath: EXE,
        packaged: true,
        pid: 777,
        platform: "win32",
      });

    process.env.FAKE_WHOAMI = "admin";
    const admin = make();
    expect(await admin?.shouldRelaunchAtStartup(async () => true)).toBe(true);
    expect(await admin?.relaunch()).toEqual({ ok: true });
    const received = commandLineToArgv(recorded().ArgumentList);
    expect(received[0]).toBe("monofield://app/");
    expect(parseLauncherAfterQuitArgs(received)?.targetPid).toBe(777);

    rmSync(uacLog, { force: true });
    process.env.FAKE_WHOAMI = "standard";
    const standard = make();
    expect(await standard?.shouldRelaunchAtStartup(async () => true)).toBe(false);
    expect(await standard?.relaunch()).toEqual({ ok: false, reason: "not-administrator" });
    // UAC was never asked: the stand-in did not run.
    expect(() => readFileSync(uacLog)).toThrow();

    process.env.FAKE_WHOAMI = "elevated";
    const elevated = make();
    expect(await elevated?.shouldRelaunchAtStartup(async () => true)).toBe(false);
    expect(await elevated?.relaunch()).toEqual({ ok: false, reason: "already-elevated" });

    process.env.FAKE_WHOAMI = "admin";
    process.env.FAKE_UAC = "decline";
    expect(await make()?.relaunch()).toEqual({ ok: false, reason: "declined" });
  }, 90_000);
});
