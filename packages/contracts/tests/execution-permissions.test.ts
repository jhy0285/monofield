import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EXECUTION_PERMISSION_LEVEL,
  EXECUTION_PERMISSION_LEVELS,
  executionPermissionsNeedRestart,
  isExecutionPermissionLevel,
  normalizeExecutionPermissionLevel,
  resolveExecutionPermissions,
} from '../src/api/execution-permissions';

describe('execution permission levels', () => {
  it('lists the three levels and defaults to the shipped behavior', () => {
    expect([...EXECUTION_PERMISSION_LEVELS]).toEqual(['read-only', 'default', 'full']);
    expect(DEFAULT_EXECUTION_PERMISSION_LEVEL).toBe('default');
    expect(normalizeExecutionPermissionLevel(undefined)).toBe('default');
    expect(normalizeExecutionPermissionLevel('root')).toBe('default');
    expect(normalizeExecutionPermissionLevel('full')).toBe('full');
    expect(isExecutionPermissionLevel('read-only')).toBe(true);
    expect(isExecutionPermissionLevel('')).toBe(false);
    expect(isExecutionPermissionLevel(null)).toBe(false);
  });

  it('maps each level to a Codex sandbox, a Claude mode and Windows elevation', () => {
    expect(resolveExecutionPermissions('read-only', { platform: 'win32' })).toEqual({
      codexSandbox: 'read-only',
      codexNetwork: false,
      claudePermissionMode: 'plan',
      startElevated: false,
    });
    expect(resolveExecutionPermissions('default', { platform: 'win32' })).toEqual({
      codexSandbox: 'workspace-write',
      codexNetwork: true,
      claudePermissionMode: 'bypassPermissions',
      startElevated: false,
    });
    expect(resolveExecutionPermissions('full', { platform: 'win32' })).toEqual({
      codexSandbox: 'danger-full-access',
      codexNetwork: true,
      claudePermissionMode: 'bypassPermissions',
      startElevated: true,
    });
    expect(resolveExecutionPermissions('full', { platform: 'darwin' }).startElevated).toBe(false);
    expect(resolveExecutionPermissions('full').startElevated).toBe(false);
  });

  it('lets the environment override widen Codex only', () => {
    const locked = resolveExecutionPermissions('read-only', { codexFullAccessFromEnv: true, platform: 'linux' });
    expect(locked.codexSandbox).toBe('danger-full-access');
    expect(locked.claudePermissionMode).toBe('plan');
  });
});

describe('executionPermissionsNeedRestart', () => {
  const full = resolveExecutionPermissions('full', { platform: 'win32' });
  const normal = resolveExecutionPermissions('default', { platform: 'win32' });

  it('asks for a restart when the administrator state does not match the level', () => {
    expect(executionPermissionsNeedRestart({ effective: full, elevated: false })).toBe(true);
    expect(executionPermissionsNeedRestart({ effective: full, elevated: false, canElevate: true })).toBe(true);
    expect(executionPermissionsNeedRestart({ effective: normal, elevated: true })).toBe(true);
    expect(executionPermissionsNeedRestart({ effective: full, elevated: true })).toBe(false);
    expect(executionPermissionsNeedRestart({ effective: normal, elevated: false })).toBe(false);
  });

  it('never asks where elevation is unknown or does not apply', () => {
    expect(executionPermissionsNeedRestart({ effective: full, elevated: null })).toBe(false);
  });

  it('never asks a standard account to restart as administrator, but still lets an elevated one drop', () => {
    expect(executionPermissionsNeedRestart({ effective: full, elevated: false, canElevate: false })).toBe(false);
    expect(executionPermissionsNeedRestart({ effective: normal, elevated: true, canElevate: false })).toBe(true);
  });
});
