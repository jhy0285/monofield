// Marketplace registry - plan section 3.B4 / spec sections 6, 7, 11.5, 16 Phase 3
// (entry slice).
//
// Stores user-configured federated catalog indexes in
// `plugin_marketplaces`. The actual `od plugin install <name>` resolution
// through these catalogs lands in Phase 3 alongside the trust UI; this
// module is the storage + refresh half so the desktop / CLI can already
// register and inspect catalogs.
//
// We intentionally treat the catalog body as opaque JSON in v1. Zod
// validation lives in `@open-design/plugin-runtime`'s parser and we only
// store what the parser returns. Trust default mirrors section 9: a freshly
// added user-supplied marketplace is `restricted` (discovery only)
// unless `--trust` is passed.

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  parseMarketplace,
  type MarketplaceParseResult,
} from '@open-design/plugin-runtime';
import {
  MarketplaceSecurityPolicySchema,
  MarketplaceVisibilitySchema,
  MONOFIELD_PLUGIN_SPEC_VERSION,
  STRICT_ENTERPRISE_MARKETPLACE_POLICY,
  evaluateMarketplacePackagePolicy,
  type MarketplacePackageEvidence,
  type MarketplacePackageKind,
  type MarketplacePolicyEvaluation,
  type MarketplaceSecurityPolicy,
  type MarketplaceSupplyChainReferences,
  type MarketplaceVisibility,
  type MarketplaceManifest,
} from '@open-design/contracts';
import {
  parsePluginSpecifier,
  resolveMarketplaceEntryVersion,
} from '../registry/versioning.js';

type SqliteDb = Database.Database;

export type MarketplaceTrustTier = 'official' | 'trusted' | 'restricted';

export interface MarketplaceRow {
  id: string;
  url: string;
  specVersion: string;
  version: string;
  trust: MarketplaceTrustTier;
  visibility: MarketplaceVisibility;
  authEnv: string | null;
  policy: MarketplaceSecurityPolicy;
  manifest: MarketplaceManifest;
  addedAt: number;
  refreshedAt: number;
}

export interface AddMarketplaceInput {
  url: string;
  // Pluggable HTTPS fetcher; tests inject a stub. Production injects the
  // global fetch.
  fetcher?: (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
  trust?: MarketplaceTrustTier;
  visibility?: MarketplaceVisibility;
  authEnv?: string;
  policy?: MarketplaceSecurityPolicy;
}

export interface AddMarketplaceResult {
  ok: true;
  row: MarketplaceRow;
  warnings: string[];
}

export interface AddMarketplaceFailure {
  ok: false;
  status: number;
  message: string;
  errors?: string[];
}

export interface EnsureMarketplaceManifestInput {
  id: string;
  url: string;
  trust: MarketplaceTrustTier;
  visibility?: MarketplaceVisibility;
  authEnv?: string;
  policy?: MarketplaceSecurityPolicy;
  manifestText: string;
  now?: number;
}

export interface SyncManagedMarketplaceCatalogsInput {
  catalogUrls: readonly string[];
  allowedHosts: readonly string[];
  allowedLicenses: readonly string[];
  authEnv?: string | null;
  fetcher: NonNullable<AddMarketplaceInput['fetcher']>;
}

export interface SyncManagedMarketplaceCatalogsResult {
  rows: MarketplaceRow[];
  failures: Array<{ url: string; status: number; message: string }>;
}

const HTTPS_RE = /^https:\/\//i;
const MARKETPLACE_AUTH_ENV_RE = /^(?:MONOFIELD|OD|OPEN_DOCS)_MARKETPLACE_TOKEN(?:_[A-Z0-9_]+)?$/;
const LEGACY_PUBLIC_MARKETPLACE_POLICY: MarketplaceSecurityPolicy =
  MarketplaceSecurityPolicySchema.parse({
    allowedVisibilities: ['public', 'enterprise', 'private'],
    allowedHosts: [],
    allowedLicenses: [],
    requireHttps: true,
    requireDigest: false,
    requireSignature: false,
    requireProvenance: false,
    requireSbom: false,
    requireApproval: false,
    allowDirectUrlInstall: true,
  });
const DEFAULT_MARKETPLACE_REPO = 'jhy0285/monofield';
const DEFAULT_MARKETPLACE_REPO_REF = 'main';
const DEFAULT_MARKETPLACE_REGISTRY_PATH = 'plugins/registry';
const LEGACY_OPEN_DESIGN_MARKETPLACE_REPO = 'nexu-io/open-design';
const MARKETPLACE_CATALOG_MAX_BYTES = 2 * 1024 * 1024;
const MARKETPLACE_FETCH_TIMEOUT_MS = 15_000;
export const MONOFIELD_MARKETPLACE_MANIFEST_FILENAME = 'monofield-marketplace.json';
export const LEGACY_OPEN_DOCS_MARKETPLACE_MANIFEST_FILENAME = 'open-docs-marketplace.json';
export const LEGACY_OPEN_DESIGN_MARKETPLACE_MANIFEST_FILENAME = 'open-design-marketplace.json';
const PUBLIC_MARKETPLACE_BASE_URL = 'https://open-design.ai/marketplace';
const PUBLIC_PLUGINS_BASE_URL = 'https://open-design.ai/plugins';

function normalizeExactMarketplaceHostname(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/\.$/, '');
  if (
    normalized.length === 0 ||
    normalized.length > 253 ||
    normalized.includes('*') ||
    normalized.includes('://') ||
    /[\s/@:[\]]/.test(normalized)
  ) {
    return null;
  }
  return normalized.split('.').every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
  ) ? normalized : null;
}

