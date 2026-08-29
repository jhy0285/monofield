import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

import type {
  DesktopDevelopmentProcessInput,
  DesktopDevelopmentProcessResult,
} from "@open-design/sidecar-proto";

const MAX_LOG_LINES = 120;

type ManagedProcess = {
  child: ChildProcess | null;
  error: string | null;
  logs: string[];
  launchFingerprint: string;
  ownerPid: number;
  pid: number | null;
  projectId: string;
};

function normalizedAbsolutePathIdentity(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function launchFingerprint(input: Extract<DesktopDevelopmentProcessInput, { action: "start" }>): string {
  const environment = Object.entries(input.environment ?? {})
    .sort(([left], [right]) => left.localeCompare(right));
  return createHash("sha256").update(JSON.stringify({
    args: input.args,
    command: normalizedAbsolutePathIdentity(input.command),
    cwd: normalizedAbsolutePathIdentity(input.cwd),
    environment,
    port: input.port,
    windowsVerbatimArguments: input.windowsVerbatimArguments === true,
  })).digest("hex");
}

type DevelopmentProcessBrokerOptions = {
  isAlive?: (pid: number) => boolean;
  monitorIntervalMs?: number;
  spawnProcess?: typeof spawn;
  terminateTree?: (pid: number) => Promise<void>;
};

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

async function terminateProcessTree(pid: number): Promise<void> {
  if (!isProcessAlive(pid)) return;
  if (process.platform !== "win32") {
    try { process.kill(-pid, "SIGTERM"); }
    catch { try { process.kill(pid, "SIGTERM"); } catch { /* already exited */ } }
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0 || !isProcessAlive(pid)) resolve();
      else reject(new Error(`Failed to stop development server ${pid}: ${stderr.trim() || `taskkill exited ${code ?? "unknown"}`}`));
    });
  });
}

function appendLogs(record: ManagedProcess, chunk: unknown): void {
  const lines = String(chunk)
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  record.logs = [...record.logs, ...lines].slice(-MAX_LOG_LINES);
}

/** Desktop-owned process manager for discovered local development servers. */
export class DevelopmentProcessBroker {
  private readonly records = new Map<string, ManagedProcess>();
  private readonly isAlive: (pid: number) => boolean;
  private readonly spawnProcess: typeof spawn;
  private readonly terminateTree: (pid: number) => Promise<void>;
  private readonly monitor: NodeJS.Timeout;

  constructor(options: DevelopmentProcessBrokerOptions = {}) {
    this.isAlive = options.isAlive ?? isProcessAlive;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.terminateTree = options.terminateTree ?? terminateProcessTree;
    this.monitor = setInterval(() => { void this.reapOrphanedOwners(); }, options.monitorIntervalMs ?? 1_000);
    this.monitor.unref();
  }

  async execute(input: DesktopDevelopmentProcessInput): Promise<DesktopDevelopmentProcessResult> {
    if (input.ownerPid === process.pid) throw new Error("Refusing to use the MonoField desktop process as a development-server owner");
    if (input.action === "start") return await this.start(input);
    const record = this.records.get(input.projectId);
    if (record && record.ownerPid !== input.ownerPid) throw new Error("The development server belongs to another daemon process");
    if (input.action === "terminate" && record) await this.terminate(record);
    return this.snapshot(input.action, input.projectId, record ?? null);
  }

  async dispose(): Promise<void> {
    clearInterval(this.monitor);
    const records = [...this.records.values()];
    this.records.clear();
    await Promise.allSettled(records.map((record) => this.terminate(record)));
  }

  private async start(input: Extract<DesktopDevelopmentProcessInput, { action: "start" }>): Promise<DesktopDevelopmentProcessResult> {
    if (!this.isAlive(input.ownerPid)) throw new Error("The development-server owner is not running");
    if (!path.isAbsolute(input.command) || !path.isAbsolute(input.cwd)) {
      throw new Error("Development server command and cwd must be absolute paths");
    }
    const existing = this.records.get(input.projectId);
    const requestedFingerprint = launchFingerprint(input);
    if (existing && existing.ownerPid !== input.ownerPid) {
      if (this.isAlive(existing.ownerPid)) throw new Error("The development server belongs to another daemon process");
      await this.terminate(existing);
    }
    if (existing?.child && existing.pid && this.isAlive(existing.pid)) {
      if (existing.launchFingerprint === requestedFingerprint) {
        return this.snapshot("start", input.projectId, existing);
      }
      await this.terminate(existing);
    } else if (existing) {
      this.records.delete(existing.projectId);
    }
    const record: ManagedProcess = {
      child: null,
      error: null,
      logs: [],
      launchFingerprint: requestedFingerprint,
      ownerPid: input.ownerPid,
      pid: null,
      projectId: input.projectId,
    };
    const child = this.spawnProcess(input.command, input.args, {
      cwd: input.cwd,
      env: {
        ...process.env,
        ...input.environment,
        ASPNETCORE_URLS: `http://127.0.0.1:${input.port}`,
        BROWSER: "none",
        GRADIO_SERVER_PORT: String(input.port),
        PORT: String(input.port),
        SERVER_PORT: String(input.port),
        STREAMLIT_SERVER_PORT: String(input.port),
      },
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: input.windowsVerbatimArguments,
    });
    record.child = child;
    record.pid = child.pid ?? null;
    this.records.set(input.projectId, record);
    child.stdout?.on("data", (chunk) => appendLogs(record, chunk));
    child.stderr?.on("data", (chunk) => appendLogs(record, chunk));
    child.once("error", (error) => { record.error = error.message; });
    child.once("exit", (code, signal) => {
      record.child = null;
      record.pid = null;
      if (record.error == null && code !== 0) record.error = `Development server exited (${signal ?? code ?? "unknown"})`;
    });
    if (record.pid == null) record.error = "The development server did not expose a process id";
    return this.snapshot("start", input.projectId, record);
  }

  private async terminate(record: ManagedProcess): Promise<void> {
    const pid = record.pid;
    // Keep the broker record until the OS confirms that the process tree was
    // terminated.  Clearing it first made a failed Windows `taskkill` look
    // stopped and removed the only handle MonoField had for retrying.
    if (pid != null) await this.terminateTree(pid);
    record.child = null;
    record.pid = null;
    this.records.delete(record.projectId);
  }

  private snapshot(action: DesktopDevelopmentProcessInput["action"], projectId: string, record: ManagedProcess | null): DesktopDevelopmentProcessResult {
    const running = Boolean(record?.pid && this.isAlive(record.pid));
    return {
      accepted: true,
      action,
      error: record?.error ?? null,
      logs: [...(record?.logs ?? [])],
      pid: running ? record?.pid ?? null : null,
      projectId,
      running,
    };
  }

  private async reapOrphanedOwners(): Promise<void> {
    const orphaned = [...this.records.values()].filter((record) => !this.isAlive(record.ownerPid));
    await Promise.allSettled(orphaned.map((record) => this.terminate(record)));
  }
}
