// @vitest-environment jsdom
import { createRef } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JavaToolsPanel } from "../../src/components/workspace/JavaToolsPanel";
import { I18nProvider } from "../../src/i18n";
const stopped = {
  state: "stopped",
  installed: false,
  version: "redhat.java-1.56.0",
  projectPath: "backend",
  message: null,
  diagnostics: [],
  pid: null,
};
const ready = { ...stopped, state: "ready", installed: true, pid: 123 };
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function panel(dirty = false) {
  return render(
    <I18nProvider initial="en">
      <JavaToolsPanel
        projectId="traffic"
        file="backend/Service.java"
        text="class Service {}"
        dirty={dirty}
        editorRef={createRef<HTMLTextAreaElement>()}
        onText={vi.fn()}
        onRenamed={vi.fn()}
      />
    </I18nProvider>,
  );
}
describe("Java editor controls", () => {
  it("allows a semantic request after idle shutdown without starting on a status poll", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      Response.json(
        String(input).endsWith("/query")
          ? { version: 1, locations: [] }
          : { ...stopped, resumeAvailable: true },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    panel();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Find references" }),
      ).toBeTruthy(),
    );
    expect(
      fetchMock.mock.calls.every((call) => !String(call[0]).endsWith("/start")),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Find references" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/query")),
      ).toBe(true),
    );
  });
  it("does not install or start Java merely by opening a file and does not poll a closed debugger", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json(stopped),
    );
    vi.stubGlobal("fetch", fetchMock);
    panel();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toContain("?file=");
    expect(
      screen.getByRole("button", { name: "Enable Java tools" }),
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes("/debug")),
    ).toBe(false);
  });
  it("requires a saved document before semantic rename and displays actual navigation results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        Response.json(
          String(input).endsWith("/query")
            ? {
                version: 1,
                locations: [
                  {
                    path: "backend/Service.java",
                    range: {
                      start: { line: 2, character: 0 },
                      end: { line: 2, character: 5 },
                    },
                  },
                ],
              }
            : ready,
        ),
      ),
    );
    panel(true);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Find references" }),
      ).toBeTruthy(),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "New Java symbol name" }),
      { target: { value: "readSignal" } },
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Preview symbol rename",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Find references" }));
    await waitFor(() =>
      expect(screen.getByText("backend/Service.java:3")).toBeTruthy(),
    );
  });
  it("reports setup failure instead of displaying ready controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/start")
          ? Response.json(
              { error: { message: "JDK 21 required" } },
              { status: 400 },
            )
          : Response.json(stopped),
      ),
    );
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Enable Java tools" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "JDK 21 required",
      ),
    );
    expect(
      screen.queryByRole("button", { name: "Find references" }),
    ).toBeNull();
  });
});
