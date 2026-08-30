import type { ResearchFindings } from '@open-design/contracts';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';

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

export interface FinancialGroundingTarget {
  key: string;
  label: string;
  aliases: string[];
}

export type FinancialEvidenceFacet =
  | 'current_price'
  | 'recommendation'
  | 'outlook'
  | 'event_schedule';

export interface FinancialGroundingFacetRequirement {
  facet: FinancialEvidenceFacet;
  label: string;
  freshnessDays: number;
  freshnessCutoff: number;
}

export interface FinancialGroundingRequirements {
  targets: FinancialGroundingTarget[];
  facets: FinancialGroundingFacetRequirement[];
  /** Strictest requested window, retained for compact diagnostics. */
  freshnessDays: number;
  freshnessCutoff: number;
  requestedAt: number;
}

export interface FinancialFacetAttestation {
  facet: FinancialEvidenceFacet;
  relevantSourceCount: number;
  datedSourceCount: number;
  freshSourceCount: number;
  officialPreferredSourceCount: number;
  /** Canonical public URLs whose own metadata identifies this target/facet. */
  directSourceUrls: string[];
  /** Subset of directSourceUrls within this facet's freshness window. */
  freshDirectSourceUrls: string[];
}

export interface FinancialTargetAttestation {
  key: string;
  label: string;
  relevantSourceCount: number;
  datedSourceCount: number;
  freshSourceCount: number;
  officialPreferredSourceCount: number;
  facets: FinancialFacetAttestation[];
}

/** Server-private result derived only from a token-scoped research response. */
export interface FinancialResearchAttestation {
  fetchedAt: number;
  provider: string;
  query: string;
  sourcesConsidered: number;
  targets: FinancialTargetAttestation[];
}

export interface FinancialGroundingCoverage {
  ok: boolean;
  freshnessDays: number;
  freshnessByFacet: Partial<Record<FinancialEvidenceFacet, number>>;
  missingEntities: string[];
  staleEntities: string[];
  undatedEntities: string[];
  missingFacets: string[];
  staleFacets: string[];
  undatedFacets: string[];
  missingCitations: string[];
}

