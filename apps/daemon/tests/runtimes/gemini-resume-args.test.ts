import { describe, expect, it } from 'vitest';

import { geminiAgentDef } from '../../src/runtimes/defs/gemini.js';
import { agentCapabilities } from '../../src/runtimes/capabilities.js';

describe('Gemini CLI session and workspace arguments', () => {
  it('starts a daemon-owned session and forwards each allowed directory', () => {
    agentCapabilities.delete('gemini');
    const args = geminiAgentDef.buildArgs(
      '',
      [],
      ['C:\\work\\skills', '', 'C:\\work\\design-systems'],
      { model: 'gemini-3.1-pro-preview' },
      { newSessionId: 'mono-session-1' },
    );

    expect(args).toEqual([
      '--output-format',
      'stream-json',
      '--approval-mode=yolo',
      '--model',
      'gemini-3.1-pro-preview',
      '--include-directories',
      'C:\\work\\skills',
      '--include-directories',
      'C:\\work\\design-systems',
      '--session-id',
      'mono-session-1',
    ]);
  });

  it('resumes the stored UUID instead of creating a second session', () => {
    agentCapabilities.delete('gemini');
    const args = geminiAgentDef.buildArgs(
      '',
      [],
      [],
      {},
      { resumeSessionId: 'existing-session', newSessionId: 'unused-session' },
    );

    expect(args).toContain('--resume');
    expect(args).toContain('existing-session');
    expect(args).not.toContain('--session-id');
    expect(geminiAgentDef.resumesSessionViaCli).toBe(true);
  });
});
