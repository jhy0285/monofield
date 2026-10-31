import type { ExecutionPermissionLevel } from '@open-design/contracts';

import type { RuntimeAgentDef } from './types.js';

/**
 * The message for starting `def` at the "Read only" execution permission level,
 * or null when that is fine: the level is another one, or the adapter turns it
 * into flags its CLI documents (`readOnlySupport`). Everything else is refused
 * rather than started with an approve-everything flag the user did not choose.
 */
export function readOnlyUnsupportedMessage(
  def: Pick<RuntimeAgentDef, 'name' | 'readOnlySupport'>,
  level: ExecutionPermissionLevel,
): string | null {
  if (level !== 'read-only' || def.readOnlySupport === true) return null;
  return (
    `${def.name} cannot run at the "Read only" execution permission level: MonoField starts it with an ` +
    'approve-everything setting and could not confirm a read-only mode for it. ' +
    'Choose "Default" in Settings → Execution permissions, or pick Codex, Claude Code, Gemini, Qwen Code, CodeBuddy or Copilot.'
  );
}
