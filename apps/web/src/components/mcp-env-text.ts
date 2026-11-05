/**
 * The MCP form keeps a server's environment as plain `KEY=VALUE` lines. These
 * helpers read and write one key of that text without touching the other lines,
 * comments or ordering, so a dedicated input and the text box can show the same
 * data.
 */

function keyOf(line: string): string | null {
  const eq = line.indexOf('=');
  if (eq <= 0) return null;
  const key = line.slice(0, eq).trim();
  return key || null;
}

/** The value after `KEY=` exactly as typed (not trimmed, so "Program Files" can be typed one key at a time). */
export function readEnvLine(text: string | undefined, key: string): string | undefined {
  let found: string | undefined;
  for (const line of (text ?? '').split('\n')) {
    if (keyOf(line) === key) found = line.slice(line.indexOf('=') + 1);
  }
  return found;
}

/**
 * Set `key` to `value`, or remove its lines when the value is empty (an empty
 * value is never saved). The first matching line keeps its place, later
 * duplicates are dropped, and a missing key is appended.
 */
export function writeEnvLine(text: string | undefined, key: string, value: string): string {
  const lines = (text ?? '').split('\n');
  const empty = value.trim() === '';
  const out: string[] = [];
  let written = false;
  for (const line of lines) {
    if (keyOf(line) !== key) { out.push(line); continue; }
    if (empty || written) continue;
    out.push(`${key}=${value}`);
    written = true;
  }
  if (!empty && !written) {
    while (out.length > 0 && out[out.length - 1]?.trim() === '') out.pop();
    out.push(`${key}=${value}`);
  }
  return out.join('\n');
}

/** A POSIX path, a Windows drive path or a UNC path. REA refuses to start with anything else. */
export function isAbsoluteFolder(value: string): boolean {
  return /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value.trim());
}
