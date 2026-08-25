import type { Express, Request, Response } from 'express';
import type * as BetterSqlite3 from 'better-sqlite3';
import type { MarketplaceSecurityPolicy } from '@open-design/contracts';

type MarketplaceTrust = 'trusted' | 'restricted' | 'official';
type MarketplaceVisibility = 'public' | 'private' | 'enterprise';

type SqliteDbLike = BetterSqlite3.Database;

interface MarketplaceManifest {
  plugins?: unknown[];
  [key: string]: unknown;
}

interface MarketplaceRow {
  id: string;
  url: string;
  version?: string;
  specVersion?: string;
  trust?: MarketplaceTrust;
  visibility?: MarketplaceVisibility;
  authEnv?: string | null;
  policy?: MarketplaceSecurityPolicy;
  manifest: MarketplaceManifest;
  [key: string]: unknown;
}

interface MarketplaceMutationResult {
  ok: boolean;
  status: number;
  message: string;
  errors?: unknown[];
  row: MarketplaceRow;
}

type MarketplaceFetcher = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface RegisterPluginMarketplaceRoutesDeps {
  db: SqliteDbLike;
  bundledMarketplaceEntries: unknown;
  createMarketplaceFetcher: (
    seedId: string | null,
    bundled: unknown,
    authEnv?: string | null,
    administratorAllowedCatalogUrls?: readonly string[],
  ) => MarketplaceFetcher;
  marketplaceRegistryIdFromUrl: (url: string) => string | null;
  managedInstallOnly?: boolean;
  managedAllowedCatalogUrls?: readonly string[];
  managedAllowedHosts?: readonly string[];
  managedAllowedLicenses?: readonly string[];
  managedAuthEnv?: string | null;
}

function sendManagedMarketplaceDenied(
  res: Response,
  reason:
    | 'administrator-catalog-allowlist-empty'
    | 'administrator-allowlist-empty'
    | 'administrator-license-allowlist-empty'
    | 'catalog-url-not-allowed'
    | 'enterprise-catalog-required'
    | 'invalid-marketplace-policy'
    | 'managed-catalog-mutation-disabled'
    | 'marketplace-policy-host-not-allowed'
    | 'marketplace-policy-license-not-allowed',
) {
  const catalogRequired = reason === 'enterprise-catalog-required';
  const mutationDisabled = reason === 'managed-catalog-mutation-disabled';
  const hostFailure = reason === 'administrator-allowlist-empty'
    || reason === 'marketplace-policy-host-not-allowed';
  const catalogFailure = reason === 'administrator-catalog-allowlist-empty'
    || reason === 'catalog-url-not-allowed';
  return res.status(403).json({
    error: {
      code: catalogRequired
        ? 'managed-marketplace-required'
        : mutationDisabled
          ? 'managed-marketplace-mutation-disabled'
        : catalogFailure
          ? 'managed-marketplace-catalog-not-allowed'
        : hostFailure
          ? 'managed-marketplace-host-not-allowed'
          : 'managed-marketplace-policy-not-allowed',
      message: catalogRequired
        ? 'Managed deployments accept only company marketplace catalogs.'
        : mutationDisabled
          ? 'Marketplace trust and removal are controlled by administrator policy.'
        : 'The marketplace is not allowed by administrator policy.',
      data: { installMode: 'managed', reason },
    },
  });
}

