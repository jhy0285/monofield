import type {
  DesktopCredentialVaultCommand,
  DesktopCredentialVaultResult,
} from '@open-design/sidecar-proto';

import {
  configureCredentialVaultBroker,
  type DesktopCredentialVaultBroker,
} from '../../src/credential-vault.js';

export interface TestCredentialVault {
  broker: DesktopCredentialVaultBroker;
  values: Map<string, string>;
  state: { failAfterWrites: number | null; failReads: boolean; failWrites: boolean; writeCount: number };
  restore(): void;
}

export function installTestCredentialVault(): TestCredentialVault {
  const values = new Map<string, string>();
  const state = { failAfterWrites: null as number | null, failReads: false, failWrites: false, writeCount: 0 };
  const broker = async (request: DesktopCredentialVaultCommand): Promise<DesktopCredentialVaultResult> => {
    if (request.action === 'available') return { action: 'available', available: true };
    if (request.action === 'get') {
      if (state.failReads) throw new Error('test vault read failed');
      return { action: 'get', value: values.get(request.key) ?? null };
    }
    if (request.action === 'set') {
      state.writeCount += 1;
      if (state.failWrites || (state.failAfterWrites != null && state.writeCount > state.failAfterWrites)) {
        throw new Error('test vault write failed');
      }
      values.set(request.key, request.value);
      return { action: 'set', stored: true };
    }
    const deleted = values.delete(request.key);
    return { action: 'delete', deleted };
  };
  configureCredentialVaultBroker(broker);
  return {
    broker,
    values,
    state,
    restore: () => configureCredentialVaultBroker(null),
  };
}
