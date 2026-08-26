import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  OPEN_DESIGN_SIDECAR_CONTRACT,
  SIDECAR_DEFAULTS,
} from "@open-design/sidecar-proto";
import { resolveNamespace } from "@open-design/sidecar";
import { releaseChannelFromVersion, releaseNamespace } from "@open-design/release";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const WORKSPACE_ROOT = resolve(__dirname, "../../..");

export type ToolPackPlatform = "mac" | "win" | "linux";
export type ToolPackBuildOutput = "all" | "app" | "appimage" | "dir" | "dmg" | "nsis" | "store" | "zip";
export type ToolPackMacCompression = "store" | "normal" | "maximum";
export type ToolPackWebOutputMode = "server" | "standalone";
export type ToolPackAmrProfile = "prod" | "test" | "local";

export type ToolPackCliOptions = {
  appVersion?: string;
  cacheDir?: string;
  containerized?: boolean;
  dir?: string;
  diagnoseAttempts?: string | number;
  expectedVersion?: string;
  expr?: string;
  headless?: boolean;
  json?: boolean;
  macCompression?: string;
  notarize?: boolean;
  namespace?: string;
  path?: string;
  payloadPath?: string;
  portable?: boolean;
  removeCache?: boolean;
  removeData?: boolean;
  removeLogs?: boolean;
  removeProductUserData?: boolean;
  removeSidecars?: boolean;
  requireVelaCli?: boolean;
  signed?: boolean;
  silent?: boolean;
  statusPollCount?: string | number;
  statusPollIntervalMs?: string | number;
  to?: string;
  updateAction?: string;
};

export type ToolPackRoots = {
  output: {
    appBuilderRoot: string;
    namespaceRoot: string;
    platformRoot: string;
    root: string;
  };
  runtime: {
    namespaceBaseRoot: string;
    namespaceRoot: string;
  };
  cacheRoot: string;
  toolPackRoot: string;
};

export type ToolPackConfig = {
  appVersion?: string;
  containerized: boolean;
  electronBuilderCliPath: string;
  electronDistPath: string;
  electronVersion: string;
  macCompression: ToolPackMacCompression;
  macNotarize?: boolean;
  namespace: string;
  platform: ToolPackPlatform;
  portable: boolean;
  removeCache?: boolean;
  removeData: boolean;
  removeLogs: boolean;
  removeProductUserData: boolean;
  removeSidecars: boolean;
  requireVelaCli: boolean;
  roots: ToolPackRoots;
  silent: boolean;
  signed: boolean;
  amrProfile?: ToolPackAmrProfile;
  updateMetadataUrl?: string;
  to: ToolPackBuildOutput;
  webOutputMode: ToolPackWebOutputMode;
  windowsStoreIdentity?: ToolPackWindowsStoreIdentity;
  workspaceRoot: string;
};

export type ToolPackWindowsStoreIdentity = {
  identityName: string;
  publisher: string;
  publisherDisplayName: string;
};

function resolveToolPackBuildOutput(platform: ToolPackPlatform, value: string | undefined): ToolPackBuildOutput {
  if (value == null || value.length === 0) return platform === "win" ? "nsis" : "all";
  if (platform === "mac" && (value === "all" || value === "app" || value === "dmg" || value === "zip")) return value;
  if (platform === "win" && (value === "all" || value === "dir" || value === "nsis" || value === "store" || value === "zip")) return value;
  if (platform === "linux" && (value === "all" || value === "appimage" || value === "dir")) return value;
  throw new Error(`unsupported ${platform} --to target: ${value}`);
}

function requireWindowsStoreEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (value == null || value.length === 0) {
    throw new Error(`${name} is required for tools-pack win build --to store; copy the exact value from Partner Center > Product identity`);
  }
  return value;
}

function resolveWindowsStoreIdentity(
  platform: ToolPackPlatform,
  to: ToolPackBuildOutput,
): ToolPackWindowsStoreIdentity | undefined {
  if (platform !== "win" || to !== "store") return undefined;
  const identityName = requireWindowsStoreEnvironment("MONOFIELD_WINDOWS_STORE_IDENTITY_NAME");
  if (!/^[A-Za-z0-9.-]{3,50}$/.test(identityName)) {
    throw new Error("MONOFIELD_WINDOWS_STORE_IDENTITY_NAME must be 3-50 characters using letters, numbers, periods, or hyphens");
  }
  const publisher = requireWindowsStoreEnvironment("MONOFIELD_WINDOWS_STORE_PUBLISHER");
  if (!/^CN=.+/i.test(publisher)) {
    throw new Error("MONOFIELD_WINDOWS_STORE_PUBLISHER must be the exact Partner Center Publisher value and begin with CN=");
  }
  return {
    identityName,
    publisher,
    publisherDisplayName: requireWindowsStoreEnvironment("MONOFIELD_WINDOWS_STORE_PUBLISHER_DISPLAY_NAME"),
  };
}

function resolveToolPackMacCompression(value: string | undefined): ToolPackMacCompression {
  if (value == null || value.length === 0) return "normal";
  if (value === "store" || value === "normal" || value === "maximum") return value;
  throw new Error(`unsupported mac --mac-compression value: ${value}`);
}

