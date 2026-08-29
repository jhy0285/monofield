import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { RELEASE_CHANNELS, type ReleaseChannel } from "@open-design/release";

export const APP_KEYS = Object.freeze({
  DAEMON: "daemon",
  DESKTOP: "desktop",
  WEB: "web",
} as const);

export type AppKey = (typeof APP_KEYS)[keyof typeof APP_KEYS];

export const SIDECAR_MODES = Object.freeze({
  DEV: "dev",
  RUNTIME: "runtime",
} as const);

export type SidecarMode = (typeof SIDECAR_MODES)[keyof typeof SIDECAR_MODES];

export const SIDECAR_SOURCES = Object.freeze({
  PACKAGED: "packaged",
  TOOLS_DEV: "tools-dev",
  TOOLS_PACK: "tools-pack",
} as const);

export type SidecarSource = (typeof SIDECAR_SOURCES)[keyof typeof SIDECAR_SOURCES];

export const SIDECAR_ENV = Object.freeze({
  BASE: "OD_SIDECAR_BASE",
  DAEMON_CLI_PATH: "OD_DAEMON_CLI_PATH",
  DAEMON_PORT: "OD_PORT",
  IPC_BASE: "OD_SIDECAR_IPC_BASE",
  IPC_PATH: "OD_SIDECAR_IPC_PATH",
  NAMESPACE: "OD_SIDECAR_NAMESPACE",
  SOURCE: "OD_SIDECAR_SOURCE",
  TOOLS_DEV_PARENT_PID: "OD_TOOLS_DEV_PARENT_PID",
  WEB_DIST_DIR: "OD_WEB_DIST_DIR",
  WEB_PORT: "OD_WEB_PORT",
  WEB_TSCONFIG_PATH: "OD_WEB_TSCONFIG_PATH",
} as const);

export const SIDECAR_RUNTIME_ENV = Object.freeze({
  base: SIDECAR_ENV.BASE,
  ipcBase: SIDECAR_ENV.IPC_BASE,
  ipcPath: SIDECAR_ENV.IPC_PATH,
  namespace: SIDECAR_ENV.NAMESPACE,
  source: SIDECAR_ENV.SOURCE,
} as const);

export const SIDECAR_STAMP_FLAGS = Object.freeze({
  app: "--od-stamp-app",
  ipc: "--od-stamp-ipc",
  mode: "--od-stamp-mode",
  namespace: "--od-stamp-namespace",
  source: "--od-stamp-source",
} as const);

export const STAMP_APP_FLAG = SIDECAR_STAMP_FLAGS.app;
export const STAMP_IPC_FLAG = SIDECAR_STAMP_FLAGS.ipc;
export const STAMP_MODE_FLAG = SIDECAR_STAMP_FLAGS.mode;
export const STAMP_NAMESPACE_FLAG = SIDECAR_STAMP_FLAGS.namespace;
export const STAMP_SOURCE_FLAG = SIDECAR_STAMP_FLAGS.source;

export const SIDECAR_STAMP_FIELDS = ["app", "mode", "namespace", "ipc", "source"] as const;

export const SIDECAR_DEFAULTS = Object.freeze({
  host: "127.0.0.1",
  ipcBase: "/tmp/open-design/ipc",
  namespace: "default",
  projectTmpDirName: ".tmp",
  windowsPipePrefix: "open-design",
} as const);

export const OPEN_DESIGN_PRODUCT_NAME = "MonoField";

