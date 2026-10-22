import type { ChildProcessWithoutNullStreams } from "node:child_process";

/** Bounded Content-Length JSON-RPC over the trusted Java server's stdio. */
export class JavaLanguageRpc {
  private buffer = Buffer.alloc(0);
  private nextId = 0;
  private closed = false;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly onMessage: (method: string, params: any) => void,
    private readonly configuration: Record<string, unknown>,
  ) {
    child.stdin.on("error", () =>
      this.close(new Error("Java language input closed")),
    );
    child.stderr.resume();
    child.stdout.on("data", (part) => {
      try {
        this.consume(part);
      } catch {
        this.close(new Error("Invalid Java language protocol response"));
        child.kill();
      }
    });
    child.once("error", () =>
      this.close(new Error("Java language process could not start")),
    );
    child.once("close", () =>
      this.close(new Error("Java language process stopped")),
    );
  }
  private consume(part: Buffer) {
    this.buffer = Buffer.concat([this.buffer, part]);
    if (this.buffer.length > 12 * 1024 * 1024)
      throw new Error("Protocol size limit");
    while (this.buffer.length) {
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end < 0) {
        if (this.buffer.length > 8192) throw new Error("Header limit");
        return;
      }
      const header = this.buffer.subarray(0, end).toString("ascii");
      const length = Number(/^Content-Length:\s*(\d+)\s*$/im.exec(header)?.[1]);
      if (!Number.isInteger(length) || length < 1 || length > 10 * 1024 * 1024)
        throw new Error("Invalid length");
      if (this.buffer.length < end + 4 + length) return;
      const message = JSON.parse(
        this.buffer.subarray(end + 4, end + 4 + length).toString("utf8"),
      );
      this.buffer = this.buffer.subarray(end + 4 + length);
      if (typeof message.method === "string") {
        if (message.id !== undefined)
          this.send({
            jsonrpc: "2.0",
            id: message.id,
            result:
              message.method === "workspace/configuration"
                ? (message.params?.items ?? []).map((item: any) => {
                    if (typeof item.section !== "string" || !item.section)
                      return this.configuration;
                    let value: any = this.configuration;
                    for (const key of item.section.split(".")) {
                      if (
                        !value ||
                        typeof value !== "object" ||
                        !Object.hasOwn(value, key)
                      )
                        return null;
                      value = value[key];
                    }
                    return value;
                  })
                : message.method === "workspace/applyEdit"
                  ? {
                      applied: false,
                      failureReason:
                        "Changes require an explicit MonoField review",
                    }
                  : null,
          });
        else this.onMessage(message.method, message.params);
      } else {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error)
          pending.reject(
            new Error(
              String(message.error.message ?? "Java language request failed"),
            ),
          );
        else pending.resolve(message.result);
      }
    }
  }
  private send(message: unknown) {
    if (this.closed) throw new Error("Java language process stopped");
    const body = Buffer.from(JSON.stringify(message));
    this.child.stdin.write(
      Buffer.concat([
        Buffer.from(`Content-Length: ${body.length}\r\n\r\n`),
        body,
      ]),
    );
  }
  notify(method: string, params: unknown) {
    this.send({ jsonrpc: "2.0", method, params });
  }
  request(method: string, params: unknown, timeoutMs = 30000): Promise<any> {
    if (this.closed || this.pending.size >= 32)
      return Promise.reject(
        new Error("Java language server is unavailable or busy"),
      );
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        try {
          this.notify("$/cancelRequest", { id });
        } catch {}
        reject(new Error("Java language request timed out"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  close(error = new Error("Java language session closed")) {
    this.closed = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
}