/**
 * Parses the administrator-owned managed marketplace ceiling. Entries are
 * exact hostnames only: URL-shaped values, ports, credentials, and wildcards
 * are ignored so a malformed configuration fails closed.
 */
export function parseManagedMarketplaceAllowedHosts(value: string | undefined): string[] {
  const hosts = new Set<string>();
  for (const entry of value?.split(',') ?? []) {
    const hostname = normalizeExactMarketplaceHostname(entry);
    if (hostname) hosts.add(hostname);
  }
  return [...hosts];
}

/** Exact administrator-approved SPDX identifiers or proprietary labels. */
export function parseManagedMarketplaceAllowedLicenses(value: string | undefined): string[] {
  const licenses = new Set<string>();
  for (const entry of value?.split(',') ?? []) {
    const license = entry.trim();
    if (license) licenses.add(license);
  }
  return [...licenses];
}

/**
 * Canonical managed catalog identity. The effective port is always explicit,
 * so omitted HTTPS port and `:443` compare equally while any other port and
 * every path remain distinct. Queries, fragments, and credentials are never
 * valid catalog identities.
 */
export function canonicalManagedMarketplaceCatalogUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /[?#]/.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    const hostname = normalizeExactMarketplaceHostname(parsed.hostname);
    if (!hostname) return null;
    const port = parsed.port || '443';
    return `https://${hostname}:${port}${parsed.pathname || '/'}`;
  } catch {
    return null;
  }
}

export function parseManagedMarketplaceAllowedCatalogUrls(value: string | undefined): string[] {
  const urls = new Set<string>();
  for (const entry of value?.split(',') ?? []) {
    const canonicalUrl = canonicalManagedMarketplaceCatalogUrl(entry);
    if (canonicalUrl) urls.add(canonicalUrl);
  }
  return [...urls];
}

export function isManagedMarketplaceCatalogUrlAllowed(
  value: string,
  administratorAllowedCatalogUrls: readonly string[],
): boolean {
  const canonicalUrl = canonicalManagedMarketplaceCatalogUrl(value);
  if (!canonicalUrl) return false;
  return administratorAllowedCatalogUrls.some(
    (allowedUrl) => canonicalManagedMarketplaceCatalogUrl(allowedUrl) === canonicalUrl,
  );
}

/** Invalid administrator credential mappings degrade to anonymous access. */
export function parseManagedMarketplaceAuthEnv(value: string | undefined): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const normalized = value.trim().toUpperCase();
  return MARKETPLACE_AUTH_ENV_RE.test(normalized) ? normalized : null;
}

function normalizedAdministratorHosts(hosts: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const host of hosts) {
    const hostname = normalizeExactMarketplaceHostname(host);
    if (hostname) normalized.add(hostname);
  }
  return [...normalized];
}

function normalizedAdministratorLicenses(licenses: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const rawLicense of licenses) {
    if (typeof rawLicense !== 'string') continue;
    const license = rawLicense.trim();
    if (license) normalized.add(license);
  }
  return [...normalized];
}

function marketplaceHttpsHostname(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.search ||
      parsed.hash
    ) return null;
    return normalizeExactMarketplaceHostname(parsed.hostname);
  } catch {
    return null;
  }
}

/** Exact administrator-host match on the default HTTPS port, without URL secrets. */
export function isManagedMarketplaceUrlAllowed(
  value: string,
  administratorAllowedHosts: readonly string[],
): boolean {
  const hostname = marketplaceHttpsHostname(value);
  if (!hostname) return false;
  return normalizedAdministratorHosts(administratorAllowedHosts).includes(hostname);
}

function marketplacePolicyPatternAllowsHost(pattern: string, hostname: string): boolean {
  const normalizedPattern = pattern.trim().toLowerCase().replace(/\.$/, '');
  if (normalizedPattern.startsWith('*.')) {
    const suffix = normalizeExactMarketplaceHostname(normalizedPattern.slice(2));
    return Boolean(
      suffix && hostname.length > suffix.length && hostname.endsWith(`.${suffix}`),
    );
  }
  return normalizeExactMarketplaceHostname(normalizedPattern) === hostname;
}

/**
 * A row policy may narrow administrator policy, never expand it. Returning
 * exact administrator hostnames also prevents a row wildcard from becoming
 * an administrator wildcard by accident.
 */
export function intersectManagedMarketplaceAllowedHosts(
  marketplaceAllowedHosts: readonly string[],
  administratorAllowedHosts: readonly string[],
): string[] {
  return normalizedAdministratorHosts(administratorAllowedHosts).filter((hostname) =>
    marketplaceAllowedHosts.some((pattern) =>
      marketplacePolicyPatternAllowsHost(pattern, hostname),
    ),
  );
}

export function intersectManagedMarketplaceAllowedLicenses(
  marketplaceAllowedLicenses: readonly string[],
  administratorAllowedLicenses: readonly string[],
): string[] {
  const marketplaceLicenses = new Set(
    marketplaceAllowedLicenses
      .filter((license): license is string => typeof license === 'string')
      .map((license) => license.trim())
      .filter(Boolean),
  );
  return normalizedAdministratorLicenses(administratorAllowedLicenses).filter((license) =>
    marketplaceLicenses.has(license),
  );
}

export type ManagedMarketplacePolicyRejection =
  | 'invalid-marketplace-policy'
  | 'administrator-allowlist-empty'
  | 'administrator-license-allowlist-empty'
  | 'marketplace-policy-host-not-allowed'
  | 'marketplace-policy-license-not-allowed';

