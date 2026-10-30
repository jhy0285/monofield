/**
 * Runtimes MonoField documents and verifies end to end (README "Runtime
 * capability boundary"). Any other local CLI adapter is detected and usable but
 * not shown to have the same file, terminal, Git and browser coverage.
 */
const VERIFIED_AGENT_IDS: ReadonlySet<string> = new Set(['codex', 'claude']);

/** The hosted model router is a MonoField-integrated service, not a CLI someone else maintains. */
const HOSTED_AGENT_IDS: ReadonlySet<string> = new Set(['amr']);

export function isCommunityAgent(id: string | null | undefined): boolean {
  if (!id) return false;
  return !VERIFIED_AGENT_IDS.has(id) && !HOSTED_AGENT_IDS.has(id);
}
