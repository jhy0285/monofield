import type { ComposeInput } from './system.js';

export function isNativeCodexChat(input: Pick<ComposeInput, 'agentId' | 'sessionMode' | 'streamFormat' | 'executionProfile'>): boolean {
  return input.agentId === 'codex' && input.sessionMode === 'chat'
    && input.streamFormat !== 'plain' && input.executionProfile !== 'text_artifact';
}

/** Keep Codex's own instructions; omit the app charter only when no selected context needs it. */
export function canSkipNativeCodexInstructions(input: ComposeInput): boolean {
  if (!isNativeCodexChat(input)) return false;
  if (input.metadata?.kind && !['other', 'prototype'].includes(input.metadata.kind)) return false;
  if (input.metadata?.databaseContext?.connectionId || input.template || input.critique?.enabled
    || input.skillMode || input.skillModes?.length || input.connectedExternalMcp?.length) return false;
  return ![
    input.skillBody, input.designSystemBody, input.designSystemUsageMd, input.designSystemTokensCss,
    input.designSystemComponentsManifest, input.designSystemFixtureHtml, input.designSystemPullIndex,
    input.craftBody, input.memoryBody, input.userInstructions, input.projectInstructions,
    input.pluginBlock, ...(input.activeStageBlocks ?? []),
  ].some((part) => typeof part === 'string' && part.trim().length > 0);
}

/** Remove only the host's exact single-user wrapper, never a seeded multi-turn transcript. */
export function nativeCodexUserRequest(request: string, currentPrompt: unknown): string {
  return typeof currentPrompt === 'string' && request === `## user\n${currentPrompt.trim()}`
    ? currentPrompt : request;
}
