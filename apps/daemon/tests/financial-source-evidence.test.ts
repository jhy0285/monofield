import { describe, expect, it } from 'vitest';

import {
  hasTrustedCurrentFinancialSourceEvidence,
  requiresCurrentFinancialArtifactGrounding,
  sanitizeExternalSourceUrl,
  trustedResearchEvidenceFromFindings,
} from '../src/financial-source-evidence.js';

const creationDocs = {
  workMode: 'creation',
  sessionMode: 'docs',
  structuredArtifactInstructions: true,
} as const;

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
});
