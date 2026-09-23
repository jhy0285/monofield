/** Indent complete selected lines, or insert two spaces at a collapsed caret. */
export function indentTextSelection(text: string, start: number, end: number, outdent = false) {
  if (start === end && !outdent) {
    return { text: text.slice(0, start) + '  ' + text.slice(end), start: start + 2, end: end + 2 };
  }
  const lineStart = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
  // A selection ending at the next line's start must not modify that line.
  const lastSelected = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const nextNewline = text.indexOf('\n', lastSelected);
  const lineEnd = nextNewline === -1 ? text.length : nextNewline;
  const lines = text.slice(lineStart, lineEnd).split('\n');
  let firstDelta = 0;
  let totalDelta = 0;
  const replacement = lines.map((line, index) => {
    const removed = outdent ? (line.match(/^(?:\t| {1,2})/)?.[0].length ?? 0) : 0;
    const delta = outdent ? -removed : 2;
    if (index === 0) firstDelta = delta;
    totalDelta += delta;
    return outdent ? line.slice(removed) : `  ${line}`;
  }).join('\n');
  return {
    text: text.slice(0, lineStart) + replacement + text.slice(lineEnd),
    start: Math.max(lineStart, start + firstDelta),
    end: Math.max(lineStart, end + totalDelta),
  };
}
