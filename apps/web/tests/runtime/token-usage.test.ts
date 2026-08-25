import { describe, expect, it } from 'vitest';
import { usageForConversation, usageForEvents } from '../../src/runtime/token-usage';
import type { ChatMessage } from '../../src/types';

describe('chat token usage summaries', () => {
  it('combines multiple model calls within one response', () => {
    expect(usageForEvents([
      { kind: 'usage', inputTokens: 100, outputTokens: 20, totalTokens: 120, measurementSource: 'provider_usage' },
      { kind: 'usage', inputTokens: 80, cachedInputTokens: 50, outputTokens: 10, totalTokens: 90, measurementSource: 'provider_usage' },
    ])).toMatchObject({
      inputTokens: 180,
      cachedInputTokens: 50,
      outputTokens: 30,
      totalTokens: 210,
      measurementSource: 'provider_usage',
    });
  });

  it('reports conversation coverage without pretending missing responses are zero', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'hello' },
      {
        id: 'a1', role: 'assistant', content: 'one',
        events: [{ kind: 'usage', inputTokens: 100, outputTokens: 20, totalTokens: 120, measurementSource: 'provider_usage' }],
      },
      { id: 'a2', role: 'assistant', content: 'two' },
    ];
    expect(usageForConversation(messages)).toMatchObject({
      assistantResponseCount: 2,
      measuredResponseCount: 1,
      metrics: { totalTokens: 120, measurementSource: 'provider_usage' },
    });
  });
});
