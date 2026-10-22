import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Packaging tests perform large directory copies and real PowerShell
    // launches. Unbounded file parallelism makes Windows Defender/indexer
    // contention dominate the work. Even four workers exceeded the 20 s
    // budget on windows-2025 during release validation; serialize real
    // PowerShell launches there without relaxing assertions or deadlines.
    maxWorkers: process.platform === "win32" ? 1 : 4,
    testTimeout: 20_000,
  },
});