const FINANCIAL_MARKET_PATTERN = /(?:주가|현재가|목표가|매수|매도|투자\s*의견|증시|주식|종목|실적\s*(?:발표|전망)|시가\s*총액|stock\s*price|share\s*price|target\s*price|buy\s*(?:rating|recommendation)?|sell\s*(?:rating|recommendation)?|investment\s*(?:rating|opinion)|earnings|market\s*outlook|equity\s*market)/iu;
const CURRENT_OR_FORECAST_PATTERN = /(?:오늘|현재|최신|실시간|최근|향후|전망|예측|일정|예정|까지|오늘부터|today|current|latest|real[ -]?time|recent|forecast|outlook|schedule|until|through|as\s+of|up[ -]?to[ -]?date)/iu;
const ARTIFACT_REQUEST_PATTERN = /(?:만들|작성|생성|제작|구축|정리해|대시보드|대쉬보드|보고서|문서|슬라이드|프레젠테이션|pptx?|dashboard|report|document|deck|presentation|create|generate|build|write|prepare|compile)/iu;
const AFFIRMATIVE_NON_FACTUAL_PATTERN = /(?:(?:가상|임의|더미|허구|목업)\s*(?:데이터|수치|값|시세|주가).{0,32}(?:사용|써|쓰|기반|만들|작성|생성)|(?:실제|실시간|현재|최신)\s*(?:데이터|시세|수치|정보).{0,16}(?:없이|필요\s*없)(?:\s|,|\.|$)|미확인\s*(?:값|수치|placeholder).{0,24}(?:사용|써|쓰|기반|만들|작성|생성)|(?:use|using|with|based\s+on)\s+(?:fictional|dummy|mock|placeholder|unverified)\s+(?:data|values?|prices?)|without\s+(?:live|current|real)\s+(?:data|prices?))/iu;
const REAL_DATA_REQUIREMENT_PATTERN = /(?:(?:가상|임의|더미|허구|목업)\s*(?:데이터|수치|값|시세|주가).{0,16}(?:쓰지|사용하지|말고|아닌|제외)|(?:실제|실시간|현재|최신)\s*(?:데이터|시세|수치|정보|주가|가격).{0,20}(?:사용|써|쓰|기반|반영|가져|조회)|(?:do\s+not|don't|without)\s+(?:use\s+)?(?:fictional|dummy|mock|placeholder|unverified)\s+(?:data|values?|prices?)|(?:use|using|with|based\s+on)\s+(?:live|current|real|latest)\s+(?:data|prices?|quotes?))/iu;
const ANAPHORIC_ARTIFACT_FOLLOWUP_PATTERN = /(?:(?:그|이|위|앞서|이전|해당)\s*(?:내용|자료|분석|결과|조사|정보|것|걸)|(?:그걸|이걸|이를|그것을)|(?:첨부(?:한|된)?|올린)\s*(?:내용|파일|자료)|(?:that|those|this|the\s+above|previous)\s+(?:content|data|analysis|result|research|information|one)|(?:attached|uploaded)\s+(?:content|file|document|data)|(?:based\s+on|using|from)\s+(?:that|those|this|the\s+above|the\s+previous))/iu;
const FINANCIAL_GROUNDING_TEXT_ATTACHMENT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.json',
  '.yaml',
  '.yml',
]);
const MAX_FINANCIAL_GROUNDING_ATTACHMENT_COUNT = 4;
const MAX_FINANCIAL_GROUNDING_ATTACHMENT_SCAN_COUNT = 32;
const MAX_FINANCIAL_GROUNDING_ATTACHMENT_BYTES = 128 * 1024;
const MAX_FINANCIAL_GROUNDING_ATTACHMENT_TOTAL_BYTES = 256 * 1024;
// Keep this grammar byte-for-byte aligned with the role-delimiter escaping in
// apps/web/src/providers/daemon.ts. Headers are a literal "## ", one accepted
// role (case-insensitive), optional ASCII horizontal padding, then LF/CRLF.
const TRANSCRIPT_USER_BLOCK_PATTERN = /(?:^|\n)## user[ \t]*\r?\n([\s\S]*?)(?=\n## (?:user|assistant|system)[ \t]*\r?(?:\n|$)|$)/giu;
const ESCAPED_TRANSCRIPT_ROLE_DELIMITER_PATTERN = /^\\(## (?:user|assistant|system)[ \t]*)(\r?)$/gim;
const CURRENT_PRICE_PATTERN = /(?:현재(?:의)?\s*(?:주가|시세)|현재가|실시간\s*(?:주가|시세)|오늘\s*(?:주가|시세)|최신\s*(?:주가|시세)|current\s+(?:stock|share)?\s*price|live\s+(?:stock|share)?\s*price|real[ -]?time\s+(?:price|quote)|latest\s+(?:stock|share)?\s*(?:price|quote))/iu;
const RECOMMENDATION_PATTERN = /(?:목표가|매수|매도|투자\s*의견|target\s*price|buy\s*(?:rating|recommendation)?|sell\s*(?:rating|recommendation)?|investment\s*(?:rating|opinion)|recommendation)/iu;
const OUTLOOK_PATTERN = /(?:전망|예측|전망치|추정치|향후\s*(?:실적|주가|흐름)|forecast|outlook|projection|estimate|guidance|scenario)/iu;
const EVENT_SCHEDULE_PATTERN = /(?:관련\s*이슈(?:\s*일정)?|이슈\s*(?:및|[·/&])?\s*일정|주요\s*일정|이벤트\s*일정|실적\s*발표\s*(?:일|일정)?|주주\s*총회|배당\s*(?:일정|기준일)|행사\s*일정|일정|event\s*(?:schedule|calendar|date)|earnings\s*(?:date|calendar|schedule)|corporate\s*calendar|schedule)/iu;
const FACET_FRESHNESS_DAYS: Record<FinancialEvidenceFacet, number> = {
  current_price: 7,
  recommendation: 90,
  outlook: 180,
  event_schedule: 180,
};
const FACET_LABELS: Record<FinancialEvidenceFacet, string> = {
  current_price: '현재 주가',
  recommendation: '매수·매도/목표가 의견',
  outlook: '전망',
  event_schedule: '관련 이슈·일정',
};
const ENTITY_LIST_SPLIT_PATTERN = /\s*(?:,|，|&|＆|\band\b|\bversus\b|\bvs\.?\b|및|그리고|와|과)\s*/iu;
const GENERIC_ENTITY_WORD_PATTERN = /^(?:나|내|우리|오늘|오늘부터|현재|최신|최근|향후|관련|시장|증시|주식|종목|기업|회사|대상|문서|보고서|대시보드|대쉬보드|슬라이드|전망|일정|의견|price|stock|share|market|equity|company|companies|report|dashboard|document|today|current|latest|recent|forecast|outlook|schedule)$/iu;
const OFFICIAL_SOURCE_HINT_PATTERN = /(?:\b(?:investor\s*relations?|filings?|exchange|disclosure|regulatory|sec)\b|\/ir(?:\/|$)|공시|거래소)/iu;
const OFFICIAL_SOURCE_HOST_PATTERN = /(?:^|\.)(?:sec\.gov|dart\.fss\.or\.kr|kind\.krx\.co\.kr|krx\.co\.kr|nasdaq\.com|nyse\.com)$/iu;
const MAX_FUTURE_PUBLICATION_SKEW_MS = 2 * 24 * 60 * 60 * 1000;
const RESERVED_EXAMPLE_HOST_PATTERN = /(?:^|\.)(?:example\.(?:com|net|org)|example|test|invalid)$/iu;

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
  if (!prompt || explicitlyRequestsNonFactualData(prompt)) return false;
  return (
    ARTIFACT_REQUEST_PATTERN.test(prompt)
    && FINANCIAL_MARKET_PATTERN.test(prompt)
    && CURRENT_OR_FORECAST_PATTERN.test(prompt)
  );
}

