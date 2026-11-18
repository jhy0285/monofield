import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";

import {
  DAEMON_PREBUNDLE_WORKERS,
  DAEMON_WORKER_DIR_ENV,
  renderDaemonPrebundleEntrypoints,
  renderDaemonWorkerDirPrologue,
} from "../src/daemon-prebundle.js";
import { VUE_SFC_TEMPLATE_ENGINE_EXTERNALS } from "../src/prebundle-externals.js";
import { toRelativeImportSpecifier } from "../src/win/app.js";
import { WIN_PREBUNDLE_ESM_REQUIRE_BANNER } from "../src/win-prebundle.js";

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const daemonSource = join(workspaceRoot, "apps", "daemon", "src");
const cleanup: string[] = [];

afterEach(async () => {
  delete process.env[DAEMON_WORKER_DIR_ENV];
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

function render(entrypointsDir: string) {
  return renderDaemonPrebundleEntrypoints({
    cliEntrypointPath: join(entrypointsDir, "daemon-cli.js"),
    daemonBuildRoot: daemonSource,
    entrypointsDir,
    sidecarEntrypointPath: join(entrypointsDir, "daemon-sidecar.js"),
    toImportSpecifier: toRelativeImportSpecifier,
  });
}

describe("daemon prebundle entries", () => {
  it("names the worker folder before the daemon loads, and makes every worker an entry", () => {
    const entries = render(join(workspaceRoot, ".tmp", "entries"));
    for (const entry of [entries.cli, entries.sidecar]) {
      const lines = entry.source.split("\n");
      const named = lines.findIndex((line) => line.startsWith(`process.env.${DAEMON_WORKER_DIR_ENV} ??=`));
      const loaded = lines.findIndex((line) => line.startsWith("await import("));
      expect(named).toBeGreaterThanOrEqual(0);
      expect(loaded).toBeGreaterThan(named);
    }
    expect(entries.cli.source).toContain("process.env.OD_DAEMON_CLI_PATH ??= selfPath;");
    expect(entries.workers.map((entry) => entry.path.split(/[\\/]/).at(-1))).toEqual(
      Object.keys(DAEMON_PREBUNDLE_WORKERS).map((name) => `${name}.js`),
    );
  });

  it("runs the code-ontology and Java source workers from a bundle laid out like the packaged one", async () => {
    const root = await mkdtemp(join(tmpdir(), "od-daemon-prebundle-"));
    cleanup.push(root);
    const entrypointsDir = join(root, "entries");
    const outdir = join(root, "bundle");
    await mkdir(entrypointsDir, { recursive: true });
    const entries = render(entrypointsDir);
    const host = join(entrypointsDir, "host.js");
    const module = (path: string) => JSON.stringify(toRelativeImportSpecifier(entrypointsDir, join(daemonSource, path)));
    await writeFile(host, [
      ...renderDaemonWorkerDirPrologue(),
      `const ontology = await import(${module("services/code-ontology.js")});`,
      `const java = await import(${module("services/java/source-info.js")});`,
      "export const buildCodeOntology = ontology.buildCodeOntology;",
      "export const javaBreakpointClass = java.javaBreakpointClass;",
      "",
    ].join("\n"));
    for (const entry of entries.workers) await writeFile(entry.path, entry.source);

    await build({
      banner: { js: WIN_PREBUNDLE_ESM_REQUIRE_BANNER },
      bundle: true,
      chunkNames: "chunks/[name]-[hash]",
      entryNames: "[name]",
      entryPoints: [host, ...entries.workers.map((entry) => entry.path)],
      external: [...VUE_SFC_TEMPLATE_ENGINE_EXTERNALS],
      format: "esm",
      logLevel: "silent",
      outExtension: { ".js": ".mjs" },
      outdir,
      platform: "node",
      splitting: true,
      target: "node24",
    });

    const project = join(root, "project");
    await mkdir(join(project, "src"), { recursive: true });
    await writeFile(join(project, "src", "Orders.vue"),
      '<template><OrderTable /></template>\n<script setup lang="ts">\nconst total = 1;\n</script>\n');
    await writeFile(join(project, "src", "OrderController.java"),
      "package shop;\npublic class OrderController {\n  public int total() { return 1; }\n}\n");

    const bundled = await import(pathToFileURL(join(outdir, "host.mjs")).href) as {
      buildCodeOntology: (dataDir: string, projectId: string, root: string, projectPath: string,
        businessFiles: string[], request: string) => Promise<{ nodes: Array<{ kind: string; label: string }> }>;
      javaBreakpointClass: (file: string, text: string) => Promise<string>;
    };
    const ontology = await bundled.buildCodeOntology(join(root, "data"), "probe", project, ".", [], "");
    expect(ontology.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "screen", label: "Orders.vue" }),
      expect.objectContaining({ kind: "class" }),
    ]));
    await expect(bundled.javaBreakpointClass("src/OrderController.java",
      "package shop;\npublic class OrderController {}\n")).resolves.toContain("OrderController");
  }, 60_000);
});
