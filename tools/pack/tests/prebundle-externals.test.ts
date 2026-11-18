import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { describe, expect, it } from "vitest";

import { VUE_SFC_TEMPLATE_ENGINE_EXTERNALS } from "../src/prebundle-externals.js";

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const daemonRequire = createRequire(join(workspaceRoot, "apps", "daemon", "package.json"));

async function bundleVueCompiler(external: readonly string[]) {
  return build({
    bundle: true,
    entryPoints: [daemonRequire.resolve("@vue/compiler-sfc")],
    external: [...external],
    format: "esm",
    logLevel: "silent",
    platform: "node",
    target: "node24",
    write: false,
  });
}

describe("prebundle externals", () => {
  it("lets the daemon's Vue compiler bundle without its optional template engines", async () => {
    await expect(bundleVueCompiler([])).rejects.toThrow(/Could not resolve "velocityjs"/);
    const result = await bundleVueCompiler(VUE_SFC_TEMPLATE_ENGINE_EXTERNALS);
    expect(result.errors).toEqual([]);
  }, 60_000);
});
