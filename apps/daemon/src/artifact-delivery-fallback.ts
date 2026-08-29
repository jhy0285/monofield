import type { ExecutionProfile } from '@open-design/contracts';

export interface ArtifactDeliveryFallbackScope {
  workMode?: unknown;
  sessionMode?: unknown;
  structuredArtifactInstructions?: boolean;
}

export interface ArtifactDeliveryFallbackDecision
  extends ArtifactDeliveryFallbackScope {
  errorCode?: unknown;
  executionProfile: ExecutionProfile;
  fallbackAttempted?: boolean;
  cancelRequested?: boolean;
}

/**
 * Host-owned artifact delivery is deliberately narrower than ordinary project
 * execution. It is available only to document/design projects while Docs mode
 * is handling an artifact-producing turn. Development projects must keep using
 * their user-selected working folder and native CLI tools.
 */
export function requiresHostOwnedArtifactDelivery(
  scope: ArtifactDeliveryFallbackScope,
): boolean {
  return (
    scope.workMode === 'creation'
    && scope.sessionMode === 'docs'
    && scope.structuredArtifactInstructions !== false
  );
}

/**
 * A Windows sandbox logon failure cannot be repaired by repeating the same
 * native tool call. For a narrowly scoped creation turn, switch once to the
 * text-artifact contract so the host can persist the returned artifact through
 * its project API. Never use this as a filesystem escape hatch for development.
 */
export function shouldStartHostOwnedArtifactFallback(
  input: ArtifactDeliveryFallbackDecision,
  expectedErrorCode: string,
): boolean {
  return (
    requiresHostOwnedArtifactDelivery(input)
    && input.executionProfile === 'filesystem'
    && input.errorCode === expectedErrorCode
    && input.fallbackAttempted !== true
    && input.cancelRequested !== true
  );
}

export function executionProfileForArtifactDelivery(
  defaultProfile: ExecutionProfile,
  fallbackAttempted: boolean | undefined,
): ExecutionProfile {
  return fallbackAttempted === true ? 'text_artifact' : defaultProfile;
}

/**
 * True only for the one-way host-owned recovery attempt. The server uses this
 * as a security boundary (not merely a prompt hint): it withholds tool tokens,
 * starts a fresh CLI session in an empty managed cwd, strips project runtime
 * environment, and asks supporting adapters to disable native tools.
 */
export function isHostOwnedArtifactFallbackAttempt({
  executionProfile,
  fallbackAttempted,
}: {
  executionProfile: ExecutionProfile;
  fallbackAttempted?: boolean;
}): boolean {
  return executionProfile === 'text_artifact' && fallbackAttempted === true;
}

/** The Windows native-execution circuit is irrelevant to a no-tools handoff. */
export function shouldEnforceCodexNativeSandboxCircuit(
  agentId: unknown,
  executionProfile: ExecutionProfile,
): boolean {
  return agentId === 'codex' && executionProfile === 'filesystem';
}

/**
 * The no-tools fallback is allowed to finish only after the model emitted a
 * closed, non-empty artifact envelope. This is intentionally a small transport
 * check rather than HTML validation: the host applies the renderer-specific
 * validation and persists the file, then the web client waits for that save
 * receipt before exposing success.
 */
export function hasCompleteHostOwnedArtifactEnvelope(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  const open = /<artifact\b[^>]*>/iu.exec(value);
  if (!open) return false;
  const bodyStart = open.index + open[0].length;
  const close = value.indexOf('</artifact>', bodyStart);
  if (close < bodyStart) return false;
  return value.slice(bodyStart, close).trim().length > 0;
}

export function shouldRejectIncompleteHostOwnedArtifact({
  deliveryRequired,
  executionProfile,
  assistantText,
  askedQuestion,
}: {
  deliveryRequired: boolean;
  executionProfile: ExecutionProfile;
  assistantText: unknown;
  askedQuestion: boolean;
}): boolean {
  return (
    deliveryRequired
    && executionProfile === 'text_artifact'
    && !askedQuestion
    && !hasCompleteHostOwnedArtifactEnvelope(assistantText)
  );
}
