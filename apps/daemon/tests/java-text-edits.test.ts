import { describe, expect, it } from "vitest";
import {
  applyJavaTextEdits,
  javaOffset,
} from "../src/services/java/text-edits.js";
describe("Java UTF-16 source edits", () => {
  it("preserves CRLF and Unicode while applying several nonoverlapping edits", () => {
    const text = "// 🚦\r\nint oldName() { return oldName(); }\r\n";
    expect(javaOffset(text, { line: 1, character: 4 })).toBe(11);
    const result = applyJavaTextEdits(text, [
      {
        range: {
          start: { line: 1, character: 4 },
          end: { line: 1, character: 11 },
        },
        newText: "readCycle",
      },
      {
        range: {
          start: { line: 1, character: 23 },
          end: { line: 1, character: 30 },
        },
        newText: "readCycle",
      },
    ]);
    expect(result).toBe("// 🚦\r\nint readCycle() { return readCycle(); }\r\n");
  });
  it("rejects invalid coordinates and overlapping edits before any filesystem write", () => {
    expect(() => javaOffset("abc", { line: 1, character: 0 })).toThrow();
    expect(() => javaOffset("abc", { line: 0, character: 4 })).toThrow();
    expect(() =>
      applyJavaTextEdits("abcdef", [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 3 },
          },
          newText: "x",
        },
        {
          range: {
            start: { line: 0, character: 2 },
            end: { line: 0, character: 4 },
          },
          newText: "y",
        },
      ]),
    ).toThrow("Overlapping");
  });
});
