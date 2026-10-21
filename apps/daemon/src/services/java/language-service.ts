import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  JavaToolsStatus,
  JavaPosition,
  JavaSemanticResult,
  JavaTextEdit,
  JavaRenamePlan,
} from "@open-design/contracts";
import { JavaLanguageRpc } from "./language-rpc.js";
import { applyJavaTextEdits, javaOffset } from "./text-edits.js";
import {
  installJavaTools,
  javaLauncher,
  javaToolsInstalled,
  JAVA_TOOLS_VERSION,
} from "./installation.js";
import { javaMavenSettings, javaMavenProfile } from "./maven-settings.js";
import { JavaSourceMirror } from "./source-mirror.js";

export interface JavaTarget {
  projectId: string;
  workspaceRoot: string;
  root: string;
  projectPath: string;
}
interface Session {
  target: JavaTarget;
  child: ChildProcessWithoutNullStreams;
  rpc: JavaLanguageRpc;
  state: JavaToolsStatus["state"];
  message: string | null;
  lastUse: number;
  documents: Map<string, { version: number; text: string }>;
  diagnostics: Map<string, JavaToolsStatus["diagnostics"]>;
  plans: Map<string, { plan: JavaRenamePlan; expires: number }>;
  stopped: boolean;
  checkingImport: boolean;
  mirror: JavaSourceMirror;
}
export type JavaProjectRead = (
  name: string,
) => Promise<{ name: string; buffer: Buffer }>;
export type JavaProjectWrite = (
  name: string,
  buffer: Buffer,
  expectedSha256: string,
) => Promise<unknown>;
const digest = (text: string | Buffer) =>
  createHash("sha256").update(text).digest("hex");
const error = (text: string, status = 400) =>
  Object.assign(new Error(text), { status });

