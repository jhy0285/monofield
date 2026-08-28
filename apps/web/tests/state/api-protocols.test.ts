import { describe, expect, it } from 'vitest';
import {
  FAST_MODEL_BY_PROTOCOL,
  SUGGESTED_MODELS_BY_PROTOCOL,
} from '../../src/state/apiProtocols';

describe('apiProtocols table consistency', () => {
  it('FAST_MODEL_BY_PROTOCOL.google is one of the live suggested models', () => {
    expect(SUGGESTED_MODELS_BY_PROTOCOL.google).toContain(FAST_MODEL_BY_PROTOCOL.google);
  });

  it('keeps current first-party frontier models in the BYOK suggestions', () => {
    expect(SUGGESTED_MODELS_BY_PROTOCOL.openai).toEqual(expect.arrayContaining([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ]));
    expect(SUGGESTED_MODELS_BY_PROTOCOL.anthropic).toContain('claude-sonnet-5');
    expect(SUGGESTED_MODELS_BY_PROTOCOL.google).toContain('gemini-3.7-flash');
  });
});