function explicitlyRequestsNonFactualData(prompt: string): boolean {
  // A rejection such as "더미 데이터는 쓰지 말고 실제 최신 데이터를 써줘"
  // contains the same keywords as an affirmative mock request. Real/current
  // data requirements therefore take precedence over the narrow opt-in.
  if (REAL_DATA_REQUIREMENT_PATTERN.test(prompt)) return false;
  return AFFIRMATIVE_NON_FACTUAL_PATTERN.test(prompt);
}

function transcriptUserBlocks(transcript: string): string[] {
  const blocks: string[] = [];
  for (const match of transcript.matchAll(TRANSCRIPT_USER_BLOCK_PATTERN)) {
    const block = match[1]?.trim();
    if (block) blocks.push(block);
  }
  return blocks;
}

function unescapeTranscriptRoleDelimiters(content: string): string {
  return content.replace(ESCAPED_TRANSCRIPT_ROLE_DELIMITER_PATTERN, '$1$2');
}

export function isAnaphoricArtifactFollowup(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const prompt = value.trim();
  return Boolean(
    prompt
    && ARTIFACT_REQUEST_PATTERN.test(prompt)
    && ANAPHORIC_ARTIFACT_FOLLOWUP_PATTERN.test(prompt)
    && !FINANCIAL_MARKET_PATTERN.test(prompt)
  );
}

function isPathWithin(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return relative === '' || (
    relative.length > 0
    && !relative.startsWith('..')
    && !path.isAbsolute(relative)
  );
}

/**
 * Read the small, explicitly attached text files that may supply the subject
 * of an anaphoric request. Callers must first pass the paths through
 * resolveSafeProjectAttachments; realpath containment here closes symlink and
 * race-prone outside-project aliases before any contents are exposed to the
 * grounding resolver.
 */
export async function readFinancialGroundingAttachmentTexts(
  cwd: string,
  safeAttachments: readonly string[],
): Promise<string[]> {
  if (!cwd || !Array.isArray(safeAttachments) || safeAttachments.length === 0) return [];

  let realRoot: string;
  try {
    realRoot = await realpath(cwd);
  } catch {
    return [];
  }

  const texts: string[] = [];
  let totalBytes = 0;
  for (const attachment of safeAttachments.slice(0, MAX_FINANCIAL_GROUNDING_ATTACHMENT_SCAN_COUNT)) {
    if (texts.length >= MAX_FINANCIAL_GROUNDING_ATTACHMENT_COUNT) break;
    if (typeof attachment !== 'string') continue;
    const extension = path.extname(attachment).toLocaleLowerCase('en-US');
    if (!FINANCIAL_GROUNDING_TEXT_ATTACHMENT_EXTENSIONS.has(extension)) continue;

    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      const candidate = await realpath(path.resolve(cwd, attachment));
      if (!isPathWithin(realRoot, candidate)) continue;
      handle = await open(candidate, 'r');
      const fileStat = await handle.stat();
      if (
        !fileStat.isFile()
        || fileStat.size <= 0
        || fileStat.size > MAX_FINANCIAL_GROUNDING_ATTACHMENT_BYTES
        || totalBytes + fileStat.size > MAX_FINANCIAL_GROUNDING_ATTACHMENT_TOTAL_BYTES
      ) continue;

      // Read at most the already-approved byte count. This remains bounded if
      // the file grows between stat and read.
      const buffer = Buffer.alloc(Number(fileStat.size));
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const chunk = await handle.read(
          buffer,
          bytesRead,
          buffer.length - bytesRead,
          bytesRead,
        );
        if (chunk.bytesRead === 0) break;
        bytesRead += chunk.bytesRead;
      }
      const text = new TextDecoder('utf-8', { fatal: true })
        .decode(buffer.subarray(0, bytesRead))
        .trim();
      if (!text || text.includes('\0')) continue;
      totalBytes += bytesRead;
      texts.push(text);
    } catch {
      // Attachments are optional context. Unreadable, invalid UTF-8, or files
      // swapped during validation are omitted rather than weakening the gate.
    } finally {
      await handle?.close().catch(() => {});
    }
  }
  return texts;
}

