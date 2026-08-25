#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const entryDir = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(entryDir, "../dist/cli.js");

if (!existsSync(distEntry)) {
  throw new Error(
    `MonoField daemon entry not found at ${distEntry}. Run "pnpm build:daemon" from the repository root first.`,
  );
}

await import(pathToFileURL(distEntry).href);
