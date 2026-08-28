import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  browserAutomationPointerDragTargetsScript,
  browserAutomationPointerOverlayScript,
  browserAutomationPointerTargetScript,
  createBrowserAutomationService,
  BROWSER_AUTOMATION_PAGE_INFO_SCRIPT,
  BROWSER_AUTOMATION_SNAPSHOT_SCRIPT,
  redactBrowserAutomationUrl,
  type BrowserAutomationGuest,
} from "../../src/main/browser-automation.js";

function executeJavaScriptMock(
  implementation: (code: string, userGesture?: boolean) => Promise<unknown>,
): BrowserAutomationGuest["executeJavaScript"] {
  return vi.fn(implementation) as unknown as BrowserAutomationGuest["executeJavaScript"];
}

function guest(overrides: Partial<BrowserAutomationGuest> = {}): BrowserAutomationGuest {
  return {
    capturePage: vi.fn(async () => ({
      getSize: () => ({ height: 720, width: 1280 }),
      toDataURL: () => "data:image/png;base64,cG5n",
    })),
    id: 41,
    getURL: () => "http://127.0.0.1:5173/app",
    isDestroyed: () => false,
    loadURL: vi.fn(async () => undefined),
    sendInputEvent: vi.fn(),
    executeJavaScript: executeJavaScriptMock(async (code: string) => code.includes("candidates.slice")
      ? { title: "Fixture", url: "http://127.0.0.1:5173/app", elements: [] }
      : {}),
    ...overrides,
  };
}

