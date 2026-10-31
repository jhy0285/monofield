import { describe, expect, it } from 'vitest';

import { AGENT_DEFS, claude, codex, withEnvSnapshot, withPlatform } from './helpers/test-helpers.js';
import { agentCapabilities } from '../../src/runtimes/capabilities.js';
import { readOnlyUnsupportedMessage } from '../../src/runtimes/read-only.js';
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

function agent(id: string) {
  const def = AGENT_DEFS.find((candidate) => candidate.id === id);
  if (!def) throw new Error(`no agent ${id}`);
  return def;
}

describe('execution permission level → other agent CLIs', () => {
  const read = { executionPermissionLevel: 'read-only' } as const;

  it('keeps every adapter\'s shipped flags at the default and full levels', () => {
    for (const level of [undefined, 'default', 'full'] as const) {
      const ctx = level ? { executionPermissionLevel: level } : {};
      expect(agent('gemini').buildArgs('', [], [], {}, ctx)).toContain('--approval-mode=yolo');
      expect(agent('qwen').buildArgs('', [], [], {}, ctx)).toEqual(['--yolo']);
      expect(agent('codebuddy').buildArgs('', [], [], {}, ctx).slice(-2)).toEqual(['--permission-mode', 'bypassPermissions']);
      const copilotArgs = agent('copilot').buildArgs('', [], [], {}, ctx);
      expect(copilotArgs).toContain('--allow-all-tools');
      expect(copilotArgs.some((arg) => arg.startsWith('--deny-tool'))).toBe(false);
    }
  });

  it('uses each CLI\'s own read-only mode at the read-only level', () => {
    expect(agent('gemini').buildArgs('', [], [], {}, read)).toContain('--approval-mode=plan');
    expect(agent('gemini').buildArgs('', [], [], {}, read)).not.toContain('--approval-mode=yolo');
    expect(agent('qwen').buildArgs('', [], [], {}, read)).toEqual(['--approval-mode', 'plan']);
    expect(agent('codebuddy').buildArgs('', [], [], {}, read).slice(-2)).toEqual(['--permission-mode', 'plan']);
    const copilotArgs = agent('copilot').buildArgs('', [], [], {}, read);
    expect(copilotArgs).toEqual(expect.arrayContaining(['--allow-all-tools', '--deny-tool=shell', '--deny-tool=write']));
  });

  it('fails closed on a Gemini build without --approval-mode instead of falling back to --yolo', () => {
    const saved = agentCapabilities.get('gemini');
    agentCapabilities.set('gemini', { approvalMode: false });
    try {
      expect(agent('gemini').buildArgs('', [], [], {}, {})).toContain('--yolo');
      expect(() => agent('gemini').buildArgs('', [], [], {}, read)).toThrow(/Read only/);
    } finally {
      if (saved) agentCapabilities.set('gemini', saved);
      else agentCapabilities.delete('gemini');
    }
  });

  it('marks exactly the adapters whose CLI has a confirmed read-only mode', () => {
    const supported = AGENT_DEFS.filter((def) => def.readOnlySupport === true).map((def) => def.id).sort();
    expect(supported).toEqual(['claude', 'codebuddy', 'codex', 'copilot', 'gemini', 'qwen']);
  });

  it('never hands an approve-everything flag to an adapter that claims read-only support', () => {
    const permissive = [
      '--yolo',
      '--approval-mode=yolo',
      'bypassPermissions',
      '--dangerously-allow-all',
      '--dangerously-skip-permissions',
      '--dangerously-bypass-approvals-and-sandbox',
      'danger-full-access',
      'dangerous',
      '--force',
    ];
    for (const def of AGENT_DEFS.filter((candidate) => candidate.readOnlySupport === true)) {
      withEnvSnapshot(['OD_CODEX_SANDBOX'], () => {
        delete process.env.OD_CODEX_SANDBOX;
        const args = def.buildArgs('', [], [], {}, { ...read, cwd: '/tmp/od-project', resumeSessionId: null });
        for (const flag of permissive) {
          expect(args, `${def.id} must not pass ${flag} at read-only`).not.toContain(flag);
        }
      });
    }
  });

  it('refuses every other adapter at the read-only level with a message that says what to do', () => {
    for (const def of AGENT_DEFS) {
      const message = readOnlyUnsupportedMessage(def, 'read-only');
      if (def.readOnlySupport === true) {
        expect(message, def.id).toBeNull();
      } else {
        expect(message, def.id).toContain(def.name);
        expect(message, def.id).toContain('Read only');
        expect(message, def.id).toContain('Settings → Execution permissions');
      }
      // The other levels never refuse anything.
      expect(readOnlyUnsupportedMessage(def, 'default')).toBeNull();
      expect(readOnlyUnsupportedMessage(def, 'full')).toBeNull();
    }
  });
});
