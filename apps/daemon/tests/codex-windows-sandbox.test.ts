import { afterEach, describe, expect, it } from 'vitest';

import {
  codexWindowsSandboxEnvironmentFingerprint,
  codexWindowsSandboxUnavailableMessage,
  currentCodexWindowsSandboxCircuit,
  isCodexWindowsSandboxLogonFailureText,
  recordCodexWindowsSandboxLogonFailure,
  resetCodexWindowsSandboxCircuit,
  resetCodexWindowsSandboxCircuitForTests,
} from '../src/codex-windows-sandbox.js';

describe('Codex Windows sandbox circuit breaker', () => {
  afterEach(() => resetCodexWindowsSandboxCircuitForTests());

  it('recognizes the native Windows logon-right failure without matching generic failures', () => {
    expect(isCodexWindowsSandboxLogonFailureText(
      'execution error: Io(Custom { kind: Other, error: "windows sandbox: CreateProcessWithLogonW failed: 1385" })',
    )).toBe(true);
    expect(isCodexWindowsSandboxLogonFailureText('spawn failed: EPERM')).toBe(false);
    expect(isCodexWindowsSandboxLogonFailureText('Windows error 1385')).toBe(false);
  });

  it('keeps a Windows-only circuit open for the same launch environment', () => {
    recordCodexWindowsSandboxLogonFailure({
      environmentFingerprint: 'same-environment',
      now: 1_000,
    });

    expect(currentCodexWindowsSandboxCircuit({
      platform: 'win32',
      environmentFingerprint: 'same-environment',
    })).toEqual({
      observedAt: 1_000,
      environmentFingerprint: 'same-environment',
    });
    expect(currentCodexWindowsSandboxCircuit({
      platform: 'linux',
      environmentFingerprint: 'same-environment',
    })).toBeNull();
  });

  it('does not expire by time and resets when the binary/session fingerprint changes', () => {
    recordCodexWindowsSandboxLogonFailure({
      environmentFingerprint: 'old-environment',
      now: 2_000,
    });

    expect(currentCodexWindowsSandboxCircuit({
      platform: 'win32',
      environmentFingerprint: 'old-environment',
    })).toEqual({
      observedAt: 2_000,
      environmentFingerprint: 'old-environment',
    });
    expect(currentCodexWindowsSandboxCircuit({
      platform: 'win32',
      environmentFingerprint: 'new-environment',
    })).toBeNull();
  });

  it('never overrides explicit administrator configuration', () => {
    recordCodexWindowsSandboxLogonFailure({
      environmentFingerprint: 'same-environment',
      now: 3_000,
    });
    expect(currentCodexWindowsSandboxCircuit({
      platform: 'win32',
      environmentFingerprint: 'same-environment',
      dangerFullAccessExplicitlyEnabled: true,
    })).toBeNull();
  });

  it('can be reset only by an explicit refresh/diagnostic action', () => {
    recordCodexWindowsSandboxLogonFailure({
      environmentFingerprint: 'same-environment',
      now: 4_000,
    });
    resetCodexWindowsSandboxCircuit();
    expect(currentCodexWindowsSandboxCircuit({
      platform: 'win32',
      environmentFingerprint: 'same-environment',
    })).toBeNull();
  });

  it('fingerprints Codex binary and Windows session facts without exposing them', () => {
    const first = codexWindowsSandboxEnvironmentFingerprint({
      binaryPath: 'C:/missing/codex.exe',
      platform: 'win32',
      env: { USERNAME: 'alice', SESSIONNAME: 'Console' },
    });
    const same = codexWindowsSandboxEnvironmentFingerprint({
      binaryPath: 'C:/missing/codex.exe',
      platform: 'win32',
      env: { USERNAME: 'alice', SESSIONNAME: 'Console' },
    });
    const changed = codexWindowsSandboxEnvironmentFingerprint({
      binaryPath: 'C:/missing/codex.exe',
      platform: 'win32',
      env: { USERNAME: 'alice', SESSIONNAME: 'RDP-Tcp#1' },
    });
    expect(first).toBe(same);
    expect(changed).not.toBe(first);
    expect(first).not.toContain('alice');
  });

  it('explains that access was not silently broadened', () => {
    const message = codexWindowsSandboxUnavailableMessage(false);
    expect(message).toContain('Windows error 1385');
    expect(message).toContain('did not broaden filesystem access automatically');
    expect(message).toContain('token usage');
  });
});
