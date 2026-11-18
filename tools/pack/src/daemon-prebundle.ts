import { join } from "node:path";

// The daemon starts some work in worker threads from a file beside the module that starts it
// (`new URL("./worker.js", import.meta.url)`). esbuild leaves such URLs as they are, so a bundled
// daemon has no such files. Each worker is therefore its own prebundle entry, written as
// `<name>.mjs` beside `daemon-cli.mjs`, and the CLI and sidecar entries name that folder in
// OD_DAEMON_WORKER_DIR before the daemon loads. The daemon reads it in `daemonWorkerUrl`
// (apps/daemon/src/daemon-paths.ts); the names below are the ones it asks for.
export const DAEMON_WORKER_DIR_ENV = "OD_DAEMON_WORKER_DIR";

/** Worker name → its module, relative to the daemon's build root. */
export const DAEMON_PREBUNDLE_WORKERS = {
  "java-source-worker": "services/java/source-worker.js",
  "ontology-worker": "services/ontology/worker.js",
} as const;

export interface DaemonPrebundleEntrypoint {
  path: string;
  source: string;
}

export interface DaemonPrebundleEntrypoints {
  cli: DaemonPrebundleEntrypoint;
  sidecar: DaemonPrebundleEntrypoint;
  workers: DaemonPrebundleEntrypoint[];
}

/** The lines every daemon entry runs first: the folder its workers were written to. */
export function renderDaemonWorkerDirPrologue(): string[] {
  return [
    'import { fileURLToPath } from "node:url";',
    `process.env.${DAEMON_WORKER_DIR_ENV} ??= fileURLToPath(new URL(".", import.meta.url));`,
  ];
}

export function renderDaemonPrebundleEntrypoints(options: {
  cliEntrypointPath: string;
  daemonBuildRoot: string;
  entrypointsDir: string;
  sidecarEntrypointPath: string;
  toImportSpecifier: (fromDirectory: string, targetPath: string) => string;
}): DaemonPrebundleEntrypoints {
  const { daemonBuildRoot, entrypointsDir, toImportSpecifier } = options;
  const specifier = (target: string) => JSON.stringify(toImportSpecifier(entrypointsDir, join(daemonBuildRoot, target)));
  return {
    cli: {
      path: options.cliEntrypointPath,
      source: [
        ...renderDaemonWorkerDirPrologue(),
        "const selfPath = fileURLToPath(import.meta.url);",
        "process.env.OD_BIN ??= selfPath;",
        "process.env.OD_DAEMON_CLI_PATH ??= selfPath;",
        `await import(${specifier("cli.js")});`,
        "",
      ].join("\n"),
    },
    sidecar: {
      path: options.sidecarEntrypointPath,
      source: [...renderDaemonWorkerDirPrologue(), `await import(${specifier("sidecar/index.js")});`, ""].join("\n"),
    },
    workers: Object.entries(DAEMON_PREBUNDLE_WORKERS).map(([name, module]) => ({
      path: join(entrypointsDir, `${name}.js`),
      source: `import ${specifier(module)};\n`,
    })),
  };
}
