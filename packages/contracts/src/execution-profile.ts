export type ExecutionProfile = 'filesystem' | 'text_artifact';

export interface ExecutionProfileCapabilities {
  /** Can read, create, and edit files in the selected working folder. */
  workingFolder: 'read-write' | 'none';
  /** Can invoke the agent's native shell / code tools. */
  nativeTools: boolean;
  /** Can use MonoField's approved in-app browser automation bridge. */
  browserAutomation: boolean;
  /** Can use a project-selected database connection through the broker. */
  databaseTools: boolean;
  /** External MCP forwarding also depends on the selected adapter. */
  externalMcp: 'adapter-dependent' | 'none';
  /** Can still return a previewable artifact through assistant text. */
  textArtifacts: boolean;
}

/**
 * User-facing capability boundary for the two execution profiles. Local CLI
 * adapters with a structured runtime use `filesystem`; BYOK and plain API
 * adapters use `text_artifact`. Keeping this in contracts prevents Settings,
 * onboarding, and future guides from promising daemon tools to an API-only
 * model just because both surfaces share the same composer.
 */
export const EXECUTION_PROFILE_CAPABILITIES: Readonly<
  Record<ExecutionProfile, Readonly<ExecutionProfileCapabilities>>
> = {
  filesystem: {
    workingFolder: 'read-write',
    nativeTools: true,
    browserAutomation: true,
    databaseTools: true,
    externalMcp: 'adapter-dependent',
    textArtifacts: true,
  },
  text_artifact: {
    workingFolder: 'none',
    nativeTools: false,
    browserAutomation: false,
    databaseTools: false,
    externalMcp: 'none',
    textArtifacts: true,
  },
};

export function capabilitiesForExecutionProfile(
  profile: ExecutionProfile,
): Readonly<ExecutionProfileCapabilities> {
  return EXECUTION_PROFILE_CAPABILITIES[profile];
}

export function executionProfileFromStreamFormat(
  streamFormat: string | null | undefined,
): ExecutionProfile {
  return streamFormat === 'plain' ? 'text_artifact' : 'filesystem';
}
