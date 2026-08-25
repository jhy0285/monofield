import { z } from 'zod';

/** Package types that can be distributed through an MonoField marketplace. */
export const MarketplacePackageKindSchema = z.enum([
  'plugin',
  'skill',
  'template',
  'mcp-server',
]);
export type MarketplacePackageKind = z.infer<typeof MarketplacePackageKindSchema>;

/** Who can discover the registry entry. Access control remains the registry's responsibility. */
export const MarketplaceVisibilitySchema = z.enum(['private', 'enterprise', 'public']);
export type MarketplaceVisibility = z.infer<typeof MarketplaceVisibilitySchema>;

const AllowedHostSchema = z.string().trim().min(1).refine(
  (value) => {
    const hostname = value.startsWith('*.') ? value.slice(2) : value;
    return (
      hostname.length > 0 &&
      !hostname.includes('://') &&
      !/[\s/@:[\]]/.test(hostname) &&
      hostname.split('.').every((label) =>
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
      )
    );
  },
  'Expected a hostname or a wildcard subdomain such as *.corp.example',
);

/**
 * A local administrator policy. This object must never be accepted from a
 * remote marketplace manifest because the publisher is not a trust-policy
 * authority.
 */
export const MarketplaceSecurityPolicySchema = z.object({
  allowedVisibilities: z.array(MarketplaceVisibilitySchema).min(1)
    .default(['enterprise', 'private']),
  allowedHosts: z.array(AllowedHostSchema).default([]),
  allowedLicenses: z.array(z.string().trim().min(1)).default([]),
  requireHttps: z.boolean().default(true),
  requireDigest: z.boolean().default(true),
  requireSignature: z.boolean().default(true),
  requireProvenance: z.boolean().default(true),
  requireSbom: z.boolean().default(true),
  requireApproval: z.boolean().default(true),
  allowDirectUrlInstall: z.boolean().default(false),
}).strict();
export type MarketplaceSecurityPolicy = z.infer<typeof MarketplaceSecurityPolicySchema>;

/**
 * A status reported by a registry adapter, local verifier, or approval
 * service. `satisfied` is metadata supplied to this pure evaluator; it does
 * not mean this module performed cryptographic verification.
 */
export const MarketplaceEvidenceStateSchema = z.enum([
  'satisfied',
  'missing',
  'failed',
  'unknown',
]);
export type MarketplaceEvidenceState = z.infer<typeof MarketplaceEvidenceStateSchema>;

export const MarketplaceEvidenceRecordSchema = z.object({
  state: MarketplaceEvidenceStateSchema,
  checkedBy: z.string().trim().min(1).optional(),
  checkedAt: z.string().datetime({ offset: true }).optional(),
  reference: z.string().trim().min(1).optional(),
  subjectDigest: z.string().trim().min(1).optional(),
}).strict();
export type MarketplaceEvidenceRecord = z.infer<typeof MarketplaceEvidenceRecordSchema>;

export const MarketplaceDigestEvidenceSchema = MarketplaceEvidenceRecordSchema.extend({
  value: z.string().trim().min(1).optional(),
});
export type MarketplaceDigestEvidence = z.infer<typeof MarketplaceDigestEvidenceSchema>;

/**
 * The install candidate plus locally collected/reported supply-chain status.
 * Remote catalog references must be resolved and checked before a caller marks
 * an evidence item as `satisfied`.
 */
export const MarketplacePackageEvidenceSchema = z.object({
  packageId: z.string().trim().min(1),
  packageKind: MarketplacePackageKindSchema,
  version: z.string().trim().min(1),
  visibility: MarketplaceVisibilitySchema,
  sourceUrl: z.string().trim().min(1),
  directUrl: z.boolean().default(false),
  license: z.string().trim().min(1).optional(),
  digest: MarketplaceDigestEvidenceSchema.optional(),
  signature: MarketplaceEvidenceRecordSchema.optional(),
  provenance: MarketplaceEvidenceRecordSchema.optional(),
  sbom: MarketplaceEvidenceRecordSchema.optional(),
  approval: MarketplaceEvidenceRecordSchema.optional(),
}).strict();
export type MarketplacePackageEvidence = z.infer<typeof MarketplacePackageEvidenceSchema>;

