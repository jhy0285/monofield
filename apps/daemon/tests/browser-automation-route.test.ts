import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  DesktopBrowserAutomationInput,
  DesktopBrowserAutomationResult,
} from "@open-design/sidecar-proto";

describe("local browser automation route", () => {
  let started: import("../src/server.js").StartServerResult;
  let dataDir: string;
  const execute = vi.fn(async (
    input: DesktopBrowserAutomationInput,
  ): Promise<DesktopBrowserAutomationResult> => ({
    action: input.action,
    data: { title: "Fixture" },
    ok: true,
    sessionId: input.sessionId,
  }));

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "od-browser-automation-route-"));
    process.env.OD_DATA_DIR = dataDir;
    const { startServer } = await import("../src/server.js");
    started = await startServer({
      desktopBrowserAutomation: execute,
      port: 0,
      returnServer: true,
    }) as import("../src/server.js").StartServerResult;
  }, 60_000);

  afterAll(async () => {
    if (started) {
      started.server.close();
      started.server.closeAllConnections?.();
    }
    await rm(dataDir, { force: true, recursive: true, maxRetries: 2, retryDelay: 50 }).catch(() => undefined);
    delete process.env.OD_DATA_DIR;
  }, 10_000);

  it("forwards a normalized finite operation to the desktop callback", async () => {
    const response = await fetch(`${started.url}/api/browser-automation`, {
      method: "POST",
      headers: { "connection": "close", "content-type": "application/json" },
      body: JSON.stringify({ action: "snapshot", sessionId: "browser_session_1234567890" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, action: "snapshot" });
    expect(execute).toHaveBeenCalledWith({ action: "snapshot", sessionId: "browser_session_1234567890" });
  });

  it("rejects unknown fields and arbitrary script before desktop IPC", async () => {
    execute.mockClear();
    const response = await fetch(`${started.url}/api/browser-automation`, {
      method: "POST",
      headers: { "connection": "close", "content-type": "application/json" },
      body: JSON.stringify({
        action: "snapshot",
        javascript: "document.cookie",
        sessionId: "browser_session_1234567890",
      }),
    });
    expect(response.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});
