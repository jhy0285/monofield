import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const LOG_TAIL_MAX_BYTES = 16_384;

export const STARTUP_FAILURE_EVENT = "packaged_runtime_failed";

export type StartupFailureKind = "daemon-start" | "web-start" | "path-access" | "unknown";

export interface StartupFailureClassification {
  failureKind: StartupFailureKind;
  exitCode: number | null;
  signal: string | null;
  logPath: string | null;
}

const EXIT_RE =
  /exited before reporting status \(code=(.*?), signal=(.*?)\); see (.*?) for details/;

export function classifyStartupFailure(
  error: unknown,
  isPathAccess: boolean,
): StartupFailureClassification {
  if (isPathAccess) {
    return { failureKind: "path-access", exitCode: null, signal: null, logPath: null };
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  const match = EXIT_RE.exec(message);
  if (!match) {
    return { failureKind: "unknown", exitCode: null, signal: null, logPath: null };
  }
  const rawCode = match[1];
  const rawSignal = match[2];
  const logPath = match[3] && match[3] !== "<no log path>" ? match[3] : null;
  const parsedCode = rawCode === "null" ? null : Number.parseInt(rawCode, 10);
  const exitCode = parsedCode == null || Number.isNaN(parsedCode) ? null : parsedCode;
  const signal = rawSignal === "none" ? null : rawSignal;
  const normalizedLogPath = logPath?.replace(/\\/g, "/") ?? null;
  const failureKind: StartupFailureKind = normalizedLogPath?.includes("/web/")
    ? "web-start"
    : "daemon-start";
  return { failureKind, exitCode, signal, logPath };
}

export function parseDaemonLogTail(logText: string): {
  errorCode?: string;
  missingModule?: string;
} {
  const out: { errorCode?: string; missingModule?: string } = {};
  const errMatch = /\bERR_[A-Z0-9_]+/.exec(logText);
  if (errMatch) out.errorCode = errMatch[0];
  const modMatch = /Cannot find package '([^']+)'|Cannot find module '([^']+)'/.exec(logText);
  if (modMatch) out.missingModule = modMatch[1] ?? modMatch[2];
  return out;
}

export function scrubUserPaths(value: string): string {
  return value
    .replace(/\/(Users|home)\/[^/\s]+/g, "/$1/<redacted>")
    .replace(/([A-Za-z]:\\Users\\)[^\\\s]+/g, "$1<redacted>");
}

export function resolveStartupDistinctId(
  namespace: string,
  installationRoot?: string | null,
): string {
  const dir = installationRoot?.trim()
    || process.env.MONOFIELD_INSTALLATION_DIR?.trim()
    || process.env.OD_INSTALLATION_DIR?.trim();
  try {
    if (dir) {
      const raw = readFileSync(join(dir, "installation.json"), "utf8");
      const parsed = JSON.parse(raw) as { installationId?: unknown };
      if (typeof parsed.installationId === "string" && parsed.installationId.length > 0) {
        return parsed.installationId;
      }
    }
  } catch {
    // fall through to synthetic
  }
  return `packaged-${namespace}`;
}

async function defaultReadLogTail(path: string): Promise<string | null> {
  try {
    const buf = await readFile(path);
    return buf.length > LOG_TAIL_MAX_BYTES
      ? buf.subarray(buf.length - LOG_TAIL_MAX_BYTES).toString("utf8")
      : buf.toString("utf8");
  } catch {
    return null;
  }
}

export interface CaptureDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => string;
  insertId?: string;
}

export async function captureStartupFailure(
  args: {
    distinctId: string;
    event: string;
    properties: Record<string, unknown>;
  },
  deps: CaptureDeps = {},
): Promise<void> {
  void args;
  void deps;
}

export interface ReportStartupFailureArgs {
  error: unknown;
  isPathAccess: boolean;
  distinctId: string;
  appVersion: string | null;
  namespace: string;
  source: string;
}

export interface ReportDeps extends CaptureDeps {
  readLogTail?: (path: string) => Promise<string | null>;
}

export async function reportStartupFailure(
  args: ReportStartupFailureArgs,
  deps: ReportDeps = {},
): Promise<void> {
  try {
    const classification = classifyStartupFailure(args.error, args.isPathAccess);
    if (classification.logPath) {
      const tail = await (deps.readLogTail ?? defaultReadLogTail)(classification.logPath);
      if (tail) {
        parseDaemonLogTail(tail);
      }
    }
    await captureStartupFailure(
      {
        distinctId: args.distinctId,
        event: STARTUP_FAILURE_EVENT,
        properties: {
          failure_kind: classification.failureKind,
          exit_code: classification.exitCode,
          signal: classification.signal,
          log_path: classification.logPath ? scrubUserPaths(classification.logPath) : null,
          app_version: args.appVersion,
          namespace: args.namespace,
          source: args.source,
          platform: process.platform,
        },
      },
      deps,
    );
  } catch {
    // Startup failure reporting must never become a new startup failure.
  }
}
