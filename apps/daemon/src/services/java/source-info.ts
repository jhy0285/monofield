import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";
let active = 0;
/** A single bounded trusted syntax worker; project code never executes here. */
export async function javaBreakpointClass(
  file: string,
  text: string,
): Promise<string> {
  if (active >= 2) throw new Error("Java source analysis is busy");
  active++;
  try {
    return await new Promise<string>((resolve, reject) => {
      const worker = new Worker(
        new URL("./source-worker.js", import.meta.url),
        {
          workerData: {
            file,
            text,
            sha256: createHash("sha256").update(text).digest("hex"),
          },
          resourceLimits: { maxOldGenerationSizeMb: 128 },
        },
      );
      let done = false;
      const finish = (error?: Error, className?: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        void worker
          .terminate()
          .then(() => (error ? reject(error) : resolve(className!)), reject);
      };
      const timer = setTimeout(
        () => finish(new Error("Java source analysis timed out")),
        10000,
      );
      worker.once("message", (value) =>
        value.error
          ? finish(new Error(value.error))
          : finish(undefined, value.className),
      );
      worker.once("error", (error) => finish(error));
      worker.once("exit", () => {
        if (!done) finish(new Error("Java syntax worker stopped"));
      });
    });
  } finally {
    active--;
  }
}