/**
 * Resolve the minimum conversation context needed by the financial gate.
 *
 * The current turn remains authoritative. We only borrow the nearest relevant
 * user block when the current turn both requests an artifact and explicitly
 * points back to prior material. This preserves the important stale-history
 * behavior: a plain "안녕" or unrelated edit never re-enables the gate merely
 * because an old market request remains in the CLI transcript. User-attached
 * text rendered inside that user block is treated the same as user prose.
 */
export function resolveFinancialGroundingPrompt(
  transcript: unknown,
  currentPrompt: unknown,
  attachmentTexts: readonly string[] = [],
): string {
  const current = typeof currentPrompt === 'string' ? currentPrompt.trim() : '';
  const legacyTranscript = typeof transcript === 'string' ? transcript.trim() : '';
  if (!current) return legacyTranscript;
  if (!isAnaphoricArtifactFollowup(current)) return current;

  const blocks = transcriptUserBlocks(legacyTranscript);
  // The current transcript block is not context for itself. Only the user
  // block immediately before it may resolve "그 내용" / "that analysis".
  // Never search farther back across an intervening unrelated user turn.
  const lastBlock = blocks.at(-1);
  const comparableLastBlock = lastBlock
    ? unescapeTranscriptRoleDelimiters(lastBlock).trim()
    : '';
  const lastBlockIsCurrent = comparableLastBlock === current
    || comparableLastBlock.startsWith(`${current}\n`)
    || comparableLastBlock.endsWith(`\n${current}`);
  const previousUserBlock = blocks.at(lastBlockIsCurrent ? -2 : -1);
  const candidates = [previousUserBlock, ...attachmentTexts];
  const relevantCandidates: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    if (
      FINANCIAL_MARKET_PATTERN.test(candidate)
      && CURRENT_OR_FORECAST_PATTERN.test(candidate)
    ) {
      relevantCandidates.push(candidate.trim());
    }
  }
  if (relevantCandidates.length > 0) {
    return `${relevantCandidates.join('\n\n')}\n\n${current}`;
  }
  return current;
}