function resolveToolPackAppVersion(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error("--app-version must not be empty");
  if (/\s/.test(normalized)) throw new Error(`--app-version must not contain whitespace: ${value}`);
  return normalized;
}

function defaultNamespaceForAppVersion(platform: ToolPackPlatform, appVersion: string | undefined): string {
  const channel = releaseChannelFromVersion(appVersion);
  if (channel == null) return SIDECAR_DEFAULTS.namespace;

  return releaseNamespace(channel, platform);
}

function resolveToolPackWebOutputMode(platform: ToolPackPlatform, value: string | undefined): ToolPackWebOutputMode {
  // Standalone web output is wired for desktop packaged platforms; Linux stays on
  // the existing server output until its AppImage resource path is optimized.
  if (platform === "linux") return "server";
  if (value == null || value.length === 0) return "standalone";
  if (value === "server" || value === "standalone") return value;
  throw new Error(`unsupported OD_WEB_OUTPUT_MODE value: ${value}`);
}

function resolveToolPackAmrProfile(value: string | undefined): ToolPackAmrProfile | undefined {
  if (value == null) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  if (normalized === "prod" || normalized === "test" || normalized === "local") return normalized;
  throw new Error(`OPEN_DESIGN_AMR_PROFILE must be prod, test, or local: ${value}`);
}

function resolveToolPackUpdateMetadataUrl(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`OD_UPDATE_METADATA_URL must be an absolute URL: ${value}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`OD_UPDATE_METADATA_URL must use http(s): ${value}`);
  }
  return normalized;
}

function resolveElectronVersion(workspaceRoot: string): string {
  const require = createRequire(join(workspaceRoot, "apps/desktop/package.json"));
  const desktopPackage = require(join(workspaceRoot, "apps/desktop/package.json")) as {
    devDependencies?: Record<string, string>;
  };
  const version = desktopPackage.devDependencies?.electron;
  if (version == null || version.length === 0) {
    throw new Error("apps/desktop/package.json must declare electron");
  }
  return version;
}

function resolveElectronDistPath(workspaceRoot: string): string {
  const require = createRequire(join(workspaceRoot, "apps/desktop/package.json"));
  const electronEntry = require.resolve("electron");
  return join(path.dirname(electronEntry), "dist");
}

function resolveElectronBuilderCliPath(): string {
  const require = createRequire(import.meta.url);
  return require.resolve("electron-builder/out/cli/cli.js");
}

export function resolveToolPackConfig(
  platform: ToolPackPlatform,
  options: ToolPackCliOptions = {},
): ToolPackConfig {
  const appVersion = resolveToolPackAppVersion(options.appVersion);
  const namespace = resolveNamespace({
    contract: OPEN_DESIGN_SIDECAR_CONTRACT,
    env: process.env,
    namespace: options.namespace ?? defaultNamespaceForAppVersion(platform, appVersion),
  });
  const defaultToolPackRoot = join(WORKSPACE_ROOT, ".tmp", "tools-pack");
  const toolPackRoot = resolve(options.dir ?? defaultToolPackRoot);
  const cacheRoot = resolve(options.cacheDir ?? join(defaultToolPackRoot, "cache"));
  const outputRoot = join(toolPackRoot, "out");
  const outputPlatformRoot = join(outputRoot, platform);
  const outputNamespaceRoot = join(outputPlatformRoot, "namespaces", namespace);
  const runtimeNamespaceBaseRoot = join(toolPackRoot, "runtime", platform, "namespaces");
  const to = resolveToolPackBuildOutput(platform, options.to);

  return {
    appVersion,
    containerized: options.containerized === true,
    electronBuilderCliPath: resolveElectronBuilderCliPath(),
    electronDistPath: resolveElectronDistPath(WORKSPACE_ROOT),
    electronVersion: resolveElectronVersion(WORKSPACE_ROOT),
    macCompression: resolveToolPackMacCompression(options.macCompression),
    macNotarize: options.notarize === true,
    namespace,
    platform,
    portable: options.portable === true,
    roots: {
      output: {
        appBuilderRoot: join(outputNamespaceRoot, "builder"),
        namespaceRoot: outputNamespaceRoot,
        platformRoot: outputPlatformRoot,
        root: outputRoot,
      },
      runtime: {
        namespaceBaseRoot: runtimeNamespaceBaseRoot,
        namespaceRoot: join(runtimeNamespaceBaseRoot, namespace),
      },
      cacheRoot,
      toolPackRoot,
    },
    removeCache: options.removeCache === true,
    removeData: options.removeData === true,
    removeLogs: options.removeLogs === true,
    removeProductUserData: options.removeProductUserData === true,
    removeSidecars: options.removeSidecars === true,
    requireVelaCli: options.requireVelaCli === true,
    silent: options.silent !== false,
    signed: options.signed === true,
    amrProfile: resolveToolPackAmrProfile(process.env.OPEN_DESIGN_AMR_PROFILE),
    updateMetadataUrl: resolveToolPackUpdateMetadataUrl(process.env.OD_UPDATE_METADATA_URL),
    to,
    webOutputMode: resolveToolPackWebOutputMode(platform, process.env.OD_WEB_OUTPUT_MODE),
    windowsStoreIdentity: resolveWindowsStoreIdentity(platform, to),
    workspaceRoot: WORKSPACE_ROOT,
  };
}
