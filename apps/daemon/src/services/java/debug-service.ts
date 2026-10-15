import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { stat } from "node:fs/promises";
import type { JavaDebugState } from "@open-design/contracts";
import type { JavaTarget } from "./language-service.js";
import {
  javaDebugFrames,
  javaDebugLocals,
  javaDebugPrompt,
} from "./debug-parser.js";

type Session = {
  target: JavaTarget;
  child: ChildProcessWithoutNullStreams;
  state: JavaDebugState;
  tail: string;
  queue: Promise<unknown>;
  pending: {
    output: string;
    resolve: (value: string) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  } | null;
  collecting: boolean;
  needsCollect: boolean;
  stopped: boolean;
  frame: number;
};
export class JavaDebugService {
  private sessions = new Map<string, Session>();
  private closing = false;
  constructor(
    private readonly spawnDebugger: (
      command: string,
      args: string[],
      options: { cwd: string; stdio: "pipe"; windowsHide: true },
    ) => ChildProcessWithoutNullStreams = spawn,
  ) {}
  private key(target: JavaTarget) {
    return target.projectId + "\0" + target.root;
  }
  status(target: JavaTarget): JavaDebugState {
    return structuredClone(
      this.sessions.get(this.key(target))?.state ?? {
        state: "stopped",
        port: null,
        frames: [],
        locals: [],
        output: "",
        message: null,
      },
    );
  }
  async attach(target: JavaTarget, port: number, javaHome?: string) {
    if (this.closing) throw new Error("Debugger is shutting down");
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("Debugger port must be between 1 and 65535");
    const key = this.key(target);
    this.stop(target);
    if (this.sessions.size >= 2)
      throw new Error("Stop an unused Java debugger first");
    const home = javaHome?.trim() || process.env.JAVA_HOME;
    if (home && !path.isAbsolute(home))
      throw new Error("JDK home must be an absolute path");
    const command = home
      ? path.join(home, "bin", process.platform === "win32" ? "jdb.exe" : "jdb")
      : "jdb";
    const child = this.spawnDebugger(
      command,
      ['-J-Duser.language=en','-J-Duser.country=US',"-attach", `127.0.0.1:${port}`],
      {
        cwd: target.root,
        stdio: "pipe",
        windowsHide: true,
      },
    );
    const session: Session = {
      target,
      child,
      state: {
        state: "connecting",
        port,
        frames: [],
        locals: [],
        output: "",
        message: null,
      },
      tail: "",
      queue: Promise.resolve(),
      pending: null,
      collecting: false,
      needsCollect: false,
      stopped: false,
      frame: 1,
    };
    this.sessions.set(key, session);
    child.stdin.on("error", () =>
      this.failed(session, "Java debugger input closed"),
    );
    child.stdout.on("data", (part) => this.consume(session, String(part)));
    child.stderr.on("data", (part) => this.consume(session, String(part)));
    child.once("error", () =>
      this.failed(
        session,
        "Could not start jdb. Select a JDK 21 installation.",
      ),
    );
    child.once("close", () => {
      if (!session.stopped) this.failed(session, "Java debugger disconnected");
    });
    const timer = setTimeout(() => {
      if (session.state.state === "connecting") {
        this.failed(
          session,
          "Debugger attach timed out. Start the application in debug mode.",
        );
        child.kill();
      }
    }, 15000);
    timer.unref();
    child.once("close", () => clearTimeout(timer));
    return this.status(target);
  }
  private failed(session: Session, message: string) {
    if (session.stopped) return;
    session.state.state = "error";
    session.state.message = message;
    if (session.pending) {
      clearTimeout(session.pending.timer);
      session.pending.reject(new Error(message));
      session.pending = null;
    }
  }
  private consume(session: Session, part: string) {
    for (const [name, value] of Object.entries(process.env))
      if (/KEY|TOKEN|SECRET|PASSWORD/i.test(name) && value && value.length >= 8)
        part = part.split(value).join("[redacted]");
    session.state.output = (session.state.output + part).slice(-64000);
    session.tail = (session.tail + part).slice(-8000);
    if (session.pending) session.pending.output += part;
    if (
      /Breakpoint hit:|Step completed:|Exception occurred:/.test(session.tail)
    ) {
      session.state.state = "paused";
      session.needsCollect = true;
    }
    if (
      javaDebugPrompt(part) ||
      javaDebugPrompt(session.tail) ||
      javaDebugPrompt(session.pending?.output ?? "")
    ) {
      const prompt = /\[(\d+)\]\s*$/.exec(
        session.pending?.output ?? session.tail ?? part,
      );
      if (prompt) session.frame = Number(prompt[1]);
      if (session.state.state === "connecting")
        session.state.state = prompt ? "paused" : "running";
      if (session.pending) {
        const pending = session.pending;
        session.pending = null;
        clearTimeout(pending.timer);
        pending.resolve(pending.output);
      }
      session.tail = "";
      // Wait for the stop-event prompt before sending "where". Otherwise that
      // prompt can be mistaken for the command response and shift locals by one.
      if (session.needsCollect && !session.collecting) {
        session.needsCollect = false;
        session.collecting = true;
        void this.enqueue(session, () => this.collect(session))
          .catch((error) => {
            session.state.message = error.message;
          })
          .finally(() => {
            session.collecting = false;
          });
      }
    }
    if (
      /Unable to attach|Connection refused|The application exited|Disconnected from target VM/.test(
        part,
      )
    )
      this.failed(session, "The target JVM is unavailable or has exited");
  }
  private enqueue<T>(
    session: Session,
    operation: () => Promise<T>,
  ): Promise<T> {
    const next = session.queue.catch(() => undefined).then(operation);
    session.queue = next;
    return next;
  }
  private send(session: Session, command: string): Promise<string> {
    if (session.stopped || session.state.state === "error")
      return Promise.reject(new Error("Debugger is unavailable"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending = null;
        this.failed(
          session,
          "Debugger command timed out. Detach and attach again.",
        );
        session.child.kill();
        reject(new Error("Debugger command timed out"));
      }, 5000);
      session.pending = { output: "", resolve, reject, timer };
      session.child.stdin.write(command + "\n");
    });
  }
  private async collect(session: Session) {
    if (session.state.state !== "paused") return;
    const frames = javaDebugFrames(await this.send(session, "where"));
    for (const frame of frames) {
      const cls = frame.method
        .split(".")
        .slice(0, -1)
        .join("/")
        .replace(/\$.*$/, "");
      if (!/^[A-Za-z_$][\w$]*(?:\/[A-Za-z_$][\w$]*)*$/.test(cls)) continue;
      for (const relative of [
        `src/main/java/${cls}.java`,
        `src/test/java/${cls}.java`,
        `${cls}.java`,
      ]) {
        if (
          await stat(path.join(session.target.root, relative))
            .then((item) => item.isFile())
            .catch(() => false)
        ) {
          frame.path = path.posix.join(session.target.projectPath, relative);
          break;
        }
      }
    }
    session.state.frames = frames;
    session.state.locals = javaDebugLocals(await this.send(session, "locals"));
  }
  async command(
    target: JavaTarget,
    action: string,
    options: { className?: string; line?: number; index?: number } = {},
  ) {
    const session = this.sessions.get(this.key(target));
    if (
      !session ||
      session.state.state === "connecting" ||
      session.state.state === "error"
    )
      throw new Error("Attach a Java debugger first");
    return this.enqueue(session, async () => {
      let command: string;
      if (action === "breakpoint" || action === "remove-breakpoint") {
        if (
          !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(
            options.className ?? "",
          ) ||
          !Number.isInteger(options.line) ||
          options.line! < 1 ||
          options.line! > 1000000
        )
          throw new Error("Valid class name and line are required");
        command = `${action === "breakpoint" ? "stop at" : "clear"} ${options.className}:${options.line}`;
      } else if (["continue", "step", "next"].includes(action)) {
        if (session.state.state !== "paused" && action !== "continue")
          throw new Error("Pause at a breakpoint first");
        command = action === "continue" ? "cont" : action;
        session.state.state = "running";
        session.state.frames = [];
        session.state.locals = [];
      } else if (action === "frame") {
        if (
          session.state.state !== "paused" ||
          !Number.isInteger(options.index) ||
          !session.state.frames.some((frame) => frame.index === options.index)
        )
          throw new Error("Select an existing paused frame");
        const delta = options.index! - session.frame;
        if (delta)
          await this.send(
            session,
            `${delta > 0 ? "up" : "down"} ${Math.abs(delta)}`,
          );
        await this.collect(session);
        return this.status(target);
      } else if (action === "refresh") {
        await this.collect(session);
        return this.status(target);
      } else throw new Error("Unsupported debugger operation");
      const output = await this.send(session, command);
      if (
        /Unable to set|No code at line|No class named|Invalid|Usage:|No breakpoint set|Not found|Nothing suspended/i.test(
          output,
        )
      )
        throw new Error(output.trim().slice(0, 1000));
      session.state.message = null;
      return this.status(target);
    });
  }
  stop(target: JavaTarget) {
    const key = this.key(target),
      session = this.sessions.get(key);
    if (!session) return;
    session.stopped = true;
    if (session.pending) {
      clearTimeout(session.pending.timer);
      session.pending.reject(new Error("Debugger detached"));
    }
    session.child.kill();
    this.sessions.delete(key);
  }
  shutdown() {
    this.closing = true;
    for (const session of this.sessions.values()) this.stop(session.target);
  }
}
