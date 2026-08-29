// Coverage for PATCH /api/memory/config apiKey three-state handling.
//
// MemoryModelInline now silently re-PATCHes whenever the surrounding BYOK
// chat creds drift, so the route must distinguish:
//   - apiKey field absent     → preserve the stored secret (settings re-save
//                                without re-typing the key)
//   - apiKey === ''           → CLEAR the stored secret (the user removed
//                                their chat key; we must not keep calling
//                                the provider with the stale credential)
//   - apiKey === 'sk-…'       → replace with the new key

import type http from 'node:http';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  DesktopCredentialVaultCommand,
  DesktopCredentialVaultResult,
} from '@open-design/sidecar-proto';
import { configureCredentialVaultBroker } from '../../src/credential-vault.js';
import {
  memoryDir,
  readMemoryConfig,
  writeMemoryConfig,
} from '../../src/memory.js';
import { startServer } from '../../src/server.js';
import {
  installTestCredentialVault,
  type TestCredentialVault,
} from '../helpers/credential-vault.js';

interface StartedServer {
  url: string;
  server: http.Server;
}

let baseUrl: string;
let server: http.Server;
let credentialVault: TestCredentialVault;
const dataDir = process.env.OD_DATA_DIR as string;
const memoryConfigPath = path.join(memoryDir(dataDir), '.config.json');
const EXTRACTION_KEY_REF_PREFIX = '__MONOFIELD_STORED_MEMORY_EXTRACTION_API_KEY__:ref:';

