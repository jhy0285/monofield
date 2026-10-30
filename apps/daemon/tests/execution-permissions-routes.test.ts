import type http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ExecutionPermissionsResponse } from '@open-design/contracts';
import { readAppConfig } from '../src/app-config.js';
import {
  buildExecutionPermissionsResponse,
  readExecutionPermissions,
  writeExecutionPermissionLevel,
} from '../src/execution-permissions.js';
import { startServer } from '../src/server.js';

describe('execution permissions module', () => {
  it('describes each level for Codex, Claude Code and Windows elevation', () => {
    expect(buildExecutionPermissionsResponse('default', { env: {}, platform: 'win32', elevated: false })).toEqual({
      level: 'default',
      effective: {
        codexSandbox: 'workspace-write',
        codexNetwork: true,
        claudePermissionMode: 'bypassPermissions',
        startElevated: false,
      },
      codexSandboxLockedByEnv: false,
      elevated: false,
      platform: 'win32',
    });
    expect(buildExecutionPermissionsResponse('read-only', { env: {}, platform: 'linux' }).effective).toEqual({
      codexSandbox: 'read-only',
      codexNetwork: false,
      claudePermissionMode: 'plan',
      startElevated: false,
    });
    expect(buildExecutionPermissionsResponse('full', { env: {}, platform: 'win32' }).effective.startElevated).toBe(true);
    // Elevation is a Windows desktop step only.
    expect(buildExecutionPermissionsResponse('full', { env: {}, platform: 'darwin' }).effective.startElevated).toBe(false);
  });

  it('reports the OD_CODEX_SANDBOX override as a lock that widens Codex only', () => {
    const locked = buildExecutionPermissionsResponse('read-only', {
      env: { OD_CODEX_SANDBOX: 'danger-full-access' },
      platform: 'linux',
    });
    expect(locked.codexSandboxLockedByEnv).toBe(true);
    expect(locked.effective.codexSandbox).toBe('danger-full-access');
    expect(locked.effective.claudePermissionMode).toBe('plan');
  });

  it('persists the level in app-config and defaults to "default"', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'od-exec-perm-'));
    try {
      const elevation = async () => null;
      expect((await readExecutionPermissions(dataDir, { elevation })).level).toBe('default');
      const written = await writeExecutionPermissionLevel(dataDir, 'full', { elevation, platform: 'win32', env: {} });
      expect(written.level).toBe('full');
      expect(written.effective.codexSandbox).toBe('danger-full-access');
      expect((await readAppConfig(dataDir)).executionPermissionLevel).toBe('full');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('/api/execution-permissions', () => {
  let server: http.Server;
  let baseUrl: string;
  let shutdown: (() => Promise<void> | void) | undefined;

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
      shutdown?: () => Promise<void> | void;
    };
    baseUrl = started.url;
    server = started.server;
    shutdown = started.shutdown;
  });

  afterAll(async () => {
    // Leave the shared test data dir on the shipped default for later suites.
    await fetch(`${baseUrl}/api/execution-permissions`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: 'default' }),
    }).catch(() => undefined);
    await Promise.resolve(shutdown?.());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('reads, writes and validates the level', async () => {
    const initial = await fetch(`${baseUrl}/api/execution-permissions`);
    expect(initial.status).toBe(200);
    const initialBody = (await initial.json()) as ExecutionPermissionsResponse;
    expect(initialBody.platform).toBe(process.platform);
    expect(initialBody.elevated).toBe(process.platform === 'win32' ? initialBody.elevated : null);

    const put = await fetch(`${baseUrl}/api/execution-permissions`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: 'read-only' }),
    });
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as ExecutionPermissionsResponse;
    expect(putBody.level).toBe('read-only');
    expect(putBody.effective.claudePermissionMode).toBe('plan');

    const config = await fetch(`${baseUrl}/api/app-config`);
    expect(((await config.json()) as { config: { executionPermissionLevel?: string } }).config.executionPermissionLevel)
      .toBe('read-only');

    const bad = await fetch(`${baseUrl}/api/execution-permissions`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: 'root' }),
    });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(await bad.json())).toContain('read-only, default, full');
  });

  it('rejects a cross-origin write', async () => {
    const resp = await fetch(`${baseUrl}/api/execution-permissions`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ level: 'full' }),
    });
    expect(resp.status).toBe(403);
  });
});
