import { z } from 'zod';
import {
  LocalizedTextSchema,
  MONOFIELD_PLUGIN_SPEC_VERSION,
  MonoFieldSpecVersionSchema,
} from './manifest.js';
import { MarketplacePackageKindSchema } from './marketplace-policy.js';

export const MarketplaceOciDistributionSchema = z.object({
  reference: z.string().min(1),
  digest:    z.string().min(1),
  mediaType: z.string().min(1).optional(),
}).passthrough();
export type MarketplaceOciDistribution = z.infer<typeof MarketplaceOciDistributionSchema>;

export const MarketplaceSupplyChainReferenceSchema = z.object({
  ref:       z.string().min(1),
  digest:    z.string().min(1).optional(),
  mediaType: z.string().min(1).optional(),
}).passthrough();
export type MarketplaceSupplyChainReference = z.infer<
  typeof MarketplaceSupplyChainReferenceSchema
>;

/**
 * Publisher-provided locations only. Installers must verify these references
 * and construct MarketplacePackageEvidence locally before applying policy.
 */
export const MarketplaceSupplyChainReferencesSchema = z.object({
  signature:  MarketplaceSupplyChainReferenceSchema.optional(),
  provenance: MarketplaceSupplyChainReferenceSchema.optional(),
  sbom:       MarketplaceSupplyChainReferenceSchema.optional(),
  approval:   MarketplaceSupplyChainReferenceSchema.optional(),
}).passthrough();
export type MarketplaceSupplyChainReferences = z.infer<
  typeof MarketplaceSupplyChainReferencesSchema
>;

export const MarketplaceEntryDistSchema = z.object({
  type:           z.string().optional(),
  archive:        z.string().optional(),
  integrity:      z.string().optional(),
  manifestDigest: z.string().optional(),
  oci:            MarketplaceOciDistributionSchema.optional(),
}).passthrough();

export const MarketplacePluginVersionSchema = z.object({
  version:        z.string().min(1),
  packageKind:    MarketplacePackageKindSchema.optional(),
  source:         z.string().min(1).optional(),
  ref:            z.string().optional(),
  dist:           MarketplaceEntryDistSchema.optional(),
  supplyChain:    MarketplaceSupplyChainReferencesSchema.optional(),
  integrity:      z.string().optional(),
  manifestDigest: z.string().optional(),
  deprecated:     z.union([z.boolean(), z.string()]).optional(),
  yanked:         z.boolean().optional(),
  yankedAt:       z.string().optional(),
  yankReason:     z.string().optional(),
}).passthrough();

export type MarketplacePluginVersion = z.infer<typeof MarketplacePluginVersionSchema>;

// `open-design-marketplace.json` schema (v1). Mirrors
// `docs/schemas/open-design.marketplace.v1.json`. The federated catalog
// format is intentionally permissive — community catalogs can carry extra
// fields (e.g. clawhub category tags) without breaking OD installs.
export const MarketplacePluginEntrySchema = z.object({
  name:        z.string().min(1),
  packageKind: MarketplacePackageKindSchema.optional(),
  source:      z.string().min(1),
  version:     z.string().min(1),
  ref:         z.string().optional(),
  dist:        MarketplaceEntryDistSchema.optional(),
  supplyChain: MarketplaceSupplyChainReferencesSchema.optional(),
  versions:    z.array(MarketplacePluginVersionSchema).optional(),
  distTags:    z.record(z.string()).optional(),
  integrity:   z.string().optional(),
  manifestDigest: z.string().optional(),
  publisher: z.object({
    id:     z.string().optional(),
    github: z.string().optional(),
    url:    z.string().optional(),
  }).passthrough().optional(),
  homepage:    z.string().optional(),
  license:     z.string().optional(),
  capabilitiesSummary: z.array(z.string()).optional(),
  deprecated:  z.union([z.boolean(), z.string()]).optional(),
  yanked:      z.boolean().optional(),
  yankedAt:    z.string().optional(),
  yankReason:  z.string().optional(),
  tags:        z.array(z.string()).optional(),
  title:       z.string().optional(),
  title_i18n:  LocalizedTextSchema.optional(),
  description: z.string().optional(),
  description_i18n: LocalizedTextSchema.optional(),
  icon:        z.string().optional(),
}).passthrough();

export type MarketplacePluginEntry = z.infer<typeof MarketplacePluginEntrySchema>;

export const MarketplaceManifestSchema = z.object({
  $schema:     z.string().optional(),
  specVersion: MonoFieldSpecVersionSchema.default(MONOFIELD_PLUGIN_SPEC_VERSION),
  name:        z.string().min(1),
  version:     z.string().min(1),
  owner: z.object({
    name: z.string().optional(),
    url:  z.string().optional(),
  }).passthrough().optional(),
  metadata: z.object({
    description: z.string().optional(),
    version:     z.string().optional(),
  }).passthrough().optional(),
  plugins: z.array(MarketplacePluginEntrySchema),
}).passthrough();

export type MarketplaceManifest = z.infer<typeof MarketplaceManifestSchema>;

// Trust levels for both individual plugins and entire marketplace indexes.
// Spec §6: bundled / official-marketplace start trusted; everything else
// starts restricted unless an operator explicitly elevates it.
export const TrustTierSchema = z.enum(['bundled', 'trusted', 'restricted']);
export type TrustTier = z.infer<typeof TrustTierSchema>;

export const MarketplaceTrustSchema = z.enum(['official', 'trusted', 'restricted']);
export type MarketplaceTrust = z.infer<typeof MarketplaceTrustSchema>;
