import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";

import { resolveWorkingDirectoryPickerDefaultPath } from "../../src/main/runtime.js";

describe("working-directory picker start path", () => {
  it("prefers an explicitly chosen recent directory after validating it", () => {
    const homePath = resolve("home", "ada");
    const desktopPath = join(homePath, "Desktop");
    const recentPath = resolve("code", "recent");
    const existing = new Set([desktopPath, recentPath]);

    expect(resolveWorkingDirectoryPickerDefaultPath({
      homePath,
      lastSelectedPath: desktopPath,
      suggestedPath: recentPath,
      pathExists: (candidate) => existing.has(candidate),
    })).toBe(recentPath);
  });

  it("reuses only the last directory selected by the working-directory picker", () => {
    const existing = new Set(["C:\\Users\\Ada\\Desktop", "D:\\code\\app"]);

    expect(resolveWorkingDirectoryPickerDefaultPath({
      homePath: "C:\\Users\\Ada",
      lastSelectedPath: "D:\\code\\app",
      pathExists: (candidate) => existing.has(candidate),
    })).toBe("D:\\code\\app");
  });

  it("starts on Desktop when no working directory has been selected yet", () => {
    const homePath = join("home", "ada");
    const desktopPath = join(homePath, "Desktop");
    const existing = new Set([homePath, desktopPath]);

    expect(resolveWorkingDirectoryPickerDefaultPath({
      homePath,
      pathExists: (candidate) => existing.has(candidate),
    })).toBe(desktopPath);
  });

  it("falls back to the home directory when Desktop is unavailable", () => {
    const homePath = join("home", "ada");
    expect(resolveWorkingDirectoryPickerDefaultPath({
      homePath,
      pathExists: (candidate) => candidate === homePath,
    })).toBe(homePath);
  });
});