export type ManagedMarketplacePolicyDecision =
  | {
      ok: true;
      policy: MarketplaceSecurityPolicy;
      allowedHosts: string[];
      allowedLicenses: string[];
    }
  | { ok: false; reason: ManagedMarketplacePolicyRejection };

/**
 * Applies the administrator ceiling and the managed-mode security minimum.
 * Optional high-assurance requirements remain exactly as selected by the row,
 * while the baseline transport, digest, visibility, and direct-install rules
 * can never be weakened by an API caller.
 */
export function resolveManagedMarketplacePolicy(input: {
  marketplacePolicy: unknown;
  administratorAllowedHosts: readonly string[];
  administratorAllowedLicenses: readonly string[];
}): ManagedMarketplacePolicyDecision {
  const parsedPolicy = MarketplaceSecurityPolicySchema.safeParse(input.marketplacePolicy);
  if (!parsedPolicy.success) {
    return { ok: false, reason: 'invalid-marketplace-policy' };
  }
  const administratorAllowedHosts = normalizedAdministratorHosts(
    input.administratorAllowedHosts,
  );
  if (administratorAllowedHosts.length === 0) {
    return { ok: false, reason: 'administrator-allowlist-empty' };
  }
  const administratorAllowedLicenses = normalizedAdministratorLicenses(
    input.administratorAllowedLicenses,
  );
  if (administratorAllowedLicenses.length === 0) {
    return { ok: false, reason: 'administrator-license-allowlist-empty' };
  }

  const allowedHosts = intersectManagedMarketplaceAllowedHosts(
    parsedPolicy.data.allowedHosts,
    administratorAllowedHosts,
  );
  if (allowedHosts.length === 0) {
    return { ok: false, reason: 'marketplace-policy-host-not-allowed' };
  }
  const allowedLicenses = intersectManagedMarketplaceAllowedLicenses(
    parsedPolicy.data.allowedLicenses,
    administratorAllowedLicenses,
  );
  if (allowedLicenses.length === 0) {
    return { ok: false, reason: 'marketplace-policy-license-not-allowed' };
  }

  const policy = MarketplaceSecurityPolicySchema.parse({
    ...parsedPolicy.data,
    allowedVisibilities: ['enterprise'],
    allowedHosts,
    allowedLicenses,
    requireHttps: true,
    requireDigest: true,
    allowDirectUrlInstall: false,
  });
  return { ok: true, policy, allowedHosts, allowedLicenses };
}

export type ManagedMarketplaceInstallHostRejection =
  | 'administrator-catalog-allowlist-empty'
  | 'administrator-allowlist-empty'
  | 'administrator-license-allowlist-empty'
  | 'catalog-url-not-allowed'
  | 'archive-host-not-allowed'
  | 'marketplace-policy-host-not-allowed'
  | 'marketplace-policy-license-not-allowed'
  | 'package-license-not-allowed'
  | 'invalid-marketplace-policy';

export type ManagedMarketplaceInstallHostDecision =
  | { ok: true; policy: MarketplaceSecurityPolicy; allowedHosts: string[] }
  | { ok: false; reason: ManagedMarketplaceInstallHostRejection };

/**
 * Resolves the effective host and license policy before any managed install download.
 * The catalog must match an exact administrator-approved HTTPS endpoint. The
 * package source must use an administrator-approved archive host, and the row
 * policy must independently allow the package host and declared license.
 */
export function resolveManagedMarketplaceInstallHostPolicy(input: {
  catalogUrl: string;
  archiveUrl: string;
  packageLicense?: string;
  marketplacePolicy: MarketplaceSecurityPolicy;
  administratorAllowedCatalogUrls: readonly string[];
  administratorAllowedHosts: readonly string[];
  administratorAllowedLicenses: readonly string[];
}): ManagedMarketplaceInstallHostDecision {
  const administratorAllowedCatalogUrls = [
    ...new Set(input.administratorAllowedCatalogUrls.flatMap((url) => {
      const canonicalUrl = canonicalManagedMarketplaceCatalogUrl(url);
      return canonicalUrl ? [canonicalUrl] : [];
    })),
  ];
  if (administratorAllowedCatalogUrls.length === 0) {
    return { ok: false, reason: 'administrator-catalog-allowlist-empty' };
  }
  const policyDecision = resolveManagedMarketplacePolicy(input);
  if (!policyDecision.ok) return policyDecision;
  const administratorAllowedHosts = normalizedAdministratorHosts(input.administratorAllowedHosts);
  if (!isManagedMarketplaceCatalogUrlAllowed(
    input.catalogUrl,
    administratorAllowedCatalogUrls,
  )) {
    return { ok: false, reason: 'catalog-url-not-allowed' };
  }
  if (!isManagedMarketplaceUrlAllowed(input.archiveUrl, administratorAllowedHosts)) {
    return { ok: false, reason: 'archive-host-not-allowed' };
  }

  if (!isManagedMarketplaceUrlAllowed(input.archiveUrl, policyDecision.allowedHosts)) {
    return { ok: false, reason: 'marketplace-policy-host-not-allowed' };
  }
  const packageLicense = input.packageLicense?.trim();
  if (!packageLicense || !policyDecision.allowedLicenses.includes(packageLicense)) {
    return { ok: false, reason: 'package-license-not-allowed' };
  }
  return {
    ok: true,
    allowedHosts: policyDecision.allowedHosts,
    policy: policyDecision.policy,
  };
}

function marketplaceRegistryRepo(): string {
  return (process.env.OD_MARKETPLACE_REPO?.trim() || DEFAULT_MARKETPLACE_REPO)
    .replace(/^\/+|\/+$/g, '');
}

