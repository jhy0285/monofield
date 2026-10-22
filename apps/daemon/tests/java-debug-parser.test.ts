import { describe, expect, it } from "vitest";
import {
  javaDebugFrames,
  javaDebugLocals,
  javaDebugPrompt,
} from "../src/services/java/debug-parser.js";
describe("actual jdb output interpretation", () => {
  it("reads source frames, unknown source frames and scalar locals", () => {
    expect(
      javaDebugFrames(
        "  [1] example.SignalService.read (SignalService.java:25)\n  [2] java.lang.Thread.run (Unknown Source)\nhttp-nio-8080-exec-1[1] ",
      ),
    ).toEqual([
      {
        index: 1,
        method: "example.SignalService.read",
        source: "SignalService.java",
        line: 25,
      },
      {
        index: 2,
        method: "java.lang.Thread.run",
        source: "Unknown Source",
        line: null,
      },
    ]);
    expect(
      javaDebugLocals(
        'Method arguments:\nid = 1\nLocal variables:\nname = "신호"\nhttp-nio[1] ',
      ),
    ).toEqual([
      { name: "id", value: "1" },
      { name: "name", value: '"신호"' },
    ]);
  });
  it("requires a complete prompt and bounds unexpectedly large output", () => {
    expect(javaDebugPrompt("Breakpoint hit:\nhttp-nio[1] ")).toBe(true);
    expect(javaDebugPrompt("> ")).toBe(true);
    expect(javaDebugPrompt("http-nio[1")).toBe(false);
    expect(
      javaDebugLocals("value = " + "x".repeat(5000))[0]?.value,
    ).toHaveLength(2000);
  });
});
