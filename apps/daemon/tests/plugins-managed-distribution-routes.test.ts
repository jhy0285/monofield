import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import express from 'express';
import {
  registerPluginRoutes,
  registerProjectPluginRoutes,
  summarizeInstalledPlugin,
} from '../src/routes/plugins/index.js';

const approvedPlugin = {
  id: 'approved-plugin',
  title: 'Approved Plugin',
  version: '1.0.0',
  sourceKind: 'marketplace',
  trust: 'trusted',
  updatedAt: 1,
  capabilitiesGranted: [],
  manifest: {},
};
const blockedPlugin = {
  id: 'blocked-plugin',
  title: 'Blocked Plugin',
  version: '1.0.0',
  sourceKind: 'github',
  trust: 'untrusted',
  updatedAt: 1,
  capabilitiesGranted: [],
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
  const resolvePluginSnapshot = vi.fn();
  const applyBakedPreviews = vi.fn((rows: unknown) => rows);
  const installed = [approvedPlugin, blockedPlugin];
  const listInstalledPlugins = vi.fn(() => installed);
  const snapshots = new Map([
    ['approved-snapshot', { snapshotId: 'approved-snapshot', pluginId: approvedPlugin.id }],
    ['blocked-snapshot', { snapshotId: 'blocked-snapshot', pluginId: blockedPlugin.id }],
  ]);
  const deps = {
    db: {
      prepare: (sql: string) => ({
        all: () => sql.includes('FROM installed_plugins')
          ? installed.map((plugin) => ({
              id: plugin.id,
              version: plugin.version,
              updatedAt: plugin.updatedAt,
              trust: plugin.trust,
              sourceMarketplaceId: null,
              sourceMarketplaceEntryVersion: null,
            }))
          : sql.includes('FROM plugin_marketplaces')
            ? []
            : [...snapshots.keys()].map((id) => ({ id })),
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
      listInstalledPlugins,
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
      resolvePluginSnapshot,
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
      applyBakedPreviews,
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
    resolvePluginSnapshot,
    handleShareProject,
    handlePluginTrust,
    handleProjectPluginCli,
    handleCandidateShareTask,
    handleProjectShareTask,
    applyBakedPreviews,
    listInstalledPlugins,
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
  it('builds a localized picker summary without full manifests or asset lists', () => {
    const summary = summarizeInstalledPlugin({
      id: 'deck-plugin',
      title: 'Deck plugin',
      version: '1.0.0',
      sourceKind: 'bundled',
      trust: 'trusted',
      updatedAt: 7,
      capabilitiesGranted: [],
      manifest: {
        name: 'deck-plugin',
        version: '1.0.0',
        description_i18n: { en: 'Deck helper', ko: '덱 도우미' },
        od: {
          kind: 'scenario',
          inputs: [{
            name: 'payload',
            type: 'textarea',
            label: 'A very large input that belongs only in plugin details',
          }],
          useCase: {
            query: { en: 'Create a deck', ko: '덱을 만들어줘' },
            exampleOutputs: [{ path: 'examples/deck.html', title: 'Deck' }],
          },
          context: {
            assets: ['assets/very-large-reference.bin'],
            designSystem: { ref: 'brand/default' },
          },
        },
        author: { name: 'Detail-only author', url: 'https://example.invalid/author' },
        homepage: 'https://example.invalid/plugin',
      },
    }, 'ko');

    expect(summary).toMatchObject({
      id: 'deck-plugin',
      version: '1.0.0',
      sourceKind: 'bundled',
      hasQuery: true,
      designSystemRef: 'brand/default',
      exampleOutput: { path: 'examples/deck.html', title: 'Deck' },
    });
    expect(summary).not.toHaveProperty('manifest');
    expect(summary).not.toHaveProperty('assets');
    expect(summary).not.toHaveProperty('inputs');
    expect(summary).not.toHaveProperty('author');
    expect(summary).not.toHaveProperty('homepage');
    expect(summary).not.toHaveProperty('description');
  });

  it('hides unapproved installed plugins and their older snapshots', async () => {
    const { baseUrl, applyBakedPreviews } = await start();

    const plugins = await fetch(`${baseUrl}/api/plugins`).then((response) => response.json());
    expect(plugins.plugins.map((plugin: { id: string }) => plugin.id)).toEqual([
      approvedPlugin.id,
    ]);

    expect((await fetch(`${baseUrl}/api/plugins/${blockedPlugin.id}`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/plugins/${approvedPlugin.id}`)).status).toBe(200);
    expect(applyBakedPreviews).toHaveBeenLastCalledWith([approvedPlugin], '');
    expect((await fetch(`${baseUrl}/api/applied-plugins/blocked-snapshot`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/applied-plugins/approved-snapshot`)).status).toBe(200);
  });

  it('reuses compact picker summaries until the installed plugin fingerprint changes', async () => {
    const { baseUrl, applyBakedPreviews, listInstalledPlugins } = await start();
    const headers = { 'x-monofield-plugin-view': 'summary' };

    const first = await fetch(`${baseUrl}/api/plugins`, { headers });
    const etag = first.headers.get('etag');
    const second = await fetch(`${baseUrl}/api/plugins`, {
      headers: { ...headers, 'if-none-match': etag ?? '' },
    });

    expect(first.status).toBe(200);
    expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/);
    await expect(first.json()).resolves.toMatchObject({
      plugins: [{ version: '1.0.0', sourceKind: 'marketplace' }],
    });
    expect(second.status).toBe(304);
    expect(applyBakedPreviews).toHaveBeenCalledTimes(1);
    expect(listInstalledPlugins).toHaveBeenCalledTimes(1);
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

  it('returns the persisted snapshot for a project-scoped apply without running the pure resolver twice', async () => {
    const { baseUrl, applyPlugin, resolvePluginSnapshot } = await start();
    const persisted = {
      snapshotId: 'persisted-snapshot',
      pluginId: approvedPlugin.id,
      pluginVersion: approvedPlugin.version,
      manifestSourceDigest: 'a'.repeat(64),
    };
    resolvePluginSnapshot.mockReturnValue({
      ok: true,
      snapshotId: persisted.snapshotId,
      snapshot: persisted,
      applyResult: {
        query: 'Create a document',
        contextItems: [],
        inputs: [],
        assets: [],
        mcpServers: [],
        projectMetadata: {},
        trust: 'trusted',
        capabilitiesGranted: [],
        capabilitiesRequired: [],
        appliedPlugin: { ...persisted, snapshotId: '' },
      },
    });

    const response = await fetch(`${baseUrl}/api/plugins/${approvedPlugin.id}/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-1',
        conversationId: 'conversation-1',
        inputs: {},
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      appliedPlugin: { snapshotId: persisted.snapshotId, pluginId: approvedPlugin.id },
    });
    expect(resolvePluginSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      body: expect.objectContaining({ pluginId: approvedPlugin.id }),
    }));
    expect(applyPlugin).not.toHaveBeenCalled();
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
