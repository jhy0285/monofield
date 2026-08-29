import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronState = vi.hoisted(() => ({
  userData: '',
  available: true,
  backend: 'gnome_libsecret' as 'basic_text' | 'gnome_libsecret' | 'kwallet' | 'kwallet5' | 'kwallet6' | 'unknown',
  decryptCalls: 0,
  failEncryption: false,
}));

vi.mock('electron', () => ({
  app: { getPath: () => electronState.userData },
  safeStorage: {
    isEncryptionAvailable: () => electronState.available,
    getSelectedStorageBackend: () => electronState.backend,
    encryptString: (value: string) => {
      if (electronState.failEncryption) throw new Error('simulated encryption failure');
      return Buffer.from(value, 'utf8').map((byte) => byte ^ 0xa5);
    },
    decryptString: (value: Buffer) => {
      electronState.decryptCalls += 1;
      return Buffer.from(value.map((byte) => byte ^ 0xa5)).toString('utf8');
    },
  },
}));

describe('CredentialVault', () => {
  let CredentialVault: typeof import('../../src/main/credential-vault.js').CredentialVault;

  beforeEach(async () => {
    electronState.userData = await mkdtemp(join(tmpdir(), 'monofield-credential-vault-'));
    electronState.available = true;
    electronState.backend = 'gnome_libsecret';
    electronState.decryptCalls = 0;
    electronState.failEncryption = false;
    ({ CredentialVault } = await import('../../src/main/credential-vault.js'));
  });

  afterEach(async () => {
    await rm(electronState.userData, { recursive: true, force: true });
  });

  it('round-trips secrets without leaving plaintext in the vault file', async () => {
    const vault = new CredentialVault();
    await expect(vault.execute({ action: 'set', key: 'media:test:openai', value: 'sk-secret-value' }))
      .resolves.toEqual({ action: 'set', stored: true });
    await expect(vault.execute({ action: 'get', key: 'media:test:openai' }))
      .resolves.toEqual({ action: 'get', value: 'sk-secret-value' });

    const raw = await readFile(join(electronState.userData, 'credential-vault.v1.enc'));
    expect(raw.toString('utf8')).not.toContain('sk-secret-value');
    expect(raw.toString('utf8')).not.toContain('media:test:openai');
  });

  it('serializes concurrent updates so unrelated entries are not lost', async () => {
    const vault = new CredentialVault();
    await Promise.all(Array.from({ length: 12 }, (_, index) => vault.execute({
      action: 'set',
      key: `connector:test:item-${index}`,
      value: `secret-${index}`,
    })));
    for (let index = 0; index < 12; index += 1) {
      await expect(vault.execute({ action: 'get', key: `connector:test:item-${index}` }))
        .resolves.toEqual({ action: 'get', value: `secret-${index}` });
    }
  });

  it('decrypts the vault only once per process instance', async () => {
    const writer = new CredentialVault();
    await writer.execute({ action: 'set', key: 'provider:test:key', value: 'secret' });

    electronState.decryptCalls = 0;
    const reader = new CredentialVault();
    await expect(reader.execute({ action: 'get', key: 'provider:test:key' }))
      .resolves.toEqual({ action: 'get', value: 'secret' });
    await expect(reader.execute({ action: 'get', key: 'provider:test:key' }))
      .resolves.toEqual({ action: 'get', value: 'secret' });
    expect(electronState.decryptCalls).toBe(1);
  });

  it('keeps the last successful cache state when a write fails', async () => {
    const vault = new CredentialVault();
    await vault.execute({ action: 'set', key: 'provider:test:key', value: 'before' });

    electronState.failEncryption = true;
    await expect(vault.execute({ action: 'set', key: 'provider:test:key', value: 'after' }))
      .rejects.toThrow('simulated encryption failure');
    await expect(vault.execute({ action: 'get', key: 'provider:test:key' }))
      .resolves.toEqual({ action: 'get', value: 'before' });
  });

  it('fails closed when OS credential encryption is unavailable', async () => {
    electronState.available = false;
    const vault = new CredentialVault();
    await expect(vault.execute({ action: 'available' })).resolves.toEqual({ action: 'available', available: false });
    await expect(vault.execute({ action: 'set', key: 'media:test:key', value: 'secret' }))
      .rejects.toThrow('OS credential encryption is unavailable');
  });

  it('rejects Linux basic_text storage even when Electron reports encryption available', async () => {
    const vault = new CredentialVault({ platform: 'linux' });
    await vault.execute({ action: 'set', key: 'provider:test:key', value: 'before' });

    electronState.backend = 'basic_text';
    await expect(vault.execute({ action: 'available' })).resolves.toEqual({ action: 'available', available: false });
    await expect(vault.execute({ action: 'get', key: 'provider:test:key' }))
      .rejects.toThrow('OS credential encryption is unavailable');
    await expect(vault.execute({ action: 'set', key: 'provider:test:key', value: 'after' }))
      .rejects.toThrow('OS credential encryption is unavailable');
  });
});
