import type { ResearchFindings } from '@open-design/contracts';

export const FINANCIAL_GROUNDING_REQUIRED = 'FINANCIAL_GROUNDING_REQUIRED';

export interface CurrentFinancialArtifactScope {
  workMode?: unknown;
  sessionMode?: unknown;
  structuredArtifactInstructions?: boolean;
  prompt?: unknown;
}

export interface TrustedResearchSourceEvidence {
  type: 'source_evidence';
  evidenceKind: 'research';
  trust: 'daemon_research';
  query: string;
  provider: string;
  fetchedAt: number;
  sources: Array<{
    title: string;
    url: string;
    publishedAt?: string;
  }>;
}

export interface RunEventLike {
  event?: string;
  data?: unknown;
}

const FINANCIAL_MARKET_PATTERN = /(?:주가|현재가|목표가|매수|매도|투자\s*의견|증시|주식|종목|실적\s*(?:발표|전망)|시가\s*총액|stock\s*price|share\s*price|target\s*price|buy\s*(?:rating|recommendation)?|sell\s*(?:rating|recommendation)?|investment\s*(?:rating|opinion)|earnings|market\s*outlook|equity\s*market)/iu;
const CURRENT_OR_FORECAST_PATTERN = /(?:오늘|현재|최신|실시간|최근|향후|전망|예측|일정|예정|까지|오늘부터|today|current|latest|real[ -]?time|recent|forecast|outlook|schedule|until|through|as\s+of|up[ -]?to[ -]?date)/iu;
const ARTIFACT_REQUEST_PATTERN = /(?:만들|작성|생성|제작|구축|정리해|대시보드|대쉬보드|보고서|문서|슬라이드|프레젠테이션|pptx?|dashboard|report|document|deck|presentation|create|generate|build|write|prepare|compile)/iu;
const EXPLICIT_NON_FACTUAL_PATTERN = /(?:(?:가상|임의|더미|허구|목업)\s*(?:데이터|수치|값|시세|주가)|(?:실제|실시간|현재|최신)\s*(?:데이터|시세|수치|정보).{0,16}(?:없이|사용하지|필요\s*없)|미확인\s*(?:값|수치|placeholder)|(?:fictional|dummy|mock|placeholder|unverified)\s+(?:data|values?|prices?)|without\s+(?:live|current|real)\s+(?:data|prices?))/iu;

/**
 * Deliberately narrow safety gate for artifact-producing Docs turns that ask
 * for current market facts or forecasts. Ordinary finance explanations,
 * software UIs with buy/sell buttons, and explicitly fictional/mock datasets
 * are not gated here.
 */
export function requiresCurrentFinancialArtifactGrounding(
  scope: CurrentFinancialArtifactScope,
): boolean {
  if (scope.workMode !== 'creation') return false;
  if (scope.sessionMode !== 'docs' && scope.sessionMode !== 'design') return false;
  if (scope.structuredArtifactInstructions === false) return false;
  if (typeof scope.prompt !== 'string') return false;
  const prompt = scope.prompt.trim();
  if (!prompt || EXPLICIT_NON_FACTUAL_PATTERN.test(prompt)) return false;
  return (
    ARTIFACT_REQUEST_PATTERN.test(prompt)
    && FINANCIAL_MARKET_PATTERN.test(prompt)
    && CURRENT_OR_FORECAST_PATTERN.test(prompt)
  );
}

function privateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/u, '');
  if (!host) return true;
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host.endsWith('.lan')
    || host === '::1'
    || host === '0:0:0:0:0:0:0:1'
    || (host.includes(':') && (
      host.startsWith('fc')
      || host.startsWith('fd')
      || host.startsWith('fe80:')
    ))
  ) return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((value) => value < 0 || value > 255)) return true;
  const a = octets[0]!;
  const b = octets[1]!;
  return (
    a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
  );
}

/** Remove credentials/fragments and reject non-public/non-HTTP source URLs. */
export function sanitizeExternalSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (privateOrLocalHostname(url.hostname)) return null;
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Convert a successful daemon-owned research response into an attestation.
 * The model cannot create this event: only the token-scoped research route
 * emits it into the owning run.
 */
export function trustedResearchEvidenceFromFindings(
  findings: ResearchFindings,
): TrustedResearchSourceEvidence | null {
  const seen = new Set<string>();
  const sources: TrustedResearchSourceEvidence['sources'] = [];
  for (const source of Array.isArray(findings?.sources) ? findings.sources : []) {
    const url = sanitizeExternalSourceUrl(source?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({
      title: typeof source.title === 'string' ? source.title.slice(0, 500) : '',
      url,
      ...(typeof source.publishedAt === 'string' && source.publishedAt.trim()
        ? { publishedAt: source.publishedAt.trim().slice(0, 100) }
        : {}),
    });
    if (sources.length >= 20) break;
  }
  if (sources.length === 0) return null;
  return {
    type: 'source_evidence',
    evidenceKind: 'research',
    trust: 'daemon_research',
    query: typeof findings.query === 'string' ? findings.query.slice(0, 1_000) : '',
    provider: typeof findings.provider === 'string' ? findings.provider.slice(0, 100) : 'unknown',
    fetchedAt: Number.isFinite(findings.fetchedAt) ? findings.fetchedAt : Date.now(),
    sources,
  };
}

export function hasTrustedCurrentFinancialSourceEvidence(
  events: readonly RunEventLike[],
): boolean {
  for (const record of events ?? []) {
    if (record?.event !== 'agent' || !record.data || typeof record.data !== 'object') continue;
    const evidence = record.data as Partial<TrustedResearchSourceEvidence>;
    if (
      evidence.type !== 'source_evidence'
      || evidence.evidenceKind !== 'research'
      || evidence.trust !== 'daemon_research'
      || !Number.isFinite(evidence.fetchedAt)
      || !Array.isArray(evidence.sources)
    ) continue;
    if (evidence.sources.some((source) => sanitizeExternalSourceUrl(source?.url) != null)) {
      return true;
    }
  }
  return false;
}