export function marketplaceRegistryBaseUrl(): string {
  const explicit = process.env.OD_MARKETPLACE_REGISTRY_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const repo = marketplaceRegistryRepo();
  const ref = (process.env.OD_MARKETPLACE_REPO_REF?.trim() || DEFAULT_MARKETPLACE_REPO_REF)
    .replace(/^\/+|\/+$/g, '');
  const registryPath = (process.env.OD_MARKETPLACE_REGISTRY_PATH?.trim() || DEFAULT_MARKETPLACE_REGISTRY_PATH)
    .replace(/^\/+|\/+$/g, '');
  return `https://raw.githubusercontent.com/${repo}/${ref}/${registryPath}`;
}

export function marketplaceManifestUrlForRegistry(id: string): string {
  const registryId = id.trim().replace(/^\/+|\/+$/g, '');
  return `${marketplaceRegistryBaseUrl()}/${registryId}/${MONOFIELD_MARKETPLACE_MANIFEST_FILENAME}`;
}

function isMarketplaceManifestFilename(filename: string | undefined): boolean {
  return filename === MONOFIELD_MARKETPLACE_MANIFEST_FILENAME
    || filename === LEGACY_OPEN_DOCS_MARKETPLACE_MANIFEST_FILENAME
    || filename === LEGACY_OPEN_DESIGN_MARKETPLACE_MANIFEST_FILENAME;
}

function stripMarketplaceManifestFilename(value: string): string {
  return value
    .replace(new RegExp(`/${MONOFIELD_MARKETPLACE_MANIFEST_FILENAME.replace(/\./g, '\\.')}$`), '')
    .replace(new RegExp(`/${LEGACY_OPEN_DOCS_MARKETPLACE_MANIFEST_FILENAME.replace(/\./g, '\\.')}$`), '')
    .replace(new RegExp(`/${LEGACY_OPEN_DESIGN_MARKETPLACE_MANIFEST_FILENAME.replace(/\./g, '\\.')}$`), '');
}

function registryIdFromBaseUrl(url: string, baseUrl: string): string | null {
  const base = baseUrl.replace(/\/+$/, '');
  if (
    !url.startsWith(`${base}/`) ||
    (!url.endsWith(`/${MONOFIELD_MARKETPLACE_MANIFEST_FILENAME}`) &&
      !url.endsWith(`/${LEGACY_OPEN_DOCS_MARKETPLACE_MANIFEST_FILENAME}`) &&
      !url.endsWith(`/${LEGACY_OPEN_DESIGN_MARKETPLACE_MANIFEST_FILENAME}`))
  ) {
    return null;
  }
  const id = stripMarketplaceManifestFilename(url.slice(base.length + 1));
  return id && !id.includes('/') ? id : null;
}

export function marketplaceRegistryIdFromUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const configuredId = registryIdFromBaseUrl(trimmed, marketplaceRegistryBaseUrl());
  if (configuredId) return configuredId;

  const publicBases = [PUBLIC_MARKETPLACE_BASE_URL, PUBLIC_PLUGINS_BASE_URL];
  for (const base of publicBases) {
    if (
      trimmed === `${base}/${MONOFIELD_MARKETPLACE_MANIFEST_FILENAME}` ||
      trimmed === `${base}/${LEGACY_OPEN_DOCS_MARKETPLACE_MANIFEST_FILENAME}` ||
      trimmed === `${base}/${LEGACY_OPEN_DESIGN_MARKETPLACE_MANIFEST_FILENAME}`
    ) return 'official';
    if (
      trimmed.startsWith(`${base}/`) &&
      (trimmed.endsWith(`/${MONOFIELD_MARKETPLACE_MANIFEST_FILENAME}`) ||
        trimmed.endsWith(`/${LEGACY_OPEN_DOCS_MARKETPLACE_MANIFEST_FILENAME}`) ||
        trimmed.endsWith(`/${LEGACY_OPEN_DESIGN_MARKETPLACE_MANIFEST_FILENAME}`))
    ) {
      const id = stripMarketplaceManifestFilename(trimmed.slice(base.length + 1));
      if (id && !id.includes('/')) return id;
    }
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'raw.githubusercontent.com') {
      return null;
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 6) return null;
    const [owner, repo] = parts;
    const allowedRepos = new Set([
      DEFAULT_MARKETPLACE_REPO,
      marketplaceRegistryRepo(),
      LEGACY_OPEN_DESIGN_MARKETPLACE_REPO,
    ]);
    if (!allowedRepos.has(`${owner}/${repo}`)) return null;
    const marker = parts.findIndex((part, index) =>
      part === 'plugins' && parts[index + 1] === 'registry',
    );
    const id = marker >= 0 ? parts[marker + 2] : undefined;
    const filename = marker >= 0 ? parts[marker + 3] : undefined;
    return id && isMarketplaceManifestFilename(filename) ? id : null;
  } catch {
    return null;
  }
}

export function resolveMarketplaceFetchUrl(url: string): string {
  const trimmed = url.trim();
  const registryId = marketplaceRegistryIdFromUrl(trimmed);
  return registryId ? marketplaceManifestUrlForRegistry(registryId) : trimmed;
}

function normalizeMarketplaceTrust(value: unknown): MarketplaceTrustTier {
  return value === 'official' || value === 'trusted' ? value : 'restricted';
}

function normalizeMarketplaceVisibility(value: unknown): MarketplaceVisibility {
  const parsed = MarketplaceVisibilitySchema.safeParse(value);
  return parsed.success ? parsed.data : 'public';
}