export class JavaLanguageService {
  private sessions = new Map<string, Session>();
  private starts = new Map<string, Promise<JavaToolsStatus>>();
  private applying = new Set<string>();
  private closing = false;
  private preferences = new Map<
    string,
    { javaHome?: string; resolveDependencies: boolean }
  >();
  private idleTimer: NodeJS.Timeout;
  constructor(private readonly dataRoot: string) {
    this.idleTimer = setInterval(() => {
      for (const [key, session] of this.sessions)
        if (Date.now() - session.lastUse > 120000) this.stopKey(key);
    }, 15000);
    this.idleTimer.unref();
  }
  private key(target: JavaTarget) {
    return digest(`${target.projectId}\0${target.root}`);
  }
  async status(target: JavaTarget, file?: string): Promise<JavaToolsStatus> {
    const session = this.sessions.get(this.key(target));
    return {
      state: session?.state ?? "stopped",
      installed: await javaToolsInstalled(this.dataRoot),
      version: JAVA_TOOLS_VERSION,
      projectPath: target.projectPath,
      message: session?.message ?? null,
      diagnostics: file ? (session?.diagnostics.get(file) ?? []) : [],
      pid: session?.child.pid ?? null,
      resumeAvailable: this.preferences.has(this.key(target)),
    };
  }
  async start(
    target: JavaTarget,
    javaHome?: string,
    resolveDependencies = false,
  ): Promise<JavaToolsStatus> {
    if (this.closing) throw error("Java tools are shutting down", 503);
    const key = this.key(target),
      existing = this.sessions.get(key);
    if (existing && existing.state !== "error") return this.status(target);
    if (existing) this.stopKey(key);
    const pending = this.starts.get(key);
    if (pending) return pending;
    if (this.sessions.size + this.starts.size >= 2)
      throw error(
        "Two Java modules are already open. Stop an unused Java session.",
        409,
      );
    const job = (async () => {
      await installJavaTools(this.dataRoot);
      if (this.closing) throw error("Java tools are shutting down", 503);
      const launcher = await javaLauncher(this.dataRoot);
      const home = javaHome?.trim() || process.env.JAVA_HOME;
      const java = home
        ? path.join(
            home,
            "bin",
            process.platform === "win32" ? "java.exe" : "java",
          )
        : "java";
      if (home && !path.isAbsolute(home))
        throw error("Java home must be an absolute JDK directory");
      const work = path.join(
        this.dataRoot,
        "java-workspaces",
        key + "-isolated-v1",
      );
      await mkdir(work, { recursive: true, mode: 0o700 });
      const mirror = new JavaSourceMirror(
        target.workspaceRoot,
        path.join(this.dataRoot, "java-sources", key),
        this.dataRoot,
      );
      await mirror.sync();
      const analysisRoot = path.resolve(mirror.root, target.projectPath);
      const { profiles: maven, temporaryFile } = await javaMavenProfile(
        {
          ...(await javaMavenSettings(target.root)),
          projectProfileSelected: false,
        },
        work,
      );
      const child = spawn(
        java,
        [
          "-Declipse.application=org.eclipse.jdt.ls.core.id1",
          "-Dosgi.bundles.defaultStartLevel=4",
          "-Declipse.product=org.eclipse.jdt.ls.core.product",
          "-Djava.import.generatesMetadataFilesAtProjectRoot=false",
          "-Xms32m",
          "-Xmx512m",
          "-XX:+UseSerialGC",
          "-XX:ReservedCodeCacheSize=64m",
          "-XX:MinHeapFreeRatio=10",
          "-XX:MaxHeapFreeRatio=20",
          "--add-modules=ALL-SYSTEM",
          "--add-opens",
          "java.base/java.util=ALL-UNNAMED",
          "--add-opens",
          "java.base/java.lang=ALL-UNNAMED",
          "-jar",
          launcher.jar,
          "-configuration",
          launcher.config,
          "-data",
          work,
        ],
        { cwd: analysisRoot, stdio: "pipe", windowsHide: true },
      );
      const configuration = {
        java: {
          // Maven owns compiler outputs. Eclipse autobuild can overwrite
          // target/classes without Maven's -parameters and break Spring routes.
          autobuild: { enabled: false },
          configuration: { updateBuildConfiguration: "automatic", maven },
          import: {
            generatesMetadataFilesAtProjectRoot: false,
            gradle: { enabled: false },
            maven: {
              enabled: true,
              offline: { enabled: !resolveDependencies },
            },
          },
          saveActions: { organizeImports: false },
          format: { enabled: false },
        },
      };
      const session: Session = {
        target,
        child,
        rpc: null!,
        state: "starting",
        message: null,
        lastUse: Date.now(),
        documents: new Map(),
        diagnostics: new Map(),
        plans: new Map(),
        stopped: false,
        checkingImport: false,
        mirror,
      };
      session.rpc = new JavaLanguageRpc(
        child,
        (method, params) => {
          if (method === "language/status") {
            if (params?.type === "Started" && !session.checkingImport) {
              session.checkingImport = true;
              void this.checkImport(session);
            } else if (
              params?.type === "ProjectStatus" &&
              params?.message !== "OK"
            )
              session.message =
                "Java project import reported warnings. Prepare Maven dependencies and check Java problems if semantic results are incomplete.";
          } else if (
            method === "textDocument/publishDiagnostics" &&
            typeof params?.uri === "string"
          ) {
            const file = this.relative(target, params.uri);
            if (!file) return;
            const document = session.documents.get(params.uri);
            if (
              typeof params.version === "number" &&
              document &&
              params.version < document.version
            )
              return;
            session.diagnostics.set(
              file,
              Array.isArray(params.diagnostics)
                ? params.diagnostics.slice(0, 1000).map((item: any) => ({
                    range: item.range,
                    message: String(item.message ?? "").slice(0, 3000),
                    severity: Number(item.severity ?? 3),
                  }))
                : [],
            );
          }
        },
        configuration,
      );
      this.sessions.set(key, session);
      if (this.preferences.size >= 64)
        this.preferences.delete(this.preferences.keys().next().value!);
      this.preferences.set(key, {
        ...(javaHome ? { javaHome } : {}),
        resolveDependencies,
      });
      child.once("error", () => {
        session.state = "error";
        session.message = "Java could not start. Select a JDK 21 or newer.";
      });
      child.once("close", () => {
        if (temporaryFile) void unlink(temporaryFile).catch(() => undefined);
      });
      child.once("close", () => {
        if (!session.stopped) {
          session.state = "error";
          session.message = "Java language server stopped. Restart Java tools.";
        }
      });
      void (async () => {
        await session.rpc.request(
          "initialize",
          {
            processId: process.pid,
            rootUri: pathToFileURL(analysisRoot).href,
            workspaceFolders: [
              {
                uri: pathToFileURL(analysisRoot).href,
                name: path.basename(target.root),
              },
            ],
            capabilities: {
              workspace: { configuration: true, applyEdit: false },
              textDocument: {
                completion: { completionItem: { snippetSupport: false } },
                definition: { linkSupport: true },
                publishDiagnostics: { versionSupport: true },
              },
            },
            initializationOptions: { settings: configuration },
          },
          90000,
        );
        session.rpc.notify("initialized", {});
        session.rpc.notify("workspace/didChangeConfiguration", {
          settings: configuration,
        });
      })().catch(() => {
        if (!session.stopped) {
          session.state = "error";
          session.message =
            "Java initialization failed. Check JDK 21 and project dependencies.";
          session.child.kill();
        }
      });
      return this.status(target);
    })();
    this.starts.set(key, job);
    try {
      return await job;
    } finally {
      this.starts.delete(key);
    }
  }
  private async checkImport(session: Session) {
    // Recent JDT versions announce Started before progressive Maven import is
    // finished. Require an actual Java classpath rather than a transport ACK.
    const deadline = Date.now() + 90000;
    while (
      !session.stopped &&
      session.state !== "error" &&
      Date.now() < deadline
    ) {
      try {
        const result = await session.rpc.request(
          "workspace/executeCommand",
          {
            command: "java.project.getClasspaths",
            arguments: [
              pathToFileURL(
                path.resolve(session.mirror.root, session.target.projectPath),
              ).href,
              JSON.stringify({ scope: "runtime" }),
            ],
          },
          10000,
        );
        if (Array.isArray(result?.classpaths) && result.classpaths.length) {
          session.state = "ready";
          session.message = null;
          session.lastUse = Date.now();
          return;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!session.stopped && session.state !== "error") {
      session.state = "error";
      session.message =
        "Java project indexing did not finish. Prepare Maven dependencies and restart Java tools.";
    }
  }
  private relative(target: JavaTarget, uri: string): string | null {
    try {
      const name = fileURLToPath(uri),
        relative = path.relative(
          this.sessions.get(this.key(target))?.mirror.root ??
            target.workspaceRoot,
          name,
        );
      if (
        path.isAbsolute(relative) ||
        relative === ".." ||
        relative.startsWith(".." + path.sep)
      )
        return null;
      return relative.replace(/\\/g, "/");
    } catch {
      return null;
    }
  }
  private uri(target: JavaTarget, file: string) {
    const session = this.sessions.get(this.key(target));
    if (!session) throw error("Java tools are stopped", 409);
    return pathToFileURL(path.join(session.mirror.root, file)).href;
  }
  private ready(target: JavaTarget) {
    const session = this.sessions.get(this.key(target));
    if (session?.state !== "ready")
      throw error(
        "Java language tools are not ready. Start or restart the session.",
        409,
      );
    session.lastUse = Date.now();
    return session;
  }
  private async resume(target: JavaTarget) {
    const key = this.key(target),
      preferences = this.preferences.get(key);
    if (!this.sessions.has(key) && preferences)
      await this.start(
        target,
        preferences.javaHome,
        preferences.resolveDependencies,
      );
    const deadline = Date.now() + 90000;
    while (
      this.sessions.get(key)?.state === "starting" &&
      Date.now() < deadline &&
      !this.closing
    )
      await new Promise((resolve) => setTimeout(resolve, 100));
    return this.ready(target);
  }
  async document(target: JavaTarget, file: string, text: string) {
    if (Buffer.byteLength(text) > 512 * 1024)
      throw error("Java editor limit is 512 KiB");
    const session = this.ready(target);
    const uri = this.uri(target, file);
    const previous = session.documents.get(uri);
    if (previous?.text === text) return previous.version;
    const version = (previous?.version ?? 0) + 1;
    if (!previous) {
      if (session.documents.size >= 64)
        throw error("Close an unused Java document");
      session.rpc.notify("textDocument/didOpen", {
        textDocument: { uri, languageId: "java", version, text },
      });
    } else
      session.rpc.notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    session.documents.set(uri, { version, text });
    return version;
  }
  closeDocument(target: JavaTarget, file: string) {
    const session = this.sessions.get(this.key(target));
    if (!session || session.state !== "ready") return;
    const uri = this.uri(target, file);
    if (session.documents.delete(uri))
      session.rpc.notify("textDocument/didClose", { textDocument: { uri } });
    session.diagnostics.delete(file);
  }
  async query(
    target: JavaTarget,
    file: string,
    text: string,
    position: JavaPosition,
    operation: "completion" | "definition" | "references" | "rename" | "hover",
    read: JavaProjectRead,
    newName?: string,
  ): Promise<JavaSemanticResult> {
    javaOffset(text, position);
    await this.resume(target);
    const active = this.ready(target),
      changed = await active.mirror.sync();
    const sourceHashes = active.mirror.sourceHashes();
    if (changed.length)
      active.rpc.notify("workspace/didChangeWatchedFiles", {
        changes: changed.map((file) => ({
          uri: this.uri(target, file),
          type: 2,
        })),
      });
    const version = await this.document(target, file, text),
      session = this.ready(target),
      uri = this.uri(target, file);
    const params = {
      textDocument: { uri },
      position,
      ...(operation === "references"
        ? { context: { includeDeclaration: true } }
        : {}),
      ...(operation === "rename" ? { newName } : {}),
    };
    if (
      operation === "rename" &&
      !/^[A-Za-z_$][\w$]{0,127}$/.test(newName ?? "")
    )
      throw error("Use a valid Java identifier");
    const result = await session.rpc.request(
      "textDocument/" + operation,
      params,
    );
    if (operation === "hover")
      return {
        version,
        hover:
          typeof result?.contents === "string"
            ? result.contents
            : (result?.contents?.value ??
              JSON.stringify(result?.contents ?? "")),
      };
    if (operation === "completion") {
      const items = Array.isArray(result) ? result : (result?.items ?? []);
      return {
        version,
        completions: items.slice(0, 100).map((item: any) => ({
          label: String(item.label ?? "").slice(0, 300),
          detail: String(item.detail ?? "").slice(0, 1000),
          edit: {
            range: item.textEdit?.range ??
              item.textEdit?.replace ?? { start: position, end: position },
            newText: String(
              item.textEdit?.newText ?? item.insertText ?? item.label ?? "",
            ),
          },
          ...(Array.isArray(item.additionalTextEdits)
            ? { additionalEdits: item.additionalTextEdits }
            : {}),
        })),
      };
    }
    if (operation === "rename") {
      const edits = new Map<string, JavaTextEdit[]>();
      for (const [uri, values] of Object.entries(result?.changes ?? {}))
        edits.set(uri, values as JavaTextEdit[]);
      for (const item of result?.documentChanges ?? []) {
        if (!item.textDocument || !Array.isArray(item.edits))
          throw error(
            "File creation, deletion and file renaming require a separate review",
          );
        edits.set(item.textDocument.uri, item.edits);
      }
      if (!edits.size || edits.size > 100)
        throw error("Rename produced no supported edits or exceeded 100 files");
      const files: JavaRenamePlan["files"] = [];
      let bytes = 0;
      for (const [uri, values] of edits) {
        const name = this.relative(target, uri);
        if (!name) throw error("Rename crosses the imported project boundary");
        const loaded = await read(name),
          before = loaded.buffer.toString("utf8");
        if (sourceHashes.get(name) !== digest(loaded.buffer))
          throw error(
            "Source changed during Java analysis. Preview the rename again.",
            409,
          );
        const open = session.documents.get(uri);
        if (open && open.text !== before)
          throw error(
            "Save all affected Java documents before applying a rename",
          );
        const after = applyJavaTextEdits(before, values);
        bytes += Buffer.byteLength(before) + Buffer.byteLength(after);
        if (bytes > 5 * 1024 * 1024) throw error("Rename exceeds 5 MiB");
        files.push({
          path: loaded.name,
          sha256: digest(loaded.buffer),
          before,
          after,
        });
      }
      const plan = {
        id: randomUUID(),
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        files,
      };
      for (const [id, item] of session.plans)
        if (item.expires < Date.now()) session.plans.delete(id);
      if (session.plans.size >= 4)
        session.plans.delete(session.plans.keys().next().value!);
      session.plans.set(plan.id, { plan, expires: Date.now() + 600000 });
      return { version, rename: plan };
    }
    const locations = Array.isArray(result) ? result : result ? [result] : [];
    return {
      version,
      locations: locations
        .flatMap((item: any) => {
          const name = this.relative(target, item.uri ?? item.targetUri);
          return name
            ? [
                {
                  path: name,
                  range:
                    item.range ?? item.targetSelectionRange ?? item.targetRange,
                },
              ]
            : [];
        })
        .slice(0, 200),
    };
  }
  async applyRename(
    target: JavaTarget,
    id: string,
    read: JavaProjectRead,
    write: JavaProjectWrite,
  ) {
    const session = this.ready(target),
      entry = session.plans.get(id);
    if (!entry || entry.expires < Date.now())
      throw error("Rename preview expired. Preview again.", 409);
    if (this.applying.has(target.projectId))
      throw error("Another rename is being applied", 409);
    this.applying.add(target.projectId);
    const applied: JavaRenamePlan["files"] = [];
    try {
      for (const file of entry.plan.files)
        if (digest((await read(file.path)).buffer) !== file.sha256)
          throw error(
            "Source changed after rename preview. Preview again.",
            409,
          );
      for (const file of entry.plan.files) {
        await write(file.path, Buffer.from(file.after), file.sha256);
        applied.push(file);
      }
      session.plans.delete(id);
      for (const file of entry.plan.files) {
        const uri = this.uri(target, file.path);
        if (session.documents.has(uri))
          await this.document(target, file.path, file.after);
      }
      await session.mirror.sync();
      session.rpc.notify("workspace/didChangeWatchedFiles", {
        changes: entry.plan.files.map((file) => ({
          uri: this.uri(target, file.path),
          type: 2,
        })),
      });
      return { changedFiles: entry.plan.files.map((file) => file.path) };
    } catch (failure) {
      const failed: string[] = [];
      for (const file of applied.reverse())
        try {
          await write(file.path, Buffer.from(file.before), digest(file.after));
        } catch {
          failed.push(file.path);
        }
      if (failed.length)
        throw error(
          "Rename was interrupted; some files need manual recovery: " +
            failed.join(", "),
          409,
        );
      throw failure;
    } finally {
      this.applying.delete(target.projectId);
    }
  }
  stop(target: JavaTarget) {
    this.preferences.delete(this.key(target));
    this.stopKey(this.key(target));
  }
  private stopKey(key: string) {
    const session = this.sessions.get(key);
    if (!session) return;
    session.stopped = true;
    session.rpc.close();
    session.child.kill();
    this.sessions.delete(key);
  }
  shutdown() {
    this.closing = true;
    this.preferences.clear();
    clearInterval(this.idleTimer);
    for (const key of this.sessions.keys()) this.stopKey(key);
  }
}