export const MarketplacePolicyFindingCodeSchema = z.enum([
  'INVALID_POLICY',
  'INVALID_EVIDENCE',
  'VISIBILITY_NOT_ALLOWED',
  'SOURCE_URL_INVALID',
  'HTTPS_REQUIRED',
  'HOST_NOT_ALLOWED',
  'DIRECT_URL_NOT_ALLOWED',
  'LICENSE_REQUIRED',
  'LICENSE_NOT_ALLOWED',
  'DIGEST_REQUIRED',
  'DIGEST_INVALID',
  'DIGEST_EVIDENCE_FAILED',
  'SIGNATURE_REQUIRED',
  'SIGNATURE_EVIDENCE_FAILED',
  'PROVENANCE_REQUIRED',
  'PROVENANCE_EVIDENCE_FAILED',
  'SBOM_REQUIRED',
  'SBOM_EVIDENCE_FAILED',
  'APPROVAL_REQUIRED',
  'APPROVAL_EVIDENCE_FAILED',
]);
export type MarketplacePolicyFindingCode = z.infer<typeof MarketplacePolicyFindingCodeSchema>;

export const MarketplacePolicyFindingSchema = z.object({
  code: MarketplacePolicyFindingCodeSchema,
  severity: z.literal('blocking'),
  field: z.string().min(1),
  message: z.string().min(1),
}).strict();
export type MarketplacePolicyFinding = z.infer<typeof MarketplacePolicyFindingSchema>;

export const MarketplacePolicyEvaluationSchema = z.object({
  installable: z.boolean(),
  findings: z.array(MarketplacePolicyFindingSchema),
}).strict();
export type MarketplacePolicyEvaluation = z.infer<typeof MarketplacePolicyEvaluationSchema>;

/**
 * A deliberately closed default. An administrator must populate host and
 * license allowlists before any package can pass it.
 */
export const STRICT_ENTERPRISE_MARKETPLACE_POLICY: MarketplaceSecurityPolicy =
  MarketplaceSecurityPolicySchema.parse({});

interface ParsedSourceUrl {
  scheme: string;
  host: string;
}

function parseSourceUrl(value: string): ParsedSourceUrl | null {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)/i.exec(value);
  if (!match) return null;

  const scheme = match[1]?.toLowerCase();
  const authority = match[2];
  if (!scheme || !authority || authority.includes('@')) return null;

  let host: string;
  if (authority.startsWith('[')) {
    const closingBracket = authority.indexOf(']');
    if (closingBracket <= 1) return null;
    host = authority.slice(1, closingBracket);
    const suffix = authority.slice(closingBracket + 1);
    if (suffix !== '' && !/^:\d+$/.test(suffix)) return null;
  } else {
    const segments = authority.split(':');
    if (segments.length > 2) return null;
    host = segments[0] ?? '';
    if (segments.length === 2 && !/^\d+$/.test(segments[1] ?? '')) return null;
  }

  host = host.trim().toLowerCase().replace(/\.$/, '');
  if (host.length === 0) return null;
  return { scheme, host };
}

function isHostAllowed(host: string, patterns: readonly string[]): boolean {
  const normalizedHost = host.toLowerCase().replace(/\.$/, '');
  return patterns.some((rawPattern) => {
    const pattern = rawPattern.trim().toLowerCase().replace(/\.$/, '');
    if (!pattern.startsWith('*.')) return normalizedHost === pattern;
    const suffix = pattern.slice(2);
    return normalizedHost.length > suffix.length && normalizedHost.endsWith(`.${suffix}`);
  });
}

function isLicenseAllowed(license: string, allowedLicenses: readonly string[]): boolean {
  const normalizedLicense = license.trim().toLowerCase();
  return allowedLicenses.some(
    (allowedLicense) => allowedLicense.trim().toLowerCase() === normalizedLicense,
  );
}

function hasSatisfiedEvidence(record: MarketplaceEvidenceRecord | undefined): boolean {
  return record?.state === 'satisfied' && Boolean(record.checkedBy?.trim());
}

function finding(
  code: MarketplacePolicyFindingCode,
  field: string,
  message: string,
): MarketplacePolicyFinding {
  return { code, severity: 'blocking', field, message };
}

/**
 * Evaluates only policy metadata. Digest/signature/provenance/SBOM validation
 * must be performed by the installer or registry adapter before constructing
 * `MarketplacePackageEvidence`.
 */
