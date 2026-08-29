import { describe, expect, it } from 'vitest';

import {
  capabilitiesForExecutionProfile,
  executionProfileFromStreamFormat,
} from '../src/execution-profile.js';

describe('execution profile capabilities', () => {
  it('keeps project-connected tools on structured Local CLI runtimes', () => {
    const profile = executionProfileFromStreamFormat('claude-stream-json');
    expect(profile).toBe('filesystem');
    expect(capabilitiesForExecutionProfile(profile)).toEqual({
      workingFolder: 'read-write',
      nativeTools: true,
      browserAutomation: true,
      databaseTools: true,
      externalMcp: 'adapter-dependent',
      textArtifacts: true,
    });
  });

  it('limits plain/BYOK runtimes to chat and text artifacts', () => {
    const profile = executionProfileFromStreamFormat('plain');
    expect(profile).toBe('text_artifact');
    expect(capabilitiesForExecutionProfile(profile)).toEqual({
      workingFolder: 'none',
      nativeTools: false,
      browserAutomation: false,
      databaseTools: false,
      externalMcp: 'none',
      textArtifacts: true,
    });
  });
});
