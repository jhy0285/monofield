import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import type { ToolPackConfig } from "./config.js";

export interface WebSourcemapOptions {
  releaseVersion?: string;
}

function resolveBrowserChunksDir(workspaceRoot: string): string {
  return join(workspaceRoot, "apps", "web", ".next", "static");
}

async function findMapFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current == null) break;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".map")) {
        out.push(entryPath);
      }
    }
  }
  return out;
}

async function deleteMapFiles(dir: string): Promise<number> {
  const maps = await findMapFiles(dir);
  for (const mapPath of maps) {
    await rm(mapPath, { force: true });
  }
  return maps.length;
}

function log(line: string): void {
  process.stderr.write(`[web-sourcemaps] ${line}\n`);
}

export async function processWebSourcemaps(
  config: ToolPackConfig,
  options: WebSourcemapOptions = {},
): Promise<void> {
  void options;
  const chunksDir = resolveBrowserChunksDir(config.workspaceRoot);
  if (!existsSync(chunksDir)) {
    log(`browser chunks dir not found at ${chunksDir}; skipping`);
    return;
  }
  const stripped = await deleteMapFiles(chunksDir);
  if (stripped === 0) {
    log(`no .map files under ${chunksDir}; nothing to do`);
    return;
  }
  log(`stripped ${stripped} .map file(s) before packaging`);
}
