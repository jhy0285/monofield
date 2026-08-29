import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { STORED_BYOK_API_KEY } from '@open-design/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  readPublicByokCredentials,
  resolveByokApiKey,
  writeByokCredentials,
} from '../src/byok-credentials.js';
import { installTestCredentialVault, type TestCredentialVault } from './helpers/credential-vault.js';

describe('BYOK credential storage', () => {
  let dataDir: string;
  let vault: TestCredentialVault;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'monofield-byok-credentials-'));
    vault = installTestCredentialVault();
  });

  afterEach(async () => {
    vault.restore();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('stores raw keys only in the vault and returns masked metadata', async () => {
    const secret = 'sk-ant-secure-value-1234';
    await expect(writeByokCredentials(dataDir, { credentials: { anthropic: secret } }))
      .resolves.toEqual({ credentials: { anthropic: { configured: true, apiKeyTail: '1234' } } });

    const disk = await readFile(path.join(dataDir, 'byok-credentials.json'), 'utf8');
    expect(disk).not.toContain(secret);
    expect(disk).toContain('credentialRef');
    await expect(readPublicByokCredentials(dataDir)).resolves.toEqual({
      credentials: { anthropic: { configured: true, apiKeyTail: '1234' } },
    });
    await expect(resolveByokApiKey(dataDir, 'anthropic', STORED_BYOK_API_KEY)).resolves.toBe(secret);
  });

  it('preserves the last confirmed key and metadata when replacement encryption fails', async () => {
    await writeByokCredentials(dataDir, { credentials: { openai: 'sk-before-1111' } });
    const before = await readFile(path.join(dataDir, 'byok-credentials.json'), 'utf8');
    vault.state.failWrites = true;

    await expect(writeByokCredentials(dataDir, { credentials: { openai: 'sk-after-2222' } }))
      .rejects.toThrow();
    expect(await readFile(path.join(dataDir, 'byok-credentials.json'), 'utf8')).toBe(before);
    await expect(resolveByokApiKey(dataDir, 'openai', STORED_BYOK_API_KEY)).resolves.toBe('sk-before-1111');
  });

  it('swaps to a fresh immutable ref before deleting the previous value', async () => {
    await writeByokCredentials(dataDir, { credentials: { openai: 'sk-before-1111' } });
    const before = JSON.parse(await readFile(path.join(dataDir, 'byok-credentials.json'), 'utf8'));
    const beforeRef = before.credentials.openai.credentialRef as string;
    expect(vault.values.get(beforeRef)).toBe('sk-before-1111');

    await writeByokCredentials(dataDir, { credentials: { openai: 'sk-after-2222' } });
    const after = JSON.parse(await readFile(path.join(dataDir, 'byok-credentials.json'), 'utf8'));
    const afterRef = after.credentials.openai.credentialRef as string;
    expect(afterRef).not.toBe(beforeRef);
    expect(vault.values.has(beforeRef)).toBe(false);
    expect(vault.values.get(afterRef)).toBe('sk-after-2222');
  });

  it('clears metadata before best-effort vault deletion', async () => {
    await writeByokCredentials(dataDir, { credentials: { google: 'AIza-secure-9999' } });
    await expect(writeByokCredentials(dataDir, { credentials: { google: '' } }))
      .resolves.toEqual({ credentials: {} });
    await expect(resolveByokApiKey(dataDir, 'google', STORED_BYOK_API_KEY)).resolves.toBe('');
  });
});
