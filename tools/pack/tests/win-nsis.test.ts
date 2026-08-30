import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { stageNsisInvocation } from "../src/win/nsis.js";

const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function createFixture(): Promise<{ localAppData: string; root: string; setupPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "monofield-nsis-stage-test-"));
  cleanupRoots.push(root);
  const localAppData = join(root, "local-app-data");
  const setupPath = join(root, "network-output", "MonoField-default-setup.exe");
  await mkdir(dirname(setupPath), { recursive: true });
  await writeFile(setupPath, Buffer.from("byte-identical-nsis-fixture"));
  return { localAppData, root, setupPath };
}

describe("stageNsisInvocation", () => {
  it("copies Windows installers beneath LOCALAPPDATA and preserves bytes and CRC validation args", async () => {
    const fixture = await createFixture();
    const invocation = await stageNsisInvocation(
      fixture.setupPath,
      ["/S", "/D=D:\\runtime\\MonoField"],
      "install",
      {
        env: { LOCALAPPDATA: fixture.localAppData, TEMP: "D:\\remote-temp", TMP: "D:\\remote-temp" },
        platform: "win32",
      },
    );

    expect(invocation.staged).toBe(true);
    expect(invocation.command).toMatch(
      new RegExp(`^${join(fixture.localAppData, "Temp", "monofield-nsis-").replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}`),
    );
    expect(invocation.command).toMatch(/MonoField-default-setup\.exe$/);
    expect(invocation.args).toEqual(["/S", "/D=D:\\runtime\\MonoField"]);
    expect(invocation.args).not.toContain("/NCRC");
    const stagedRoot = dirname(invocation.command);
    expect(invocation.env).toMatchObject({
      TEMP: stagedRoot,
      TMP: stagedRoot,
      TMPDIR: stagedRoot,
    });
    expect(await readFile(invocation.command)).toEqual(await readFile(fixture.setupPath));
    expect(invocation.sha256).toBe(
      createHash("sha256").update(await readFile(fixture.setupPath)).digest("hex"),
    );

    await mkdir(join(stagedRoot, "nsis-extraction-residue"), { recursive: true });
    await writeFile(join(stagedRoot, "nsis-extraction-residue", "payload.bin"), "temporary");
    await invocation.cleanup();
    await expect(readFile(invocation.command)).rejects.toThrow();
    await expect(readFile(stagedRoot)).rejects.toThrow();
  });

  it("keeps a staged uninstaller bound to its original install directory", async () => {
    const fixture = await createFixture();
    const uninstallerPath = join(fixture.root, "installed app", "Uninstall MonoField.exe");
    await mkdir(dirname(uninstallerPath), { recursive: true });
    await writeFile(uninstallerPath, Buffer.from("uninstaller"));

    const invocation = await stageNsisInvocation(uninstallerPath, ["/S"], "uninstall", {
      env: { LOCALAPPDATA: fixture.localAppData },
      platform: "win32",
    });

    expect(invocation.args).toEqual(["/S", `_?=${dirname(uninstallerPath)}`]);
    expect(invocation.args.at(-1)).not.toContain('"');
    await invocation.cleanup();
  });

  it("does not stage non-Windows lifecycle commands", async () => {
    const invocation = await stageNsisInvocation("/tmp/setup", ["--silent"], "install", {
      env: {},
      platform: "linux",
    });

    expect(invocation).toMatchObject({
      args: ["--silent"],
      command: "/tmp/setup",
      staged: false,
    });
    await invocation.cleanup();
  });

  it("fails closed when Windows has no local application data root", async () => {
    await expect(stageNsisInvocation("D:\\setup.exe", ["/S"], "install", {
      env: { TEMP: "D:\\remote-temp" },
      platform: "win32",
    })).rejects.toThrow("requires LOCALAPPDATA");
  });
});
