import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  STARTUP_FAILURE_EVENT,
  captureStartupFailure,
  classifyStartupFailure,
  parseDaemonLogTail,
  reportStartupFailure,
  resolveStartupDistinctId,
  scrubUserPaths,
} from '../src/startup-telemetry.js';

const ISSUE_4638_LOG = `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'better-sqlite3' imported from /Applications/Open Design.app/Contents/Resources/app/prebundled/daemon/chunks/server-PULTSXNL.mjs
    at Object.getPackageJSONURL (node:internal/modules/package_json_reader:301:9)
[open-design packaged] exited app=daemon pid=45305 code=1 signal=none`;

const DAEMON_EXIT_MESSAGE =
  'daemon exited before reporting status (code=1, signal=none); see /Users/liudetao/Library/Application Support/Open Design/namespaces/release-stable/logs/daemon/latest.log for details';
const WEB_EXIT_MESSAGE =
  'daemon exited before reporting status (code=1, signal=none); see /Users/liudetao/Library/Application Support/Open Design/namespaces/release-stable/logs/web/latest.log for details';

describe('parseDaemonLogTail', () => {
  it('extracts the error code and missing module from the #4638 log', () => {
    expect(parseDaemonLogTail(ISSUE_4638_LOG)).toEqual({
      errorCode: 'ERR_MODULE_NOT_FOUND',
      missingModule: 'better-sqlite3',
    });
  });

  it('returns empty when the log carries no recognizable signal', () => {
    expect(parseDaemonLogTail('daemon started ok\nlistening on 17456')).toEqual({});
  });
});

describe('classifyStartupFailure', () => {
  it('classifies a daemon-start failure and pulls code/signal/logPath', () => {
    const c = classifyStartupFailure(new Error(DAEMON_EXIT_MESSAGE), false);
    expect(c.failureKind).toBe('daemon-start');
    expect(c.exitCode).toBe(1);
    expect(c.signal).toBeNull();
    expect(c.logPath).toContain('/logs/daemon/latest.log');
  });

  it('distinguishes a web-start failure by log-path segment', () => {
    expect(classifyStartupFailure(new Error(WEB_EXIT_MESSAGE), false).failureKind).toBe(
      'web-start',
    );
  });

  it('classifies a Windows web-start log path as web-start', () => {
    const winWebMessage =
      'daemon exited before reporting status (code=1, signal=none); see C:\\Users\\Alice\\AppData\\Roaming\\Open Design\\namespaces\\release-stable\\logs\\web\\latest.log for details';
    expect(classifyStartupFailure(new Error(winWebMessage), false).failureKind).toBe('web-start');
  });

  it('marks path-access failures without inventing a log path', () => {
    const c = classifyStartupFailure(new Error('whatever'), true);
    expect(c.failureKind).toBe('path-access');
    expect(c.logPath).toBeNull();
  });

  it('falls back to unknown for an unrecognized error', () => {
    expect(classifyStartupFailure(new Error('boom'), false).failureKind).toBe('unknown');
  });
});

describe('scrubUserPaths', () => {
  it('redacts the user home directory but keeps the rest of the path', () => {
    const scrubbed = scrubUserPaths(
      '/Users/liudetao/Library/Application Support/Open Design/namespaces/release-stable/logs/daemon/latest.log',
    );
    expect(scrubbed).not.toContain('liudetao');
    expect(scrubbed).toContain('/Users/<redacted>/Library/Application Support');
  });

  it('redacts Windows user dirs too', () => {
    expect(scrubUserPaths('C:\\Users\\Alice\\AppData\\Roaming')).toBe(
      'C:\\Users\\<redacted>\\AppData\\Roaming',
    );
  });
});

describe('resolveStartupDistinctId', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    delete process.env.OD_INSTALLATION_DIR;
  });

  it('reads installationId from an explicit installationRoot', () => {
    const root = mkdtempSync(join(tmpdir(), 'od-install-'));
    dirs.push(root);
    writeFileSync(join(root, 'installation.json'), JSON.stringify({ installationId: 'inst-abc' }));
    expect(resolveStartupDistinctId('release-stable', root)).toBe('inst-abc');
  });

  it('falls back to a synthetic per-namespace id when no installation file exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'od-install-'));
    dirs.push(root);
    expect(resolveStartupDistinctId('release-stable', root)).toBe('packaged-release-stable');
  });
});

describe('captureStartupFailure', () => {
  it('does not send network telemetry even when legacy config is supplied', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    await captureStartupFailure(
      {
        distinctId: 'install-123',
        event: STARTUP_FAILURE_EVENT,
        properties: { failure_kind: 'daemon-start' },
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not block on a hung fetch implementation', async () => {
    const hung = new Promise<Response>(() => {
      /* never resolves */
    });
    const fetchImpl = vi.fn().mockReturnValue(hung);
    const start = Date.now();
    await captureStartupFailure(
      { distinctId: 'd', event: 'e', properties: {} },
      { fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 30 },
    );
    expect(Date.now() - start).toBeLessThan(2000);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('reportStartupFailure', () => {
  it('does not send startup diagnostics even when legacy config is supplied', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    await reportStartupFailure(
      {
        error: new Error(DAEMON_EXIT_MESSAGE),
        isPathAccess: false,
        distinctId: 'install-123',
        appVersion: '0.11.0',
        namespace: 'release-stable',
        source: 'packaged',
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        readLogTail: async () => ISSUE_4638_LOG,
      },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never throws even when the log read blows up', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    await expect(
      reportStartupFailure(
        {
          error: new Error(DAEMON_EXIT_MESSAGE),
          isPathAccess: false,
          distinctId: 'd',
          appVersion: '0.11.0',
          namespace: 'release-stable',
          source: 'packaged',
        },
        {
          fetchImpl: fetchImpl as unknown as typeof fetch,
          readLogTail: async () => {
            throw new Error('disk gone');
          },
        },
      ),
    ).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
