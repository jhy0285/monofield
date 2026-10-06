import type { ProxyMessage } from '@open-design/contracts';

export function shouldUseOpenAIResponses(hostname: string, model: string, format?: unknown): boolean {
  if (format === 'responses') return true;
  if (format === 'chat-completions') return false;
  return hostname === 'api.openai.com' && /^(gpt-5(?:[.-]|$)|o[134](?:[.-]|$))/i.test(model);
}

export function buildOpenAICompatibleMessages(messages: ProxyMessage[]) {
  return messages.map((message) => ({
    ...message,
    content: typeof message.content === 'string' ? message.content : message.content.map((block) => {
      if (block.type !== 'image') return block;
      return { type: 'image_url', image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } };
    }),
  }));
}

export function buildOpenAIResponsesPayload(options: {
  model: string; systemPrompt?: string; messages: ProxyMessage[]; maxTokens?: number;
}) {
  return {
    model: options.model, stream: true, store: false,
    max_output_tokens: options.maxTokens && options.maxTokens > 0 ? options.maxTokens : 8192,
    ...(options.systemPrompt ? { instructions: options.systemPrompt } : {}),
    input: options.messages.map((message) => {
      if (message.role === 'tool') throw new Error('Responses chat requires tool-call IDs for tool messages; use the agent tool route.');
      return {
        role: message.role,
        content: typeof message.content === 'string' ? message.content : message.content.map((block) => {
          if (block.type === 'text') return { type: 'input_text', text: block.text };
          // OpenAI-compatible clients also send image_url blocks.
          if ('image_url' in block) {
            const image = block as unknown as { image_url: { url: string } };
            return { type: 'input_image', image_url: image.image_url.url, detail: 'auto' };
          }
          return { type: 'input_image', image_url: `data:${block.source.media_type};base64,${block.source.data}`, detail: 'auto' };
        }),
      };
    }),
  };
}

type ResponseFrame = {
  type?: string; delta?: string;
  error?: { message?: string };
  response?: { usage?: Record<string, unknown>; error?: { message?: string }; incomplete_details?: { reason?: string } };
};

export function parseOpenAIResponsesFrame(frame: ResponseFrame): {
  delta?: string; usage?: Record<string, unknown>; terminal?: boolean; error?: string;
} {
  if (frame.type === 'response.output_text.delta' || frame.type === 'response.refusal.delta') {
    return typeof frame.delta === 'string' ? { delta: frame.delta } : {};
  }
  if (frame.type === 'response.completed') {
    return { terminal: true, ...(frame.response?.usage ? { usage: frame.response.usage } : {}) };
  }
  if (frame.type === 'response.failed' || frame.type === 'error') {
    return { terminal: true, error: frame.response?.error?.message ?? frame.error?.message ?? 'OpenAI response failed.' };
  }
  if (frame.type === 'response.incomplete') {
    return { terminal: true, error: `OpenAI response incomplete: ${frame.response?.incomplete_details?.reason ?? 'unknown'}` };
  }
  return {};
}
