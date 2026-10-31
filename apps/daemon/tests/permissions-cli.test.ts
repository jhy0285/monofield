import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ExecutionPermissionsResponse } from '@open-design/contracts';
import { runPermissionsCli, type PermissionsCliHelpers } from '../src/services/permissions-cli.js';
import { startServer, type StartServerResult } from '../src/server.js';

const execute = promisify(execFile);

function response(
  level: ExecutionPermissionsResponse['level'],
  elevated: boolean | null,
  platform = 'win32',
  canElevate?: boolean | null,
): ExecutionPermissionsResponse {
  return {
    level,
    effective: {
      codexSandbox: level === 'full' ? 'danger-full-access' : level === 'read-only' ? 'read-only' : 'workspace-write',
      codexNetwork: level !== 'read-only',
      claudePermissionMode: level === 'read-only' ? 'plan' : 'bypassPermissions',
      startElevated: level === 'full' && platform === 'win32',
    },
    codexSandboxLockedByEnv: false,
    elevated,
    platform,
    ...(canElevate === undefined ? {} : { canElevate }),
  };
}

function helpers(reply: ExecutionPermissionsResponse, calls: Array<{ url: string; init?: RequestInit }>, out: string[]): PermissionsCliHelpers {
  return {
    baseUrl: async () => 'http://127.0.0.1:7456/',
    parseFlags: (args) => Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2), true])),
    positionalArgs: (args) => args.filter((a) => !a.startsWith('-')),
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
    write: (text) => out.push(text),
  };
}

describe('monofield permissions (unit)', () => {
  it('shows the level and the per-tool effect in words', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const out: string[] = [];
    await runPermissionsCli([], helpers(response('default', false), calls, out));
    expect(calls).toEqual([{ url: 'http://127.0.0.1:7456/api/execution-permissions', init: {} }]);
    expect(out.join('')).toContain('Execution permission level: default');
    expect(out.join('')).toContain('workspace-write (network on)');
    expect(out.join('')).not.toContain('Restart');
  });

  it('PUTs the level and flags a restart when Windows elevation must change', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const out: string[] = [];
    await runPermissionsCli(['set', 'full', '--json'], helpers(response('full', false), calls, out));
    expect(calls[0]?.init?.method).toBe('PUT');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ level: 'full' });
    const json = JSON.parse(out.join(''));
    expect(json).toMatchObject({ level: 'full', restartRequired: true, effective: { startElevated: true } });

    const dropOut: string[] = [];
    await runPermissionsCli(['set', 'default'], helpers(response('default', true), [], dropOut));
    expect(dropOut.join('')).toContain('Close and reopen MonoField Desktop');
  });

  it('never asks for a restart where elevation does not apply', async () => {
    const out: string[] = [];
    await runPermissionsCli(['show', '--json'], helpers(response('full', null, 'darwin'), [], out));
    expect(JSON.parse(out.join(''))).toMatchObject({ restartRequired: false, effective: { startElevated: false } });
  });

  it('says a standard Windows account will not restart as administrator and asks for no restart', async () => {
    const out: string[] = [];
    await runPermissionsCli(['set', 'full'], helpers(response('full', false, 'win32', false), [], out));
    expect(out.join('')).toContain('not an administrator');
    expect(out.join('')).not.toContain('Restart MonoField Desktop');
    const jsonOut: string[] = [];
    await runPermissionsCli(['show', '--json'], helpers(response('full', false, 'win32', false), [], jsonOut));
    expect(JSON.parse(jsonOut.join(''))).toMatchObject({ canElevate: false, restartRequired: false });
  });

  it('rejects an unknown level before calling the daemon', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    await expect(runPermissionsCli(['set', 'root'], helpers(response('default', null), calls, []))).rejects.toThrow(
      /read-only, default, full/,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('monofield permissions (CLI against the daemon routes)', () => {
  let server: StartServerResult;
  const cli = (args: string[]) => execute(process.execPath, [
    path.resolve('dist/cli.js'),
    'permissions',
    ...args,
    '--daemon-url',
    server.url,
  ]);

  beforeAll(async () => {
    server = (await startServer({ port: 0, returnServer: true })) as StartServerResult;
  }, 30_000);

  afterAll(async () => {
    await fetch(`${server.url}/api/execution-permissions`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: 'default' }),
    }).catch(() => undefined);
    await server?.shutdown();
    server?.server.closeAllConnections?.();
  });

  it('uses the same endpoint as Settings', async () => {
    const set = JSON.parse((await cli(['set', 'read-only', '--json'])).stdout);
    expect(set).toMatchObject({ level: 'read-only', effective: { codexSandbox: 'read-only', claudePermissionMode: 'plan' } });
    const viaApi = await (await fetch(`${server.url}/api/execution-permissions`)).json() as ExecutionPermissionsResponse;
    expect(viaApi.level).toBe('read-only');
    const shown = (await cli(['show'])).stdout;
    expect(shown).toContain('Execution permission level: read-only');
    await expect(cli(['set', 'everything'])).rejects.toMatchObject({ code: 1 });
  });
});
