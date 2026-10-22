import { parentPort, workerData } from "node:worker_threads";
import { parseJava } from "../ontology/java.js";
try {
  const parsed = parseJava(workerData.file, workerData.text, workerData.sha256);
  const classes = parsed.nodes.filter((node) => node.kind === "class");
  if (classes.length !== 1)
    throw new Error(
      "Select the runtime class explicitly for a source with multiple or nested classes",
    );
  parentPort!.postMessage({ className: classes[0]!.label });
} catch (error) {
  parentPort!.postMessage({
    error: error instanceof Error ? error.message : String(error),
  });
}
