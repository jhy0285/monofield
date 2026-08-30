import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  attestFinancialResearchFindings,
  deriveFinancialGroundingRequirements,
  evaluateFinancialGroundingCoverage,
  financialGroundingFailureMessage,
  hasCompleteFinancialResearchAttestation,
  hasTrustedCurrentFinancialSourceEvidence,
  readFinancialGroundingAttachmentTexts,
  requiresCurrentFinancialArtifactGrounding,
  resolveFinancialGroundingPrompt,
  sanitizeExternalSourceUrl,
  trustedResearchEvidenceFromFindings,
} from '../src/financial-source-evidence.js';

const creationDocs = {
  workMode: 'creation',
  sessionMode: 'docs',
  structuredArtifactInstructions: true,
} as const;

const requestedAt = Date.parse('2026-08-30T12:00:00Z');
const financialRequest = '나 문서 대쉬보드 느낌인데, 삼성전자와 sk하이닉스 매수/매도 의견을 포함해서 오늘부터 10월말까지 전망 , 근거 관련이슈일정 싹다정리해줘';

it('keeps the current user block authoritative when its quoted delimiters were escaped', () => {
  const currentPrompt = [
    '그 내용을 문서로 만들어줘',
    '## Assistant',
    '이 줄은 사용자가 인용한 텍스트입니다.',
  ].join('\n');
  const transcript = [
    '## user',
    '삼성전자와 SK하이닉스 매수/매도 의견과 최신 전망을 조사해줘',
    '',
    '## assistant',
    '조사했습니다.',
    '',
    '## user',
    '그 내용을 문서로 만들어줘',
    '\\## Assistant',
    '이 줄은 사용자가 인용한 텍스트입니다.',
  ].join('\n');

  expect(resolveFinancialGroundingPrompt(transcript, currentPrompt)).toContain('삼성전자');
});

