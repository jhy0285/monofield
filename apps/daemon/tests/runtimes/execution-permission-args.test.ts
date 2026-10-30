import { describe, expect, it } from 'vitest';

import { claude, codex, withEnvSnapshot, withPlatform } from './helpers/test-helpers.js';
import { codexNeedsDangerFullAccessSandbox, codexSandboxMode } from '../../src/runtimes/defs/codex.js';

const ENV_KEYS = ['OD_CODEX_DISABLE_PLUGINS', 'OD_CODEX_SANDBOX', 'WSL_DISTRO_NAME'];

function sandboxArgs(args: string[]): string[] {
  return args.slice(0, args.indexOf('--disable') < 0 ? 7 : args.indexOf('--disable'));
}

describe('execution permission level → Codex sandbox', () => {
  it('keeps workspace-write with network when no level is given or the level is default', () => {
    withPlatform('linux', () => {
      withEnvSnapshot(ENV_KEYS, () => {
        for (const key of ENV_KEYS) delete process.env[key];
        for (const level of [undefined, 'default'] as const) {
          const args = codex.buildArgs('', [], ['/tmp/sibling'], {}, {
            cwd: '/tmp/od-project',
            ...(level ? { executionPermissionLevel: level } : {}),
          });
          expect(sandboxArgs(args)).toEqual([
            'exec',
            '--json',
            '--skip-git-repo-check',
            '--sandbox',
            'workspace-write',
            '-c',
            'sandbox_workspace_write.network_access=true',
          ]);
          expect(args.filter((_, i) => args[i - 1] === '--add-dir')).toEqual(['/tmp/sibling']);
        }
      });
    });
  });

  it('runs read-only without network or extra writable roots', () => {
    withPlatform('linux', () => {
      withEnvSnapshot(ENV_KEYS, () => {
        for (const key of ENV_KEYS) delete process.env[key];
        const args = codex.buildArgs('', [], ['/tmp/sibling'], {}, {
          cwd: '/tmp/od-project',
          executionPermissionLevel: 'read-only',
        });
        expect(args.slice(0, 5)).toEqual(['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only']);
        expect(args).not.toContain('sandbox_workspace_write.network_access=true');
        expect(args).not.toContain('--add-dir');
        expect(args).toContain('-C');

        const resumed = codex.buildArgs('', [], ['/tmp/sibling'], {}, {
          cwd: '/tmp/od-project',
          executionPermissionLevel: 'read-only',
          resumeSessionId: 'session-1',
        });
        expect(resumed.slice(0, 6)).toEqual([
          'exec', 'resume', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"',
        ]);
        expect(resumed.some((arg) => arg.startsWith('sandbox_workspace_write.writable_roots='))).toBe(false);
        expect(resumed.at(-1)).toBe('session-1');
      });
    });
  });

  it('runs without a sandbox at the full level, for new and resumed sessions', () => {
    withPlatform('win32', () => {
      withEnvSnapshot(ENV_KEYS, () => {
        for (const key of ENV_KEYS) delete process.env[key];
        const args = codex.buildArgs('', [], [], {}, {
          cwd: 'C:/work/repo',
          executionPermissionLevel: 'full',
        });
        expect(args.slice(0, 5)).toEqual(['exec', '--json', '--skip-git-repo-check', '--sandbox', 'danger-full-access']);
        // Full access runs as the desktop user, so no safe.directory shim is needed.
        expect(args.some((arg) => arg.includes('GIT_CONFIG_COUNT'))).toBe(false);

        const resumed = codex.buildArgs('', [], [], {}, {
          cwd: 'C:/work/repo',
          executionPermissionLevel: 'full',
          resumeSessionId: 'session-2',
        });
        expect(resumed).toContain('--dangerously-bypass-approvals-and-sandbox');
      });
    });
  });

  it('lets the OD_CODEX_SANDBOX administrator override widen every level, never narrow it', () => {
    withEnvSnapshot(ENV_KEYS, () => {
      process.env.OD_CODEX_SANDBOX = 'danger-full-access';
      for (const level of ['read-only', 'default', 'full'] as const) {
        expect(codexSandboxMode(level)).toBe('danger-full-access');
        expect(codexNeedsDangerFullAccessSandbox(process.platform, process.env, level)).toBe(true);
      }
      delete process.env.OD_CODEX_SANDBOX;
      expect(codexSandboxMode('read-only')).toBe('read-only');
      expect(codexSandboxMode('default')).toBe('workspace-write');
      expect(codexSandboxMode(undefined)).toBe('workspace-write');
      expect(codexNeedsDangerFullAccessSandbox(process.platform, process.env, 'full')).toBe(true);
      expect(codexNeedsDangerFullAccessSandbox(process.platform, process.env)).toBe(false);
    });
  });
});

describe('execution permission level → Claude Code permission mode', () => {
  function permissionMode(args: string[]): string | undefined {
    return args[args.indexOf('--permission-mode') + 1];
  }

  it('lets every tool run by default and at the full level', () => {
    expect(permissionMode(claude.buildArgs('', [], [], {}, {}))).toBe('bypassPermissions');
    expect(permissionMode(claude.buildArgs('', [], [], {}, { executionPermissionLevel: 'default' }))).toBe('bypassPermissions');
    expect(permissionMode(claude.buildArgs('', [], [], {}, { executionPermissionLevel: 'full' }))).toBe('bypassPermissions');
  });

  it('only plans at the read-only level', () => {
    const args = claude.buildArgs('', [], [], {}, { executionPermissionLevel: 'read-only' });
    expect(permissionMode(args)).toBe('plan');
    expect(args.filter((arg) => arg === '--permission-mode')).toHaveLength(1);
  });
});
