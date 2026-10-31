import { describe, expect, it } from 'vitest';

import { codexImagegenSandboxArgs } from '../../src/media/index.js';

const WORKSPACE_WRITE = ['--sandbox', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true'];
const FULL = ['--sandbox', 'danger-full-access'];

describe('Codex image generation sandbox by execution permission level', () => {
  it('keeps workspace-write with network at the default level', () => {
    expect(codexImagegenSandboxArgs('default', {})).toEqual(WORKSPACE_WRITE);
  });

  it('drops the sandbox at the full level', () => {
    expect(codexImagegenSandboxArgs('full', {})).toEqual(FULL);
  });

  it('refuses the read-only level because generating an image writes a file', () => {
    expect(() => codexImagegenSandboxArgs('read-only', {})).toThrow(/"Read only" execution permission level/);
    expect(() => codexImagegenSandboxArgs('read-only', {})).toThrow(/monofield permissions set default/);
  });

  it('lets the OD_CODEX_SANDBOX administrator override widen every level, as for chat runs', () => {
    const env = { OD_CODEX_SANDBOX: 'danger-full-access' };
    for (const level of ['read-only', 'default', 'full'] as const) {
      expect(codexImagegenSandboxArgs(level, env)).toEqual(FULL);
    }
  });
});