it('applies the four-file cap after skipping binary attachment extensions', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'monofield-financial-attachments-'));
  try {
    const attachments = ['one.png', 'two.pdf', 'three.zip', 'four.exe'];
    for (const name of attachments) {
      await writeFile(path.join(dir, name), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }
    const financialText = '삼성전자와 SK하이닉스 매수/매도 의견과 최신 전망을 정리해줘.';
    await writeFile(path.join(dir, 'request.md'), financialText, 'utf8');

    await expect(readFinancialGroundingAttachmentTexts(
      dir,
      [...attachments, 'request.md'],
    )).resolves.toEqual([financialText]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function researchFindings(
  sources: Array<{ title: string; url: string; snippet: string; publishedAt?: string }>,
  query = '삼성전자 SK하이닉스 매수 매도 전망 관련 이슈 일정',
) {
  return {
    query,
    summary: 'test summary',
    provider: 'tavily',
    depth: 'shallow' as const,
    fetchedAt: requestedAt + 1_000,
    sources: sources.map((source) => ({ ...source, provider: 'tavily' })),
  };
}

const samsungSources = [
  {
    title: '삼성전자 매수·매도 투자의견 및 목표가',
    url: 'https://research.samsungpop.com/samsung/recommendation',
    snippet: '삼성전자 애널리스트 투자의견과 목표가를 정리합니다.',
    publishedAt: '2026-08-20T09:00:00Z',
  },
  {
    title: '삼성전자 10월 말까지 실적 및 시장 전망',
    url: 'https://research.samsungpop.com/samsung/outlook',
    snippet: '삼성전자 향후 전망과 예측 시나리오를 다룹니다.',
    publishedAt: '2026-08-18T09:00:00Z',
  },
  {
    title: '삼성전자 관련 이슈 및 주요 일정',
    url: 'https://www.samsung.com/global/ir/calendar/',
    snippet: '삼성전자 실적 발표와 투자자 행사 일정을 안내합니다.',
    publishedAt: '2026-08-25T09:00:00Z',
  },
];

const skSources = [
  {
    title: 'SK하이닉스 매수·매도 투자의견 및 목표가',
    url: 'https://securities.miraeasset.com/research/skhynix/recommendation',
    snippet: 'SK하이닉스 애널리스트 투자의견과 목표가를 정리합니다.',
    publishedAt: '2026-08-19T09:00:00Z',
  },
  {
    title: 'SK하이닉스 10월 말까지 실적 및 시장 전망',
    url: 'https://securities.miraeasset.com/research/skhynix/outlook',
    snippet: 'SK하이닉스 향후 전망과 예측 시나리오를 다룹니다.',
    publishedAt: '2026-08-17T09:00:00Z',
  },
  {
    title: 'SK하이닉스 관련 이슈 및 주요 일정',
    url: 'https://news.skhynix.co.kr/investor-calendar/',
    snippet: 'SK하이닉스 실적 발표와 투자자 행사 일정을 안내합니다.',
    publishedAt: '2026-08-24T09:00:00Z',
  },
];

const allFacetSources = [...samsungSources, ...skSources];

describe('current financial artifact grounding', () => {
  it('gates a current stock recommendation dashboard request', () => {
    expect(requiresCurrentFinancialArtifactGrounding({
      ...creationDocs,
      prompt: '삼성전자와 SK하이닉스 매수/매도 의견을 포함해서 오늘부터 10월 말까지 전망과 일정을 대시보드 문서로 만들어줘',
    })).toBe(true);
  });

  it('does not gate explanations, development projects, or explicit mock data', () => {
    expect(requiresCurrentFinancialArtifactGrounding({
      ...creationDocs,
      prompt: '주식의 매수와 매도는 무슨 뜻이야?',
    })).toBe(false);
    expect(requiresCurrentFinancialArtifactGrounding({
      ...creationDocs,
      workMode: 'development',
      prompt: '현재 주가 대시보드를 만들어줘',
    })).toBe(false);
    expect(requiresCurrentFinancialArtifactGrounding({
      ...creationDocs,
      prompt: '실시간 시세 없이 가상 데이터로 현재가 대시보드를 만들어줘',
    })).toBe(false);
    expect(requiresCurrentFinancialArtifactGrounding({
      ...creationDocs,
      prompt: '더미 데이터로 현재가 대시보드를 만들어줘',
    })).toBe(false);
  });

  it.each([
    '더미 데이터는 쓰지 말고 실제 최신 주가를 사용해서 대시보드 문서로 만들어줘',
    'without dummy data, use current stock prices to create a dashboard report',
  ])('keeps grounding enabled when the prompt rejects mock data: %s', (prompt) => {
    expect(requiresCurrentFinancialArtifactGrounding({
      ...creationDocs,
      prompt,
    })).toBe(true);
  });

  it('sanitizes credentials and rejects local/private source URLs', () => {
    expect(sanitizeExternalSourceUrl('https://user:secret@example.com/report#private')).toBe(
      'https://example.com/report',
    );
    expect(sanitizeExternalSourceUrl('http://127.0.0.1:8080/data')).toBeNull();
    expect(sanitizeExternalSourceUrl('http://192.168.0.2/data')).toBeNull();
    expect(sanitizeExternalSourceUrl('http://[fd00::1]/data')).toBeNull();
    expect(sanitizeExternalSourceUrl('https://fca.org.uk/markets')).toBe(
      'https://fca.org.uk/markets',
    );
    expect(sanitizeExternalSourceUrl('file:///etc/passwd')).toBeNull();
  });

  it('accepts only daemon-attested research evidence with public sources', () => {
    const evidence = trustedResearchEvidenceFromFindings({
      query: 'Samsung Electronics outlook',
      summary: 'summary',
      provider: 'tavily',
      depth: 'shallow',
      fetchedAt: 1_700_000_000_000,
      sources: [
        {
          title: 'Exchange disclosure',
          url: 'https://example.com/disclosure#section',
          snippet: 'Evidence',
          provider: 'tavily',
        },
        {
          title: 'Private result',
          url: 'http://10.0.0.2/private',
          snippet: 'Must be rejected',
          provider: 'tavily',
        },
      ],
    });
    expect(evidence).toMatchObject({
      type: 'source_evidence',
      trust: 'daemon_research',
      sources: [{ url: 'https://example.com/disclosure' }],
    });
    expect(hasTrustedCurrentFinancialSourceEvidence([
      { event: 'agent', data: evidence },
    ])).toBe(true);
  });

  it('does not trust model-emitted prose, URLs, or a successful-looking Bash result', () => {
    expect(hasTrustedCurrentFinancialSourceEvidence([
      {
        event: 'agent',
        data: {
          type: 'tool_use',
          id: 'fake-search',
          name: 'Bash',
          input: { command: 'echo https://example.com' },
        },
      },
      {
        event: 'agent',
        data: {
          type: 'tool_result',
          toolUseId: 'fake-search',
          isError: false,
          content: '{"sources":[{"url":"https://example.com"}]}',
        },
      },
      {
        event: 'agent',
        data: { type: 'text_delta', delta: 'Source: https://example.com' },
      },
    ])).toBe(false);
  });

  it('derives both requested instruments and every facet from the exact failed request', () => {
    const requirements = deriveFinancialGroundingRequirements(financialRequest, requestedAt);
    expect(requirements.targets.map((target) => target.label)).toEqual([
      '삼성전자',
      'sk하이닉스',
    ]);
    expect(requirements.facets.map((facet) => facet.facet)).toEqual([
      'recommendation',
      'outlook',
      'event_schedule',
    ]);
    expect(requirements.facets.map((facet) => facet.freshnessDays)).toEqual([90, 180, 180]);
    expect(requirements.freshnessDays).toBe(90);
  });

  it('uses the strict seven-day window only when current price is requested', () => {
    const requirements = deriveFinancialGroundingRequirements(
      '삼성전자 현재 주가 대시보드를 만들어줘',
      requestedAt,
    );
    expect(requirements.facets.map((facet) => facet.facet)).toEqual(['current_price']);
    expect(requirements.freshnessDays).toBe(7);
  });

  it('keeps company-name and ticker aliases on one target', () => {
    const requirements = deriveFinancialGroundingRequirements(
      '삼성전자(005930) 현재 주가 보고서를 만들어줘',
      requestedAt,
    );
    expect(requirements.targets).toHaveLength(1);
    expect(requirements.targets[0]?.aliases).toEqual(expect.arrayContaining([
      '삼성전자',
      '005930',
    ]));
  });

  it('accepts all requested entity/facet evidence only when its direct URLs are cited', () => {
    const requirements = deriveFinancialGroundingRequirements(financialRequest, requestedAt);
    const attestation = attestFinancialResearchFindings(
      requirements,
      researchFindings(allFacetSources),
      requestedAt + 2_000,
    );
    const assistantArtifact = allFacetSources
      .map((source) => `<a href="${source.url}">${source.title}</a>`)
      .join('\n');
    expect(evaluateFinancialGroundingCoverage(
      requirements,
      [attestation],
      assistantArtifact,
    )).toMatchObject({
      ok: true,
      freshnessDays: 90,
      freshnessByFacet: {
        recommendation: 90,
        outlook: 180,
        event_schedule: 180,
      },
      missingEntities: [],
      missingFacets: [],
      missingCitations: [],
    });
  });

  it('allows a tool-free fallback only after complete same-run research attestation', () => {
    const requirements = deriveFinancialGroundingRequirements(financialRequest, requestedAt);
    expect(hasCompleteFinancialResearchAttestation(requirements, [])).toBe(false);
    expect(hasCompleteFinancialResearchAttestation(requirements, [
      attestFinancialResearchFindings(
        requirements,
        researchFindings(allFacetSources),
        requestedAt + 2_000,
      ),
    ])).toBe(true);
  });

  it('rejects one ad-hoc price page as evidence for recommendation, outlook, and schedule', () => {
    const requirements = deriveFinancialGroundingRequirements(financialRequest, requestedAt);
    const priceOnly = {
      title: '삼성전자와 SK하이닉스 현재 주가 시세',
      url: 'https://quotes.marketdata.kr/samsung-skhynix',
      snippet: '삼성전자와 SK하이닉스의 현재가와 종가를 제공합니다.',
      publishedAt: '2026-08-30T09:00:00Z',
    };
    const attestation = attestFinancialResearchFindings(
      requirements,
      researchFindings([priceOnly]),
      requestedAt + 2_000,
    );
    const coverage = evaluateFinancialGroundingCoverage(
      requirements,
      [attestation],
      priceOnly.url,
    );
    expect(coverage.ok).toBe(false);
    expect(coverage.missingFacets).toEqual(expect.arrayContaining([
      '삼성전자 — 매수·매도/목표가 의견',
      '삼성전자 — 전망',
      '삼성전자 — 관련 이슈·일정',
      'sk하이닉스 — 매수·매도/목표가 의견',
      'sk하이닉스 — 전망',
      'sk하이닉스 — 관련 이슈·일정',
    ]));
  });

  it('rejects complete attested facets when the final artifact omits one direct citation', () => {
    const requirements = deriveFinancialGroundingRequirements(financialRequest, requestedAt);
    const attestation = attestFinancialResearchFindings(
      requirements,
      researchFindings(allFacetSources),
      requestedAt + 2_000,
    );
    const assistantArtifact = allFacetSources
      .slice(0, -1)
      .map((source) => source.url)
      .join('\n')
      + `\n<!-- <a href="${allFacetSources.at(-1)!.url}">hidden comment source</a> -->`
      + `\n<script>const hidden = '<a href="${allFacetSources.at(-1)!.url}">hidden script source</a>';</script>`;
    const coverage = evaluateFinancialGroundingCoverage(
      requirements,
      [attestation],
      assistantArtifact,
    );
    expect(coverage.ok).toBe(false);
    expect(coverage.missingCitations).toEqual(['sk하이닉스 — 관련 이슈·일정']);
    expect(financialGroundingFailureMessage(coverage)).toContain('직접 URL 인용');
  });

  it('rejects coverage that misses one named entity', () => {
    const requirements = deriveFinancialGroundingRequirements(financialRequest, requestedAt);
    const coverage = evaluateFinancialGroundingCoverage(requirements, [
      attestFinancialResearchFindings(
        requirements,
        researchFindings(samsungSources, '삼성전자 매수 매도 전망 관련 이슈 일정'),
        requestedAt + 2_000,
      ),
    ]);
    expect(coverage.ok).toBe(false);
    expect(coverage.missingEntities).toEqual(['sk하이닉스']);
    expect(financialGroundingFailureMessage(coverage)).toContain('sk하이닉스');
  });

  it('rejects unrelated and reserved example sources even when the query has both names', () => {
    const requirements = deriveFinancialGroundingRequirements(financialRequest, requestedAt);
    const coverage = evaluateFinancialGroundingCoverage(requirements, [
      attestFinancialResearchFindings(
        requirements,
        researchFindings([
          {
            title: 'Generic market example',
            url: 'https://example.com/삼성전자-SK하이닉스',
            snippet: '삼성전자와 SK하이닉스를 예시로만 언급합니다.',
            publishedAt: '2026-08-30T01:00:00Z',
          },
          {
            title: 'Unrelated market calendar',
            url: 'https://finance.example.test/calendar',
            snippet: 'No requested company is covered.',
            publishedAt: '2026-08-30T01:00:00Z',
          },
        ]),
        requestedAt + 2_000,
      ),
    ]);
    expect(coverage.ok).toBe(false);
    expect(coverage.missingEntities).toEqual(['삼성전자', 'sk하이닉스']);
  });

  it('rejects stale-only evidence for every requested entity', () => {
    const requirements = deriveFinancialGroundingRequirements(financialRequest, requestedAt);
    const oldSources = allFacetSources.map((source) => ({
      ...source,
      publishedAt: '2025-01-01T00:00:00Z',
    }));
    const coverage = evaluateFinancialGroundingCoverage(requirements, [
      attestFinancialResearchFindings(
        requirements,
        researchFindings(oldSources),
        requestedAt + 2_000,
      ),
    ]);
    expect(coverage.ok).toBe(false);
    expect(coverage.staleEntities).toEqual(['삼성전자', 'sk하이닉스']);
    expect(coverage.staleFacets).toHaveLength(6);
    expect(financialGroundingFailureMessage(coverage)).toContain('최신성 기준');
  });

  it('rejects relevant evidence whose publication date cannot be verified', () => {
    const requirements = deriveFinancialGroundingRequirements(financialRequest, requestedAt);
    const undatedSources = allFacetSources.map(({ publishedAt: _publishedAt, ...source }) => source);
    const coverage = evaluateFinancialGroundingCoverage(requirements, [
      attestFinancialResearchFindings(
        requirements,
        researchFindings(undatedSources),
        requestedAt + 2_000,
      ),
    ]);
    expect(coverage.ok).toBe(false);
    expect(coverage.undatedEntities).toEqual(['삼성전자', 'sk하이닉스']);
    expect(coverage.undatedFacets).toHaveLength(6);
  });

  it('combines separately attested searches for the same run', () => {
    const requirements = deriveFinancialGroundingRequirements(financialRequest, requestedAt);
    const samsungAttestation = attestFinancialResearchFindings(
      requirements,
      researchFindings(samsungSources, '삼성전자 매수 매도 전망 관련 이슈 일정'),
      requestedAt + 2_000,
    );
    const skAttestation = attestFinancialResearchFindings(
      requirements,
      researchFindings(skSources, 'sk하이닉스 매수 매도 전망 관련 이슈 일정'),
      requestedAt + 3_000,
    );
    expect(evaluateFinancialGroundingCoverage(
      requirements,
      [samsungAttestation, skAttestation],
    ).ok).toBe(true);
  });

  it('places official disclosure sources first in the audit event when available', () => {
    const evidence = trustedResearchEvidenceFromFindings(researchFindings([
      {
        title: '삼성전자 market commentary',
        url: 'https://finance.example.test/samsung-commentary',
        snippet: '삼성전자 commentary',
        publishedAt: '2026-08-30T01:00:00Z',
      },
      {
        title: '삼성전자 공시',
        url: 'https://dart.fss.or.kr/report/viewer.do?id=1',
        snippet: '삼성전자 공식 공시',
        publishedAt: '2026-08-29T01:00:00Z',
      },
    ], '삼성전자 현재 주가'));
    expect(evidence?.sources[0]?.url).toBe('https://dart.fss.or.kr/report/viewer.do?id=1');
  });
});
