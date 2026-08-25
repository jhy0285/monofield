import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { InstalledPluginRecord } from '@open-design/contracts';
import { migratePlugins } from '../src/plugins/persistence.js';
import { ensureMarketplaceManifest } from '../src/plugins/marketplaces.js';
import {
  hasPinnedSha256Integrity,
  isInstalledPluginAllowedByManagedDistribution,
} from '../src/plugins/managed-distribution.js';

const CATALOG_URL = 'https://catalog.company.example/open-docs-marketplace.json';
const ARCHIVE_URL = 'https://packages.company.example/orders-plugin.tgz';
const DIGEST = `sha256:${'a'.repeat(64)}`;
const policy = {
  bundledPluginIds: new Set(['interface-spec']),
  allowedCatalogUrls: [CATALOG_URL],
  allowedArchiveHosts: ['packages.company.example'],
  allowedLicenses: ['Apache-2.0'],
};

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT, title TEXT);
  `);
  migratePlugins(db);
  const seeded = ensureMarketplaceManifest(db, {
    id: 'company',
    url: CATALOG_URL,
    trust: 'restricted',
    visibility: 'enterprise',
    manifestText: JSON.stringify({
      specVersion: '1.0.0',
      name: 'company',
      version: '1.0.0',
      plugins: [],
    }),
  });
  if (!seeded.ok) throw new Error(seeded.message);
});

afterEach(() => db.close());

function installed(overrides: Partial<InstalledPluginRecord> = {}): InstalledPluginRecord {
  return {
    id: 'orders-plugin',
    title: 'Orders Plugin',
    version: '1.0.0',
    sourceKind: 'url',
    source: ARCHIVE_URL,
    sourceMarketplaceId: 'company',
    resolvedSource: ARCHIVE_URL,
    archiveIntegrity: DIGEST,
    trust: 'restricted',
    capabilitiesGranted: [],
    manifest: {
      name: 'orders-plugin',
      version: '1.0.0',
      license: 'Apache-2.0',
    },
    fsPath: 'C:/managed/plugins/orders-plugin',
    installedAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('managed installed-plugin policy', () => {
  it('allows only explicitly allowlisted bundled plugins', () => {
    expect(isInstalledPluginAllowedByManagedDistribution(
      db,
      installed({ id: 'interface-spec', sourceKind: 'bundled' }),
      policy,
    )).toBe(true);
    expect(isInstalledPluginAllowedByManagedDistribution(
      db,
      installed({ id: 'legacy-brand-pack', sourceKind: 'bundled' }),
      policy,
    )).toBe(false);
  });

  it('requires enterprise catalog, archive host, license, and pinned SHA-256', () => {
    expect(isInstalledPluginAllowedByManagedDistribution(db, installed(), policy)).toBe(true);
    expect(isInstalledPluginAllowedByManagedDistribution(
      db,
      installed({ resolvedSource: 'https://attacker.example/plugin.tgz' }),
      policy,
    )).toBe(false);
    expect(isInstalledPluginAllowedByManagedDistribution(
      db,
      installed({ archiveIntegrity: undefined }),
      policy,
    )).toBe(false);
    expect(isInstalledPluginAllowedByManagedDistribution(
      db,
      installed({ manifest: { name: 'orders-plugin', version: '1.0.0', license: 'GPL-3.0' } }),
      policy,
    )).toBe(false);
  });

  it('accepts only complete SHA-256 encodings', () => {
    expect(hasPinnedSha256Integrity(DIGEST)).toBe(true);
    expect(hasPinnedSha256Integrity(`sha256-${Buffer.alloc(32).toString('base64')}`)).toBe(true);
    expect(hasPinnedSha256Integrity('sha256:abc')).toBe(false);
  });
});
