import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Packaging tests perform large directory copies and real PowerShell
    // launches. Unbounded file parallelism makes Windows Defender/indexer
    // contention dominate the work and causes otherwise healthy 5 s flakes.
    maxWorkers: 4,
    testTimeout: 20_000,
  },
});