async function patchConfig(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/memory/config`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function readStoredExtraction(): Promise<Record<string, unknown> | null> {
  const stored = (await readMemoryConfig(dataDir)) as {
    extraction: Record<string, unknown> | null;
  };
  return stored.extraction;
}

async function readRawMemoryConfig(): Promise<{
  extraction: { apiKey?: string; provider?: string } | null;
}> {
  return JSON.parse(await fsp.readFile(memoryConfigPath, 'utf8')) as {
    extraction: { apiKey?: string; provider?: string } | null;
  };
}

function credentialRefFromRawConfig(config: Awaited<ReturnType<typeof readRawMemoryConfig>>): string {
  const marker = config.extraction?.apiKey ?? '';
  expect(marker.startsWith(EXTRACTION_KEY_REF_PREFIX)).toBe(true);
  return marker.slice(EXTRACTION_KEY_REF_PREFIX.length);
}

beforeAll(async () => {
  const started = (await startServer({
    port: 0,
    returnServer: true,
  })) as StartedServer;
  baseUrl = started.url;
  server = started.server;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(async () => {
  credentialVault = installTestCredentialVault();
  await fsp.rm(memoryConfigPath, { force: true });
});

afterEach(() => {
  credentialVault.restore();
});

describe('PATCH /api/memory/config apiKey three-state handling', () => {
  it('preserves stored apiKey when the patch omits the field entirely', async () => {
    await writeMemoryConfig(dataDir, {
      extraction: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'sk-stored-secret',
        baseUrl: 'https://api.openai.com',
      },
    });

    const res = await patchConfig({
      extraction: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.com',
      },
    });
    expect(res.status).toBe(200);

    const extraction = await readStoredExtraction();
    expect(extraction?.apiKey).toBe('sk-stored-secret');
  });

  it('clears the stored apiKey when the patch sends an explicit empty string', async () => {
    await writeMemoryConfig(dataDir, {
      extraction: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'sk-stored-secret',
        baseUrl: 'https://api.openai.com',
      },
    });

    const res = await patchConfig({
      extraction: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.com',
        apiKey: '',
      },
    });
    expect(res.status).toBe(200);

    const extraction = await readStoredExtraction();
    expect(extraction?.apiKey ?? '').toBe('');
  });

  it('replaces the stored apiKey when the patch sends a new value', async () => {
    await writeMemoryConfig(dataDir, {
      extraction: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'sk-old-secret',
        baseUrl: 'https://api.openai.com',
      },
    });

    const res = await patchConfig({
      extraction: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-new-secret',
      },
    });
    expect(res.status).toBe(200);

    const extraction = await readStoredExtraction();
    expect(extraction?.apiKey).toBe('sk-new-secret');
  });

  it('does not reuse the stored apiKey when the provider changes', async () => {
    await writeMemoryConfig(dataDir, {
      extraction: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'sk-openai-secret',
        baseUrl: 'https://api.openai.com',
      },
    });

    const res = await patchConfig({
      extraction: {
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        baseUrl: 'https://api.anthropic.com',
      },
    });
    expect(res.status).toBe(200);

    const extraction = await readStoredExtraction();
    expect(extraction?.provider).toBe('anthropic');
    expect(extraction?.apiKey ?? '').toBe('');
  });

  it('clears the extraction override when the patch sends extraction: null', async () => {
    await writeMemoryConfig(dataDir, {
      extraction: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'sk-stored-secret',
        baseUrl: 'https://api.openai.com',
      },
    });

    const res = await patchConfig({
      extraction: null,
    });
    expect(res.status).toBe(200);

    const extraction = await readStoredExtraction();
    expect(extraction).toBeNull();
  });

  it('preserves the stored azure apiVersion when the patch omits the field', async () => {
    await writeMemoryConfig(dataDir, {
      extraction: {
        provider: 'azure',
        model: 'gpt-4.1-mini',
        apiKey: 'azure-secret',
        baseUrl: 'https://example.openai.azure.com',
        apiVersion: '2025-01-01-preview',
      },
    });

    const res = await patchConfig({
      extraction: {
        provider: 'azure',
        model: 'gpt-4.1-mini',
        baseUrl: 'https://example.openai.azure.com',
      },
    });
    expect(res.status).toBe(200);

    const extraction = await readStoredExtraction();
    expect(extraction?.provider).toBe('azure');
    expect(extraction?.apiVersion).toBe('2025-01-01-preview');
  });

  it('clears the stored azure apiVersion when the patch sends an explicit empty string', async () => {
    await writeMemoryConfig(dataDir, {
      extraction: {
        provider: 'azure',
        model: 'gpt-4.1-mini',
        apiKey: 'azure-secret',
        baseUrl: 'https://example.openai.azure.com',
        apiVersion: '2025-01-01-preview',
      },
    });

    const res = await patchConfig({
      extraction: {
        provider: 'azure',
        model: 'gpt-4.1-mini',
        baseUrl: 'https://example.openai.azure.com',
        apiVersion: '',
      },
    });
    expect(res.status).toBe(200);

    const extraction = await readStoredExtraction();
    expect(extraction?.provider).toBe('azure');
    expect(extraction?.apiVersion ?? '').toBe('');
  });

  it('updates the enabled flag independently of extraction settings', async () => {
    await writeMemoryConfig(dataDir, {
      enabled: true,
      extraction: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'sk-stored-secret',
        baseUrl: 'https://api.openai.com',
      },
    });

    const res = await patchConfig({ enabled: false });
    expect(res.status).toBe(200);

    const json = await res.json() as {
      enabled: boolean;
      extraction: { provider: string; apiKeyConfigured: boolean } | null;
    };
    expect(json.enabled).toBe(false);
    expect(json.extraction).toMatchObject({
      provider: 'openai',
      apiKeyConfigured: true,
    });

    const extraction = await readStoredExtraction();
    expect(extraction?.provider).toBe('openai');
  });

  it('returns a masked extraction config without leaking the apiKey on GET /api/memory', async () => {
    await writeMemoryConfig(dataDir, {
      extraction: {
        provider: 'azure',
        model: 'gpt-4.1-mini',
        apiKey: 'azure-secret-1234',
        baseUrl: 'https://example.openai.azure.com',
        apiVersion: '2025-01-01-preview',
      },
    });

    const res = await fetch(`${baseUrl}/api/memory`);
    expect(res.status).toBe(200);

    const json = await res.json() as {
      extraction: {
        provider: string;
        model: string;
        baseUrl: string;
        apiVersion: string;
        apiKeyTail: string;
        apiKeyConfigured: boolean;
        apiKey?: string;
      } | null;
    };
    expect(json.extraction).toMatchObject({
      provider: 'azure',
      model: 'gpt-4.1-mini',
      baseUrl: 'https://example.openai.azure.com',
      apiVersion: '2025-01-01-preview',
      apiKeyTail: '1234',
      apiKeyConfigured: true,
    });
    expect(json.extraction && 'apiKey' in json.extraction).toBe(false);
  });

  it('stores a newly submitted apiKey only in the encrypted vault', async () => {
    const secret = 'sk-route-secret-must-not-remain-in-config';
    const res = await patchConfig({
      extraction: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: secret,
        baseUrl: 'https://api.openai.com',
      },
    });
    expect(res.status).toBe(200);

    const response = await res.json() as {
      extraction: Record<string, unknown> | null;
    };
    expect(response.extraction).toMatchObject({
      provider: 'openai',
      apiKeyConfigured: true,
      apiKeyTail: 'nfig',
    });
    expect(response.extraction && 'apiKey' in response.extraction).toBe(false);

    const raw = await fsp.readFile(memoryConfigPath, 'utf8');
    expect(raw).not.toContain(secret);
    const ref = credentialRefFromRawConfig(JSON.parse(raw));
    expect(credentialVault.values.get(ref)).toBe(secret);
    expect(credentialVault.values.size).toBe(1);
  });

  it('rotates to an immutable credential ref and deletes the superseded secret', async () => {
    const first = await patchConfig({
      extraction: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'sk-old-memory-secret',
      },
    });
    expect(first.status).toBe(200);
    const oldRef = credentialRefFromRawConfig(await readRawMemoryConfig());
    expect(credentialVault.values.get(oldRef)).toBe('sk-old-memory-secret');

    const second = await patchConfig({
      extraction: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'sk-new-memory-secret',
      },
    });
    expect(second.status).toBe(200);
    const newRef = credentialRefFromRawConfig(await readRawMemoryConfig());

    expect(newRef).not.toBe(oldRef);
    expect(credentialVault.values.has(oldRef)).toBe(false);
    expect(credentialVault.values.get(newRef)).toBe('sk-new-memory-secret');
    expect(credentialVault.values.size).toBe(1);
  });

  it('preserves a legacy plaintext key on vault failure and scrubs it after retry succeeds', async () => {
    const legacySecret = 'sk-legacy-memory-secret';
    await fsp.mkdir(memoryDir(dataDir), { recursive: true });
    await fsp.writeFile(memoryConfigPath, JSON.stringify({
      enabled: true,
      chatExtractionEnabled: false,
      profileEnabled: true,
      rewriteEnabled: true,
      verifyEnabled: true,
      extraction: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: legacySecret,
      },
    }, null, 2));

    credentialVault.state.failWrites = true;
    const deferred = await fetch(`${baseUrl}/api/memory`);
    expect(deferred.status).toBe(200);
    expect(await fsp.readFile(memoryConfigPath, 'utf8')).toContain(legacySecret);
    expect(credentialVault.values.size).toBe(0);
    if (process.platform !== 'win32') {
      expect((await fsp.stat(memoryConfigPath)).mode & 0o777).toBe(0o600);
      expect((await fsp.stat(memoryDir(dataDir))).mode & 0o777).toBe(0o700);
    }

    credentialVault.state.failWrites = false;
    const migrated = await fetch(`${baseUrl}/api/memory`);
    expect(migrated.status).toBe(200);

    const raw = await fsp.readFile(memoryConfigPath, 'utf8');
    expect(raw).not.toContain(legacySecret);
    const ref = credentialRefFromRawConfig(JSON.parse(raw));
    expect(credentialVault.values.get(ref)).toBe(legacySecret);
    expect(credentialVault.values.size).toBe(1);
  });

  it('serializes a slow legacy migration with a concurrent settings patch', async () => {
    const legacySecret = 'sk-legacy-race-secret';
    await fsp.mkdir(memoryDir(dataDir), { recursive: true });
    await fsp.writeFile(memoryConfigPath, JSON.stringify({
      enabled: true,
      chatExtractionEnabled: false,
      profileEnabled: true,
      rewriteEnabled: true,
      verifyEnabled: true,
      extraction: {
        provider: 'openai',
        model: 'old-model',
        apiKey: legacySecret,
      },
    }, null, 2));

    credentialVault.restore();
    const values = new Map<string, string>();
    let setCount = 0;
    let releaseFirstSet!: () => void;
    let firstSetStarted!: () => void;
    const firstSetBarrier = new Promise<void>((resolve) => { firstSetStarted = resolve; });
    const firstSetRelease = new Promise<void>((resolve) => { releaseFirstSet = resolve; });
    configureCredentialVaultBroker(async (
      request: DesktopCredentialVaultCommand,
    ): Promise<DesktopCredentialVaultResult> => {
      if (request.action === 'available') return { action: 'available', available: true };
      if (request.action === 'get') {
        return { action: 'get', value: values.get(request.key) ?? null };
      }
      if (request.action === 'set') {
        setCount += 1;
        if (setCount === 1) {
          firstSetStarted();
          await firstSetRelease;
        }
        values.set(request.key, request.value);
        return { action: 'set', stored: true };
      }
      return { action: 'delete', deleted: values.delete(request.key) };
    });

    const migratingRead = readMemoryConfig(dataDir);
    await firstSetBarrier;
    const patch = patchConfig({
      extraction: {
        provider: 'openai',
        model: 'new-model',
        apiKey: 'sk-new-race-secret',
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(setCount).toBe(1);

    releaseFirstSet();
    await migratingRead;
    const response = await patch;
    expect(response.status).toBe(200);
    const raw = await readRawMemoryConfig();
    expect(raw.extraction?.provider).toBe('openai');
    expect((raw.extraction as { model?: string } | null)?.model).toBe('new-model');
    expect(JSON.stringify(raw)).not.toContain(legacySecret);
    expect(JSON.stringify(raw)).not.toContain('sk-new-race-secret');
    expect([...values.values()]).toEqual(['sk-new-race-secret']);
  });

  it('rejects a forged cross-namespace vault ref without reading or deleting it', async () => {
    const foreignRef = 'byok:0123456789abcdef01234567:openai:v-aaaaaaaaaaaaaaaaaaaaaaaa';
    credentialVault.values.set(foreignRef, 'sk-foreign-secret');
    await fsp.mkdir(memoryDir(dataDir), { recursive: true });
    await fsp.writeFile(memoryConfigPath, JSON.stringify({
      enabled: true,
      chatExtractionEnabled: false,
      profileEnabled: true,
      rewriteEnabled: true,
      verifyEnabled: true,
      extraction: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: `${EXTRACTION_KEY_REF_PREFIX}${foreignRef}`,
      },
    }, null, 2));

    const config = await readMemoryConfig(dataDir);
    expect(config.extraction?.apiKey ?? '').toBe('');
    expect(credentialVault.values.get(foreignRef)).toBe('sk-foreign-secret');
    expect(await fsp.readFile(memoryConfigPath, 'utf8')).not.toContain(foreignRef);

    const response = await patchConfig({ extraction: null });
    expect(response.status).toBe(200);
    expect(credentialVault.values.get(foreignRef)).toBe('sk-foreign-secret');
  });

  it('preserves a corrupted config instead of overwriting its secret reference on PATCH', async () => {
    const corrupt = '{"extraction":{"apiKey":"opaque-ref-that-needs-recovery"';
    await fsp.mkdir(memoryDir(dataDir), { recursive: true });
    await fsp.writeFile(memoryConfigPath, corrupt);

    const response = await patchConfig({ enabled: false });
    expect(response.status).toBe(400);
    expect(await fsp.readFile(memoryConfigPath, 'utf8')).toBe(corrupt);
  });
});
