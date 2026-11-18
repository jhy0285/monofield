import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { describe, expect, it } from "vitest";

import { MAC_PREBUNDLE_POLICIES } from "../src/mac-prebundle.js";
import { VUE_SFC_TEMPLATE_ENGINE_EXTERNALS } from "../src/prebundle-externals.js";
import { findForbiddenWinPrebundleInputs, WIN_PREBUNDLE_POLICIES } from "../src/win-prebundle.js";

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const daemonRequire = createRequire(join(workspaceRoot, "apps", "daemon", "package.json"));

async function bundleVueCompiler(external: readonly string[]) {
  return build({
    absWorkingDir: workspaceRoot,
    bundle: true,
    entryPoints: [daemonRequire.resolve("@vue/compiler-sfc")],
    external: [...external],
    format: "esm",
    logLevel: "silent",
    metafile: true,
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
    const inputs = Object.keys(result.metafile.inputs);
    for (const policy of [
      WIN_PREBUNDLE_POLICIES.daemonSidecar,
      WIN_PREBUNDLE_POLICIES.daemonCli,
      MAC_PREBUNDLE_POLICIES.daemonSidecar,
      MAC_PREBUNDLE_POLICIES.daemonCli,
    ]) {
      expect(findForbiddenWinPrebundleInputs({ forbiddenInputs: policy.forbiddenInputs, inputs })).toEqual([]);
    }
  }, 60_000);

  it("keeps lodash bundled, because external packages take their subpaths with them", () => {
    expect(VUE_SFC_TEMPLATE_ENGINE_EXTERNALS).not.toContain("lodash");
  });
});