export function evaluateMarketplacePackagePolicy(
  policy: MarketplaceSecurityPolicy,
  evidence: MarketplacePackageEvidence,
): MarketplacePolicyEvaluation {
  const parsedPolicy = MarketplaceSecurityPolicySchema.safeParse(policy);
  const parsedEvidence = MarketplacePackageEvidenceSchema.safeParse(evidence);
  const findings: MarketplacePolicyFinding[] = [];

  if (!parsedPolicy.success) {
    findings.push(finding('INVALID_POLICY', 'policy', 'Marketplace security policy is invalid.'));
  }
  if (!parsedEvidence.success) {
    findings.push(finding('INVALID_EVIDENCE', 'evidence', 'Marketplace package evidence is invalid.'));
  }
  if (!parsedPolicy.success || !parsedEvidence.success) {
    return { installable: false, findings };
  }

  const resolvedPolicy = parsedPolicy.data;
  const resolvedEvidence = parsedEvidence.data;

  if (!resolvedPolicy.allowedVisibilities.includes(resolvedEvidence.visibility)) {
    findings.push(finding(
      'VISIBILITY_NOT_ALLOWED',
      'visibility',
      `Marketplace visibility "${resolvedEvidence.visibility}" is not allowed.`,
    ));
  }

  const source = parseSourceUrl(resolvedEvidence.sourceUrl);
  if (!source) {
    findings.push(finding(
      'SOURCE_URL_INVALID',
      'sourceUrl',
      'Marketplace source must be an absolute URL without embedded credentials.',
    ));
  } else {
    if (resolvedPolicy.requireHttps && source.scheme !== 'https') {
      findings.push(finding(
        'HTTPS_REQUIRED',
        'sourceUrl',
        'Marketplace source must use HTTPS.',
      ));
    }
    if (!isHostAllowed(source.host, resolvedPolicy.allowedHosts)) {
      findings.push(finding(
        'HOST_NOT_ALLOWED',
        'sourceUrl',
        `Marketplace host "${source.host}" is not allowed.`,
      ));
    }
  }

  if (resolvedEvidence.directUrl && !resolvedPolicy.allowDirectUrlInstall) {
    findings.push(finding(
      'DIRECT_URL_NOT_ALLOWED',
      'directUrl',
      'Direct URL installation is disabled by policy.',
    ));
  }

  if (!resolvedEvidence.license) {
    findings.push(finding(
      'LICENSE_REQUIRED',
      'license',
      'Package license metadata is required.',
    ));
  } else if (!isLicenseAllowed(resolvedEvidence.license, resolvedPolicy.allowedLicenses)) {
    findings.push(finding(
      'LICENSE_NOT_ALLOWED',
      'license',
      `Package license "${resolvedEvidence.license}" is not allowed.`,
    ));
  }

  if (resolvedEvidence.digest?.state === 'failed') {
    findings.push(finding(
      'DIGEST_EVIDENCE_FAILED',
      'digest',
      'Artifact digest evidence reports a failed check.',
    ));
  } else if (resolvedPolicy.requireDigest && !hasSatisfiedEvidence(resolvedEvidence.digest)) {
    findings.push(finding('DIGEST_REQUIRED', 'digest', 'Satisfied artifact digest evidence is required.'));
  } else if (
    resolvedEvidence.digest?.state === 'satisfied' &&
    !/^[a-z][a-z0-9+._-]*:[a-f0-9]{32,}$/i.test(resolvedEvidence.digest.value ?? '')
  ) {
    findings.push(finding(
      'DIGEST_INVALID',
      'digest.value',
      'Satisfied digest evidence must include an algorithm-prefixed hexadecimal digest.',
    ));
  }

  const evidenceRequirements = [
    ['signature', resolvedPolicy.requireSignature, 'SIGNATURE_REQUIRED', 'SIGNATURE_EVIDENCE_FAILED'],
    ['provenance', resolvedPolicy.requireProvenance, 'PROVENANCE_REQUIRED', 'PROVENANCE_EVIDENCE_FAILED'],
    ['sbom', resolvedPolicy.requireSbom, 'SBOM_REQUIRED', 'SBOM_EVIDENCE_FAILED'],
    ['approval', resolvedPolicy.requireApproval, 'APPROVAL_REQUIRED', 'APPROVAL_EVIDENCE_FAILED'],
  ] as const;

  for (const [field, required, requiredCode, failedCode] of evidenceRequirements) {
    const record = resolvedEvidence[field];
    if (record?.state === 'failed') {
      findings.push(finding(
        failedCode,
        field,
        `${field[0]?.toUpperCase()}${field.slice(1)} evidence reports a failed check.`,
      ));
    } else if (required && !hasSatisfiedEvidence(record)) {
      findings.push(finding(
        requiredCode,
        field,
        `Satisfied ${field} evidence is required.`,
      ));
    }
  }

  return { installable: findings.length === 0, findings };
}