describe("approved in-app browser automation", () => {
  it("keeps the fixed guest scripts syntactically valid after template escaping", () => {
    expect(() => new Function(`return ${BROWSER_AUTOMATION_PAGE_INFO_SCRIPT}`)).not.toThrow();
    expect(() => new Function(`return ${BROWSER_AUTOMATION_SNAPSHOT_SCRIPT}`)).not.toThrow();
    expect(() => new Function(`return ${browserAutomationPointerTargetScript("#continue")}`)).not.toThrow();
    expect(() => new Function(`return ${browserAutomationPointerDragTargetsScript("#card", "#column")}`)).not.toThrow();
    expect(() => new Function(`return ${browserAutomationPointerOverlayScript(
      { x: 10, y: 12 },
      { x: 120, y: 80 },
      "click",
      140,
      true,
    )}`)).not.toThrow();
  });

  it("redacts credential-like URL parameters from agent results", () => {
    expect(redactBrowserAutomationUrl("https://example.com/callback?code=abc&theme=dark#done"))
      .toBe("https://example.com/callback?code=%5Bredacted%5D&theme=dark");
  });

  it("binds a random session to one attached guest and origin", async () => {
    const target = guest();
    const events: unknown[] = [];
    const service = createBrowserAutomationService({
      emit: (event) => events.push(event),
      getGuest: (id) => id === target.id ? target : null,
      now: () => 1_000,
      token: () => "browser_session_1234567890",
    });
    const session = service.begin({ guestWebContentsId: 41, origin: "http://127.0.0.1:5173", projectId: "p1" });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    expect(session.scopes).toContain("page:type-non-sensitive");
    const result = await service.execute({ action: "snapshot", sessionId: session.sessionId });
    expect(result.ok).toBe(true);
    const script = vi.mocked(target.executeJavaScript).mock.calls[0]?.[0] ?? "";
    expect(script).not.toContain("element.value");
    expect(events).toHaveLength(2);
  });

  it("blocks cross-origin navigation before the guest loads it", async () => {
    const target = guest();
    const service = createBrowserAutomationService({
      emit: () => undefined,
      getGuest: () => target,
      token: () => "browser_session_1234567890",
    });
    const session = service.begin({ guestWebContentsId: 41, origin: "http://127.0.0.1:5173", projectId: "p1" });
    if (!session.ok) throw new Error(session.reason);
    const result = await service.execute({
      action: "navigate",
      sessionId: session.sessionId,
      url: "https://example.com/",
    });
    expect(result).toMatchObject({ ok: false, error: "Navigation is limited to the approved origin" });
    expect(target.loadURL).not.toHaveBeenCalled();
  });

  it("turns a sensitive-field response into a rejected operation", async () => {
    const target = guest({
      executeJavaScript: executeJavaScriptMock(async () => ({ found: true, typed: false, blocked: true, reason: "sensitive-field" })),
    });
    const service = createBrowserAutomationService({
      emit: () => undefined,
      getGuest: () => target,
      token: () => "browser_session_1234567890",
    });
    const session = service.begin({ guestWebContentsId: 41, origin: "http://127.0.0.1:5173", projectId: "p1" });
    if (!session.ok) throw new Error(session.reason);
    const result = await service.execute({
      action: "type-text",
      selector: "#password",
      sessionId: session.sessionId,
      text: "not-a-real-secret",
    });
    expect(result).toMatchObject({ ok: false, error: "Typing into sensitive fields is blocked" });
  });

  it("captures the approved tab and performs hover, drag, and batch steps", async () => {
    const target = guest();
    const service = createBrowserAutomationService({
      emit: () => undefined,
      getGuest: () => target,
      token: () => "browser_session_1234567890",
    });
    const session = service.begin({ guestWebContentsId: 41, origin: "http://127.0.0.1:5173", projectId: "p1" });
    if (!session.ok) throw new Error(session.reason);
    await expect(service.execute({ action: "screenshot", sessionId: session.sessionId }))
      .resolves.toMatchObject({ ok: true, data: { width: 1280, height: 720 } });
    await expect(service.execute({ action: "hover", selector: "#menu", sessionId: session.sessionId }))
      .resolves.toMatchObject({ ok: true });
    await expect(service.execute({ action: "drag", selector: "#card", targetSelector: "#column", sessionId: session.sessionId }))
      .resolves.toMatchObject({ ok: true });
    await expect(service.execute({
      action: "batch",
      sessionId: session.sessionId,
      steps: [
        { action: "snapshot" },
        { action: "click", selector: "#continue" },
        { action: "scroll", to: "page" },
      ],
    })).resolves.toMatchObject({ ok: true, data: { results: [{ ok: true }, { ok: true }, { ok: true }] } });
  });

  it("uses DOM geometry to drive a visible native pointer click", async () => {
    const sendInputEvent = vi.fn();
    const target = guest({
      sendInputEvent,
      executeJavaScript: executeJavaScriptMock(async (code: string) => {
        if (code.includes("__open_agent_pointer_target__")) {
          return {
            found: true,
            height: 40,
            hitSafe: true,
            tag: "button",
            viewportHeight: 720,
            viewportWidth: 1280,
            width: 120,
            x: 320,
            y: 240,
          };
        }
        return true;
      }),
    });
    const service = createBrowserAutomationService({
      emit: () => undefined,
      getGuest: () => target,
      token: () => "browser_session_1234567890",
      wait: async () => undefined,
    });
    const session = service.begin({ guestWebContentsId: 41, origin: "http://127.0.0.1:5173", projectId: "p1" });
    if (!session.ok) throw new Error(session.reason);

    await expect(service.execute({ action: "click", selector: "#continue", sessionId: session.sessionId }))
      .resolves.toMatchObject({ ok: true, data: { clicked: true, mode: "pointer" } });
    expect(sendInputEvent.mock.calls.map(([event]) => event.type)).toEqual(
      expect.arrayContaining(["mouseMove", "mouseDown", "mouseUp"]),
    );
    expect(vi.mocked(target.executeJavaScript).mock.calls.some(([code]) => code.includes("__open_agent_pointer__"))).toBe(true);
  });

  it("falls back to the bounded DOM click when native pointer hit testing is unsafe", async () => {
    const sendInputEvent = vi.fn();
    const target = guest({
      sendInputEvent,
      executeJavaScript: executeJavaScriptMock(async (code: string) => code.includes("__open_agent_pointer_target__")
        ? {
            found: true,
            height: 40,
            hitSafe: false,
            tag: "button",
            viewportHeight: 720,
            viewportWidth: 1280,
            width: 120,
            x: 320,
            y: 240,
          }
        : { clicked: true, found: true, tag: "button" }),
    });
    const service = createBrowserAutomationService({
      emit: () => undefined,
      getGuest: () => target,
      token: () => "browser_session_1234567890",
    });
    const session = service.begin({ guestWebContentsId: 41, origin: "http://127.0.0.1:5173", projectId: "p1" });
    if (!session.ok) throw new Error(session.reason);

    await expect(service.execute({ action: "click", selector: "#covered", sessionId: session.sessionId }))
      .resolves.toMatchObject({
        ok: true,
        data: {
          clicked: true,
          fallbackReason: "the target center was covered by another element",
          mode: "dom-fallback",
        },
      });
    expect(sendInputEvent).not.toHaveBeenCalled();
  });

  it("performs a native pointer drag when both DOM targets are visible", async () => {
    const sendInputEvent = vi.fn();
    const target = guest({
      sendInputEvent,
      executeJavaScript: executeJavaScriptMock(async (code: string) => {
        if (code.includes("__open_agent_pointer_drag_targets__")) {
          return {
            found: true,
            from: { height: 80, width: 120, x: 220, y: 180 },
            sourceTag: "article",
            targetTag: "section",
            to: { height: 180, width: 280, x: 620, y: 360 },
            viewportHeight: 720,
            viewportWidth: 1280,
          };
        }
        return true;
      }),
    });
    const service = createBrowserAutomationService({
      emit: () => undefined,
      getGuest: () => target,
      token: () => "browser_session_1234567890",
      wait: async () => undefined,
    });
    const session = service.begin({ guestWebContentsId: 41, origin: "http://127.0.0.1:5173", projectId: "p1" });
    if (!session.ok) throw new Error(session.reason);

    await expect(service.execute({
      action: "drag",
      selector: "#card",
      targetSelector: "#column",
      sessionId: session.sessionId,
    })).resolves.toMatchObject({ ok: true, data: { dragged: true, mode: "pointer" } });
    const events = sendInputEvent.mock.calls.map(([event]) => event);
    expect(events.some((event) => event.type === "mouseDown")).toBe(true);
    expect(events.some((event) => event.type === "mouseMove" && event.button === "left")).toBe(true);
    expect(events.some((event) => event.type === "mouseUp")).toBe(true);
  });

  it("uploads only files inside the connected project folder", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "od-browser-upload-"));
    const filePath = join(projectDir, "fixture.txt");
    writeFileSync(filePath, "fixture", "utf8");
    try {
      const target = guest({ executeJavaScript: executeJavaScriptMock(async () => ({ found: true, uploaded: true })) });
      const service = createBrowserAutomationService({
        emit: () => undefined,
        getGuest: () => target,
        token: () => "browser_session_1234567890",
      });
      const session = service.begin({
        guestWebContentsId: 41,
        origin: "http://127.0.0.1:5173",
        projectDir,
        projectId: "p1",
      });
      if (!session.ok) throw new Error(session.reason);
      await expect(service.execute({ action: "upload", filePath, selector: "#file", sessionId: session.sessionId }))
        .resolves.toMatchObject({ ok: true, data: { uploaded: true, size: 7 } });
      await expect(service.execute({ action: "upload", filePath: join(projectDir, "..", "outside.txt"), selector: "#file", sessionId: session.sessionId }))
        .resolves.toMatchObject({ ok: false, error: "File upload is limited to the connected project folder" });
    } finally {
      rmSync(projectDir, { force: true, recursive: true });
    }
  });

  it("keeps permission active until the user stops or the session is revoked", async () => {
    let now = 100;
    const target = guest();
    const service = createBrowserAutomationService({
      emit: () => undefined,
      getGuest: () => target,
      now: () => now,
      token: () => "browser_session_1234567890",
    });
    const session = service.begin({ guestWebContentsId: 41, origin: "http://127.0.0.1:5173", projectId: "p1" });
    if (!session.ok) throw new Error(session.reason);
    now += 24 * 60 * 60 * 1_000;
    const result = await service.execute({ action: "page-info", sessionId: session.sessionId });
    expect(result.ok).toBe(true);
    expect(target.executeJavaScript).toHaveBeenCalledTimes(1);
    expect(service.stop(session.sessionId)).toEqual({ ok: true, stopped: true });
    await expect(service.execute({ action: "page-info", sessionId: session.sessionId }))
      .resolves.toMatchObject({ ok: false, error: "Browser automation session is not active" });
  });

  it("revokes immediately when the attached guest commits another origin", async () => {
    const target = guest();
    const service = createBrowserAutomationService({
      emit: () => undefined,
      getGuest: () => target,
      token: () => "browser_session_1234567890",
    });
    const session = service.begin({ guestWebContentsId: 41, origin: "http://127.0.0.1:5173", projectId: "p1" });
    if (!session.ok) throw new Error(session.reason);
    service.handleGuestNavigation(41, "https://example.com/");
    await expect(service.execute({ action: "status", sessionId: session.sessionId }))
      .resolves.toMatchObject({ ok: false, error: "Browser automation session is not active" });
  });

  it("links an approved same-origin popup to a distinct child session", async () => {
    const parentGuest = guest({ id: 41 });
    const childGuest = guest({ id: 42 });
    const crossOriginGuest = guest({ id: 43, getURL: () => "https://example.com/popup" });
    const guests = new Map([[41, parentGuest], [42, childGuest], [43, crossOriginGuest]]);
    let tokenIndex = 0;
    const service = createBrowserAutomationService({
      emit: () => undefined,
      getGuest: (id) => guests.get(id) ?? null,
      token: () => `browser_session_123456789${tokenIndex++}`,
    });
    const parent = service.begin({ guestWebContentsId: 41, origin: "http://127.0.0.1:5173", projectId: "p1" });
    if (!parent.ok) throw new Error(parent.reason);
    const child = service.link({
      guestWebContentsId: 42,
      origin: "http://127.0.0.1:5173",
      parentSessionId: parent.sessionId,
      projectId: "p1",
    });
    expect(child).toMatchObject({ ok: true, origin: parent.origin });
    if (!child.ok) return;
    expect(child.sessionId).not.toBe(parent.sessionId);
    await expect(service.execute({ action: "snapshot", sessionId: child.sessionId })).resolves.toMatchObject({ ok: true });
    expect(service.link({
      guestWebContentsId: 43,
      origin: "https://example.com",
      parentSessionId: parent.sessionId,
      projectId: "p1",
    })).toMatchObject({ ok: false, reason: "Only same-origin popup tabs inherit browser automation" });
  });
});
