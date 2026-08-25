import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

// This privileged code owns popup routing because Electron's guest webContents
// is the only reliable place to intercept target=_blank/window.open. Keep the
// source-level security contract pinned without booting a BrowserWindow.
const runtimeSource = readFileSync(new URL("../../src/main/runtime.ts", import.meta.url), "utf8");

describe("embedded Browser popup routing", () => {
  test("forwards direct http(s) popup URLs to the trusted parent renderer", () => {
    const handler = /guestWebContents\.setWindowOpenHandler\(\(\{ url \}\) => \{([\s\S]*?)\n    \}\);/.exec(runtimeSource)?.[0] ?? "";

    expect(handler).toContain("isEmbeddedBrowserDestinationUrl(url)");
    expect(handler).toContain('window.webContents.send(BROWSER_POPUP_EVENT');
    expect(handler).toContain("guestWebContentsId: guestWebContents.id");
    expect(handler).toContain('return { action: "deny" };');
  });

  test("allows only a hidden sandboxed about:blank bootstrap window", () => {
    const handler = /guestWebContents\.setWindowOpenHandler\(\(\{ url \}\) => \{([\s\S]*?)\n    \}\);/.exec(runtimeSource)?.[0] ?? "";

    expect(handler).toContain("isEmbeddedBrowserBootstrapPopupUrl(url)");
    expect(handler).toContain('action: "allow"');
    expect(handler).toContain("show: false");
    expect(handler).toContain("contextIsolation: true");
    expect(handler).toContain("nodeIntegration: false");
    expect(handler).toContain("sandbox: true");
    expect(handler).toContain("partition: DESIGN_BROWSER_PARTITION");
  });

  test("relays the bootstrap child first http(s) navigation and destroys it", () => {
    const childHandler = /guestWebContents\.on\("did-create-window", \(childWindow, details\) => \{([\s\S]*?)\n    \}\);/.exec(runtimeSource)?.[0] ?? "";

    expect(childHandler).toContain("isEmbeddedBrowserBootstrapPopupUrl(details.url)");
    expect(childHandler).toContain("isEmbeddedBrowserDestinationUrl(url)");
    expect(childHandler).toContain('childWindow.webContents.on("will-navigate", relayDestination)');
    expect(childHandler).toContain('childWindow.webContents.on("will-redirect", relayDestination)');
    expect(childHandler).toContain("guestWebContentsId: guestWebContents.id");
    expect(childHandler).toContain("childWindow.destroy()");
  });
});
