import { describe, expect, it } from 'vitest';
import {
  MarketplacePackageEvidenceSchema,
  MarketplacePackageKindSchema,
  MarketplacePluginEntrySchema,
  MarketplaceSecurityPolicySchema,
  MarketplaceVisibilitySchema,
  STRICT_ENTERPRISE_MARKETPLACE_POLICY,
  evaluateMarketplacePackagePolicy,
  type MarketplacePackageEvidence,
  type MarketplacePolicyFindingCode,
  type MarketplaceSecurityPolicy,
} from '../src/plugins/index.js';

const digest = `sha256:${'a'.repeat(64)}`;
const satisfied = {
  state: 'satisfied' as const,
  checkedBy: 'open-docs-local-verifier',
  checkedAt: '2026-08-06T07:00:00+00:00',
};

const enterprisePolicy = MarketplaceSecurityPolicySchema.parse({
  allowedHosts: ['registry.corp.example'],
  allowedLicenses: ['Apache-2.0', 'LicenseRef-Company-Proprietary'],
});

const completeEvidence = MarketplacePackageEvidenceSchema.parse({
  packageId: 'platform/order-spec',
  packageKind: 'template',
  version: '1.2.3',
  visibility: 'enterprise',
  sourceUrl: 'https://registry.corp.example/v2/platform/order-spec/manifests/1.2.3',
  license: 'Apache-2.0',
  digest: { ...satisfied, value: digest },
  signature: satisfied,
  provenance: satisfied,
  sbom: satisfied,
  approval: satisfied,
});

function findingCodes(
  policy: MarketplaceSecurityPolicy,
  evidence: MarketplacePackageEvidence,
): MarketplacePolicyFindingCode[] {
  return evaluateMarketplacePackagePolicy(policy, evidence).findings.map(({ code }) => code);
}

