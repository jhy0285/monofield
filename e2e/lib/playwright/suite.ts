import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test as base } from '@playwright/test';

import { createToolsDevSuite, e2eWorkspaceRoot } from '../tools-dev/runtime.ts';
import { markFeatureGuidesSeen } from './feature-guides.ts';
import type { ToolsDevSuite } from '../tools-dev/types.ts';

type PlaywrightToolsDevSuite = ToolsDevSuite & {
  markFailed: () => void;
};

type TestFixtures = {
  _entryFeatureGuidesSeen: void;
  _toolsDevFailureTracker: void;
};

type WorkerFixtures = {
  toolsDev: PlaywrightToolsDevSuite;
};

type WorkerOptions = {
  /**
   * Start the worker's stack with the AMR cloud runtime on. MonoField ships it off
   * (`OD_ENABLE_AMR` for the daemon, `NEXT_PUBLIC_OD_ENABLE_AMR` for the renderer), so only
   * the AMR specs turn it on, with `test.use({ amrEnabled: true })`.
   */
  amrEnabled: boolean;
};

const AMR_RUNTIME_ENV = { OD_ENABLE_AMR: '1', NEXT_PUBLIC_OD_ENABLE_AMR: '1' } as const;

export const test = base.extend<TestFixtures, WorkerFixtures & WorkerOptions>({
  amrEnabled: [false, { option: true, scope: 'worker' }],

  toolsDev: [
    async ({ amrEnabled }, use, workerInfo) => {
      const stackEnv = amrEnabled ? { ...AMR_RUNTIME_ENV } : {};
      const suite = await createPlaywrightToolsDevSuite(workerInfo.workerIndex);
      let failed = false;
      const toolsDev: PlaywrightToolsDevSuite = Object.assign(suite, {
        markFailed() {
          failed = true;
        },
      });

      let useError: unknown = null;
      let stopError: unknown = null;
      try {
        await toolsDev.startWeb(stackEnv);
        await warmUpWeb(toolsDev.url.web());
        await use(toolsDev);
      } catch (error) {
        useError = error;
        failed = true;
        throw error;
      } finally {
        try {
          await toolsDev.stopWeb(stackEnv);
        } catch (error) {
          stopError = error;
          failed = true;
        }
        if (!failed) {
          await rm(toolsDev.root, { force: true, recursive: true });
        }
        if (stopError != null && useError == null) {
          throw stopError;
        }
      }
    },
    { scope: 'worker', timeout: 240_000 },
  ],

  baseURL: async ({ toolsDev }, use) => {
    await use(toolsDev.url.web());
  },

  _entryFeatureGuidesSeen: [
    async ({ context }, use) => {
      await markFeatureGuidesSeen(context);
      await use();
    },
    { auto: true },
  ],

  _toolsDevFailureTracker: [
    async ({ toolsDev }, use, testInfo) => {
      await use();
      if (testInfo.status !== testInfo.expectedStatus) {
        toolsDev.markFailed();
        await testInfo.attach('tools-dev-runtime', {
          body: JSON.stringify({
            dataDir: toolsDev.dataDir,
            daemonPort: toolsDev.daemonPort,
            daemonUrl: toolsDev.daemonUrl,
            namespace: toolsDev.namespace,
            root: toolsDev.root,
            toolsDevRoot: toolsDev.toolsDevRoot,
            webPort: toolsDev.webPort,
            webUrl: toolsDev.webUrl,
          }, null, 2),
          contentType: 'application/json',
        });
      }
    },
    { auto: true },
  ],
});

export { expect };
export type { PlaywrightToolsDevSuite };

async function createPlaywrightToolsDevSuite(workerIndex: number): Promise<ToolsDevSuite> {
  const namespaceBase = process.env.OD_E2E_NAMESPACE ?? `playwright-${process.pid}`;
  const namespace = `${sanitizeSegment(namespaceBase)}-w${workerIndex}`;
  const root = join(e2eWorkspaceRoot(), '.tmp', 'e2e', namespace);
  const scratchDir = join(root, 'scratch');
  const suite = createToolsDevSuite({
    codexHomeDir: join(scratchDir, 'codex-home'),
    dataDir: join(scratchDir, 'data'),
    namespace,
    root,
    toolsDevRoot: join(scratchDir, 'tools-dev'),
  });

  await mkdir(scratchDir, { recursive: true });
  return suite;
}

/**
 * `next dev` compiles a route on its first request, which takes 30-45 s on a cold
 * worker. Without this the first test of every worker paid for it, a test with a
 * 30 s timeout failed, and the worker that Playwright started next was cold again.
 * Every page is served by the same catch-all route, so one request covers them. A
 * failure here is ignored: the test that needs the page reports its own error.
 */
async function warmUpWeb(webUrl: string): Promise<void> {
  try {
    const response = await fetch(webUrl, { signal: AbortSignal.timeout(180_000) });
    await response.arrayBuffer();
  } catch {
    // The first test will surface a real problem with the server.
  }
}

function sanitizeSegment(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'playwright';
}
