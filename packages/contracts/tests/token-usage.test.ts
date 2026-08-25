import { describe, expect, it } from 'vitest';
import {
  defaultConversationModeForWorkMode,
  normalizeProviderTokenUsage,
  summarizeTokenUsage,
} from '../src/index.js';

describe('token usage normalization', () => {
  it('normalizes Anthropic cache fields into effective input', () => {
    expect(normalizeProviderTokenUsage({
      input_tokens: 100,
      output_tokens: 25,
      cache_read_input_tokens: 300,
      cache_creation_input_tokens: 50,
    })).toEqual({
      inputTokens: 450,
      cachedInputTokens: 350,
      outputTokens: 25,
      totalTokens: 475,
      measurementSource: 'provider_usage',
    });
  });

  it('does not double count OpenAI cached prompt tokens', () => {
    expect(normalizeProviderTokenUsage({
      prompt_tokens: 500,
      completion_tokens: 40,
      total_tokens: 540,
      prompt_tokens_details: { cached_tokens: 320 },
      output_tokens_details: { reasoning_tokens: 12 },
    })).toMatchObject({
      inputTokens: 500,
      cachedInputTokens: 320,
      outputTokens: 40,
      reasoningTokens: 12,
      totalTokens: 540,
      measurementSource: 'provider_usage',
    });
  });

  it('sums per-call reports and preserves an estimated disclosure', () => {
    expect(summarizeTokenUsage([
      { inputTokens: 100, outputTokens: 20, totalTokens: 120, measurementSource: 'provider_usage' },
      { inputTokens: 60, outputTokens: 15, totalTokens: 75, costUsd: 0.01, measurementSource: 'estimated' },
    ])).toMatchObject({
      inputTokens: 160,
      outputTokens: 35,
      totalTokens: 195,
      costUsd: 0.01,
      measurementSource: 'estimated',
    });
  });

  it('restores the total and measured source for legacy usage events', () => {
    expect(summarizeTokenUsage([{ inputTokens: 40, outputTokens: 9 }])).toEqual({
      inputTokens: 40,
      outputTokens: 9,
      totalTokens: 49,
      measurementSource: 'provider_usage',
    });
  });
});

describe('project work mode defaults', () => {
  it('maps development to Ask and creation to Docs', () => {
    expect(defaultConversationModeForWorkMode('development')).toBe('chat');
    expect(defaultConversationModeForWorkMode('creation')).toBe('docs');
  });
});