function normalizeMarketplacePolicy(
  value: unknown,
  visibility: MarketplaceVisibility,
): MarketplaceSecurityPolicy {
  const parsed = MarketplaceSecurityPolicySchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (visibility === 'enterprise') return { ...STRICT_ENTERPRISE_MARKETPLACE_POLICY };
  return { ...LEGACY_PUBLIC_MARKETPLACE_POLICY };
}

function normalizeMarketplaceAuthEnv(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const normalized = value.trim().toUpperCase();
  if (!MARKETPLACE_AUTH_ENV_RE.test(normalized)) {
    throw new Error('marketplace credential environment variable must start with MONOFIELD_MARKETPLACE_TOKEN');
  }
  return normalized;
}

export async function addMarketplace(
  db: SqliteDb,
  input: AddMarketplaceInput,
): Promise<AddMarketplaceResult | AddMarketplaceFailure> {
  const url = resolveMarketplaceFetchUrl(input.url);
  if (!HTTPS_RE.test(url)) {
    return {
      ok: false,
      status: 400,
      message: 'marketplace url must use https://',
    };
  }
  const visibility = normalizeMarketplaceVisibility(input.visibility);
  const policyResult = MarketplaceSecurityPolicySchema.safeParse(
    input.policy ?? (visibility === 'enterprise'
      ? STRICT_ENTERPRISE_MARKETPLACE_POLICY
      : LEGACY_PUBLIC_MARKETPLACE_POLICY),
  );
  if (!policyResult.success) {
    return {
      ok: false,
      status: 400,
      message: 'marketplace security policy failed validation',
      errors: policyResult.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    };
  }
  const policy = policyResult.data;
  if (visibility === 'enterprise' && (policy.allowedHosts.length === 0 || policy.allowedLicenses.length === 0)) {
    return {
      ok: false,
      status: 400,
      message: 'enterprise marketplace policy requires non-empty host and license allowlists',
    };
  }
  let authEnv: string | null;
  try {
    authEnv = normalizeMarketplaceAuthEnv(input.authEnv);
  } catch (err) {
    return { ok: false, status: 400, message: (err as Error).message };
  }
  const fetcher = input.fetcher ?? defaultFetcher;
  let resp;
  try {
    resp = await fetcher(url);
  } catch (err) {
    return {
      ok: false,
      status: 502,
      message: `Fetch failed: ${(err as Error).message ?? String(err)}`,
    };
  }
  if (!resp.ok) {
    return {
      ok: false,
      status: 502,
      message: `Marketplace fetch returned ${resp.status}`,
    };
  }
  let text: string;
  try {
    text = await resp.text();
  } catch {
    return { ok: false, status: 502, message: 'Marketplace response could not be read safely' };
  }
  const parsed: MarketplaceParseResult = parseMarketplace(text);
  if (!parsed.ok) {
    return {
      ok: false,
      status: 422,
      message: 'marketplace manifest failed validation',
      errors: parsed.errors,
    };
  }
  const id = randomUUID();
  const now = Date.now();
  const trust = normalizeMarketplaceTrust(input.trust);
  db.prepare(
    `INSERT INTO plugin_marketplaces (
       id, url, spec_version, version, trust, visibility, auth_env, policy_json,
       manifest_json, added_at, refreshed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    url,
    parsed.manifest.specVersion,
    parsed.manifest.version,
    trust,
    visibility,
    authEnv,
    JSON.stringify(policy),
    text,
    now,
    now,
  );
  return {
    ok: true,
    row: {
      id,
      url,
      specVersion: parsed.manifest.specVersion,
      version: parsed.manifest.version,
      trust,
      visibility,
      authEnv,
      policy,
      manifest: parsed.manifest,
      addedAt: now,
      refreshedAt: now,
    },
    warnings: [],
  };
}

export function ensureMarketplaceManifest(
  db: SqliteDb,
  input: EnsureMarketplaceManifestInput,
): AddMarketplaceResult | AddMarketplaceFailure {
  const parsed = parseMarketplace(input.manifestText);
  if (!parsed.ok) {
    return {
      ok: false,
      status: 422,
      message: 'marketplace manifest failed validation',
      errors: parsed.errors,
    };
  }
  const now = input.now ?? Date.now();
  const trust = normalizeMarketplaceTrust(input.trust);
  const visibility = normalizeMarketplaceVisibility(input.visibility);
  const policy = normalizeMarketplacePolicy(input.policy, visibility);
  const authEnv = normalizeMarketplaceAuthEnv(input.authEnv);
  const existing = getMarketplace(db, input.id);
  db.prepare(`
    INSERT INTO plugin_marketplaces (
      id, url, spec_version, version, trust, visibility, auth_env, policy_json,
      manifest_json, added_at, refreshed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      url = excluded.url,
      spec_version = excluded.spec_version,
      version = excluded.version,
      trust = excluded.trust,
      visibility = excluded.visibility,
      auth_env = excluded.auth_env,
      policy_json = excluded.policy_json,
      manifest_json = excluded.manifest_json,
      refreshed_at = excluded.refreshed_at
  `).run(
    input.id,
    input.url,
    parsed.manifest.specVersion,
    parsed.manifest.version,
    trust,
    visibility,
    authEnv,
    JSON.stringify(policy),
    input.manifestText,
    existing?.addedAt ?? now,
    now,
  );
  return {
    ok: true,
    row: {
      id: input.id,
      url: input.url,
      specVersion: parsed.manifest.specVersion,
      version: parsed.manifest.version,
      trust,
      visibility,
      authEnv,
      policy,
      manifest: parsed.manifest,
      addedAt: existing?.addedAt ?? now,
      refreshedAt: now,
    },
    warnings: [],
  };
}

/**
 * Enrolls administrator-configured enterprise catalogs on every daemon boot.
 * This turns the allowlist into a centrally managed distribution channel:
 * employees do not need to add the company catalog on each desktop, and
 * existing rows are refreshed under the current administrator policy.
 */
export async function syncManagedMarketplaceCatalogs(
  db: SqliteDb,
  input: SyncManagedMarketplaceCatalogsInput,
): Promise<SyncManagedMarketplaceCatalogsResult> {
  const rows: MarketplaceRow[] = [];
  const failures: SyncManagedMarketplaceCatalogsResult['failures'] = [];
  const catalogUrls = [...new Set(input.catalogUrls.flatMap((url) => {
    const canonical = canonicalManagedMarketplaceCatalogUrl(url);
    return canonical ? [url.trim()] : [];
  }))];
  const policyDecision = resolveManagedMarketplacePolicy({
    marketplacePolicy: {
      allowedVisibilities: ['enterprise'],
      allowedHosts: input.allowedHosts,
      allowedLicenses: input.allowedLicenses,
      requireHttps: true,
      requireDigest: true,
      requireSignature: false,
      requireProvenance: false,
      requireSbom: false,
      requireApproval: false,
      allowDirectUrlInstall: false,
    },
    administratorAllowedHosts: input.allowedHosts,
    administratorAllowedLicenses: input.allowedLicenses,
  });
  if (!policyDecision.ok) {
    return {
      rows,
      failures: catalogUrls.map((url) => ({
        url,
        status: 403,
        message: policyDecision.reason,
      })),
    };
  }

  for (const url of catalogUrls) {
    if (!isManagedMarketplaceCatalogUrlAllowed(url, input.catalogUrls)) {
      failures.push({ url, status: 403, message: 'catalog-url-not-allowed' });
      continue;
    }
    const existing = listMarketplaces(db).find((row) =>
      isManagedMarketplaceCatalogUrlAllowed(row.url, [url]),
    );
    if (!existing) {
      const added = await addMarketplace(db, {
        url,
        fetcher: input.fetcher,
        trust: 'restricted',
        visibility: 'enterprise',
        ...(input.authEnv ? { authEnv: input.authEnv } : {}),
        policy: policyDecision.policy,
      });
      if (added.ok) rows.push(added.row);
      else failures.push({ url, status: added.status, message: added.message });
      continue;
    }

    let response;
    try {
      response = await input.fetcher(url);
    } catch (err) {
      failures.push({
        url,
        status: 502,
        message: `Fetch failed: ${(err as Error).message ?? String(err)}`,
      });
      continue;
    }
    if (!response.ok) {
      failures.push({
        url,
        status: 502,
        message: `Marketplace fetch returned ${response.status}`,
      });
      continue;
    }
    let manifestText: string;
    try {
      manifestText = await response.text();
    } catch {
      failures.push({
        url,
        status: 502,
        message: 'Marketplace response could not be read safely',
      });
      continue;
    }
    const ensured = ensureMarketplaceManifest(db, {
      id: existing.id,
      url,
      trust: 'restricted',
      visibility: 'enterprise',
      ...(input.authEnv ? { authEnv: input.authEnv } : {}),
      policy: policyDecision.policy,
      manifestText,
    });
    if (ensured.ok) rows.push(ensured.row);
    else failures.push({ url, status: ensured.status, message: ensured.message });
  }
  return { rows, failures };
}

export function listMarketplaces(db: SqliteDb): MarketplaceRow[] {
  const rows = db
    .prepare(`SELECT id, url, spec_version, version, trust, visibility, auth_env, policy_json, manifest_json, added_at, refreshed_at FROM plugin_marketplaces ORDER BY added_at ASC`)
    .all() as Array<{
      id: string;
      url: string;
      spec_version: string;
      version: string;
      trust: MarketplaceTrustTier;
      visibility: string;
      auth_env: string | null;
      policy_json: string;
      manifest_json: string;
      added_at: number;
      refreshed_at: number;
    }>;
  return rows.map((r) => {
    const manifest = safeParseManifest(r.manifest_json);
    const visibility = normalizeMarketplaceVisibility(r.visibility);
    return {
      id: r.id,
      url: r.url,
      specVersion: r.spec_version || manifest.specVersion,
      version: r.version === '0.0.0' ? manifest.version : r.version,
      trust: normalizeMarketplaceTrust(r.trust),
      visibility,
      authEnv: r.auth_env,
      policy: safeParseMarketplacePolicy(r.policy_json, visibility),
      manifest,
      addedAt: r.added_at,
      refreshedAt: r.refreshed_at,
    };
  });
}

export function getMarketplace(db: SqliteDb, id: string): MarketplaceRow | null {
  const row = db
    .prepare(`SELECT id, url, spec_version, version, trust, visibility, auth_env, policy_json, manifest_json, added_at, refreshed_at FROM plugin_marketplaces WHERE id = ?`)
    .get(id) as
      | undefined
      | {
          id: string;
          url: string;
          spec_version: string;
          version: string;
          trust: MarketplaceTrustTier;
          visibility: string;
          auth_env: string | null;
          policy_json: string;
          manifest_json: string;
          added_at: number;
          refreshed_at: number;
        };
  if (!row) return null;
  const manifest = safeParseManifest(row.manifest_json);
  const visibility = normalizeMarketplaceVisibility(row.visibility);
  return {
    id: row.id,
    url: row.url,
    specVersion: row.spec_version || manifest.specVersion,
    version: row.version === '0.0.0' ? manifest.version : row.version,
    trust: normalizeMarketplaceTrust(row.trust),
    visibility,
    authEnv: row.auth_env,
    policy: safeParseMarketplacePolicy(row.policy_json, visibility),
    manifest,
    addedAt: row.added_at,
    refreshedAt: row.refreshed_at,
  };
}

export function removeMarketplace(db: SqliteDb, id: string): boolean {
  const info = db.prepare(`DELETE FROM plugin_marketplaces WHERE id = ?`).run(id);
  return info.changes > 0;
}

export function setMarketplaceTrust(
  db: SqliteDb,
  id: string,
  trust: MarketplaceTrustTier,
): MarketplaceRow | null {
  const info = db.prepare(`UPDATE plugin_marketplaces SET trust = ? WHERE id = ?`).run(trust, id);
  if (info.changes === 0) return null;
  return getMarketplace(db, id);
}

export interface RefreshMarketplaceResult {
  ok: true;
  row: MarketplaceRow;
}

export async function refreshMarketplace(
  db: SqliteDb,
  id: string,
  fetcher?: AddMarketplaceInput['fetcher'],
): Promise<RefreshMarketplaceResult | AddMarketplaceFailure> {
  const existing = getMarketplace(db, id);
  if (!existing) {
    return { ok: false, status: 404, message: `marketplace ${id} not found` };
  }
  const useFetcher = fetcher ?? defaultFetcher;
  const url = resolveMarketplaceFetchUrl(existing.url);
  let resp;
  try {
    resp = await useFetcher(url);
  } catch (err) {
    return { ok: false, status: 502, message: `Fetch failed: ${(err as Error).message ?? String(err)}` };
  }
  if (!resp.ok) return { ok: false, status: 502, message: `Marketplace fetch returned ${resp.status}` };
  let text: string;
  try {
    text = await resp.text();
  } catch {
    return { ok: false, status: 502, message: 'Marketplace response could not be read safely' };
  }
  const parsed = parseMarketplace(text);
  if (!parsed.ok) {
    return { ok: false, status: 422, message: 'marketplace manifest failed validation', errors: parsed.errors };
  }
  const now = Date.now();
  db.prepare(`UPDATE plugin_marketplaces SET url = ?, spec_version = ?, version = ?, manifest_json = ?, refreshed_at = ? WHERE id = ?`)
    .run(url, parsed.manifest.specVersion, parsed.manifest.version, text, now, id);
  return {
    ok: true,
    row: {
      ...existing,
      url,
      specVersion: parsed.manifest.specVersion,
      version: parsed.manifest.version,
      manifest: parsed.manifest,
      refreshedAt: now,
    },
  };
}

async function defaultFetcher(url: string) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(MARKETPLACE_FETCH_TIMEOUT_MS),
  });
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MARKETPLACE_CATALOG_MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return {
      ok: false,
      status: 413,
      text: async () => '',
    };
  }
  return {
    ok: response.ok,
    status: response.status,
    text: () => readMarketplaceResponseText(response, MARKETPLACE_CATALOG_MAX_BYTES),
  };
}

async function readMarketplaceResponseText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('marketplace catalog size limit exceeded');
        throw new Error('marketplace catalog size limit exceeded');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function safeParseMarketplacePolicy(
  raw: string | null | undefined,
  visibility: MarketplaceVisibility,
): MarketplaceSecurityPolicy {
  if (raw) {
    try {
      return normalizeMarketplacePolicy(JSON.parse(raw), visibility);
    } catch {
      // Fall back to the visibility-specific default for legacy/corrupt rows.
    }
  }
  return normalizeMarketplacePolicy(undefined, visibility);
}

function safeParseManifest(raw: string): MarketplaceManifest {
  try {
    const parsed = parseMarketplace(raw);
    if (parsed.ok) return parsed.manifest;
  } catch {
    // fall through
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('legacy marketplace manifest is not an object');
    }
    const legacy = parsed as Record<string, unknown>;
    const metadata = typeof legacy['metadata'] === 'object' && legacy['metadata'] !== null
      ? legacy['metadata'] as Record<string, unknown>
      : {};
    const plugins = Array.isArray(legacy?.['plugins'])
      ? (legacy['plugins'] as unknown[]).flatMap((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
          const obj = entry as Record<string, unknown>;
          const name = typeof obj['name'] === 'string' ? obj['name'] : '';
          const source = typeof obj['source'] === 'string' ? obj['source'] : '';
          if (!name || !source) return [];
          return [{
            ...obj,
            name,
            source,
            version: typeof obj['version'] === 'string' && obj['version'].length > 0
              ? obj['version']
              : '0.0.0',
          }];
        })
      : [];
    return {
      ...legacy,
      specVersion: typeof legacy['specVersion'] === 'string'
        ? legacy['specVersion'] as string
        : MONOFIELD_PLUGIN_SPEC_VERSION,
      name: typeof legacy['name'] === 'string' ? legacy['name'] as string : 'unknown',
      version: typeof legacy['version'] === 'string' && (legacy['version'] as string).length > 0
        ? legacy['version'] as string
        : typeof metadata['version'] === 'string' && metadata['version'].length > 0
          ? metadata['version']
          : '0.0.0',
      plugins,
    } as MarketplaceManifest;
  } catch {
    // fall through
  }
  // Last-resort fallback: return a minimal shape so the caller doesn't
  // explode if a database row was stored before a schema patch.
  return {
    specVersion: MONOFIELD_PLUGIN_SPEC_VERSION,
    name: 'unknown',
    version: '0.0.0',
    plugins: [],
  } as MarketplaceManifest;
}

// Plan section 3.F3 / spec sections 7.2 and 6 - resolve a bare plugin name through
// every configured marketplace. Returns the first match (marketplace
// scan order matches `listMarketplaces` output, which is sorted by
// `added_at` ASC). The match carries the marketplace id (so audit
// trails record which catalog the install came from) and the resolved
// `source` string the installer can re-feed into `installPlugin()`.
//
// `restricted` marketplaces still resolve names; the plugin install
// path does NOT auto-trust the resulting plugin (it stays
// `restricted` per spec section 9 unless the marketplace was explicitly
// `trusted` at add-time).
export interface ResolvedPluginEntry {
  marketplaceId: string;
  marketplaceUrl: string;
  marketplaceTrust: MarketplaceTrustTier;
  marketplaceVisibility: MarketplaceVisibility;
  marketplaceAuthEnv: string | null;
  marketplacePolicy: MarketplaceSecurityPolicy;
  marketplaceSpecVersion: string;
  marketplaceVersion: string;
  pluginName: string;
  pluginVersion: string;
  source: string;
  packageKind: MarketplacePackageKind;
  license?: string;
  supplyChain?: MarketplaceSupplyChainReferences;
  ref?: string;
  manifestDigest?: string;
  archiveIntegrity?: string;
  description?: string;
}

export function resolvePluginInMarketplaces(
  db: SqliteDb,
  pluginName: string,
  options: { allowedVisibilities?: readonly MarketplaceVisibility[] } = {},
): ResolvedPluginEntry | null {
  const allowedVisibilities = options.allowedVisibilities == null
    ? null
    : new Set(options.allowedVisibilities);
  const rows = listMarketplaces(db).filter((row) =>
    allowedVisibilities == null || allowedVisibilities.has(row.visibility),
  );
  const specifier = parsePluginSpecifier(pluginName);
  const target = specifier.name.trim().toLowerCase();
  if (!target) return null;
  for (const row of rows) {
    const entries = row.manifest.plugins ?? [];
    for (const entry of entries) {
      if (entry.name && entry.name.toLowerCase() === target) {
        const resolvedVersion = resolveMarketplaceEntryVersion(entry, specifier.range);
        if (!resolvedVersion) continue;
        const result: ResolvedPluginEntry = {
          marketplaceId:    row.id,
          marketplaceUrl:   row.url,
          marketplaceTrust: row.trust,
          marketplaceVisibility: row.visibility,
          marketplaceAuthEnv: row.authEnv,
          marketplacePolicy: row.policy,
          marketplaceSpecVersion: row.specVersion,
          marketplaceVersion: row.version,
          pluginName:       entry.name,
          pluginVersion:    resolvedVersion.version,
          source:           resolvedVersion.source,
          packageKind:      entry.packageKind ?? 'plugin',
        };
        const versionRecord = entry.versions?.find((version) => version.version === resolvedVersion.version);
        result.packageKind = versionRecord?.packageKind ?? entry.packageKind ?? 'plugin';
        if (entry.license) result.license = entry.license;
        const supplyChain = versionRecord?.supplyChain ?? entry.supplyChain;
        if (supplyChain) result.supplyChain = supplyChain;
        if (resolvedVersion.ref) result.ref = resolvedVersion.ref;
        if (resolvedVersion.manifestDigest) result.manifestDigest = resolvedVersion.manifestDigest;
        if (resolvedVersion.archiveIntegrity) result.archiveIntegrity = resolvedVersion.archiveIntegrity;
        if (entry.description) result.description = entry.description;
        return result;
      }
    }
  }
  return null;
}

function unresolvedEvidence(
  reference: { ref: string; digest?: string | undefined } | undefined,
): MarketplacePackageEvidence['signature'] {
  if (!reference) return { state: 'missing' };
  return {
    state: 'unknown',
    reference: reference.ref,
    ...(reference.digest ? { subjectDigest: reference.digest } : {}),
  };
}

/**
 * Builds fail-closed pre-install evidence. Publisher-provided references are
 * deliberately `unknown`; a registry adapter or local verifier must replace
 * them with `satisfied` evidence. Archive digest verification is completed by
 * the installer after download and before extraction.
 */
export function marketplaceEvidenceForResolution(
  resolved: ResolvedPluginEntry,
): MarketplacePackageEvidence {
  return {
    packageId: resolved.pluginName,
    packageKind: resolved.packageKind,
    version: resolved.pluginVersion,
    visibility: resolved.marketplaceVisibility,
    sourceUrl: resolved.source,
    directUrl: false,
    ...(resolved.license ? { license: resolved.license } : {}),
    digest: resolved.archiveIntegrity
      ? { state: 'unknown', value: resolved.archiveIntegrity }
      : { state: 'missing' },
    signature: unresolvedEvidence(resolved.supplyChain?.signature),
    provenance: unresolvedEvidence(resolved.supplyChain?.provenance),
    sbom: unresolvedEvidence(resolved.supplyChain?.sbom),
    approval: unresolvedEvidence(resolved.supplyChain?.approval),
  };
}

export function evaluateResolvedMarketplacePlugin(
  resolved: ResolvedPluginEntry,
  evidence: MarketplacePackageEvidence = marketplaceEvidenceForResolution(resolved),
): MarketplacePolicyEvaluation {
  return evaluateMarketplacePackagePolicy(resolved.marketplacePolicy, evidence);
}
