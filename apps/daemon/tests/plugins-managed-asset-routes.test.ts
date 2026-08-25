import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import Database from 'better-sqlite3';
import express from 'express';
import { migratePlugins } from '../src/plugins/persistence.js';
import { upsertInstalledPlugin } from '../src/plugins/registry.js';
import { registerPluginAssetRoutes } from '../src/routes/plugins/assets.js';

let server: Server | null = null;
let db: Database.Database | null = null;

afterEach(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
  db?.close();
  db = null;
});

describe('managed plugin asset routes', () => {
  it('does not serve preview or asset paths for an unapproved installed plugin', async () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT, title TEXT);
    `);
    migratePlugins(db);
    upsertInstalledPlugin(db, {
      id: 'blocked-plugin',
      title: 'Blocked Plugin',
      version: '1.0.0',
      sourceKind: 'github',
      source: 'github:example/blocked',
      trust: 'restricted',
      capabilitiesGranted: [],
      manifest: {
        name: 'blocked-plugin',
        title: 'Blocked Plugin',
        version: '1.0.0',
        license: 'MIT',
        od: { preview: { entry: 'preview.html' } },
      },
      fsPath: 'C:/unapproved/plugin',
      installedAt: 1,
      updatedAt: 1,
    });

    const app = express();
    registerPluginAssetRoutes(app, {
      db,
      pluginAssetCache: { get: async () => ({ buf: Buffer.alloc(0), contentType: '' }) },
      AssetCacheError: class AssetCacheError extends Error { status = 500; },
      assetCacheRewriteUrl: (url) => url,
      isCacheableExternalUrl: () => false,
      assembleExample: () => '',
      isPluginAllowed: () => false,
    });
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP listener');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    expect((await fetch(`${baseUrl}/api/plugins/blocked-plugin/preview`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/plugins/blocked-plugin/asset/preview.html`)).status).toBe(404);
  });
});
