/** Compact framing for chat and structured-document guidance; memory facts stay intact. */
export function renderLeanMemoryContext(body: string): string {
  return `\n\n## Personal memory\n\nUse these preferences, terminology, goals and constraints as context. The current user request takes precedence; selected design-system tokens and skill workflows govern their own domains. Infer missing context silently and ask only unresolved critical questions. Do not re-ask facts already recorded here.\n\n${body.trim()}`;
}
