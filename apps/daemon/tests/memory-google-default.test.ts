import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STORED_BYOK_API_KEY } from '@open-design/contracts';
import { writeByokCredentials } from '../src/byok-credentials.js';
import { extractWithLLM } from '../src/memory-llm.js';
import { writeMemoryConfig } from '../src/memory.js';
import { __resetExtractionsForTests } from '../src/memory-extractions.js';
import {
  installTestCredentialVault,
  type TestCredentialVault,
} from './helpers/credential-vault.js';

const dataDir = path.join(process.env.OD_DATA_DIR as string, 'memory-google-default-test');
const originalFetch = globalThis.fetch;
const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
const originalOpenAIApiKey = process.env.OPENAI_API_KEY;
let credentialVault: TestCredentialVault;

function restoreEnvironment(name: 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY', value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : (input as Request).url;
}

beforeEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
  credentialVault = installTestCredentialVault();
  await writeMemoryConfig(dataDir, { chatExtractionEnabled: true });
  __resetExtractionsForTests();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnvironment('ANTHROPIC_API_KEY', originalAnthropicApiKey);
  restoreEnvironment('OPENAI_API_KEY', originalOpenAIApiKey);
  credentialVault.restore();
});

describe('memory-llm Google fast-model default', () => {
  it('uses gemini-3.5-flash (not a shut-down 2.0 model) when chatProvider omits a model', async () => {
    let capturedUrl: string | null = null;

    globalThis.fetch = async (input: Parameters<typeof fetch>[0]) => {
      capturedUrl = requestUrl(input);
      // Return a valid Google Gemini response shape so extractWithLLM can parse it.
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"entries":[]}' }] } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    await extractWithLLM(
      dataDir,
      { userMessage: 'I prefer dark mode.', assistantMessage: 'Noted.' },
      {
        projectRoot: null,
        chatAgentId: null,
        chatProvider: {
          provider: 'google',
          apiKey: 'AQ.TestKeyForUnitTests01234567890123456789012',
          baseUrl: 'https://generativelanguage.googleapis.com',
          apiVersion: '',
          model: '',
        },
      },
    );

    expect(capturedUrl).not.toBeNull();
    expect(capturedUrl).toContain('gemini-3.5-flash');
    expect(capturedUrl).not.toContain('gemini-2.0-flash');
  });

  it('fails closed instead of falling through to foreign env providers when chatProvider has no key', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-anthropic-must-not-be-used';
    process.env.OPENAI_API_KEY = 'sk-openai-must-not-be-used';
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount += 1;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };

    await extractWithLLM(
      dataDir,
      { userMessage: 'Keep this conversation local.', assistantMessage: 'Understood.' },
      {
        projectRoot: null,
        chatAgentId: null,
        chatProvider: {
          provider: 'openai',
          apiKey: '',
          baseUrl: 'http://127.0.0.1:11434/v1',
          apiVersion: '',
          model: 'local-model',
        },
      },
    );

    expect(fetchCount).toBe(0);
  });

  it.each([
    {
      provider: 'senseaudio',
      baseUrl: 'https://senseaudio.example/v1',
      apiKey: 'sk-senseaudio-memory',
      model: 'senseaudio-s2-flash',
    },
    {
      provider: 'aihubmix',
      baseUrl: 'https://aihubmix.example/v1',
      apiKey: 'sk-aihubmix-memory',
      model: 'gpt-4o-mini',
    },
  ])('uses the explicit $provider OpenAI-compatible endpoint and credential', async ({
    provider,
    baseUrl,
    apiKey,
    model,
  }) => {
    let capturedUrl: string | null = null;
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = async (input, init) => {
      capturedUrl = requestUrl(input);
      capturedInit = init;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"entries":[]}' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    await extractWithLLM(
      dataDir,
      { userMessage: `Use ${provider} for memory.`, assistantMessage: 'Understood.' },
      {
        projectRoot: null,
        chatAgentId: null,
        chatProvider: { provider, apiKey, baseUrl, apiVersion: '', model },
      },
    );

    expect(capturedUrl).toBe(`${baseUrl}/chat/completions`);
    expect(new Headers(capturedInit?.headers).get('authorization')).toBe(`Bearer ${apiKey}`);
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({ model });
  });

  it('resolves the central BYOK marker before placing the credential in Authorization', async () => {
    const storedSecret = 'sk-central-vault-memory-secret';
    await writeByokCredentials(dataDir, { credentials: { openai: storedSecret } });
    let authorization: string | null = null;
    globalThis.fetch = async (_input, init) => {
      authorization = new Headers(init?.headers).get('authorization');
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"entries":[]}' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    await extractWithLLM(
      dataDir,
      { userMessage: 'Remember this safely.', assistantMessage: 'Understood.' },
      {
        projectRoot: null,
        chatAgentId: null,
        chatProvider: {
          provider: 'openai',
          apiKey: STORED_BYOK_API_KEY,
          baseUrl: 'https://openai.example/v1',
          apiVersion: '',
          model: 'gpt-4o-mini',
        },
      },
    );

    expect(authorization).toBe(`Bearer ${storedSecret}`);
    expect(authorization).not.toContain(STORED_BYOK_API_KEY);
  });
});
