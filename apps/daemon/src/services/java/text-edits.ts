import type { JavaPosition, JavaTextEdit } from "@open-design/contracts";

export function javaOffset(text: string, position: JavaPosition): number {
  if (
    !Number.isInteger(position?.line) ||
    !Number.isInteger(position?.character) ||
    position.line < 0 ||
    position.character < 0
  )
    throw new Error("Invalid Java position");
  let offset = 0;
  for (let i = 0; i < position.line; i++) {
    const next = text.indexOf("\n", offset);
    if (next < 0) throw new Error("Java position exceeds document");
    offset = next + 1;
  }
  const end = text.indexOf("\n", offset);
  let length = (end < 0 ? text.length : end) - offset;
  if (text[offset + length - 1] === "\r") length--;
  if (position.character > length)
    throw new Error("Java position exceeds line");
  return offset + position.character;
}
export function applyJavaTextEdits(
  text: string,
  edits: JavaTextEdit[],
): string {
  if (!Array.isArray(edits) || edits.length > 10000)
    throw new Error("Java edit limit");
  const ranges = edits
    .map((edit) => ({
      start: javaOffset(text, edit.range.start),
      end: javaOffset(text, edit.range.end),
      newText: edit.newText,
    }))
    .sort((a, b) => b.start - a.start || b.end - a.end);
  let boundary = text.length + 1;
  for (const edit of ranges) {
    if (
      typeof edit.newText !== "string" ||
      edit.end < edit.start ||
      edit.end > boundary ||
      edit.start === boundary
    )
      throw new Error("Overlapping or invalid Java edits");
    text = text.slice(0, edit.start) + edit.newText + text.slice(edit.end);
    boundary = edit.start;
  }
  return text;
}
