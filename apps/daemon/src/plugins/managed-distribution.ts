import type Database from 'better-sqlite3';
import type { InstalledPluginRecord } from '@open-design/contracts';
import {
  getMarketplace,
  isManagedMarketplaceCatalogUrlAllowed,
  isManagedMarketplaceUrlAllowed,
} from './marketplaces.js';

export interface ManagedPluginDistributionPolicy {
  bundledPluginIds: ReadonlySet<string>;
  allowedCatalogUrls: readonly string[];
  allowedArchiveHosts: readonly string[];
  allowedLicenses: readonly string[];
}

export function hasPinnedSha256Integrity(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return /^sha256:[0-9a-f]{64}$/i.test(normalized)
    || /^sha256-[A-Za-z0-9+/]{43}=$/.test(normalized);
}

/**
 * Revalidates an installed plugin against the current administrator policy.
 * This is intentionally stricter than trusting installation-time metadata:
 * a later managed-mode restart must not reactivate an old local/public plugin.
 */
export function isInstalledPluginAllowedByManagedDistribution(
  db: Database.Database,
  plugin: InstalledPluginRecord,
  policy: ManagedPluginDistributionPolicy,
): boolean {
  if (plugin.sourceKind === 'bundled') {
    return policy.bundledPluginIds.has(plugin.id.toLowerCase());
  }
  if (!plugin.sourceMarketplaceId) return false;
  const marketplace = getMarketplace(db, plugin.sourceMarketplaceId);
  if (
    !marketplace
    || marketplace.visibility !== 'enterprise'
    || !isManagedMarketplaceCatalogUrlAllowed(
      marketplace.url,
      policy.allowedCatalogUrls,
    )
  ) {
    return false;
  }
  const packageUrl = plugin.resolvedSource || plugin.source;
  if (!isManagedMarketplaceUrlAllowed(packageUrl, policy.allowedArchiveHosts)) {
    return false;
  }
  const license = plugin.manifest.license;
  if (typeof license !== 'string' || !policy.allowedLicenses.includes(license)) {
    return false;
  }
  return hasPinnedSha256Integrity(plugin.archiveIntegrity);
}
