import { describe, expect, it } from "vitest";

import {
  APP_KEYS,
  DESKTOP_UPDATE_ACTIONS,
  DESKTOP_UPDATE_CHANNELS,
  DESKTOP_UPDATE_MODES,
  DESKTOP_UPDATE_STATES,
  normalizeDaemonSidecarMessage,
  normalizeDesktopSidecarMessage,
  normalizeNamespace,
  normalizeSidecarStamp,
  OPEN_DESIGN_SIDECAR_CONTRACT,
  SIDECAR_MESSAGES,
  SIDECAR_SOURCES,
  SIDECAR_STAMP_FIELDS,
  STAMP_APP_FLAG,
  STAMP_IPC_FLAG,
  STAMP_MODE_FLAG,
  STAMP_NAMESPACE_FLAG,
  STAMP_SOURCE_FLAG,
  type DaemonStatusSnapshot,
} from "../src/index.js";

const validStamp = {
  app: APP_KEYS.WEB,
  ipc: "/tmp/open-design/ipc/contract-check/web.sock",
  mode: "dev" as const,
  namespace: "contract-check",
  source: SIDECAR_SOURCES.TOOLS_DEV,
};

describe("open-design sidecar contract", () => {
  it("exports the canonical five-field stamp descriptor", () => {
    expect(SIDECAR_STAMP_FIELDS).toEqual(["app", "mode", "namespace", "ipc", "source"]);
    expect(OPEN_DESIGN_SIDECAR_CONTRACT.stampFlags).toEqual({
      app: STAMP_APP_FLAG,
      ipc: STAMP_IPC_FLAG,
      mode: STAMP_MODE_FLAG,
      namespace: STAMP_NAMESPACE_FLAG,
      source: STAMP_SOURCE_FLAG,
    });
    expect(OPEN_DESIGN_SIDECAR_CONTRACT.updateActions).toBe(DESKTOP_UPDATE_ACTIONS);
    expect(OPEN_DESIGN_SIDECAR_CONTRACT.updateChannels).toBe(DESKTOP_UPDATE_CHANNELS);
    expect(Object.values(DESKTOP_UPDATE_CHANNELS)).toEqual(["beta", "betas", "prerelease", "preview", "stable"]);
    expect(OPEN_DESIGN_SIDECAR_CONTRACT.updateModes).toBe(DESKTOP_UPDATE_MODES);
    expect(OPEN_DESIGN_SIDECAR_CONTRACT.updateStates).toBe(DESKTOP_UPDATE_STATES);
  });

  it("accepts the explicit namespace contract", () => {
    expect(normalizeNamespace("contract-check_1.alpha")).toBe("contract-check_1.alpha");
  });

  it("rejects path-like or whitespace namespaces", () => {
    expect(() => normalizeNamespace("../other")).toThrow();
    expect(() => normalizeNamespace(" contract-check")).toThrow();
    expect(() => normalizeNamespace("contract check")).toThrow();
  });

  it("accepts exactly app, mode, namespace, ipc, and source", () => {
    expect(normalizeSidecarStamp(validStamp)).toEqual(validStamp);
  });

  it("rejects legacy or extra stamp fields", () => {
    expect(() => normalizeSidecarStamp({ ...validStamp, runtimeToken: "legacy" })).toThrow();
    expect(() => normalizeSidecarStamp({ ...validStamp, role: "web-sidecar" })).toThrow();
  });

  it("rejects non-contract sidecar sources", () => {
    expect(() => normalizeSidecarStamp({ ...validStamp, source: "custom-script" })).toThrow();
  });

  it("validates daemon IPC messages", () => {
    expect(normalizeDaemonSidecarMessage({ type: SIDECAR_MESSAGES.STATUS })).toEqual({ type: "status" });
    expect(normalizeDaemonSidecarMessage({ type: SIDECAR_MESSAGES.SHUTDOWN })).toEqual({ type: "shutdown" });
    expect(() => normalizeDaemonSidecarMessage({ input: {}, type: SIDECAR_MESSAGES.EVAL })).toThrow();
  });

  it("accepts a base64 register-desktop-auth payload", () => {
    const message = {
      input: { secret: "AAECAwQFBgcICQoLDA0ODw==" },
      type: SIDECAR_MESSAGES.REGISTER_DESKTOP_AUTH,
    };
    expect(normalizeDaemonSidecarMessage(message)).toEqual(message);
  });

  it("accepts a mint-import-token payload with a baseDir", () => {
    const message = {
      input: { baseDir: "/Users/u/project" },
      type: SIDECAR_MESSAGES.MINT_IMPORT_TOKEN,
    };
    expect(normalizeDaemonSidecarMessage(message)).toEqual(message);
  });

  it("rejects malformed mint-import-token payloads", () => {
    expect(() =>
      normalizeDaemonSidecarMessage({
        input: { baseDir: "" },
        type: SIDECAR_MESSAGES.MINT_IMPORT_TOKEN,
      }),
    ).toThrow(/baseDir/i);
    expect(() =>
      normalizeDaemonSidecarMessage({
        input: { baseDir: "/Users/u/project", extra: true },
        type: SIDECAR_MESSAGES.MINT_IMPORT_TOKEN,
      }),
    ).toThrow(/extra/i);
  });

  it("rejects register-desktop-auth payloads that are not base64-shaped", () => {
    expect(() =>
      normalizeDaemonSidecarMessage({
        input: { secret: "not base64!" },
        type: SIDECAR_MESSAGES.REGISTER_DESKTOP_AUTH,
      }),
    ).toThrow(/base64/i);
    expect(() =>
      normalizeDaemonSidecarMessage({
        input: { secret: "" },
        type: SIDECAR_MESSAGES.REGISTER_DESKTOP_AUTH,
      }),
    ).toThrow();
    expect(() =>
      normalizeDaemonSidecarMessage({
        input: {},
        type: SIDECAR_MESSAGES.REGISTER_DESKTOP_AUTH,
      }),
    ).toThrow();
  });

  it("validates desktop IPC message inputs", () => {
    expect(normalizeDesktopSidecarMessage({ type: SIDECAR_MESSAGES.SHOW })).toEqual({ type: "show" });
    expect(normalizeDesktopSidecarMessage({ input: { expression: "location.href" }, type: SIDECAR_MESSAGES.EVAL })).toEqual({
      input: { expression: "location.href" },
      type: "eval",
    });
    expect(() => normalizeDesktopSidecarMessage({ input: { expression: 42 }, type: SIDECAR_MESSAGES.EVAL })).toThrow();
    expect(() => normalizeDesktopSidecarMessage({ input: { selector: "" }, type: SIDECAR_MESSAGES.CLICK })).toThrow();
  });

  it("validates desktop development process ownership messages", () => {
    const start = {
      input: { action: "start", args: ["-m", "http.server"], command: "C:\\Python\\python.exe", cwd: "C:\\work", ownerPid: 100, port: 8000, projectId: "project-1" },
      type: SIDECAR_MESSAGES.DEVELOPMENT_PROCESS,
    } as const;
    expect(normalizeDesktopSidecarMessage(start)).toEqual(start);
    expect(normalizeDesktopSidecarMessage({ input: { action: "status", ownerPid: 100, projectId: "project-1" }, type: SIDECAR_MESSAGES.DEVELOPMENT_PROCESS })).toMatchObject({ input: { action: "status" } });
    expect(() => normalizeDesktopSidecarMessage({ ...start, input: { ...start.input, port: 0 } })).toThrow(/between 1 and 65535/i);
    expect(() => normalizeDesktopSidecarMessage({ ...start, input: { ...start.input, args: "-m" } })).toThrow(/array/i);
  });

  it("accepts only the finite browser automation protocol", () => {
    const sessionId = "browser_session_1234567890";
    expect(normalizeDesktopSidecarMessage({
      input: { action: "snapshot", sessionId },
      type: SIDECAR_MESSAGES.BROWSER_AUTOMATION,
    })).toEqual({ input: { action: "snapshot", sessionId }, type: "browser-automation" });
    expect(normalizeDesktopSidecarMessage({
      input: { action: "type-text", selector: "#name", sessionId, text: "Ada" },
      type: SIDECAR_MESSAGES.BROWSER_AUTOMATION,
    })).toEqual({
      input: { action: "type-text", selector: "#name", sessionId, text: "Ada" },
      type: "browser-automation",
    });
    expect(normalizeDesktopSidecarMessage({
      input: {
        action: "batch",
        continueOnError: true,
        sessionId,
        steps: [
          { action: "hover", selector: "#menu" },
          { action: "drag", selector: "#card", targetSelector: "#column" },
          { action: "upload", filePath: "C:/project/fixture.png", selector: "#file" },
        ],
      },
      type: SIDECAR_MESSAGES.BROWSER_AUTOMATION,
    })).toEqual({
      input: {
        action: "batch",
        continueOnError: true,
        sessionId,
        steps: [
          { action: "hover", selector: "#menu" },
          { action: "drag", selector: "#card", targetSelector: "#column" },
          { action: "upload", filePath: "C:/project/fixture.png", selector: "#file" },
        ],
      },
      type: "browser-automation",
    });
    expect(() => normalizeDesktopSidecarMessage({
      input: { action: "evaluate", sessionId },
      type: SIDECAR_MESSAGES.BROWSER_AUTOMATION,
    })).toThrow();
    expect(() => normalizeDesktopSidecarMessage({
      input: { action: "click", sessionId },
      type: SIDECAR_MESSAGES.BROWSER_AUTOMATION,
    })).toThrow();
    expect(() => normalizeDesktopSidecarMessage({
      input: { action: "snapshot", javascript: "document.cookie", sessionId },
      type: SIDECAR_MESSAGES.BROWSER_AUTOMATION,
    })).toThrow();
    expect(() => normalizeDesktopSidecarMessage({
      input: { action: "batch", sessionId, steps: [{ action: "batch", steps: [{ action: "snapshot" }] }] },
      type: SIDECAR_MESSAGES.BROWSER_AUTOMATION,
    })).toThrow();
  });

  it("requires DaemonStatusSnapshot to carry desktopAuthGateActive (PR #974 round 6)", () => {
    // The TS compiler enforces that `desktopAuthGateActive: boolean` is
    // present on every constructed snapshot — tools-dev's split-start
    // hardening relies on the daemon STATUS IPC carrying this field so
    // `start desktop` can detect an ungated already-running daemon and
    // restart it before launching desktop main. Removing the field, or
    // softening it to optional, must fail this build.
    const armed: DaemonStatusSnapshot = {
      state: "running",
      url: "http://127.0.0.1:7456",
      desktopAuthGateActive: true,
    };
    const dormant: DaemonStatusSnapshot = {
      state: "running",
      url: "http://127.0.0.1:7456",
      desktopAuthGateActive: false,
    };
    expect(armed.desktopAuthGateActive).toBe(true);
    expect(dormant.desktopAuthGateActive).toBe(false);
  });

  it("validates desktop PDF export IPC message inputs", () => {
    expect(
      normalizeDesktopSidecarMessage({
        input: {
          baseHref: "http://127.0.0.1:7456/api/projects/proj/raw/deck/",
          deck: true,
          defaultFilename: "Seed Deck.pdf",
          html: "<!doctype html><section class=\"slide\">One</section>",
          title: "Seed Deck",
        },
        type: SIDECAR_MESSAGES.EXPORT_PDF,
      }),
    ).toEqual({
      input: {
        baseHref: "http://127.0.0.1:7456/api/projects/proj/raw/deck/",
        deck: true,
        defaultFilename: "Seed Deck.pdf",
        html: "<!doctype html><section class=\"slide\">One</section>",
        title: "Seed Deck",
      },
      type: "export-pdf",
    });
    expect(() =>
      normalizeDesktopSidecarMessage({
        input: { deck: true, defaultFilename: "x.pdf", html: "", title: "x" },
        type: SIDECAR_MESSAGES.EXPORT_PDF,
      }),
    ).toThrow();
    expect(() =>
      normalizeDesktopSidecarMessage({
        input: { deck: "yes", defaultFilename: "x.pdf", html: "<p>x</p>", title: "x" },
        type: SIDECAR_MESSAGES.EXPORT_PDF,
      }),
    ).toThrow();
  });

  it("accepts PNG/JPEG artifact image export and rejects WebP up front", () => {
    // The off-screen Electron renderer (nativeImage) can only encode PNG/JPEG.
    for (const imageFormat of ["png", "jpeg"] as const) {
      expect(
        normalizeDesktopSidecarMessage({
          input: { deck: false, format: "image", html: "<p>x</p>", imageFormat, title: "Shot" },
          type: SIDECAR_MESSAGES.EXPORT_ARTIFACT,
        }),
      ).toEqual({
        input: { deck: false, format: "image", html: "<p>x</p>", imageFormat, title: "Shot" },
        type: "export-artifact",
      });
    }
    // WebP must fail fast with a clear error rather than silently downgrade to PNG.
    expect(() =>
      normalizeDesktopSidecarMessage({
        input: { deck: false, format: "image", html: "<p>x</p>", imageFormat: "webp", title: "Shot" },
        type: SIDECAR_MESSAGES.EXPORT_ARTIFACT,
      }),
    ).toThrow(/unsupported artifact export image format/);
  });

  it("validates desktop update IPC message inputs", () => {
    expect(
      normalizeDesktopSidecarMessage({
        input: { action: DESKTOP_UPDATE_ACTIONS.CHECK },
        type: SIDECAR_MESSAGES.UPDATE,
      }),
    ).toEqual({
      input: { action: "check" },
      type: "update",
    });
    expect(
      normalizeDesktopSidecarMessage({
        input: { action: DESKTOP_UPDATE_ACTIONS.INSTALL },
        type: SIDECAR_MESSAGES.UPDATE,
      }),
    ).toEqual({
      input: { action: "install" },
      type: "update",
    });
    expect(() =>
      normalizeDesktopSidecarMessage({
        input: { action: "apply" },
        type: SIDECAR_MESSAGES.UPDATE,
      }),
    ).toThrow(/unsupported desktop update action/);
    expect(() =>
      normalizeDesktopSidecarMessage({
        input: { action: "status", path: "/tmp/update.dmg" },
        type: SIDECAR_MESSAGES.UPDATE,
      }),
    ).toThrow(/unsupported fields/);
  });

  it("permits only constrained database broker requests", () => {
    expect(normalizeDesktopSidecarMessage({ input: { action: "list" }, type: SIDECAR_MESSAGES.DATABASE })).toEqual({
      input: { action: "list" }, type: "database",
    });
    expect(normalizeDesktopSidecarMessage({
      input: { action: "sample", connectionId: "db-1", schema: "public", table: "orders", limit: 5 },
      type: SIDECAR_MESSAGES.DATABASE,
    })).toEqual({
      input: { action: "sample", connectionId: "db-1", schema: "public", table: "orders", limit: 5 }, type: "database",
    });
    expect(normalizeDesktopSidecarMessage({
      input: {
        action: "inspect",
        connectionId: "db-1",
        tables: [{ schema: "public", table: "orders" }, { schema: "public", table: "users" }],
        limit: 5,
        concurrency: 16,
        selectedByUser: true,
      },
      type: SIDECAR_MESSAGES.DATABASE,
    })).toEqual({
      input: {
        action: "inspect",
        connectionId: "db-1",
        tables: [{ schema: "public", table: "orders" }, { schema: "public", table: "users" }],
        limit: 5,
        concurrency: 16,
        selectedByUser: true,
      },
      type: "database",
    });
    const manyTables = Array.from({ length: 501 }, (_, index) => ({ schema: "public", table: `table_${index}` }));
    const manyTableMessage = normalizeDesktopSidecarMessage({
      input: { action: "inspect", connectionId: "db-1", tables: manyTables },
      type: SIDECAR_MESSAGES.DATABASE,
    });
    expect(manyTableMessage).toMatchObject({
      type: SIDECAR_MESSAGES.DATABASE,
      input: { action: "inspect", tables: manyTables },
    });
    expect(normalizeDesktopSidecarMessage({
      input: {
        action: "mutate",
        connectionId: "db-1",
        operation: "update",
        schema: "public",
        table: "orders",
        values: { status: "paid" },
        where: { id: 42 },
        projectId: "project-1",
        reason: "Verify the checkout flow",
      },
      type: SIDECAR_MESSAGES.DATABASE,
    })).toEqual({
      input: {
        action: "mutate",
        connectionId: "db-1",
        operation: "update",
        schema: "public",
        table: "orders",
        values: { status: "paid" },
        where: { id: 42 },
        projectId: "project-1",
        reason: "Verify the checkout flow",
      },
      type: "database",
    });
    expect(() => normalizeDesktopSidecarMessage({
      input: { action: "inspect", connectionId: "db-1", tables: manyTables, concurrency: 12 },
      type: SIDECAR_MESSAGES.DATABASE,
    })).toThrow(/concurrency must be 8, 16, or 32/);
    expect(() => normalizeDesktopSidecarMessage({
      input: { action: "query", connectionId: "db-1", sql: "select * from users" }, type: SIDECAR_MESSAGES.DATABASE,
    })).toThrow(/unsupported desktop database action/);
  });
});
