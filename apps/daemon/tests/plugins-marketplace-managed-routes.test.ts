import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import { migratePlugins } from '../src/plugins/persistence.js';
import { ensureMarketplaceManifest } from '../src/plugins/marketplaces.js';
import { registerPluginMarketplaceRoutes } from '../src/routes/plugins/marketplaces.js';

const VALID_MANIFEST = JSON.stringify({
  specVersion: '1.0.0',
  name: 'company-marketplace',
  version: '1.0.0',
  plugins: [{
    name: 'company/orders-spec',
    source: 'https://packages.company.example/orders-spec-1.0.0.tgz',
    version: '1.0.0',
    integrity: `sha256:${'a'.repeat(64)}`,
    license: 'Apache-2.0',
  }],
});

const ENTERPRISE_POLICY = {
  allowedVisibilities: ['enterprise'],
  allowedHosts: ['packages.company.example', 'attacker.example'],
  allowedLicenses: ['Apache-2.0'],
  requireHttps: true,
  requireDigest: true,
  requireSignature: false,
  requireProvenance: false,
  requireSbom: false,
  requireApproval: false,
  allowDirectUrlInstall: false,
};

const APPROVED_CATALOG_URL =
  'https://catalog.company.example/open-docs-marketplace.json';

let db: Database.Database;
let tmpDir: string;
let server: Server | null;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'od-managed-mp-routes-'));
  db = new Database(path.join(tmpDir, 'test.sqlite'));
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT, title TEXT);
  `);
  migratePlugins(db);
  server = null;
});

afterEach(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

async function startManagedMarketplaceRoutes(
  administratorAllowedHosts: readonly string[],
  administratorAllowedLicenses: readonly string[] = ['Apache-2.0'],
  options: {
    catalogUrls?: readonly string[];
    authEnv?: string | null;
  } = {},
) {
  const fetchedUrls: string[] = [];
  const fetcherAllowedCatalogUrls: Array<readonly string[] | undefined> = [];
  const fetcherAuthEnvs: Array<string | null | undefined> = [];
  const administratorAllowedCatalogUrls = options.catalogUrls ?? [APPROVED_CATALOG_URL];
  const app = express();
  app.use(express.json());
  registerPluginMarketplaceRoutes(app, {
    db,
    bundledMarketplaceEntries: [],
    marketplaceRegistryIdFromUrl: () => null,
    managedInstallOnly: true,
    managedAllowedCatalogUrls: administratorAllowedCatalogUrls,
    managedAllowedHosts: administratorAllowedHosts,
    managedAllowedLicenses: administratorAllowedLicenses,
    managedAuthEnv: options.authEnv,
    createMarketplaceFetcher: (_seedId, _bundled, authEnv, allowedCatalogUrls) => {
      fetcherAuthEnvs.push(authEnv);
      fetcherAllowedCatalogUrls.push(allowedCatalogUrls);
      return async (url) => {
        fetchedUrls.push(url);
        return { ok: true, status: 200, text: async () => VALID_MANIFEST };
      };
    },
  });

  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('expected TCP listener');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    fetchedUrls,
    fetcherAllowedCatalogUrls,
    fetcherAuthEnvs,
    administratorAllowedCatalogUrls,
  };
}

async function postJson(baseUrl: string, pathname: string, body?: unknown) {
  return fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('managed marketplace routes', () => {
  it('fails closed when the administrator host allowlist is empty', async () => {
    const { baseUrl, fetchedUrls } = await startManagedMarketplaceRoutes([]);
    const secret = 'TOP_SECRET_SHOULD_NOT_LEAK';
    const response = await postJson(baseUrl, '/api/marketplaces', {
      url: APPROVED_CATALOG_URL,
      visibility: 'enterprise',
      policy: ENTERPRISE_POLICY,
      authEnv: secret,
    });

    expect(response.status).toBe(403);
    const payload = await response.text();
    expect(payload).toContain('administrator-allowlist-empty');
    expect(payload).not.toContain(secret);
    expect(fetchedUrls).toEqual([]);
  });

  it('fails closed when the exact catalog URL allowlist is empty', async () => {
    const { baseUrl, fetchedUrls } = await startManagedMarketplaceRoutes(
      ['packages.company.example'],
      ['Apache-2.0'],
      { catalogUrls: [] },
    );
    const response = await postJson(baseUrl, '/api/marketplaces', {
      url: APPROVED_CATALOG_URL,
      visibility: 'enterprise',
      policy: ENTERPRISE_POLICY,
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'managed-marketplace-catalog-not-allowed',
        data: { reason: 'administrator-catalog-allowlist-empty' },
      },
    });
    expect(fetchedUrls).toEqual([]);
  });

  it('rejects arbitrary path and port on an otherwise approved catalog host', async () => {
    const { baseUrl, fetchedUrls } = await startManagedMarketplaceRoutes([
      'packages.company.example',
    ]);
    const arbitraryPath = await postJson(baseUrl, '/api/marketplaces', {
      url: 'https://catalog.company.example/users/attacker/open-docs-marketplace.json',
      visibility: 'enterprise',
      policy: {
        ...ENTERPRISE_POLICY,
      },
    });
    const arbitraryPort = await postJson(baseUrl, '/api/marketplaces', {
      url: 'https://catalog.company.example:8443/open-docs-marketplace.json',
      visibility: 'enterprise',
      policy: ENTERPRISE_POLICY,
    });

    expect(arbitraryPath.status).toBe(403);
    expect(await arbitraryPath.json()).toMatchObject({
      error: {
        code: 'managed-marketplace-catalog-not-allowed',
        data: { reason: 'catalog-url-not-allowed' },
      },
    });
    expect(arbitraryPort.status).toBe(403);
    expect(await arbitraryPort.json()).toMatchObject({
      error: { data: { reason: 'catalog-url-not-allowed' } },
    });
    expect(fetchedUrls).toEqual([]);
  });

  it('fails closed when the administrator license allowlist is empty', async () => {
    const { baseUrl, fetchedUrls } = await startManagedMarketplaceRoutes([
      'packages.company.example',
    ], []);
    const response = await postJson(baseUrl, '/api/marketplaces', {
      url: APPROVED_CATALOG_URL,
      visibility: 'enterprise',
      policy: ENTERPRISE_POLICY,
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'managed-marketplace-policy-not-allowed',
        data: { reason: 'administrator-license-allowlist-empty' },
      },
    });
    expect(fetchedUrls).toEqual([]);
  });

  it('stores the administrator intersection and cannot weaken the managed minimum', async () => {
    const administratorAllowedHosts = [
      'packages.company.example',
      'admin-only.company.example',
    ];
    const {
      baseUrl,
      fetchedUrls,
      fetcherAllowedCatalogUrls,
      fetcherAuthEnvs,
      administratorAllowedCatalogUrls,
    } = await startManagedMarketplaceRoutes(
      administratorAllowedHosts,
      ['Apache-2.0'],
      { authEnv: 'OD_MARKETPLACE_TOKEN_PLATFORM' },
    );
    const response = await postJson(baseUrl, '/api/marketplaces', {
      url: APPROVED_CATALOG_URL,
      visibility: 'enterprise',
      trust: 'official',
      authEnv: 'OD_MARKETPLACE_TOKEN_CALLER',
      policy: {
        ...ENTERPRISE_POLICY,
        allowedVisibilities: ['enterprise', 'public'],
        allowedLicenses: ['Apache-2.0', 'Caller-Approved'],
        requireHttps: false,
        requireDigest: false,
        requireSignature: true,
        requireProvenance: true,
        allowDirectUrlInstall: true,
      },
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      visibility: 'enterprise',
      trust: 'restricted',
      authEnv: 'OD_MARKETPLACE_TOKEN_PLATFORM',
      policy: {
        allowedVisibilities: ['enterprise'],
        allowedHosts: ['packages.company.example'],
        allowedLicenses: ['Apache-2.0'],
        requireHttps: true,
        requireDigest: true,
        requireSignature: true,
        requireProvenance: true,
        allowDirectUrlInstall: false,
      },
    });
    expect(fetchedUrls).toEqual([
      APPROVED_CATALOG_URL,
    ]);
    expect(fetcherAllowedCatalogUrls).toEqual([administratorAllowedCatalogUrls]);
    expect(fetcherAuthEnvs).toEqual(['OD_MARKETPLACE_TOKEN_PLATFORM']);
  });

  it('rejects refresh of an existing catalog outside administrator policy', async () => {
    const seeded = ensureMarketplaceManifest(db, {
      id: 'legacy-enterprise',
      url: 'https://legacy-user-catalog.example/open-docs-marketplace.json',
      trust: 'trusted',
      visibility: 'enterprise',
      policy: {
        ...ENTERPRISE_POLICY,
        allowedVisibilities: ['enterprise'],
      },
      manifestText: VALID_MANIFEST,
    });
    if (!seeded.ok) throw new Error(`seed failed: ${seeded.message}`);

    const { baseUrl, fetchedUrls, fetcherAllowedCatalogUrls } = await startManagedMarketplaceRoutes([
      'packages.company.example',
    ]);
    const response = await postJson(
      baseUrl,
      '/api/marketplaces/legacy-enterprise/refresh',
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { data: { reason: 'catalog-url-not-allowed' } },
    });
    expect(fetchedUrls).toEqual([]);
    expect(fetcherAllowedCatalogUrls).toEqual([]);
  });

  it('rejects refresh when administrator license policy is not configured', async () => {
    const seeded = ensureMarketplaceManifest(db, {
      id: 'company-enterprise',
      url: APPROVED_CATALOG_URL,
      trust: 'trusted',
      visibility: 'enterprise',
      policy: {
        ...ENTERPRISE_POLICY,
        allowedVisibilities: ['enterprise'],
      },
      manifestText: VALID_MANIFEST,
    });
    if (!seeded.ok) throw new Error(`seed failed: ${seeded.message}`);

    const { baseUrl, fetchedUrls, fetcherAllowedCatalogUrls } = await startManagedMarketplaceRoutes([
      'packages.company.example',
    ], []);
    const response = await postJson(
      baseUrl,
      '/api/marketplaces/company-enterprise/refresh',
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { data: { reason: 'administrator-license-allowlist-empty' } },
    });
    expect(fetchedUrls).toEqual([]);
    expect(fetcherAllowedCatalogUrls).toEqual([]);
  });

  it('rejects refresh when the exact catalog URL allowlist is empty', async () => {
    const seeded = ensureMarketplaceManifest(db, {
      id: 'catalog-fail-closed',
      url: APPROVED_CATALOG_URL,
      trust: 'restricted',
      visibility: 'enterprise',
      policy: {
        ...ENTERPRISE_POLICY,
        allowedVisibilities: ['enterprise'],
      },
      manifestText: VALID_MANIFEST,
    });
    if (!seeded.ok) throw new Error(`seed failed: ${seeded.message}`);

    const { baseUrl, fetchedUrls } = await startManagedMarketplaceRoutes(
      ['packages.company.example'],
      ['Apache-2.0'],
      { catalogUrls: [] },
    );
    const response = await postJson(
      baseUrl,
      '/api/marketplaces/catalog-fail-closed/refresh',
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { data: { reason: 'administrator-catalog-allowlist-empty' } },
    });
    expect(fetchedUrls).toEqual([]);
  });

  it('uses the administrator credential mapping for refresh instead of the row mapping', async () => {
    const seeded = ensureMarketplaceManifest(db, {
      id: 'credentialed-enterprise',
      url: APPROVED_CATALOG_URL,
      trust: 'restricted',
      visibility: 'enterprise',
      authEnv: 'OD_MARKETPLACE_TOKEN_CALLER',
      policy: {
        ...ENTERPRISE_POLICY,
        allowedVisibilities: ['enterprise'],
      },
      manifestText: VALID_MANIFEST,
    });
    if (!seeded.ok) throw new Error(`seed failed: ${seeded.message}`);

    const { baseUrl, fetcherAuthEnvs } = await startManagedMarketplaceRoutes(
      ['packages.company.example'],
      ['Apache-2.0'],
      { authEnv: 'OD_MARKETPLACE_TOKEN_PLATFORM' },
    );
    const response = await postJson(
      baseUrl,
      '/api/marketplaces/credentialed-enterprise/refresh',
    );

    expect(response.status).toBe(200);
    expect(fetcherAuthEnvs).toEqual(['OD_MARKETPLACE_TOKEN_PLATFORM']);
  });

  it('blocks managed trust changes and catalog removal', async () => {
    const seeded = ensureMarketplaceManifest(db, {
      id: 'admin-controlled-enterprise',
      url: APPROVED_CATALOG_URL,
      trust: 'restricted',
      visibility: 'enterprise',
      policy: {
        ...ENTERPRISE_POLICY,
        allowedVisibilities: ['enterprise'],
      },
      manifestText: VALID_MANIFEST,
    });
    if (!seeded.ok) throw new Error(`seed failed: ${seeded.message}`);

    const { baseUrl } = await startManagedMarketplaceRoutes(['packages.company.example']);
    const trustResponse = await postJson(
      baseUrl,
      '/api/marketplaces/admin-controlled-enterprise/trust',
      { trust: 'official' },
    );
    const removeResponse = await fetch(
      `${baseUrl}/api/marketplaces/admin-controlled-enterprise`,
      { method: 'DELETE' },
    );

    expect(trustResponse.status).toBe(403);
    expect(removeResponse.status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) AS count FROM plugin_marketplaces WHERE id = ?')
      .get('admin-controlled-enterprise')).toEqual({ count: 1 });
  });
});
