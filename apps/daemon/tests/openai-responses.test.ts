import { describe, expect, it } from 'vitest';
import { buildOpenAIResponsesPayload, parseOpenAIResponsesFrame, shouldUseOpenAIResponses } from '../src/integrations/openai-responses.js';

describe('OpenAI Responses adapter', () => {
  it('keeps compatible providers on chat completions and supports an explicit override', () => {
    expect(shouldUseOpenAIResponses('api.openai.com', 'gpt-5.2')).toBe(true);
    expect(shouldUseOpenAIResponses('api.example.com', 'gpt-5.2')).toBe(false);
    expect(shouldUseOpenAIResponses('api.openai.com', 'gpt-4o')).toBe(false);
    expect(shouldUseOpenAIResponses('api.openai.com', 'gpt-5', 'chat-completions')).toBe(false);
  });
  it('sends conversation context, images and a token cap without storing responses', () => {
    const payload = buildOpenAIResponsesPayload({ model: 'gpt-5', systemPrompt: 'Keep evidence', maxTokens: 1200,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Screen' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] }],
    });
    expect(payload).toMatchObject({ store: false, instructions: 'Keep evidence', max_output_tokens: 1200,
      input: [{ content: [{ type: 'input_text', text: 'Screen' }, { type: 'input_image', image_url: 'data:image/png;base64,AAAA' }] }],
    });
  });
  it('distinguishes completion from truncation or failure and preserves usage', () => {
    expect(parseOpenAIResponsesFrame({ type: 'response.output_text.delta', delta: 'hello' })).toEqual({ delta: 'hello' });
    expect(parseOpenAIResponsesFrame({ type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 3 } } })).toEqual({ terminal: true, usage: { input_tokens: 10, output_tokens: 3 } });
    expect(parseOpenAIResponsesFrame({ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } }).error).toContain('max_output_tokens');
    expect(parseOpenAIResponsesFrame({ type: 'response.failed', response: { error: { message: 'failure' } } }).error).toBe('failure');
  });
});
