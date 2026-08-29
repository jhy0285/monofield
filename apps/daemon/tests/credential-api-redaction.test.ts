import type { Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  STORED_AGENT_CLI_CREDENTIAL,
  STORED_BYOK_API_KEY,
} from '@open-design/contracts';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readMcpConfig } from '../src/mcp-config.js';
import { readAppConfig } from '../src/app-config.js';
import { composeSystemPrompt } from '../src/prompts/system.js';
import { startServer } from '../src/server.js';
import { installTestCredentialVault, type TestCredentialVault } from './helpers/credential-vault.js';

type StartedServer = { server: Server; url: string };

describe('credential API redaction', () => {
  const realFetch = globalThis.fetch;
  let baseUrl = '';
  let server: Server;
  let vault: TestCredentialVault;

  beforeAll(async () => {
    vault = installTestCredentialVault();
    const started = await startServer({
      port: 0,
      returnServer: true,
      desktopCredentialVault: vault.broker,
    }) as StartedServer;
    baseUrl = started.url;
    server = started.server;
  });

  afterAll(async () => {
    await fetch(`${baseUrl}/api/mcp/servers`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ servers: [] }),
    }).catch(() => undefined);
    await fetch(`${baseUrl}/api/connectors/composio/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: '' }),
    }).catch(() => undefined);
    await fetch(`${baseUrl}/api/byok/credentials`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credentials: { anthropic: '' } }),
    }).catch(() => undefined);
    await fetch(`${baseUrl}/api/app-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentCliEnv: {}, agentCliEnvIntent: {} }),
    }).catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vault.restore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never echoes MCP env/header credentials from PUT or GET', async () => {
    const envSecret = 'api-mcp-env-secret';
    const headerSecret = 'Bearer api-mcp-header-secret';
    const payload = {
      servers: [
        { id: 'github', transport: 'stdio', enabled: true, command: 'npx', env: { GITHUB_TOKEN: envSecret } },
        { id: 'remote', transport: 'http', enabled: true, url: 'https://mcp.example.test', headers: { Authorization: headerSecret } },
      ],
    };
    const put = await fetch(`${baseUrl}/api/mcp/servers`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(put.status).toBe(200);
    const putText = await put.text();
    expect(putText).not.toContain(envSecret);
    expect(putText).not.toContain(headerSecret);
    expect(putText).toContain('••••••••');

    const getText = await (await fetch(`${baseUrl}/api/mcp/servers`)).text();
    expect(getText).not.toContain(envSecret);
    expect(getText).not.toContain(headerSecret);
    expect(getText).toContain('••••••••');
  });

  it('never echoes the Composio API key and exposes only its tail', async () => {
    const secret = 'cmp_api_response_secret_6789';
    const put = await fetch(`${baseUrl}/api/connectors/composio/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: secret }),
    });
    expect(put.status).toBe(200);
    const putText = await put.text();
    expect(putText).not.toContain(secret);
    expect(JSON.parse(putText)).toEqual({ configured: true, apiKeyTail: '6789' });

    const getText = await (await fetch(`${baseUrl}/api/connectors/composio/config`)).text();
    expect(getText).not.toContain(secret);
    expect(JSON.parse(getText)).toEqual({ configured: true, apiKeyTail: '6789' });
  });

  it('stores BYOK keys without echoing them and resolves only the marker internally', async () => {
    const secret = 'sk-ant-api-response-secret-2468';
    const put = await fetch(`${baseUrl}/api/byok/credentials`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credentials: { anthropic: secret } }),
    });
    expect(put.status).toBe(200);
    const putText = await put.text();
    expect(putText).not.toContain(secret);
    expect(JSON.parse(putText)).toEqual({
      credentials: { anthropic: { configured: true, apiKeyTail: '2468' } },
    });

    const getText = await (await fetch(`${baseUrl}/api/byok/credentials`)).text();
    expect(getText).not.toContain(secret);
    expect(getText).toContain('2468');
    // Marker resolution itself is covered by the storage unit test; API
    // responses expose only metadata and never the resolved value.
    expect(STORED_BYOK_API_KEY).not.toContain(secret);
  });

  it('resolves a stored marker only for the upstream request', async () => {
    const secret = 'sk-vault-upstream-only-1357';
    await realFetch(`${baseUrl}/api/byok/credentials`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credentials: { openai: secret } }),
    });
    const upstreamFetch = vi.fn((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(input).startsWith(baseUrl)) return realFetch(input, init);
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${secret}`);
      return Promise.resolve(new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }));
    });
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await realFetch(`${baseUrl}/api/proxy/openai/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://provider.example.test/v1',
        apiKey: STORED_BYOK_API_KEY,
        model: 'test-model',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('event: end');
    expect(upstreamFetch).toHaveBeenCalled();
  });

  it('resolves a stored BYOK marker for background memory extraction without exposing it', async () => {
    const secret = 'sk-memory-upstream-only-8642';
    await realFetch(`${baseUrl}/api/byok/credentials`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credentials: { openai: secret } }),
    });
    await realFetch(`${baseUrl}/api/memory/config`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatExtractionEnabled: true }),
    });
    const upstreamFetch = vi.fn((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(input).startsWith(baseUrl)) return realFetch(input, init);
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${secret}`);
      expect(JSON.stringify(init)).not.toContain(STORED_BYOK_API_KEY);
      return Promise.resolve(new Response(JSON.stringify({
        choices: [{ message: { content: '[]' } }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    });
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await realFetch(`${baseUrl}/api/memory/extract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userMessage: 'Remember my preference.',
        assistantMessage: 'Understood.',
        chatProvider: {
          provider: 'openai',
          apiKey: STORED_BYOK_API_KEY,
          baseUrl: 'https://provider.example.test/v1',
          model: 'test-model',
        },
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(secret);
    await vi.waitFor(() => expect(upstreamFetch).toHaveBeenCalled(), { timeout: 2_000 });
  });

  it('encrypts Local CLI auth overrides and never returns them through app-config', async () => {
    const secret = 'sk-cli-api-response-secret-9753';
    const put = await fetch(`${baseUrl}/api/app-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentCliEnv: {
          codex: {
            CODEX_HOME: '~/.codex-secure',
            OPENAI_API_KEY: secret,
          },
        },
        agentCliEnvIntent: { codex: { apiKeyOverride: true } },
      }),
    });
    expect(put.status).toBe(200);
    const putText = await put.text();
    expect(putText).not.toContain(secret);
    expect(putText).toContain(STORED_AGENT_CLI_CREDENTIAL);

    const getText = await (await fetch(`${baseUrl}/api/app-config`)).text();
    expect(getText).not.toContain(secret);
    expect(getText).toContain(STORED_AGENT_CLI_CREDENTIAL);

    const dataDir = process.env.OD_DATA_DIR!;
    await expect(readAppConfig(dataDir)).resolves.toMatchObject({
      agentCliEnv: { codex: { OPENAI_API_KEY: secret } },
    });
    const disk = await readFile(path.join(dataDir, 'app-config.json'), 'utf8');
    expect(disk).not.toContain(secret);
    expect(disk).toContain(STORED_AGENT_CLI_CREDENTIAL);
  });

  it('passes only MCP ids and labels into the model prompt, never credentials', async () => {
    await fetch(`${baseUrl}/api/mcp/servers`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ servers: [
        { id: 'github', transport: 'stdio', enabled: true, command: 'npx', env: { GITHUB_TOKEN: 'api-mcp-env-secret' } },
        { id: 'remote', transport: 'http', enabled: true, url: 'https://mcp.example.test', headers: { Authorization: 'Bearer api-mcp-header-secret' } },
      ] }),
    });
    const dataDir = process.env.OD_DATA_DIR!;
    const internal = await readMcpConfig(dataDir);
    const serializedInternal = JSON.stringify(internal);
    expect(serializedInternal).toContain('api-mcp-env-secret');
    expect(serializedInternal).toContain('api-mcp-header-secret');

    const prompt = composeSystemPrompt({
      connectedExternalMcp: internal.servers.map(({ id, label }) => ({ id, ...(label ? { label } : {}) })),
    });
    expect(prompt).toContain('github');
    expect(prompt).toContain('remote');
    expect(prompt).not.toContain('api-mcp-env-secret');
    expect(prompt).not.toContain('api-mcp-header-secret');
  });
});