export function resolveWindowsReleaseNamespaceToken(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

export function resolveWindowsUninstallRegistryKey(namespace: string): string {
  const namespaceToken = resolveWindowsReleaseNamespaceToken(namespace);
  return `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${OPEN_DESIGN_PRODUCT_NAME}-${namespaceToken}`;
}

export const SIDECAR_MESSAGES = Object.freeze({
  BROWSER_AUTOMATION: "browser-automation",
  CLICK: "click",
  CONSOLE: "console",
  CREDENTIAL_VAULT: "credential-vault",
  DATABASE: "database",
  DEVELOPMENT_PROCESS: "development-process",
  EVAL: "eval",
  EXPORT_ARTIFACT: "export-artifact",
  EXPORT_PDF: "export-pdf",
  MINT_IMPORT_TOKEN: "mint-import-token",
  REGISTER_DESKTOP_AUTH: "register-desktop-auth",
  SCREENSHOT: "screenshot",
  SHUTDOWN: "shutdown",
  SHOW: "show",
  STATUS: "status",
  UPDATE: "update",
} as const);

export const DESKTOP_BROWSER_AUTOMATION_ACTIONS = Object.freeze({
  BATCH: "batch",
  CLICK: "click",
  DRAG: "drag",
  HOVER: "hover",
  NAVIGATE: "navigate",
  PAGE_INFO: "page-info",
  SCREENSHOT: "screenshot",
  SCROLL: "scroll",
  SNAPSHOT: "snapshot",
  STATUS: "status",
  TYPE_TEXT: "type-text",
  UPLOAD: "upload",
} as const);

export type DesktopBrowserAutomationAction =
  (typeof DESKTOP_BROWSER_AUTOMATION_ACTIONS)[keyof typeof DESKTOP_BROWSER_AUTOMATION_ACTIONS];

export const DESKTOP_UPDATE_ACTIONS = Object.freeze({
  CHECK: "check",
  DOWNLOAD: "download",
  INSTALL: "install",
  STATUS: "status",
} as const);

export type DesktopUpdateAction = (typeof DESKTOP_UPDATE_ACTIONS)[keyof typeof DESKTOP_UPDATE_ACTIONS];

export const DESKTOP_UPDATE_MODES = Object.freeze({
  JS_INCREMENTAL: "js-incremental",
  PACKAGE_LAUNCHER: "package-launcher",
} as const);

export type DesktopUpdateMode = (typeof DESKTOP_UPDATE_MODES)[keyof typeof DESKTOP_UPDATE_MODES];

export const DESKTOP_UPDATE_CHANNELS = Object.freeze({
  BETA: RELEASE_CHANNELS.BETA,
  BETAS: RELEASE_CHANNELS.BETAS,
  PRERELEASE: RELEASE_CHANNELS.PRERELEASE,
  PREVIEW: RELEASE_CHANNELS.PREVIEW,
  STABLE: RELEASE_CHANNELS.STABLE,
} as const);

export type DesktopUpdateChannel = ReleaseChannel;

export const DESKTOP_UPDATE_STATES = Object.freeze({
  AVAILABLE: "available",
  CHECKING: "checking",
  DOWNLOADED: "downloaded",
  DOWNLOADING: "downloading",
  ERROR: "error",
  IDLE: "idle",
  INSTALLING: "installing",
  NOT_AVAILABLE: "not-available",
  UNSUPPORTED: "unsupported",
} as const);

export type DesktopUpdateState = (typeof DESKTOP_UPDATE_STATES)[keyof typeof DESKTOP_UPDATE_STATES];

export const SIDECAR_ERROR_CODES = Object.freeze({
  INVALID_MESSAGE: "SIDECAR_INVALID_MESSAGE",
  UNKNOWN_MESSAGE: "SIDECAR_UNKNOWN_MESSAGE",
} as const);

export type SidecarErrorCode = (typeof SIDECAR_ERROR_CODES)[keyof typeof SIDECAR_ERROR_CODES];

export class SidecarContractError extends Error {
  readonly code: SidecarErrorCode;

  constructor(code: SidecarErrorCode, message: string) {
    super(message);
    this.name = "SidecarContractError";
    this.code = code;
  }
}

export type ServiceRuntimeState = "idle" | "running" | "starting" | "stopped" | "unknown";

export type DaemonStatusSnapshot = {
  pid?: number | null;
  state: ServiceRuntimeState;
  trustedWebOriginPort?: number | null;
  updatedAt?: string;
  url: string | null;
  /**
   * PR #974 round 6 (mrcfps): true when the daemon's
   * `/api/import/folder` route refuses tokenless requests. Surfaced
   * over IPC so `tools-dev start desktop` can detect a daemon that
   * was spawned without `OD_REQUIRE_DESKTOP_AUTH=1` (the split-start
   * dev flow `start daemon` -> `start desktop`) and restart it
   * before launching desktop main, instead of letting a renderer
   * race the registration handshake. Mirrors
   * `apps/daemon/src/server.ts#isDesktopAuthGateActive()` at the
   * moment the STATUS request was answered.
   */
  desktopAuthGateActive: boolean;
};

export type WebStatusSnapshot = {
  pid?: number | null;
  state: ServiceRuntimeState;
  updatedAt?: string;
  url: string | null;
};

export type DesktopRuntimeState = "idle" | "running" | "unknown";

export type DesktopStatusSnapshot = {
  pid?: number | null;
  state: DesktopRuntimeState;
  title?: string | null;
  update?: DesktopUpdateStatusSnapshot;
  updateStatusError?: string;
  updatedAt?: string;
  url?: string | null;
  windowVisible?: boolean;
};

export type DesktopEvalInput = {
  expression: string;
};

export type DesktopEvalResult = {
  error?: string;
  ok: boolean;
  value?: unknown;
};

export type DesktopScreenshotInput = {
  path: string;
};

export type DesktopScreenshotResult = {
  path: string;
};

export type DesktopConsoleEntry = {
  level: string;
  text: string;
  timestamp: string;
};

export type DesktopConsoleResult = {
  entries: DesktopConsoleEntry[];
};

export type DesktopClickInput = {
  selector: string;
};

export type DesktopClickResult = {
  clicked: boolean;
  found: boolean;
};

/**
 * Deliberately finite browser-automation protocol. A caller can select and
 * interact with page elements, but cannot send JavaScript to the guest.
 * The Electron main process validates the user-approved session, origin,
 * selector, URL, and sensitive-field policy again before execution.
 */
export type DesktopBrowserAutomationStep = {
  action: DesktopBrowserAutomationAction;
  continueOnError?: boolean;
  filePath?: string;
  selector?: string;
  steps?: DesktopBrowserAutomationStep[];
  targetSelector?: string;
  text?: string;
  url?: string;
  pixels?: number;
  to?: "top" | "bottom" | "page";
};

export type DesktopBrowserAutomationInput = DesktopBrowserAutomationStep & {
  sessionId: string;
};

export type DesktopBrowserAutomationResult = {
  action: DesktopBrowserAutomationAction;
  data?: unknown;
  error?: string;
  ok: boolean;
  sessionId: string;
};

export type DesktopExportPdfInput = {
  baseHref?: string;
  deck: boolean;
  defaultFilename: string;
  html: string;
  title: string;
};

export type DesktopExportPdfResult = {
  canceled?: boolean;
  error?: string;
  ok: boolean;
  path?: string;
};

export type DesktopExportArtifactFormat = "pdf" | "image";
// Electron's `nativeImage` (the off-screen renderer the programmatic exporter
// uses) can only encode PNG and JPEG. WebP is deliberately excluded so a caller
// asking for it gets a clear validation error instead of a silent PNG downgrade.
// (The in-app web Download menu encodes WebP client-side via canvas.toBlob and
// is unaffected by this list.)
export type DesktopExportArtifactImageFormat = "png" | "jpeg";

// Generic programmatic export (PDF / image). The desktop renderer writes
// the result to a temporary file and returns its path; the daemon streams those
// bytes to the HTTP caller (the `od export` CLI), then removes the temp file.
export type DesktopExportArtifactInput = {
  baseHref?: string;
  deck: boolean;
  format: DesktopExportArtifactFormat;
  html: string;
  imageFormat?: DesktopExportArtifactImageFormat;
  title: string;
  width?: number;
  height?: number;
};

export type DesktopExportArtifactResult = {
  bytes?: number;
  error?: string;
  mime?: string;
  ok: boolean;
  path?: string;
};

export type DesktopUpdateCapabilitySet = {
  canApplyInPlace: boolean;
  canDownload: boolean;
  canOpenInstaller: boolean;
  requiresManualInstall: boolean;
};

export type DesktopUpdatePathSnapshot = {
  downloadRoot?: string;
  manifestPath?: string;
};

export type DesktopUpdateChecksumSnapshot = {
  algorithm: "sha256" | "sha512";
  url?: string;
  value?: string;
};

export type DesktopUpdateArtifactSnapshot = {
  name?: string;
  platformKey?: string;
  size?: number;
  type?: string;
  url: string;
};

export type DesktopUpdateProgressSnapshot = {
  receivedBytes: number;
  totalBytes?: number;
};

export type DesktopUpdateErrorSnapshot = {
  code: string;
  details?: unknown;
  message: string;
};

export type DesktopUpdateInstallResult = {
  activeVersion?: string;
  artifactPath?: string;
  dryRun?: boolean;
  helperLogPath?: string;
  launcherRuntimePath?: string;
  launchPath?: string;
  openedAt: string;
  path: string;
};

export type DesktopUpdateReleaseSnapshot = {
  arch: string;
  artifact: DesktopUpdateArtifactSnapshot;
  checksum: DesktopUpdateChecksumSnapshot;
  channel: DesktopUpdateChannel;
  downloadedAt: string;
  key: string;
  metadata?: Record<string, unknown>;
  path: string;
  platformKey: string;
  version: string;
};

export type DesktopUpdateIncomingSnapshot = {
  arch: string;
  artifact: DesktopUpdateArtifactSnapshot;
  channel: DesktopUpdateChannel;
  key?: string;
  metadata?: Record<string, unknown>;
  progress?: DesktopUpdateProgressSnapshot;
  startedAt: string;
  version: string;
};

export type DesktopUpdateCacheLifecycleTrigger = "cold-start" | "next-version-ready";

export type DesktopUpdateReleaseLifecycleState =
  | "cleanup-deferred"
  | "cleanup-removed"
  | "deprecated"
  | "retained"
  | "unknown";

export type DesktopUpdateCacheLifecycleSummary = {
  lastRunAt?: string;
  lastTrigger?: DesktopUpdateCacheLifecycleTrigger;
  platform: string;
  releases: {
    cleanupDeferred: number;
    cleanupRemoved: number;
    deprecated: number;
    errors: number;
    retained: number;
    total: number;
    unknown: number;
  };
};

export type DesktopUpdateCacheSnapshot = {
  lifecycle?: DesktopUpdateCacheLifecycleSummary;
};

export type DesktopUpdateStatusSnapshot = {
  active?: DesktopUpdateReleaseSnapshot;
  arch: string;
  artifact?: DesktopUpdateArtifactSnapshot;
  artifactUrl?: string;
  availableVersion?: string;
  cache?: DesktopUpdateCacheSnapshot;
  capabilities: DesktopUpdateCapabilitySet;
  channel: DesktopUpdateChannel;
  checksum?: DesktopUpdateChecksumSnapshot;
  currentVersion: string;
  downloadPath?: string;
  enabled: boolean;
  error?: DesktopUpdateErrorSnapshot;
  incoming?: DesktopUpdateIncomingSnapshot;
  installResult?: DesktopUpdateInstallResult;
  lastCheckedAt?: string;
  metadata?: Record<string, unknown>;
  mode: DesktopUpdateMode;
  paths?: DesktopUpdatePathSnapshot;
  platform: string;
  progress?: DesktopUpdateProgressSnapshot;
  state: DesktopUpdateState;
  supported: boolean;
};

export type DesktopUpdateInput = {
  action: DesktopUpdateAction;
};

export type DesktopUpdateResult = DesktopUpdateStatusSnapshot;

// Deliberately narrow desktop-main database broker protocol. It contains no
// connection URL, username, password, or arbitrary SQL; those never leave the
// Electron main process or encrypted OS-backed storage.
export type DesktopDatabaseRequest =
  | { action: "list" }
  | { action: "schemas"; connectionId: string; selectedByUser?: boolean }
  | { action: "describe"; connectionId: string; schema: string; table: string }
  | { action: "sample"; connectionId: string; schema: string; table: string; limit?: number }
  | {
      action: "inspect";
      connectionId: string;
      tables: Array<{ schema: string; table: string }>;
      limit?: number;
      concurrency?: 8 | 16 | 32;
      /** The user selected these tables in the database-context form. */
      selectedByUser?: boolean;
    }
  | {
      action: "mutate";
      connectionId: string;
      operation: "insert" | "update" | "delete";
      schema: string;
      table: string;
      values?: Record<string, string | number | boolean | null>;
      where?: Record<string, string | number | boolean | null>;
      projectId?: string;
      reason: string;
    };

export type DesktopDatabaseMessage = { input: DesktopDatabaseRequest; type: typeof SIDECAR_MESSAGES.DATABASE };
export type DesktopCredentialVaultCommand =
  | { action: "available" }
  | { action: "get"; key: string }
  | { action: "set"; key: string; value: string }
  | { action: "delete"; key: string };
export type DesktopCredentialVaultAuthorization = {
  expiresAt: string;
  nonce: string;
  signature: string;
};
export type DesktopCredentialVaultRequest =
  | { action: "available" }
  | ((Exclude<DesktopCredentialVaultCommand, { action: "available" }>) & {
      authorization: DesktopCredentialVaultAuthorization;
    });
export type DesktopCredentialVaultResult =
  | { action: "available"; available: boolean }
  | { action: "get"; value: string | null }
  | { action: "set"; stored: true }
  | { action: "delete"; deleted: boolean };

export const DESKTOP_IMPORT_TOKEN_AUTH_DOMAIN = "monofield-desktop-import-token-v1";
export const DESKTOP_IMPORT_TOKEN_FIELD_SEPARATOR = "~";

function desktopImportTokenAuthorizationPayload(
  baseDir: string,
  options: { exp: string; nonce: string },
): string {
  // The Desktop auth secret also protects other IPC capabilities. Domain
  // separation and control-character rejection prevent a chosen folder path
  // from being interpreted as another protocol's signed payload.
  if (/[\r\n\0]/u.test(baseDir)) {
    throw new Error("desktop import baseDir contains invalid control characters");
  }
  return [DESKTOP_IMPORT_TOKEN_AUTH_DOMAIN, baseDir, options.nonce, options.exp].join("\n");
}

export function createDesktopImportTokenSignature(
  secret: Buffer,
  baseDir: string,
  options: { exp: string; nonce: string },
): string {
  return createHmac("sha256", secret)
    .update(desktopImportTokenAuthorizationPayload(baseDir, options))
    .digest("base64url");
}

export function signDesktopImportToken(
  secret: Buffer,
  baseDir: string,
  options: { exp: string; nonce: string },
): string {
  return [
    options.nonce,
    options.exp,
    createDesktopImportTokenSignature(secret, baseDir, options),
  ].join(DESKTOP_IMPORT_TOKEN_FIELD_SEPARATOR);
}
export type DesktopCredentialVaultMessage = {
  input: DesktopCredentialVaultRequest;
  type: typeof SIDECAR_MESSAGES.CREDENTIAL_VAULT;
};
export type DesktopDevelopmentProcessInput =
  | { action: "start"; args: string[]; command: string; cwd: string; environment?: Record<string, string>; ownerPid: number; port: number; projectId: string; windowsVerbatimArguments?: boolean }
  | { action: "status"; ownerPid: number; projectId: string }
  | { action: "terminate"; ownerPid: number; projectId: string };
export type DesktopDevelopmentProcessResult = {
  accepted: true;
  action: DesktopDevelopmentProcessInput["action"];
  error: string | null;
  logs: string[];
  pid: number | null;
  projectId: string;
  running: boolean;
};
export type DesktopDevelopmentProcessMessage = {
  input: DesktopDevelopmentProcessInput;
  type: typeof SIDECAR_MESSAGES.DEVELOPMENT_PROCESS;
};
export type DesktopBrowserAutomationMessage = {
  input: DesktopBrowserAutomationInput;
  type: typeof SIDECAR_MESSAGES.BROWSER_AUTOMATION;
};

export type SidecarStatusMessage = { type: typeof SIDECAR_MESSAGES.STATUS };
export type SidecarShutdownMessage = { type: typeof SIDECAR_MESSAGES.SHUTDOWN };
export type DesktopEvalMessage = { input: DesktopEvalInput; type: typeof SIDECAR_MESSAGES.EVAL };
export type DesktopScreenshotMessage = { input: DesktopScreenshotInput; type: typeof SIDECAR_MESSAGES.SCREENSHOT };
export type DesktopConsoleMessage = { type: typeof SIDECAR_MESSAGES.CONSOLE };
export type DesktopShowMessage = { type: typeof SIDECAR_MESSAGES.SHOW };
export type DesktopClickMessage = { input: DesktopClickInput; type: typeof SIDECAR_MESSAGES.CLICK };
export type DesktopExportPdfMessage = { input: DesktopExportPdfInput; type: typeof SIDECAR_MESSAGES.EXPORT_PDF };
export type DesktopExportArtifactMessage = { input: DesktopExportArtifactInput; type: typeof SIDECAR_MESSAGES.EXPORT_ARTIFACT };
export type DesktopUpdateMessage = { input: DesktopUpdateInput; type: typeof SIDECAR_MESSAGES.UPDATE };

// Sent by the desktop main process to the daemon over its sidecar IPC at
// startup, before the BrowserWindow is created. The base64 string is a
// freshly generated 32-byte secret that both processes will share for the
// lifetime of the daemon. The daemon uses this secret to verify HMAC tokens
// minted by the desktop main process for `POST /api/import/folder` calls
// (PR #974: closes the renderer→arbitrary-baseDir→openPath bypass chain).
// When the secret is registered, daemon's import-folder route requires a
// valid per-path token; when it isn't (web-only deployments), the route
// behaves as before.
export type RegisterDesktopAuthInput = {
  secret: string;
};

export type RegisterDesktopAuthMessage = {
  input: RegisterDesktopAuthInput;
  type: typeof SIDECAR_MESSAGES.REGISTER_DESKTOP_AUTH;
};

export type RegisterDesktopAuthResult = {
  accepted: true;
};

export type MintImportTokenInput = {
  baseDir: string;
};

export type MintImportTokenMessage = {
  input: MintImportTokenInput;
  type: typeof SIDECAR_MESSAGES.MINT_IMPORT_TOKEN;
};

export type MintImportTokenResult =
  | { ok: true; expiresAt: string; token: string }
  | { ok: false; code: "DESKTOP_AUTH_INACTIVE"; message: string; retryable: false }
  | { ok: false; code: "DESKTOP_AUTH_PENDING"; message: string; retryable: true };

export type DaemonSidecarMessage =
  | SidecarStatusMessage
  | SidecarShutdownMessage
  | RegisterDesktopAuthMessage
  | MintImportTokenMessage;
export type WebSidecarMessage = SidecarStatusMessage | SidecarShutdownMessage;
export type DesktopSidecarMessage =
  | SidecarStatusMessage
  | SidecarShutdownMessage
  | DesktopEvalMessage
  | DesktopScreenshotMessage
  | DesktopConsoleMessage
  | DesktopCredentialVaultMessage
  | DesktopDatabaseMessage
  | DesktopDevelopmentProcessMessage
  | DesktopBrowserAutomationMessage
  | DesktopShowMessage
  | DesktopClickMessage
  | DesktopExportPdfMessage
  | DesktopExportArtifactMessage
  | DesktopUpdateMessage;

export type ShutdownResult = {
  accepted: true;
};

export type SidecarStamp = {
  app: AppKey;
  ipc: string;
  mode: SidecarMode;
  namespace: string;
  source: SidecarSource;
};

export type SidecarStampInput = Partial<Record<(typeof SIDECAR_STAMP_FIELDS)[number], unknown>>;
export type SidecarStampCriteria = Partial<SidecarStamp>;

export type OpenDesignSidecarContract = {
  appKeys: typeof APP_KEYS;
  browserAutomationActions: typeof DESKTOP_BROWSER_AUTOMATION_ACTIONS;
  defaults: typeof SIDECAR_DEFAULTS;
  env: typeof SIDECAR_RUNTIME_ENV;
  errorCodes: typeof SIDECAR_ERROR_CODES;
  messages: typeof SIDECAR_MESSAGES;
  modes: typeof SIDECAR_MODES;
  normalizeApp: typeof normalizeAppKey;
  normalizeNamespace: typeof normalizeNamespace;
  normalizeSource: typeof normalizeSidecarSource;
  normalizeStamp: typeof normalizeSidecarStamp;
  normalizeStampCriteria: typeof normalizeSidecarStampCriteria;
  sources: typeof SIDECAR_SOURCES;
  stampFields: typeof SIDECAR_STAMP_FIELDS;
  stampFlags: typeof SIDECAR_STAMP_FLAGS;
  updateActions: typeof DESKTOP_UPDATE_ACTIONS;
  updateChannels: typeof DESKTOP_UPDATE_CHANNELS;
  updateModes: typeof DESKTOP_UPDATE_MODES;
  updateStates: typeof DESKTOP_UPDATE_STATES;
};

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set<string>(allowed);
  const unexpected = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} contains unsupported fields: ${unexpected.join(", ")}`);
  }
}

function normalizeNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  if (value.length === 0) throw new Error(`${label} must not be empty`);
  return value;
}

export function normalizeNamespace(namespace: unknown): string {
  if (typeof namespace !== "string") throw new Error("namespace must be a string");
  const value = namespace.trim();
  if (value.length === 0) throw new Error("namespace must not be empty");
  if (value !== namespace) throw new Error("namespace must not contain leading or trailing whitespace");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`namespace contains unsupported characters: ${value}`);
  }
  if (/[\\/]/.test(value)) throw new Error(`namespace must not contain path separators: ${value}`);
  return value;
}

export function isSidecarMode(value: unknown): value is SidecarMode {
  return Object.values(SIDECAR_MODES).includes(value as SidecarMode);
}

export function normalizeSidecarMode(mode: unknown): SidecarMode {
  if (!isSidecarMode(mode)) {
    throw new Error("sidecar mode must be dev or runtime");
  }
  return mode;
}

export function isAppKey(value: unknown): value is AppKey {
  return Object.values(APP_KEYS).includes(value as AppKey);
}

export function normalizeAppKey(app: unknown): AppKey {
  if (!isAppKey(app)) throw new Error(`unsupported sidecar app: ${String(app)}`);
  return app;
}

export function isSidecarSource(value: unknown): value is SidecarSource {
  return Object.values(SIDECAR_SOURCES).includes(value as SidecarSource);
}

export function normalizeSidecarSource(source: unknown): SidecarSource {
  if (!isSidecarSource(source)) {
    throw new Error(`unsupported sidecar source: ${String(source)}`);
  }
  return source;
}

export function isWindowsNamedPipePath(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("\\\\.\\pipe\\");
}

export function normalizeIpcPath(ipc: unknown): string {
  if (typeof ipc !== "string") throw new Error("sidecar ipc path must be a string");
  if (ipc.length === 0) throw new Error("sidecar ipc path must not be empty");
  if (ipc.trim() !== ipc) throw new Error("sidecar ipc path must not contain leading or trailing whitespace");
  if (ipc.includes("\0")) throw new Error("sidecar ipc path must not contain null bytes");
  if (isWindowsNamedPipePath(ipc)) return ipc;
  if (!ipc.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(ipc)) {
    throw new Error(`sidecar ipc path must be absolute: ${ipc}`);
  }
  return ipc;
}

function assertKnownStampKeys(value: Record<string, unknown>, label: string): void {
  assertKnownKeys(value, SIDECAR_STAMP_FIELDS, label);
}

export function normalizeSidecarStamp(input: unknown): SidecarStamp {
  const value = assertObject(input, "sidecar stamp");
  assertKnownStampKeys(value, "sidecar stamp");
  return {
    app: normalizeAppKey(value.app),
    ipc: normalizeIpcPath(value.ipc),
    mode: normalizeSidecarMode(value.mode),
    namespace: normalizeNamespace(value.namespace),
    source: normalizeSidecarSource(value.source),
  };
}

export function normalizeSidecarStampCriteria(input: unknown = {}): SidecarStampCriteria {
  const value = assertObject(input, "sidecar stamp criteria");
  assertKnownStampKeys(value, "sidecar stamp criteria");
  return {
    ...(value.app == null ? {} : { app: normalizeAppKey(value.app) }),
    ...(value.ipc == null ? {} : { ipc: normalizeIpcPath(value.ipc) }),
    ...(value.mode == null ? {} : { mode: normalizeSidecarMode(value.mode) }),
    ...(value.namespace == null ? {} : { namespace: normalizeNamespace(value.namespace) }),
    ...(value.source == null ? {} : { source: normalizeSidecarSource(value.source) }),
  };
}

export function assertSidecarStamp(input: unknown): asserts input is SidecarStamp {
  normalizeSidecarStamp(input);
}

function normalizeDesktopEvalInput(input: unknown): DesktopEvalInput {
  const value = assertObject(input, "desktop eval input");
  assertKnownKeys(value, ["expression"], "desktop eval input");
  return { expression: normalizeNonEmptyString(value.expression, "desktop eval expression") };
}

function normalizeDesktopScreenshotInput(input: unknown): DesktopScreenshotInput {
  const value = assertObject(input, "desktop screenshot input");
  assertKnownKeys(value, ["path"], "desktop screenshot input");
  return { path: normalizeNonEmptyString(value.path, "desktop screenshot path") };
}

function normalizeDesktopClickInput(input: unknown): DesktopClickInput {
  const value = assertObject(input, "desktop click input");
  assertKnownKeys(value, ["selector"], "desktop click input");
  return { selector: normalizeNonEmptyString(value.selector, "desktop click selector") };
}

function normalizeRegisterDesktopAuthInput(input: unknown): RegisterDesktopAuthInput {
  const value = assertObject(input, "register-desktop-auth input");
  assertKnownKeys(value, ["secret"], "register-desktop-auth input");
  const secret = normalizeNonEmptyString(value.secret, "register-desktop-auth secret");
  // Reject anything that isn't base64-shaped — the wire format is a
  // base64-encoded random buffer minted by the desktop main process. The
  // daemon decodes it back to bytes for HMAC. Loose validation here, not
  // length-pinned, so the encoding (base64 vs base64url) stays caller-driven.
  if (!/^[A-Za-z0-9+/_=-]+$/.test(secret)) {
    throw new Error("register-desktop-auth secret must be base64-encoded");
  }
  return { secret };
}

function normalizeMintImportTokenInput(input: unknown): MintImportTokenInput {
  const value = assertObject(input, "mint-import-token input");
  assertKnownKeys(value, ["baseDir"], "mint-import-token input");
  const baseDir = normalizeNonEmptyString(value.baseDir, "mint-import-token baseDir");
  if (/[\r\n\0]/u.test(baseDir)) {
    throw new Error("mint-import-token baseDir contains invalid control characters");
  }
  return { baseDir };
}

function normalizeBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function normalizeDesktopExportPdfInput(input: unknown): DesktopExportPdfInput {
  const value = assertObject(input, "desktop PDF export input");
  assertKnownKeys(value, ["baseHref", "deck", "defaultFilename", "html", "title"], "desktop PDF export input");
  return {
    ...(value.baseHref == null ? {} : { baseHref: normalizeNonEmptyString(value.baseHref, "desktop PDF export baseHref") }),
    deck: normalizeBoolean(value.deck, "desktop PDF export deck"),
    defaultFilename: normalizeNonEmptyString(value.defaultFilename, "desktop PDF export defaultFilename"),
    html: normalizeNonEmptyString(value.html, "desktop PDF export html"),
    title: normalizeNonEmptyString(value.title, "desktop PDF export title"),
  };
}

function normalizeOptionalPositiveNumber(value: unknown, label: string): number | undefined {
  if (value == null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return value;
}

const DESKTOP_EXPORT_ARTIFACT_FORMATS: readonly DesktopExportArtifactFormat[] = ["pdf", "image"];
const DESKTOP_EXPORT_ARTIFACT_IMAGE_FORMATS: readonly DesktopExportArtifactImageFormat[] = ["png", "jpeg"];

function normalizeDesktopExportArtifactInput(input: unknown): DesktopExportArtifactInput {
  const value = assertObject(input, "desktop artifact export input");
  assertKnownKeys(value, ["baseHref", "deck", "format", "html", "imageFormat", "title", "width", "height"], "desktop artifact export input");
  if (!DESKTOP_EXPORT_ARTIFACT_FORMATS.includes(value.format as DesktopExportArtifactFormat)) {
    throw new Error(`unsupported artifact export format: ${String(value.format)}`);
  }
  if (value.imageFormat != null && !DESKTOP_EXPORT_ARTIFACT_IMAGE_FORMATS.includes(value.imageFormat as DesktopExportArtifactImageFormat)) {
    throw new Error(`unsupported artifact export image format: ${String(value.imageFormat)}`);
  }
  return {
    ...(value.baseHref == null ? {} : { baseHref: normalizeNonEmptyString(value.baseHref, "desktop artifact export baseHref") }),
    deck: normalizeBoolean(value.deck, "desktop artifact export deck"),
    format: value.format as DesktopExportArtifactFormat,
    html: normalizeNonEmptyString(value.html, "desktop artifact export html"),
    ...(value.imageFormat == null ? {} : { imageFormat: value.imageFormat as DesktopExportArtifactImageFormat }),
    title: normalizeNonEmptyString(value.title, "desktop artifact export title"),
    ...(value.width == null ? {} : { width: normalizeOptionalPositiveNumber(value.width, "desktop artifact export width")! }),
    ...(value.height == null ? {} : { height: normalizeOptionalPositiveNumber(value.height, "desktop artifact export height")! }),
  };
}

function isDesktopUpdateAction(value: unknown): value is DesktopUpdateAction {
  return Object.values(DESKTOP_UPDATE_ACTIONS).includes(value as DesktopUpdateAction);
}

function normalizeDesktopUpdateInput(input: unknown): DesktopUpdateInput {
  const value = assertObject(input, "desktop update input");
  assertKnownKeys(value, ["action"], "desktop update input");
  if (!isDesktopUpdateAction(value.action)) {
    throw new Error(`unsupported desktop update action: ${String(value.action)}`);
  }
  return { action: value.action };
}

function normalizeDesktopBrowserAutomationStep(
  input: unknown,
  { allowBatch = true }: { allowBatch?: boolean } = {},
): DesktopBrowserAutomationStep {
  const value = assertObject(input, "desktop browser automation input");
  const action = normalizeNonEmptyString(value.action, "desktop browser automation action") as DesktopBrowserAutomationAction;
  if (!Object.values(DESKTOP_BROWSER_AUTOMATION_ACTIONS).includes(action)) {
    throw new Error(`unsupported desktop browser automation action: ${String(value.action)}`);
  }
  if (!allowBatch && action === "batch") throw new Error("nested browser automation batches are not supported");
  const keysByAction: Record<DesktopBrowserAutomationAction, readonly string[]> = {
    "status": ["action"],
    "page-info": ["action"],
    "snapshot": ["action"],
    "screenshot": ["action"],
    "navigate": ["action", "url"],
    "click": ["action", "selector"],
    "hover": ["action", "selector"],
    "drag": ["action", "selector", "targetSelector"],
    "type-text": ["action", "selector", "text"],
    "upload": ["action", "selector", "filePath"],
    "scroll": ["action", "pixels", "to"],
    "batch": ["action", "steps", "continueOnError"],
  };
  assertKnownKeys(value, [...keysByAction[action]], `desktop browser automation ${action} input`);
  if (["click", "hover", "drag", "type-text", "upload"].includes(action) && value.selector == null) {
    throw new Error(`desktop browser automation ${action} requires selector`);
  }
  if (action === "drag" && value.targetSelector == null) {
    throw new Error("desktop browser automation drag requires targetSelector");
  }
  if (action === "type-text" && value.text == null) {
    throw new Error("desktop browser automation type-text requires text");
  }
  if (action === "upload" && value.filePath == null) {
    throw new Error("desktop browser automation upload requires filePath");
  }
  if (action === "batch" && (!Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > 25)) {
    throw new Error("desktop browser automation batch requires 1 to 25 steps");
  }
  if (value.continueOnError != null && typeof value.continueOnError !== "boolean") {
    throw new Error("desktop browser automation continueOnError must be a boolean");
  }
  if (value.text != null && typeof value.text !== "string") {
    throw new Error("desktop browser automation text must be a string");
  }
  if (action === "scroll" && value.pixels != null && value.to != null) {
    throw new Error("desktop browser automation scroll accepts either pixels or to, not both");
  }
  if (action === "navigate" && value.url == null) {
    throw new Error("desktop browser automation navigate requires url");
  }
  if (value.pixels != null && (typeof value.pixels !== "number" || !Number.isFinite(value.pixels) || Math.abs(value.pixels) > 100_000)) {
    throw new Error("desktop browser automation pixels must be a finite number between -100000 and 100000");
  }
  if (value.to != null && value.to !== "top" && value.to !== "bottom" && value.to !== "page") {
    throw new Error("desktop browser automation to must be top, bottom, or page");
  }
  return {
    action,
    ...(value.continueOnError == null ? {} : { continueOnError: value.continueOnError as boolean }),
    ...(value.filePath == null ? {} : { filePath: normalizeNonEmptyString(value.filePath, "desktop browser automation filePath") }),
    ...(value.selector == null ? {} : { selector: normalizeNonEmptyString(value.selector, "desktop browser automation selector") }),
    ...(value.steps == null ? {} : { steps: (value.steps as unknown[]).map((step) => normalizeDesktopBrowserAutomationStep(step, { allowBatch: false })) }),
    ...(value.targetSelector == null ? {} : { targetSelector: normalizeNonEmptyString(value.targetSelector, "desktop browser automation targetSelector") }),
    ...(value.text == null ? {} : { text: String(value.text).slice(0, 20_000) }),
    ...(value.url == null ? {} : { url: normalizeNonEmptyString(value.url, "desktop browser automation url") }),
    ...(value.pixels == null ? {} : { pixels: value.pixels as number }),
    ...(value.to == null ? {} : { to: value.to as "top" | "bottom" | "page" }),
  };
}

function normalizeDesktopBrowserAutomationInput(input: unknown): DesktopBrowserAutomationInput {
  const value = assertObject(input, "desktop browser automation input");
  const sessionId = normalizeNonEmptyString(value.sessionId, "desktop browser automation sessionId");
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(sessionId)) {
    throw new Error("desktop browser automation sessionId has an invalid format");
  }
  const { sessionId: _sessionId, ...stepInput } = value;
  return { ...normalizeDesktopBrowserAutomationStep(stepInput), sessionId };
}

function normalizeDesktopDatabaseInput(input: unknown): DesktopDatabaseRequest {
  const value = assertObject(input, "desktop database input");
  const action = normalizeNonEmptyString(value.action, "desktop database action");
  if (action === "list") {
    assertKnownKeys(value, ["action"], "desktop database input");
    return { action };
  }
  if (action === "schemas") {
    assertKnownKeys(value, ["action", "connectionId", "selectedByUser"], "desktop database input");
    if (value.selectedByUser != null && typeof value.selectedByUser !== "boolean") {
      throw new Error("desktop database schemas selectedByUser must be a boolean");
    }
    return {
      action,
      connectionId: normalizeNonEmptyString(value.connectionId, "desktop database connectionId"),
      ...(value.selectedByUser == null ? {} : { selectedByUser: value.selectedByUser }),
    };
  }
  if (action === "describe") {
    assertKnownKeys(value, ["action", "connectionId", "schema", "table"], "desktop database input");
    return {
      action,
      connectionId: normalizeNonEmptyString(value.connectionId, "desktop database connectionId"),
      schema: normalizeNonEmptyString(value.schema, "desktop database schema"),
      table: normalizeNonEmptyString(value.table, "desktop database table"),
    };
  }
  if (action === "sample") {
    assertKnownKeys(value, ["action", "connectionId", "schema", "table", "limit"], "desktop database input");
    if (value.limit != null && (typeof value.limit !== "number" || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 20)) {
      throw new Error("desktop database sample limit must be an integer between 1 and 20");
    }
    return {
      action,
      connectionId: normalizeNonEmptyString(value.connectionId, "desktop database connectionId"),
      schema: normalizeNonEmptyString(value.schema, "desktop database schema"),
      table: normalizeNonEmptyString(value.table, "desktop database table"),
      ...(value.limit == null ? {} : { limit: value.limit }),
    };
  }
  if (action === "inspect") {
    assertKnownKeys(value, ["action", "connectionId", "tables", "limit", "concurrency", "selectedByUser"], "desktop database input");
    if (!Array.isArray(value.tables) || value.tables.length < 1) {
      throw new Error("desktop database inspect tables must contain at least one table");
    }
    if (value.limit != null && (typeof value.limit !== "number" || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 20)) {
      throw new Error("desktop database inspect limit must be an integer between 1 and 20");
    }
    if (value.concurrency != null && (value.concurrency !== 8 && value.concurrency !== 16 && value.concurrency !== 32)) {
      throw new Error("desktop database inspect concurrency must be 8, 16, or 32");
    }
    if (value.selectedByUser != null && typeof value.selectedByUser !== "boolean") {
      throw new Error("desktop database inspect selectedByUser must be a boolean");
    }
    const tables = value.tables.map((table, index) => {
      const item = assertObject(table, `desktop database inspect table ${index + 1}`);
      assertKnownKeys(item, ["schema", "table"], `desktop database inspect table ${index + 1}`);
      return {
        schema: normalizeNonEmptyString(item.schema, `desktop database inspect table ${index + 1} schema`),
        table: normalizeNonEmptyString(item.table, `desktop database inspect table ${index + 1} table`),
      };
    });
    return {
      action,
      connectionId: normalizeNonEmptyString(value.connectionId, "desktop database connectionId"),
      tables,
      ...(value.limit == null ? {} : { limit: value.limit }),
      ...(value.concurrency == null ? {} : { concurrency: value.concurrency }),
      ...(value.selectedByUser == null ? {} : { selectedByUser: value.selectedByUser }),
    };
  }
  if (action === "mutate") {
    assertKnownKeys(value, ["action", "connectionId", "operation", "schema", "table", "values", "where", "projectId", "reason"], "desktop database input");
    if (value.operation !== "insert" && value.operation !== "update" && value.operation !== "delete") {
      throw new Error("desktop database mutation operation must be insert, update, or delete");
    }
    const normalizeValues = (input: unknown, label: string): Record<string, string | number | boolean | null> | undefined => {
      if (input == null) return undefined;
      const record = assertObject(input, label);
      if (Object.keys(record).length > 50) throw new Error(`${label} has too many columns`);
      const normalized: Record<string, string | number | boolean | null> = {};
      for (const [key, entry] of Object.entries(record)) {
        if (entry !== null && typeof entry !== "string" && typeof entry !== "number" && typeof entry !== "boolean") {
          throw new Error(`${label}.${key} must be a scalar JSON value`);
        }
        normalized[key] = entry;
      }
      return normalized;
    };
    const values = normalizeValues(value.values, "desktop database mutation values");
    const where = normalizeValues(value.where, "desktop database mutation where");
    return {
      action,
      connectionId: normalizeNonEmptyString(value.connectionId, "desktop database connectionId"),
      operation: value.operation,
      schema: normalizeNonEmptyString(value.schema, "desktop database schema"),
      table: normalizeNonEmptyString(value.table, "desktop database table"),
      ...(values == null ? {} : { values }),
      ...(where == null ? {} : { where }),
      ...(value.projectId == null ? {} : { projectId: normalizeNonEmptyString(value.projectId, "desktop database projectId") }),
      reason: normalizeNonEmptyString(value.reason, "desktop database mutation reason").slice(0, 500),
    };
  }
  throw new Error(`unsupported desktop database action: ${action}`);
}

const CREDENTIAL_VAULT_KEY_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,255}$/i;
const CREDENTIAL_VAULT_MAX_VALUE_CHARS = 1_048_576;
const CREDENTIAL_VAULT_AUTH_TTL_MS = 15_000;
const CREDENTIAL_VAULT_AUTH_FIELD_SEPARATOR = "\n";
const CREDENTIAL_VAULT_AUTH_NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const CREDENTIAL_VAULT_AUTH_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DEVELOPMENT_ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEVELOPMENT_ENVIRONMENT_RESERVED_KEYS = new Set([
  "ASPNETCORE_URLS",
  "BROWSER",
  "GRADIO_SERVER_PORT",
  "PORT",
  "SERVER_PORT",
  "STREAMLIT_SERVER_PORT",
]);

function normalizeDesktopCredentialVaultInput(input: unknown): DesktopCredentialVaultRequest {
  const value = assertObject(input, "desktop credential vault input");
  const action = normalizeNonEmptyString(value.action, "desktop credential vault action");
  if (action === "available") {
    assertKnownKeys(value, ["action"], "desktop credential vault input");
    return { action };
  }
  if (action !== "get" && action !== "set" && action !== "delete") {
    throw new Error("desktop credential vault action must be available, get, set, or delete");
  }
  const knownKeys = action === "set"
    ? ["action", "authorization", "key", "value"]
    : ["action", "authorization", "key"];
  assertKnownKeys(value, knownKeys, "desktop credential vault input");
  const key = normalizeNonEmptyString(value.key, "desktop credential vault key");
  if (!CREDENTIAL_VAULT_KEY_PATTERN.test(key)) {
    throw new Error("desktop credential vault key has an invalid format");
  }
  const authInput = assertObject(value.authorization, "desktop credential vault authorization");
  assertKnownKeys(authInput, ["expiresAt", "nonce", "signature"], "desktop credential vault authorization");
  const expiresAt = normalizeNonEmptyString(authInput.expiresAt, "desktop credential vault authorization expiresAt");
  const nonce = normalizeNonEmptyString(authInput.nonce, "desktop credential vault authorization nonce");
  const signature = normalizeNonEmptyString(authInput.signature, "desktop credential vault authorization signature");
  if (!CREDENTIAL_VAULT_AUTH_NONCE_PATTERN.test(nonce)) {
    throw new Error("desktop credential vault authorization nonce has an invalid format");
  }
  if (!CREDENTIAL_VAULT_AUTH_SIGNATURE_PATTERN.test(signature)) {
    throw new Error("desktop credential vault authorization signature has an invalid format");
  }
  const authorization = { expiresAt, nonce, signature };
  if (action === "set") {
    if (typeof value.value !== "string" || value.value.length > CREDENTIAL_VAULT_MAX_VALUE_CHARS) {
      throw new Error(`desktop credential vault value must be a string of at most ${CREDENTIAL_VAULT_MAX_VALUE_CHARS} characters`);
    }
    return { action, authorization, key, value: value.value };
  }
  return { action, authorization, key };
}

function desktopCredentialVaultAuthorizationPayload(
  command: Exclude<DesktopCredentialVaultCommand, { action: "available" }>,
  authorization: Pick<DesktopCredentialVaultAuthorization, "expiresAt" | "nonce">,
): string {
  const valueHash = createHash("sha256")
    .update(command.action === "set" ? command.value : "", "utf8")
    .digest("base64url");
  return [
    "monofield-desktop-credential-vault-v1",
    command.action,
    command.key,
    valueHash,
    authorization.nonce,
    authorization.expiresAt,
  ].join(CREDENTIAL_VAULT_AUTH_FIELD_SEPARATOR);
}

export function authorizeDesktopCredentialVaultCommand(
  secret: Buffer,
  command: Exclude<DesktopCredentialVaultCommand, { action: "available" }>,
  options: { expiresAt: string; nonce: string },
): DesktopCredentialVaultRequest {
  const signature = createHmac("sha256", secret)
    .update(desktopCredentialVaultAuthorizationPayload(command, options))
    .digest("base64url");
  return { ...command, authorization: { ...options, signature } } as DesktopCredentialVaultRequest;
}

export type DesktopCredentialVaultAuthorizationVerification =
  | { ok: true; command: Exclude<DesktopCredentialVaultCommand, { action: "available" }>; expiresAt: number; nonce: string }
  | { ok: false; reason: string };

export function verifyDesktopCredentialVaultRequest(
  secret: Buffer,
  request: Exclude<DesktopCredentialVaultRequest, { action: "available" }>,
  now = Date.now(),
): DesktopCredentialVaultAuthorizationVerification {
  const expiresAt = Date.parse(request.authorization.expiresAt);
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: "authorization expiry invalid" };
  if (expiresAt <= now) return { ok: false, reason: "authorization expired" };
  if (expiresAt - now > CREDENTIAL_VAULT_AUTH_TTL_MS * 2) {
    return { ok: false, reason: "authorization expiry exceeds permitted window" };
  }
  const command = request.action === "set"
    ? { action: request.action, key: request.key, value: request.value }
    : { action: request.action, key: request.key };
  const expected = createHmac("sha256", secret)
    .update(desktopCredentialVaultAuthorizationPayload(command, request.authorization))
    .digest("base64url");
  const actual = Buffer.from(request.authorization.signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (actual.length !== expectedBuffer.length || !timingSafeEqual(actual, expectedBuffer)) {
    return { ok: false, reason: "authorization signature invalid" };
  }
  return { ok: true, command, expiresAt, nonce: request.authorization.nonce };
}

function normalizeDesktopDevelopmentProcessInput(input: unknown): DesktopDevelopmentProcessInput {
  const value = assertObject(input, "desktop development process input");
  const action = normalizeNonEmptyString(value.action, "desktop development process action");
  if (action !== "start" && action !== "status" && action !== "terminate") {
    throw new Error("desktop development process action must be start, status, or terminate");
  }
  const ownerPid = value.ownerPid;
  if (typeof ownerPid !== "number" || !Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
    throw new Error("desktop development process ownerPid must be a positive integer");
  }
  const projectId = normalizeNonEmptyString(value.projectId, "desktop development process projectId");
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(projectId)) {
    throw new Error("desktop development process projectId has an invalid format");
  }
  if (action !== "start") {
    assertKnownKeys(value, ["action", "ownerPid", "projectId"], "desktop development process input");
    return { action, ownerPid, projectId };
  }
  assertKnownKeys(value, ["action", "args", "command", "cwd", "environment", "ownerPid", "port", "projectId", "windowsVerbatimArguments"], "desktop development process input");
  const command = normalizeNonEmptyString(value.command, "desktop development process command");
  const cwd = normalizeNonEmptyString(value.cwd, "desktop development process cwd");
  if (!Array.isArray(value.args) || value.args.length > 64 || value.args.some((arg) => typeof arg !== "string" || arg.length > 4_096)) {
    throw new Error("desktop development process args must be an array of at most 64 strings");
  }
  if (typeof value.port !== "number" || !Number.isInteger(value.port) || value.port < 1 || value.port > 65_535) {
    throw new Error("desktop development process port must be an integer between 1 and 65535");
  }
  if (value.windowsVerbatimArguments != null && typeof value.windowsVerbatimArguments !== "boolean") {
    throw new Error("desktop development process windowsVerbatimArguments must be a boolean");
  }
  let environment: Record<string, string> | undefined;
  if (value.environment != null) {
    const source = assertObject(value.environment, "desktop development process environment");
    const entries = Object.entries(source);
    if (entries.length > 64) throw new Error("desktop development process environment must contain at most 64 values");
    environment = {};
    for (const [key, envValue] of entries) {
      if (!DEVELOPMENT_ENVIRONMENT_KEY_PATTERN.test(key) || DEVELOPMENT_ENVIRONMENT_RESERVED_KEYS.has(key.toUpperCase())) {
        throw new Error(`desktop development process environment key ${key} is invalid or reserved`);
      }
      if (typeof envValue !== "string" || envValue.length > 8_192 || envValue.includes("\0")) {
        throw new Error("desktop development process environment values must be strings of at most 8192 characters");
      }
      environment[key] = envValue;
    }
  }
  return {
    action,
    args: value.args as string[],
    command,
    cwd,
    ...(environment && Object.keys(environment).length > 0 ? { environment } : {}),
    ownerPid,
    port: value.port,
    projectId,
    ...(value.windowsVerbatimArguments == null ? {} : { windowsVerbatimArguments: value.windowsVerbatimArguments }),
  };
}

function normalizeMessageType(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new SidecarContractError(SIDECAR_ERROR_CODES.INVALID_MESSAGE, `${label} type must be a non-empty string`);
  }
  return value;
}

export function normalizeDaemonSidecarMessage(input: unknown): DaemonSidecarMessage {
  const value = assertObject(input, "daemon sidecar message");
  const type = normalizeMessageType(value.type, "daemon sidecar message");
  if (type === SIDECAR_MESSAGES.STATUS || type === SIDECAR_MESSAGES.SHUTDOWN) {
    assertKnownKeys(value, ["type"], "daemon sidecar message");
    return { type };
  }
  if (type === SIDECAR_MESSAGES.REGISTER_DESKTOP_AUTH) {
    assertKnownKeys(value, ["input", "type"], "daemon sidecar message");
    return { input: normalizeRegisterDesktopAuthInput(value.input), type };
  }
  if (type === SIDECAR_MESSAGES.MINT_IMPORT_TOKEN) {
    assertKnownKeys(value, ["input", "type"], "daemon sidecar message");
    return { input: normalizeMintImportTokenInput(value.input), type };
  }
  throw new SidecarContractError(SIDECAR_ERROR_CODES.UNKNOWN_MESSAGE, `unknown daemon sidecar message: ${type}`);
}

export function normalizeWebSidecarMessage(input: unknown): WebSidecarMessage {
  const value = assertObject(input, "web sidecar message");
  const type = normalizeMessageType(value.type, "web sidecar message");
  if (type === SIDECAR_MESSAGES.STATUS || type === SIDECAR_MESSAGES.SHUTDOWN) {
    assertKnownKeys(value, ["type"], "web sidecar message");
    return { type };
  }
  throw new SidecarContractError(SIDECAR_ERROR_CODES.UNKNOWN_MESSAGE, `unknown web sidecar message: ${type}`);
}

export function normalizeDesktopSidecarMessage(input: unknown): DesktopSidecarMessage {
  const value = assertObject(input, "desktop sidecar message");
  const type = normalizeMessageType(value.type, "desktop sidecar message");
  switch (type) {
    case SIDECAR_MESSAGES.STATUS:
    case SIDECAR_MESSAGES.SHUTDOWN:
    case SIDECAR_MESSAGES.CONSOLE:
    case SIDECAR_MESSAGES.SHOW:
      assertKnownKeys(value, ["type"], "desktop sidecar message");
      return { type };
    case SIDECAR_MESSAGES.EVAL:
      assertKnownKeys(value, ["input", "type"], "desktop sidecar message");
      return { input: normalizeDesktopEvalInput(value.input), type };
    case SIDECAR_MESSAGES.SCREENSHOT:
      assertKnownKeys(value, ["input", "type"], "desktop sidecar message");
      return { input: normalizeDesktopScreenshotInput(value.input), type };
    case SIDECAR_MESSAGES.CLICK:
      assertKnownKeys(value, ["input", "type"], "desktop sidecar message");
      return { input: normalizeDesktopClickInput(value.input), type };
    case SIDECAR_MESSAGES.BROWSER_AUTOMATION:
      assertKnownKeys(value, ["input", "type"], "desktop sidecar message");
      return { input: normalizeDesktopBrowserAutomationInput(value.input), type };
    case SIDECAR_MESSAGES.EXPORT_PDF:
      assertKnownKeys(value, ["input", "type"], "desktop sidecar message");
      return { input: normalizeDesktopExportPdfInput(value.input), type };
    case SIDECAR_MESSAGES.EXPORT_ARTIFACT:
      assertKnownKeys(value, ["input", "type"], "desktop sidecar message");
      return { input: normalizeDesktopExportArtifactInput(value.input), type };
    case SIDECAR_MESSAGES.UPDATE:
      assertKnownKeys(value, ["input", "type"], "desktop sidecar message");
      return { input: normalizeDesktopUpdateInput(value.input), type };
    case SIDECAR_MESSAGES.CREDENTIAL_VAULT:
      assertKnownKeys(value, ["input", "type"], "desktop sidecar message");
      return { input: normalizeDesktopCredentialVaultInput(value.input), type };
    case SIDECAR_MESSAGES.DATABASE:
      assertKnownKeys(value, ["input", "type"], "desktop sidecar message");
      return { input: normalizeDesktopDatabaseInput(value.input), type };
    case SIDECAR_MESSAGES.DEVELOPMENT_PROCESS:
      assertKnownKeys(value, ["input", "type"], "desktop sidecar message");
      return { input: normalizeDesktopDevelopmentProcessInput(value.input), type };
    default:
      throw new SidecarContractError(SIDECAR_ERROR_CODES.UNKNOWN_MESSAGE, `unknown desktop sidecar message: ${type}`);
  }
}

export const OPEN_DESIGN_SIDECAR_CONTRACT = Object.freeze({
  appKeys: APP_KEYS,
  browserAutomationActions: DESKTOP_BROWSER_AUTOMATION_ACTIONS,
  defaults: SIDECAR_DEFAULTS,
  env: SIDECAR_RUNTIME_ENV,
  errorCodes: SIDECAR_ERROR_CODES,
  messages: SIDECAR_MESSAGES,
  modes: SIDECAR_MODES,
  normalizeApp: normalizeAppKey,
  normalizeNamespace,
  normalizeSource: normalizeSidecarSource,
  normalizeStamp: normalizeSidecarStamp,
  normalizeStampCriteria: normalizeSidecarStampCriteria,
  sources: SIDECAR_SOURCES,
  stampFields: SIDECAR_STAMP_FIELDS,
  stampFlags: SIDECAR_STAMP_FLAGS,
  updateActions: DESKTOP_UPDATE_ACTIONS,
  updateChannels: DESKTOP_UPDATE_CHANNELS,
  updateModes: DESKTOP_UPDATE_MODES,
  updateStates: DESKTOP_UPDATE_STATES,
} as const satisfies OpenDesignSidecarContract);
