import { copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const fixtureRoots: string[] = [];

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("workspace artifact cleanup script", () => {
  it.runIf(process.platform === "win32")(
    "removes only approved artifact trees and unlinks nested junctions without traversing them",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "monofield-workspace-cleanup-test-"));
      fixtureRoots.push(root);
      const scriptDirectory = join(root, "tools", "release", "scripts");
      await mkdir(scriptDirectory, { recursive: true });
      await mkdir(join(root, ".git"));
      await mkdir(join(root, ".tmp"));
      await mkdir(join(root, ".playwright-cli"));
      await mkdir(join(root, ".tmp-keep"));
      await mkdir(join(root, "outside-link-target"));
      await writeFile(join(root, "package.json"), JSON.stringify({ name: "monofield", private: true }));
      await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []\n");
      await writeFile(join(root, ".tmp", "artifact.txt"), "temporary");
      await writeFile(join(root, ".playwright-cli", "capture.png"), "temporary");
      await writeFile(join(root, ".tmp-keep", "source.txt"), "keep");
      await writeFile(join(root, "outside-link-target", "must-survive.txt"), "outside");
      const nestedJunction = join(root, ".tmp", "tools-dev", "default", "web", "node_modules");
      await mkdir(join(root, ".tmp", "tools-dev", "default", "web"), { recursive: true });
      await symlink(join(root, "outside-link-target"), nestedJunction, "junction");

      const sourceScript = new URL("../../release/scripts/cleanup-monofield-workspace-artifacts.ps1", import.meta.url);
      const fixtureScript = join(scriptDirectory, "cleanup-monofield-workspace-artifacts.ps1");
      await copyFile(sourceScript, fixtureScript);

      const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixtureScript, "-WorkspaceRoot", root, "-DryRun"],
        { encoding: "utf8" },
      );

      expect(result.status, result.stderr).toBe(0);
      const report = JSON.parse(result.stdout) as {
        approvedTargets: string[];
        deletedCount: number;
        dryRun: boolean;
        freedBytes: number;
        planned: string[];
        plannedCount: number;
        nestedReparsePointCount: number;
        nestedReparsePoints: Array<{ directory: boolean; path: string; target: string }>;
      };
      expect(report).toMatchObject({
        approvedTargets: [".tmp", ".playwright-cli"],
        deletedCount: 0,
        dryRun: true,
        freedBytes: 0,
        nestedReparsePointCount: 1,
        plannedCount: 2,
      });
      expect(report.planned).toEqual([join(root, ".tmp"), join(root, ".playwright-cli")]);
      expect(report.nestedReparsePoints).toEqual([
        { directory: true, path: nestedJunction, target: join(root, ".tmp") },
      ]);
      await expect(readFile(join(root, ".tmp", "artifact.txt"), "utf8")).resolves.toBe("temporary");
      await expect(readFile(join(root, ".tmp-keep", "source.txt"), "utf8")).resolves.toBe("keep");
      await expect(readFile(join(root, "outside-link-target", "must-survive.txt"), "utf8")).resolves.toBe("outside");

      const cleanup = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixtureScript, "-WorkspaceRoot", root],
        { encoding: "utf8" },
      );
      expect(cleanup.status, cleanup.stderr).toBe(0);
      const cleanupReport = JSON.parse(cleanup.stdout) as {
        deletedCount: number;
        failedCount: number;
        removedNestedReparsePointCount: number;
        removedNestedReparsePoints: string[];
      };
      expect(cleanupReport).toMatchObject({
        deletedCount: 2,
        failedCount: 0,
        removedNestedReparsePointCount: 1,
      });
      expect(cleanupReport.removedNestedReparsePoints).toEqual([nestedJunction]);
      await expect(stat(join(root, ".tmp"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(join(root, ".playwright-cli"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(root, ".tmp-keep", "source.txt"), "utf8")).resolves.toBe("keep");
      await expect(readFile(join(root, "outside-link-target", "must-survive.txt"), "utf8")).resolves.toBe("outside");
    },
  );
});