export function registerPluginMarketplaceRoutes(app: Express, deps: RegisterPluginMarketplaceRoutesDeps): void {
  const { db, bundledMarketplaceEntries, createMarketplaceFetcher, marketplaceRegistryIdFromUrl } = deps;

  const readBody = (req: Request): Record<string, unknown> =>
    req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};

  app.get('/api/marketplaces', async (_req, res) => {
    try {
      const {
        isManagedMarketplaceCatalogUrlAllowed,
        listMarketplaces,
      } = await import('../../plugins/marketplaces.js');
      const marketplaces = listMarketplaces(db).filter((marketplace) =>
        !deps.managedInstallOnly || (
          marketplace.visibility === 'enterprise' &&
          isManagedMarketplaceCatalogUrlAllowed(
            marketplace.url,
            deps.managedAllowedCatalogUrls ?? [],
          )
        ),
      );
      res.json({
        marketplaces,
        installPolicy: { mode: deps.managedInstallOnly ? 'managed' : 'open' },
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
  app.post('/api/marketplaces', async (req, res) => {
    try {
      const body = readBody(req);
      const url = typeof body.url === 'string' ? body.url : '';
      if (!url) return res.status(400).json({ error: 'url is required' });
      const requestedTrust = body.trust === 'trusted' || body.trust === 'official'
        ? body.trust
        : 'restricted';
      const trust = deps.managedInstallOnly ? 'restricted' : requestedTrust;
      const visibility: MarketplaceVisibility = body.visibility === 'enterprise' || body.visibility === 'private'
        ? body.visibility
        : 'public';
      const requestedAuthEnv = typeof body.authEnv === 'string' && body.authEnv.trim().length > 0
        ? body.authEnv.trim().toUpperCase()
        : undefined;
      const {
        addMarketplace,
        isManagedMarketplaceCatalogUrlAllowed,
        parseManagedMarketplaceAuthEnv,
        resolveManagedMarketplacePolicy,
        resolveMarketplaceFetchUrl,
      } = await import('../../plugins/marketplaces.js');
      const catalogUrl = resolveMarketplaceFetchUrl(url);
      const administratorAllowedCatalogUrls = deps.managedAllowedCatalogUrls ?? [];
      const administratorAllowedHosts = deps.managedAllowedHosts ?? [];
      const administratorAllowedLicenses = deps.managedAllowedLicenses ?? [];
      const authEnv = deps.managedInstallOnly
        ? parseManagedMarketplaceAuthEnv(deps.managedAuthEnv ?? undefined) ?? undefined
        : requestedAuthEnv;
      if (deps.managedInstallOnly) {
        if (visibility !== 'enterprise') {
          return sendManagedMarketplaceDenied(res, 'enterprise-catalog-required');
        }
        if (administratorAllowedCatalogUrls.length === 0) {
          return sendManagedMarketplaceDenied(res, 'administrator-catalog-allowlist-empty');
        }
        if (!isManagedMarketplaceCatalogUrlAllowed(
          catalogUrl,
          administratorAllowedCatalogUrls,
        )) {
          return sendManagedMarketplaceDenied(res, 'catalog-url-not-allowed');
        }
      }
      const requestedPolicy = body.policy && typeof body.policy === 'object' && !Array.isArray(body.policy)
        ? body.policy as MarketplaceSecurityPolicy
        : undefined;
      let effectivePolicy = requestedPolicy;
      if (deps.managedInstallOnly) {
        const policyDecision = resolveManagedMarketplacePolicy({
          marketplacePolicy: requestedPolicy,
          administratorAllowedHosts,
          administratorAllowedLicenses,
        });
        if (!policyDecision.ok) {
          return sendManagedMarketplaceDenied(res, policyDecision.reason);
        }
        effectivePolicy = policyDecision.policy;
      }
      const result = await addMarketplace(db, {
        url: catalogUrl,
        trust,
        visibility,
        ...(authEnv ? { authEnv } : {}),
        ...(effectivePolicy ? { policy: effectivePolicy } : {}),
        fetcher: createMarketplaceFetcher(
          marketplaceRegistryIdFromUrl(catalogUrl),
          bundledMarketplaceEntries,
          authEnv,
          deps.managedInstallOnly ? administratorAllowedCatalogUrls : undefined,
        ),
      }) as MarketplaceMutationResult;
      if (!result.ok) return res.status(result.status).json({ error: { code: 'marketplace-add-failed', message: result.message, data: { errors: result.errors ?? [] } } });
      res.status(201).json(result.row);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
  app.get('/api/marketplaces/:id', async (req, res) => {
    try {
      const {
        getMarketplace,
        isManagedMarketplaceCatalogUrlAllowed,
      } = await import('../../plugins/marketplaces.js');
      const row = getMarketplace(db, req.params.id) as MarketplaceRow | null;
      if (
        !row ||
        (deps.managedInstallOnly && (
          row.visibility !== 'enterprise' ||
          !isManagedMarketplaceCatalogUrlAllowed(
            row.url,
            deps.managedAllowedCatalogUrls ?? [],
          )
        ))
      ) return res.status(404).json({ error: 'marketplace not found' });
      res.json(row);
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });
  app.delete('/api/marketplaces/:id', async (req, res) => {
    try {
      if (deps.managedInstallOnly) {
        return sendManagedMarketplaceDenied(res, 'managed-catalog-mutation-disabled');
      }
      const { removeMarketplace } = await import('../../plugins/marketplaces.js');
      const ok = removeMarketplace(db, req.params.id);
      if (!ok) return res.status(404).json({ error: 'marketplace not found' });
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });
  app.post('/api/marketplaces/:id/refresh', async (req, res) => {
    try {
      const {
        getMarketplace,
        isManagedMarketplaceCatalogUrlAllowed,
        parseManagedMarketplaceAuthEnv,
        refreshMarketplace,
        resolveManagedMarketplacePolicy,
      } = await import('../../plugins/marketplaces.js');
      const row = getMarketplace(db, req.params.id) as MarketplaceRow | null;
      const administratorAllowedCatalogUrls = deps.managedAllowedCatalogUrls ?? [];
      const administratorAllowedHosts = deps.managedAllowedHosts ?? [];
      const administratorAllowedLicenses = deps.managedAllowedLicenses ?? [];
      if (deps.managedInstallOnly && row) {
        if (row.visibility !== 'enterprise') {
          return sendManagedMarketplaceDenied(res, 'enterprise-catalog-required');
        }
        if (administratorAllowedCatalogUrls.length === 0) {
          return sendManagedMarketplaceDenied(res, 'administrator-catalog-allowlist-empty');
        }
        if (!isManagedMarketplaceCatalogUrlAllowed(
          row.url,
          administratorAllowedCatalogUrls,
        )) {
          return sendManagedMarketplaceDenied(res, 'catalog-url-not-allowed');
        }
        const policyDecision = resolveManagedMarketplacePolicy({
          marketplacePolicy: row.policy,
          administratorAllowedHosts,
          administratorAllowedLicenses,
        });
        if (!policyDecision.ok) {
          return sendManagedMarketplaceDenied(res, policyDecision.reason);
        }
      }
      const seedId = row ? marketplaceRegistryIdFromUrl(row.url) ?? req.params.id : req.params.id;
      const result = await refreshMarketplace(
        db,
        req.params.id,
        createMarketplaceFetcher(
          seedId,
          bundledMarketplaceEntries,
          deps.managedInstallOnly
            ? parseManagedMarketplaceAuthEnv(deps.managedAuthEnv ?? undefined)
            : row?.authEnv,
          deps.managedInstallOnly ? administratorAllowedCatalogUrls : undefined,
        ),
      ) as MarketplaceMutationResult;
      if (!result.ok) return res.status(result.status).json({ error: { code: 'marketplace-refresh-failed', message: result.message, data: { errors: result.errors ?? [] } } });
      try {
        const { recordPluginEvent } = await import('../../plugins/events.js');
        recordPluginEvent({ kind: 'plugin.marketplace-refreshed', pluginId: '', details: { marketplaceId: req.params.id, marketplaceVersion: result.row.version, specVersion: result.row.specVersion } });
      } catch {}
      res.json(result.row);
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });
  app.post('/api/marketplaces/:id/trust', async (req, res) => {
    try {
      if (deps.managedInstallOnly) {
        return sendManagedMarketplaceDenied(res, 'managed-catalog-mutation-disabled');
      }
      const body = readBody(req);
      const trust = body.trust === 'trusted' || body.trust === 'restricted' || body.trust === 'official' ? body.trust : null;
      if (!trust) return res.status(400).json({ error: 'trust must be one of: trusted, restricted, official' });
      const { setMarketplaceTrust } = await import('../../plugins/marketplaces.js');
      const row = setMarketplaceTrust(db, req.params.id, trust) as MarketplaceRow | null;
      if (!row) return res.status(404).json({ error: 'marketplace not found' });
      res.json(row);
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });
  app.get('/api/marketplaces/:id/plugins', async (req, res) => {
    try {
      const {
        getMarketplace,
        isManagedMarketplaceCatalogUrlAllowed,
      } = await import('../../plugins/marketplaces.js');
      const row = getMarketplace(db, req.params.id) as MarketplaceRow | null;
      if (
        !row ||
        (deps.managedInstallOnly && (
          row.visibility !== 'enterprise' ||
          !isManagedMarketplaceCatalogUrlAllowed(
            row.url,
            deps.managedAllowedCatalogUrls ?? [],
          )
        ))
      ) return res.status(404).json({ error: 'marketplace not found' });
      res.json({ plugins: row.manifest.plugins ?? [] });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });
}