describe('enterprise marketplace policy contracts', () => {
  it('models every distributable package kind and registry visibility', () => {
    expect(MarketplacePackageKindSchema.options).toEqual([
      'plugin',
      'skill',
      'template',
      'mcp-server',
    ]);
    expect(MarketplaceVisibilitySchema.options).toEqual(['private', 'enterprise', 'public']);
  });

  it('provides a strict default that remains closed until allowlists are configured', () => {
    expect(STRICT_ENTERPRISE_MARKETPLACE_POLICY).toMatchObject({
      allowedHosts: [],
      allowedLicenses: [],
      allowedVisibilities: ['enterprise', 'private'],
      requireHttps: true,
      requireDigest: true,
      requireSignature: true,
      requireProvenance: true,
      requireSbom: true,
      requireApproval: true,
      allowDirectUrlInstall: false,
    });

    const result = evaluateMarketplacePackagePolicy(
      STRICT_ENTERPRISE_MARKETPLACE_POLICY,
      completeEvidence,
    );
    expect(result.installable).toBe(false);
    expect(result.findings.map(({ code }) => code)).toEqual([
      'HOST_NOT_ALLOWED',
      'LICENSE_NOT_ALLOWED',
    ]);
  });

  it('allows a package only when every required evidence item is reported satisfied', () => {
    expect(evaluateMarketplacePackagePolicy(enterprisePolicy, completeEvidence)).toEqual({
      installable: true,
      findings: [],
    });
  });

  it('blocks disallowed visibility, transport, host, direct URL, and license deterministically', () => {
    const unsafeEvidence = MarketplacePackageEvidenceSchema.parse({
      ...completeEvidence,
      visibility: 'public',
      sourceUrl: 'http://public.example/package.tgz',
      directUrl: true,
      license: 'GPL-3.0-only',
    });

    expect(findingCodes(enterprisePolicy, unsafeEvidence)).toEqual([
      'VISIBILITY_NOT_ALLOWED',
      'HTTPS_REQUIRED',
      'HOST_NOT_ALLOWED',
      'DIRECT_URL_NOT_ALLOWED',
      'LICENSE_NOT_ALLOWED',
    ]);
  });

  it('fails closed when required supply-chain or approval status is missing', () => {
    const incompleteEvidence = MarketplacePackageEvidenceSchema.parse({
      packageId: 'platform/order-spec',
      packageKind: 'template',
      version: '1.2.3',
      visibility: 'enterprise',
      sourceUrl: 'https://registry.corp.example/package',
      license: 'Apache-2.0',
    });

    expect(findingCodes(enterprisePolicy, incompleteEvidence)).toEqual([
      'DIGEST_REQUIRED',
      'SIGNATURE_REQUIRED',
      'PROVENANCE_REQUIRED',
      'SBOM_REQUIRED',
      'APPROVAL_REQUIRED',
    ]);
  });

  it('does not treat an un-attributed satisfied status as verified evidence', () => {
    const unattributedEvidence = MarketplacePackageEvidenceSchema.parse({
      ...completeEvidence,
      signature: { state: 'satisfied' },
    });
    expect(findingCodes(enterprisePolicy, unattributedEvidence)).toContain('SIGNATURE_REQUIRED');
  });

  it('blocks explicitly failed evidence even when that evidence type is optional', () => {
    const permissivePolicy = MarketplaceSecurityPolicySchema.parse({
      allowedVisibilities: ['public'],
      allowedHosts: ['downloads.example'],
      allowedLicenses: ['MIT'],
      requireDigest: false,
      requireSignature: false,
      requireProvenance: false,
      requireSbom: false,
      requireApproval: false,
      allowDirectUrlInstall: true,
    });
    const failedEvidence = MarketplacePackageEvidenceSchema.parse({
      packageId: 'shared/example',
      packageKind: 'skill',
      version: '1.0.0',
      visibility: 'public',
      sourceUrl: 'https://downloads.example/example.tgz',
      directUrl: true,
      license: 'MIT',
      signature: { state: 'failed', checkedBy: 'local-verifier' },
    });

    expect(findingCodes(permissivePolicy, failedEvidence)).toEqual([
      'SIGNATURE_EVIDENCE_FAILED',
    ]);
  });

  it('supports wildcard subdomains without implicitly allowing the parent domain', () => {
    const wildcardPolicy = MarketplaceSecurityPolicySchema.parse({
      ...enterprisePolicy,
      allowedHosts: ['*.corp.example'],
    });
    const child = MarketplacePackageEvidenceSchema.parse({
      ...completeEvidence,
      sourceUrl: 'https://registry.corp.example/package',
    });
    const parent = MarketplacePackageEvidenceSchema.parse({
      ...completeEvidence,
      sourceUrl: 'https://corp.example/package',
    });

    expect(evaluateMarketplacePackagePolicy(wildcardPolicy, child).installable).toBe(true);
    expect(findingCodes(wildcardPolicy, parent)).toContain('HOST_NOT_ALLOWED');
  });

  it('returns blocking findings instead of throwing for malformed runtime inputs', () => {
    const result = evaluateMarketplacePackagePolicy(
      { allowedHosts: ['https://registry.example'] } as MarketplaceSecurityPolicy,
      { packageId: '' } as MarketplacePackageEvidence,
    );

    expect(result.installable).toBe(false);
    expect(result.findings.map(({ code }) => code)).toEqual([
      'INVALID_POLICY',
      'INVALID_EVIDENCE',
    ]);
  });

  it('keeps legacy entries valid and accepts OCI and supply-chain references', () => {
    expect(MarketplacePluginEntrySchema.safeParse({
      name: 'legacy/plugin',
      source: 'github:company/plugin',
      version: '1.0.0',
    }).success).toBe(true);

    const entry = MarketplacePluginEntrySchema.parse({
      name: 'platform/order-spec',
      packageKind: 'template',
      source: 'oci:registry.corp.example/open-docs/order-spec',
      version: '1.2.3',
      license: 'LicenseRef-Company-Proprietary',
      dist: {
        oci: {
          reference: 'registry.corp.example/open-docs/order-spec:1.2.3',
          digest,
        },
      },
      supplyChain: {
        signature: { ref: 'oci://registry.corp.example/signatures/order-spec' },
        provenance: { ref: 'oci://registry.corp.example/attestations/order-spec' },
        sbom: { ref: 'oci://registry.corp.example/sbom/order-spec' },
        approval: { ref: 'approval://open-docs/order-spec/1.2.3' },
      },
      versions: [{
        version: '1.2.3',
        packageKind: 'template',
        supplyChain: {
          approval: { ref: 'approval://open-docs/order-spec/1.2.3' },
        },
      }],
    });

    expect(entry.packageKind).toBe('template');
    expect(entry.dist?.oci?.digest).toBe(digest);
    expect(entry.supplyChain?.signature?.ref).toContain('signatures');
    expect(entry.versions?.[0]?.packageKind).toBe('template');
  });
});