function normalizeEntityText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function cleanEntityLabel(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/^[\s'"“”‘’([{]+|[\s'"“”‘’)\]}]+$/gu, '')
    .replace(/^(?:오늘(?:부터)?|현재|최신|최근|향후|about|for|on|regarding|covering)\s+/iu, '')
    .replace(/\s+(?:오늘(?:부터)?|현재|최신|최근|향후)$/iu, '')
    .replace(/\s+(?:에\s*대해|에\s*대한|관련|대상)$/u, '')
    .replace(/(?:의|은|는|을|를)$/u, '')
    .trim();
}

function aliasesForEntity(label: string): string[] {
  const values = new Set<string>();
  const add = (value: string) => {
    const normalized = normalizeEntityText(value);
    if (normalized.length >= 2) values.add(normalized);
  };
  add(label);
  add(label.replace(/(?:주식회사|㈜|\b(?:incorporated|corporation|corp\.?|inc\.?|ltd\.?|plc)\b)/giu, ''));
  const parenthetical = label.match(/[([]\s*([$]?[A-Z]{1,8}|\d{4,8})\s*[)\]]/u)?.[1];
  if (parenthetical) {
    add(parenthetical);
    add(label.replace(/[([]\s*([$]?[A-Z]{1,8}|\d{4,8})\s*[)\]]/gu, ''));
  }
  return [...values];
}

function addEntityCandidate(
  targets: FinancialGroundingTarget[],
  seen: Set<string>,
  raw: string,
): void {
  const label = cleanEntityLabel(raw);
  if (!label || label.length > 80 || GENERIC_ENTITY_WORD_PATTERN.test(label)) return;
  if (/^(?:만들|작성|생성|제작|정리|포함|원해|알려|please\b|create\b|make\b|build\b)/iu.test(label)) return;
  if (!/[\p{L}\p{N}]/u.test(label)) return;
  const aliases = aliasesForEntity(label);
  const key = aliases[0];
  if (!key || aliases.some((alias) => seen.has(alias))) return;
  for (const alias of aliases) seen.add(alias);
  targets.push({ key, label, aliases });
}

function candidateListsNearFinancialTerms(prompt: string): string[] {
  const lists: string[] = [];
  const financialMatch = FINANCIAL_MARKET_PATTERN.exec(prompt);
  if (financialMatch?.index != null && financialMatch.index > 0) {
    let prefix = prompt.slice(0, financialMatch.index).trim();
    const clauses = prefix.split(/[,，:：]/u);
    while (
      clauses.length > 1
      && (ARTIFACT_REQUEST_PATTERN.test(clauses[0]!)
        || /(?:느낌|원하|부탁|정리|포함|please|would\s+like)/iu.test(clauses[0]!))
    ) clauses.shift();
    prefix = clauses.join(',').trim();
    if (prefix) lists.push(prefix);
  }

  const markerPatterns = [
    /(?:대상|종목|기업)(?:은|는)?\s*[:：]?\s*([^.!?\n]{2,140}?)(?=\s*(?:의\s*)?(?:현재가|주가|목표가|매수|매도|투자\s*의견|전망|예측|일정)|[.!?\n]|$)/giu,
    /\b(?:for|on|covering|regarding)\s+([^.!?\n]{2,140}?)(?=\s+\b(?:with|through|until|from|today|current|latest|price|recommendation|forecast|outlook|schedule|dashboard|report)\b|[.!?\n]|$)/giu,
  ];
  for (const pattern of markerPatterns) {
    for (const match of prompt.matchAll(pattern)) {
      if (match[1]?.trim()) lists.push(match[1].trim());
    }
  }
  return lists;
}

function requestedFinancialFacets(prompt: string): FinancialEvidenceFacet[] {
  const facets: FinancialEvidenceFacet[] = [];
  if (CURRENT_PRICE_PATTERN.test(prompt)) facets.push('current_price');
  if (RECOMMENDATION_PATTERN.test(prompt)) facets.push('recommendation');
  if (OUTLOOK_PATTERN.test(prompt)) facets.push('outlook');
  if (EVENT_SCHEDULE_PATTERN.test(prompt)) facets.push('event_schedule');
  return facets;
}

function createFacetRequirement(
  facet: FinancialEvidenceFacet,
  requestedAt: number,
): FinancialGroundingFacetRequirement {
  const freshnessDays = FACET_FRESHNESS_DAYS[facet];
  return {
    facet,
    label: FACET_LABELS[facet],
    freshnessDays,
    freshnessCutoff: requestedAt - freshnessDays * 24 * 60 * 60 * 1000,
  };
}

/**
 * Extract explicit instruments deterministically from the user request. The
 * gate intentionally avoids model NER: ambiguous requests fail closed rather
 * than letting the model invent an attested target after the fact.
 */
export function deriveFinancialGroundingRequirements(
  prompt: string,
  requestedAt = Date.now(),
): FinancialGroundingRequirements {
  const targets: FinancialGroundingTarget[] = [];
  const seen = new Set<string>();
  for (const list of candidateListsNearFinancialTerms(prompt)) {
    for (const candidate of list.split(ENTITY_LIST_SPLIT_PATTERN)) {
      addEntityCandidate(targets, seen, candidate);
    }
  }

  for (const match of prompt.matchAll(/(?:[$][A-Z]{1,8}|\b(?:KRX|NASDAQ|NYSE|TSE|LSE):[A-Z0-9.]{1,12}\b|\b\d{6}\b)/gu)) {
    addEntityCandidate(targets, seen, match[0]);
  }
  for (const match of prompt.matchAll(/(?:코스피|코스닥|KOSPI|KOSDAQ|S&P\s*500|NASDAQ(?:\s+Composite)?|Dow\s+Jones|비트코인|이더리움|Bitcoin|Ethereum)/giu)) {
    addEntityCandidate(targets, seen, match[0]);
  }

  const facets = requestedFinancialFacets(prompt)
    .map((facet) => createFacetRequirement(facet, requestedAt));
  const freshnessDays = facets.length > 0
    ? Math.min(...facets.map((facet) => facet.freshnessDays))
    : 180;
  return {
    targets,
    facets,
    freshnessDays,
    freshnessCutoff: requestedAt - freshnessDays * 24 * 60 * 60 * 1000,
    requestedAt,
  };
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

function sourceMatchesTarget(
  sourceText: string,
  target: FinancialGroundingTarget,
): boolean {
  const normalized = normalizeEntityText(sourceText);
  return target.aliases.some((alias) => normalized.includes(alias));
}

function sourceMatchesFacet(
  sourceText: string,
  facet: FinancialEvidenceFacet,
): boolean {
  switch (facet) {
    case 'current_price':
      if (CURRENT_PRICE_PATTERN.test(sourceText)) return true;
      return !OUTLOOK_PATTERN.test(sourceText)
        && /(?:주가|시세|종가|stock\s*price|share\s*price|quote|last\s*price|closing\s*price)/iu.test(sourceText);
    case 'recommendation':
      return RECOMMENDATION_PATTERN.test(sourceText)
        || /(?:애널리스트\s*(?:평가|리포트)|analyst\s*(?:rating|report)|rating\s*(?:change|report))/iu.test(sourceText);
    case 'outlook':
      return OUTLOOK_PATTERN.test(sourceText);
    case 'event_schedule':
      return EVENT_SCHEDULE_PATTERN.test(sourceText);
  }
}

function parsedPublicationTime(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function officialPreferredSource(title: string, url: string): boolean {
  let host = '';
  let path = '';
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    path = parsed.pathname;
  } catch {
    return false;
  }
  return (
    OFFICIAL_SOURCE_HOST_PATTERN.test(host)
    || OFFICIAL_SOURCE_HINT_PATTERN.test(`${title} ${path}`)
  );
}

function reservedExampleSource(url: string): boolean {
  try {
    return RESERVED_EXAMPLE_HOST_PATTERN.test(new URL(url).hostname);
  } catch {
    return true;
  }
}

/**
 * Build a private, request-scoped coverage attestation from raw provider
 * findings. Query matches are necessary but never sufficient: a source's own
 * title/snippet/URL must name the requested target as well.
 */
export function attestFinancialResearchFindings(
  requirements: FinancialGroundingRequirements,
  findings: ResearchFindings,
  now = Date.now(),
): FinancialResearchAttestation {
  const fetchedAt = Number.isFinite(findings?.fetchedAt) ? findings.fetchedAt : 0;
  const fetchedInRun =
    fetchedAt >= requirements.requestedAt - 60_000
    && fetchedAt <= now + 60_000;
  const publicSources = (Array.isArray(findings?.sources) ? findings.sources : [])
    .map((source) => {
      const url = sanitizeExternalSourceUrl(source?.url);
      if (!url) return null;
      return {
        title: typeof source.title === 'string' ? source.title : '',
        snippet: typeof source.snippet === 'string' ? source.snippet : '',
        url,
        publishedAt: parsedPublicationTime(source.publishedAt),
      };
    })
    .filter((source): source is NonNullable<typeof source> => source != null);
  const query = typeof findings?.query === 'string' ? findings.query : '';

  return {
    fetchedAt,
    provider: typeof findings?.provider === 'string' ? findings.provider : 'unknown',
    query: query.slice(0, 1_000),
    sourcesConsidered: fetchedInRun ? publicSources.length : 0,
    targets: requirements.targets.map((target) => {
      const queryMatches = sourceMatchesTarget(query, target);
      const facets = requirements.facets.map((facetRequirement) => {
        const directSourceUrls = new Set<string>();
        const freshDirectSourceUrls = new Set<string>();
        let datedSourceCount = 0;
        let officialPreferredSourceCount = 0;
        if (fetchedInRun && queryMatches) {
          for (const source of publicSources) {
            if (reservedExampleSource(source.url)) continue;
            const sourceText = `${source.title} ${source.snippet} ${source.url}`;
            if (!sourceMatchesTarget(sourceText, target)) continue;
            if (!sourceMatchesFacet(sourceText, facetRequirement.facet)) continue;
            if (directSourceUrls.has(source.url)) continue;
            directSourceUrls.add(source.url);
            if (officialPreferredSource(source.title, source.url)) {
              officialPreferredSourceCount += 1;
            }
            if (source.publishedAt == null) continue;
            if (source.publishedAt > now + MAX_FUTURE_PUBLICATION_SKEW_MS) continue;
            datedSourceCount += 1;
            if (source.publishedAt >= facetRequirement.freshnessCutoff) {
              freshDirectSourceUrls.add(source.url);
            }
          }
        }
        return {
          facet: facetRequirement.facet,
          relevantSourceCount: directSourceUrls.size,
          datedSourceCount,
          freshSourceCount: freshDirectSourceUrls.size,
          officialPreferredSourceCount,
          directSourceUrls: [...directSourceUrls],
          freshDirectSourceUrls: [...freshDirectSourceUrls],
        } satisfies FinancialFacetAttestation;
      });
      return {
        key: target.key,
        label: target.label,
        relevantSourceCount: facets.reduce((sum, facet) => sum + facet.relevantSourceCount, 0),
        datedSourceCount: facets.reduce((sum, facet) => sum + facet.datedSourceCount, 0),
        freshSourceCount: facets.reduce((sum, facet) => sum + facet.freshSourceCount, 0),
        officialPreferredSourceCount: facets.reduce(
          (sum, facet) => sum + facet.officialPreferredSourceCount,
          0,
        ),
        facets,
      };
    }),
  };
}

function citedPublicUrls(assistantText: string): Set<string> {
  const cited = new Set<string>();
  const addCandidate = (raw: string) => {
    const candidate = raw.trim().replace(/[),.;:!?\]}]+$/u, '');
    const url = sanitizeExternalSourceUrl(candidate);
    if (url) cited.add(url);
  };
  const normalizedText = assistantText
    .replace(/&amp;|&#38;|&#x26;/giu, '&');
  const citationMarkup = normalizedText
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<(?:script|style|template)\b[^>]*>[\s\S]*?<\/(?:script|style|template)>/giu, ' ');

  // An HTML citation must be an actual anchor. URLs hidden in comments,
  // script/style blocks, or arbitrary data attributes do not count as a
  // citation that a user can inspect in the final artifact.
  for (const match of citationMarkup.matchAll(
    /<a\b[^>]*\bhref\s*=\s*(["'])(https?:\/\/.*?)\1[^>]*>/giu,
  )) {
    if (match[2]) addCandidate(match[2]);
  }
  for (const match of citationMarkup.matchAll(/<(https?:\/\/[^>\s]+)>/giu)) {
    if (match[1]) addCandidate(match[1]);
  }

  const visibleText = citationMarkup
    .replace(/<[^>]*>/gu, ' ');
  for (const match of visibleText.matchAll(/https?:\/\/[^\s<>"'`]+/giu)) {
    addCandidate(match[0]);
  }
  return cited;
}

function facetDiagnosticLabel(
  target: FinancialGroundingTarget,
  facet: FinancialGroundingFacetRequirement,
): string {
  return `${target.label} — ${facet.label}`;
}

export function evaluateFinancialGroundingCoverage(
  requirements: FinancialGroundingRequirements,
  attestations: readonly FinancialResearchAttestation[],
  assistantText?: string,
): FinancialGroundingCoverage {
  const missingEntities: string[] = [];
  const staleEntities: string[] = [];
  const undatedEntities: string[] = [];
  const missingFacets: string[] = [];
  const staleFacets: string[] = [];
  const undatedFacets: string[] = [];
  const missingCitations: string[] = [];
  const citedUrls = assistantText === undefined ? null : citedPublicUrls(assistantText);
  const freshnessByFacet = Object.fromEntries(
    requirements.facets.map((facet) => [facet.facet, facet.freshnessDays]),
  ) as Partial<Record<FinancialEvidenceFacet, number>>;

  if (requirements.targets.length === 0) {
    missingEntities.push('요청한 종목 또는 금융상품을 식별할 수 없음');
  }
  if (requirements.facets.length === 0) {
    missingFacets.push('요청한 금융 근거 항목을 식별할 수 없음');
  }
  for (const target of requirements.targets) {
    let targetRelevant = 0;
    for (const facetRequirement of requirements.facets) {
      const directUrls = new Set<string>();
      const freshUrls = new Set<string>();
      let dated = 0;
      for (const attestation of attestations ?? []) {
        const targetCoverage = attestation.targets.find(
          (candidate) => candidate.key === target.key,
        );
        const facetCoverage = targetCoverage?.facets?.find(
          (candidate) => candidate.facet === facetRequirement.facet,
        );
        if (!facetCoverage) continue;
        for (const url of facetCoverage.directSourceUrls ?? []) directUrls.add(url);
        for (const url of facetCoverage.freshDirectSourceUrls ?? []) freshUrls.add(url);
        dated += facetCoverage.datedSourceCount;
      }
      targetRelevant += directUrls.size;
      const label = facetDiagnosticLabel(target, facetRequirement);
      if (directUrls.size === 0) {
        missingFacets.push(label);
      } else if (freshUrls.size === 0 && dated === 0) {
        undatedFacets.push(label);
        if (!undatedEntities.includes(target.label)) undatedEntities.push(target.label);
      } else if (freshUrls.size === 0) {
        staleFacets.push(label);
        if (!staleEntities.includes(target.label)) staleEntities.push(target.label);
      } else if (
        citedUrls
        && ![...freshUrls].some((url) => citedUrls.has(url))
      ) {
        missingCitations.push(label);
      }
    }
    if (targetRelevant === 0) {
      missingEntities.push(target.label);
    }
  }
  return {
    ok:
      requirements.targets.length > 0
      && requirements.facets.length > 0
      && missingEntities.length === 0
      && staleEntities.length === 0
      && undatedEntities.length === 0
      && missingFacets.length === 0
      && staleFacets.length === 0
      && undatedFacets.length === 0
      && missingCitations.length === 0,
    freshnessDays: requirements.freshnessDays,
    freshnessByFacet,
    missingEntities,
    staleEntities,
    undatedEntities,
    missingFacets,
    staleFacets,
    undatedFacets,
    missingCitations,
  };
}

/**
 * Whether a no-tools artifact handoff may safely reuse research already
 * attested earlier in the same run. Citation checks are intentionally omitted
 * here because the replacement artifact does not exist yet; the normal final
 * gate still requires those URLs inside the completed artifact body.
 */
export function hasCompleteFinancialResearchAttestation(
  requirements: FinancialGroundingRequirements,
  attestations: readonly FinancialResearchAttestation[],
): boolean {
  return evaluateFinancialGroundingCoverage(requirements, attestations).ok;
}

export function financialGroundingFailureMessage(
  coverage: FinancialGroundingCoverage,
): string {
  const reasons: string[] = [];
  if (coverage.missingEntities.length > 0) {
    reasons.push(`출처에서 확인되지 않은 대상: ${coverage.missingEntities.join(', ')}`);
  }
  if (coverage.staleEntities.length > 0) {
    reasons.push(
      `최근 ${coverage.freshnessDays}일 이내 근거가 없고 오래된 자료만 있는 대상: ${coverage.staleEntities.join(', ')}`,
    );
  }
  if (coverage.undatedEntities.length > 0) {
    reasons.push(
      `발행일이 없어 현재성을 확인할 수 없는 대상: ${coverage.undatedEntities.join(', ')}`,
    );
  }
  if (coverage.missingFacets.length > 0) {
    reasons.push(`출처가 없는 요청 항목: ${coverage.missingFacets.join(', ')}`);
  }
  if (coverage.staleFacets.length > 0) {
    reasons.push(`최신성 기준을 충족하지 못한 요청 항목: ${coverage.staleFacets.join(', ')}`);
  }
  if (coverage.undatedFacets.length > 0) {
    reasons.push(`발행일을 확인할 수 없는 요청 항목: ${coverage.undatedFacets.join(', ')}`);
  }
  if (coverage.missingCitations.length > 0) {
    reasons.push(`최종 문서에 직접 URL 인용이 없는 요청 항목: ${coverage.missingCitations.join(', ')}`);
  }
  return [
    '현재 금융 문서에 필요한 출처 메타데이터와 직접 인용 조건이 충족되지 않아 파일을 완료 처리하지 않았습니다.',
    ...reasons,
    '각 대상 이름 또는 티커와 요청 항목이 출처 제목·요약·URL에서 확인되는 최신 공개 자료를 검색하고, 그 직접 URL을 최종 문서에 인용하세요.',
  ].join(' ');
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
  const rankedSources = [...(Array.isArray(findings?.sources) ? findings.sources : [])]
    .sort((left, right) => (
      Number(officialPreferredSource(right?.title ?? '', right?.url ?? ''))
      - Number(officialPreferredSource(left?.title ?? '', left?.url ?? ''))
    ));
  for (const source of rankedSources) {
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
