import { describe, expect, it } from 'vitest';

import { opencodeAgentDef } from '../../src/runtimes/defs/opencode.js';

describe('OpenCode session arguments', () => {
  it('lets OpenCode generate the first session id for stream capture', () => {
    const args = opencodeAgentDef.buildArgs(
      '',
      [],
      [],
      { model: 'openai/gpt-5' },
      { newSessionId: 'unsupported-create-id' },
    );

    expect(args).toEqual(['run', '--format', 'json', '-m', 'openai/gpt-5']);
    expect(opencodeAgentDef.resumesSessionViaCli).toBe(true);
    expect(opencodeAgentDef.sessionIdFromStream).toBe(true);
  });

  it('resumes exactly the session captured from the prior JSON stream', () => {
    const args = opencodeAgentDef.buildArgs(
      '',
      [],
      [],
      {},
      { resumeSessionId: 'ses-abc123' },
    );

    expect(args).toEqual(['run', '--format', 'json', '--session', 'ses-abc123']);
  });
});
