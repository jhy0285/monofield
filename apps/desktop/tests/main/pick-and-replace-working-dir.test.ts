import { describe, expect, it, vi } from "vitest";

import { pickAndReplaceWorkingDir } from "../../src/main/runtime.js";

const SECRET = Buffer.from("test-desktop-auth-secret");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("pickAndReplaceWorkingDir", () => {
  it("changes the project root through the authenticated daemon endpoint", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      baseDir: "C:/work/orders",
      entryFile: "src/main.ts",
      project: { id: "project-1" },
    }));
    const mintToken = vi.fn((_secret: Buffer, baseDir: string) => `bound:${baseDir}`);

    const result = await pickAndReplaceWorkingDir({
      apiBaseUrl: "http://127.0.0.1:7456/",
      baseDir: "C:/work/orders",
      desktopAuthSecret: SECRET,
      fetchImpl,
      mintToken,
      projectId: "project-1",
      registerDesktopAuth: vi.fn(async () => true),
    });

    expect(result).toEqual({
      ok: true,
      response: {
        baseDir: "C:/work/orders",
        entryFile: "src/main.ts",
        project: { id: "project-1" },
      },
    });
    expect(mintToken).toHaveBeenCalledWith(SECRET, "C:/work/orders");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:7456/api/projects/project-1/working-dir",
      expect.objectContaining({
        body: JSON.stringify({ baseDir: "C:/work/orders" }),
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-OD-Desktop-Import-Token": "bound:C:/work/orders",
        }),
        method: "POST",
      }),
    );
  });

  it("re-registers desktop auth and retries a pending authenticated root replacement", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: "DESKTOP_AUTH_PENDING" } }, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const registerDesktopAuth = vi.fn(async () => true);

    const result = await pickAndReplaceWorkingDir({
      apiBaseUrl: "http://127.0.0.1:7456",
      baseDir: "C:/work/orders",
      desktopAuthSecret: SECRET,
      fetchImpl,
      mintToken: () => "bound-token",
      projectId: "project-1",
      registerDesktopAuth,
    });

    expect(result).toEqual({ ok: true, response: { ok: true } });
    expect(registerDesktopAuth).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not send a request for an invalid project id", async () => {
    const fetchImpl = vi.fn();
    const mintToken = vi.fn(() => "must-not-mint");

    const result = await pickAndReplaceWorkingDir({
      apiBaseUrl: "http://127.0.0.1:7456",
      baseDir: "C:/work/orders",
      desktopAuthSecret: SECRET,
      fetchImpl,
      mintToken,
      projectId: "../other-project",
    });

    expect(result).toEqual({ ok: false, reason: "project id contains disallowed characters" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mintToken).not.toHaveBeenCalled();
  });
});
