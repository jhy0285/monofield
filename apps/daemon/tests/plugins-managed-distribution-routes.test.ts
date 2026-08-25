import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import express from 'express';
import {
  registerPluginRoutes,
  registerProjectPluginRoutes,
} from '../src/routes/plugins/index.js';

const approvedPlugin = {
  id: 'approved-plugin',
  title: 'Approved Plugin',
  sourceKind: 'marketplace',
  manifest: {},
};
const blockedPlugin = {
  id: 'blocked-plugin',
  title: 'Blocked Plugin',
  sourceKind: 'github',
  manifest: {},
};

let server: Server | null = null;

afterEach(async () => {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

function managedDeps() {
  const handleShareProject = vi.fn();
  const handlePluginTrust = vi.fn();
  const handleProjectPluginCli = vi.fn();
  const handleCandidateShareTask = vi.fn();
  const handleProjectShareTask = vi.fn();
  const applyPlugin = vi.fn();
  const installed = [approvedPlugin, blockedPlugin];
  const snapshots = new Map([
    ['approved-snapshot', { snapshotId: 'approved-snapshot', pluginId: approvedPlugin.id }],
    ['blocked-snapshot', { snapshotId: 'blocked-snapshot', pluginId: blockedPlugin.id }],
  ]);
  const deps = {
    db: {
      prepare: () => ({
        all: () => [...snapshots.keys()].map((id) => ({ id })),
        get: () => undefined,
        run: () => undefined,
      }),
    },
    paths: {
      PROJECTS_DIR: '',
      PLUGIN_REGISTRY_ROOTS: [],
      PLUGIN_LOCKFILE_PATH: '',
    },
    plugins: {
      listInstalledPlugins: () => installed,
      getInstalledPlugin: (_db: unknown, id: string) =>
        installed.find((plugin) => plugin.id === id) ?? null,
      installPlugin: async function* () {},
      uninstallPlugin: async () => ({ ok: false }),
      installFromLocalFolder: async function* () {},
      applyPlugin,
      doctorPlugin: vi.fn(),
      getSnapshot: (_db: unknown, id: string) => snapshots.get(id) ?? null,
      pruneExpiredSnapshots: () => ({ removed: 0, ids: [] }),
      readPluginLockfile: async () => ({}),
      resolvePluginSnapshot: vi.fn(),
      MissingInputError: class MissingInputError extends Error {
        fields: string[] = [];
      },
      pluginPromptBlock: () => '',
      listSkillPluginCandidates: () => [],
      dismissSkillPluginCandidate: () => null,
      generateSkillPluginDraft: vi.fn(),
      FIRST_PARTY_ATOMS: [],
    },
    helpers: {
      PLUGIN_PREVIEWS_DIR: '',
      pluginUpload: {
        single: () => (_req: unknown, _res: unknown, next: () => void) => next(),
        array: () => (_req: unknown, _res: unknown, next: () => void) => next(),
      },
      pluginInstallation: {
        stageUploadedPluginZip: vi.fn(),
        stageUploadedPluginFolder: vi.fn(),
      },
      connectorService: {},
      resolvedPortRef: { current: null },
      pluginShareTaskStore: { get: () => null, snapshot: () => null },
      applyBakedPreviews: (rows: unknown) => rows,
      sendMulterError: vi.fn(),
      decodeMultipartFilename: (name: string) => name,
      installOrUpgradePlugin: vi.fn(),
      loadPluginRegistryView: async () => ({}),
      buildConnectorProbe: () => ({}),
      handleShareProject,
      handlePluginTrust,
      handlePluginStats: vi.fn(),
      requireLocalDaemonRequest: (_req: unknown, _res: unknown, next: () => void) => next(),
      handleAppliedPluginExport: vi.fn(),
      handleProjectInstallFolder: vi.fn(),
      handleProjectPluginCli,
      getProject: () => ({}),
      sendApiError: vi.fn(),
      isLocalSameOrigin: () => true,
      handleCandidateDraft: vi.fn(),
      handleCandidateShareTask,
      handleProjectShareTask,
      managedDistributionOnly: true,
      isPluginAllowed: (plugin: { id?: string }) => plugin.id === approvedPlugin.id,
    },
  };
  return {
    deps: deps as never,
    applyPlugin,
    handleShareProject,
    handlePluginTrust,
    handleProjectPluginCli,
    handleCandidateShareTask,
    handleProjectShareTask,
  };
}

async function start() {
  const state = managedDeps();
  const app = express();
  app.use(express.json());
  registerPluginRoutes(app, state.deps);
  registerProjectPluginRoutes(app, state.deps);
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('expected TCP listener');
  return { ...state, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe('managed plugin distribution routes', () => {
  it('hides unapproved installed plugins and their older snapshots', async () => {
    const { baseUrl } = await start();

    const plugins = await fetch(`${baseUrl}/api/plugins`).then((response) => response.json());
    expect(plugins.plugins.map((plugin: { id: string }) => plugin.id)).toEqual([
      approvedPlugin.id,
    ]);

    expect((await fetch(`${baseUrl}/api/plugins/${blockedPlugin.id}`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/applied-plugins/blocked-snapshot`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/applied-plugins/approved-snapshot`)).status).toBe(200);
  });

  it('blocks unapproved apply, request capability grants, and local trust changes', async () => {
    const { baseUrl, applyPlugin, handlePluginTrust } = await start();
    const headers = { 'content-type': 'application/json' };

    const unapproved = await fetch(`${baseUrl}/api/plugins/${blockedPlugin.id}/apply`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    expect(unapproved.status).toBe(403);

    const grant = await fetch(`${baseUrl}/api/plugins/${approvedPlugin.id}/apply`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ grantCaps: ['connector:github'] }),
    });
    expect(grant.status).toBe(403);

    const trust = await fetch(`${baseUrl}/api/plugins/${approvedPlugin.id}/trust`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ capabilities: ['connector:github'] }),
    });
    expect(trust.status).toBe(403);
    expect(applyPlugin).not.toHaveBeenCalled();
    expect(handlePluginTrust).not.toHaveBeenCalled();
  });

  it('blocks public sharing endpoints before their handlers run', async () => {
    const {
      baseUrl,
      handleShareProject,
      handleProjectPluginCli,
      handleCandidateShareTask,
      handleProjectShareTask,
    } = await start();
    const request = (pathname: string) => fetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    const responses = await Promise.all([
      request(`/api/plugins/${approvedPlugin.id}/share-project`),
      request('/api/projects/project-1/plugins/publish-github'),
      request('/api/projects/project-1/plugins/contribute-open-design'),
      request('/api/projects/project-1/plugin-candidates/candidate-1/share-tasks'),
      request('/api/projects/project-1/plugins/share-tasks'),
    ]);
    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403, 403]);
    expect(handleShareProject).not.toHaveBeenCalled();
    expect(handleProjectPluginCli).not.toHaveBeenCalled();
    expect(handleCandidateShareTask).not.toHaveBeenCalled();
    expect(handleProjectShareTask).not.toHaveBeenCalled();
  });
});
