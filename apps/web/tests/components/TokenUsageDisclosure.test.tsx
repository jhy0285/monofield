// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TokenUsageDisclosure } from '../../src/components/TokenUsageDisclosure';
import { I18nProvider } from '../../src/i18n';

afterEach(cleanup);

describe('TokenUsageDisclosure', () => {
  it('shows response metrics and their measurement source in Korean', () => {
    render(
      <I18nProvider initial="ko">
        <TokenUsageDisclosure
          variant="response"
          metrics={{
            inputTokens: 1_200,
            cachedInputTokens: 800,
            outputTokens: 300,
            reasoningTokens: 90,
            totalTokens: 1_500,
            costUsd: 0.0123,
            measurementSource: 'provider_usage',
          }}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '호출 누적 사용량: 실측' }));
    expect(screen.getAllByText('실측').length).toBeGreaterThan(0);
    expect(screen.getByText('전체 입력 · 호출 누적')).toBeTruthy();
    expect(screen.getByText('새 입력')).toBeTruthy();
    expect(screen.getByText('캐시 재사용 · 입력의 일부')).toBeTruthy();
    expect(screen.getByText('출력 · 호출 누적')).toBeTruthy();
    expect(screen.getByText('입력 + 출력')).toBeTruthy();
    expect(screen.getByText('1,200')).toBeTruthy();
    expect(screen.getByText('400')).toBeTruthy();
    expect(screen.getByText('추론')).toBeTruthy();
    expect(screen.getAllByText('1,500').length).toBe(2);
    expect(screen.getByText('$0.01')).toBeTruthy();
    expect(screen.getAllByText('토큰').length).toBeGreaterThan(1);
    expect(screen.getAllByText('USD').length).toBeGreaterThan(0);
    expect(screen.getByText(/MonoField가 별도로 더 쓴 양도 아닙니다/)).toBeTruthy();
    expect(screen.getByText(/모든 모델 호출의 누적 사용량/)).toBeTruthy();

    fireEvent.click(screen.getByText('단위 및 계산 기준'));
    expect(screen.getByText(/글자나 단어 수가 아니라 모델의 토크나이저 단위/)).toBeTruthy();
    expect(screen.getByText(/새 입력 = 전체 입력 − 캐시 재사용/)).toBeTruthy();
    expect(screen.getByText(/과금 금액을 반환한 경우에만 표시/)).toBeTruthy();
    expect(screen.getByText(/기본 지침과 도구 스키마/)).toBeTruthy();
    expect(screen.getByText(/누적 입력은 모델의 컨텍스트 창 크기보다 커질 수 있습니다/)).toBeTruthy();
  });

  it('makes a multi-million cache total explicit as cumulative calls, not one context window', () => {
    render(
      <I18nProvider initial="ko">
        <TokenUsageDisclosure
          variant="response"
          metrics={{
            inputTokens: 7_120_000,
            cachedInputTokens: 7_000_000,
            outputTokens: 2_000,
            totalTokens: 7_122_000,
            measurementSource: 'provider_usage',
          }}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '호출 누적 사용량: 실측' }));
    expect(screen.getByText('7,120,000')).toBeTruthy();
    expect(screen.getByText('7,000,000')).toBeTruthy();
    expect(screen.getByText('120,000')).toBeTruthy();
    expect(screen.getByText(/한 번에 열린 현재 컨텍스트 크기도/)).toBeTruthy();
    expect(screen.getByText(/큰 캐시 값\(예: 700만\).*여러 호출이 재사용한 입력의 합계/)).toBeTruthy();
  });

  it('explains the approximation only for estimated usage', () => {
    render(
      <I18nProvider initial="ko">
        <TokenUsageDisclosure
          variant="response"
          metrics={{
            inputTokens: 25,
            outputTokens: 10,
            totalTokens: 35,
            measurementSource: 'estimated',
          }}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '호출 누적 사용량: 추정' }));
    expect(screen.getByText('보고 안 됨')).toBeTruthy();
    expect(screen.getByText('USD · 보고 시')).toBeTruthy();
    expect(screen.getByText(/임의의 API 비용으로 환산하지 않습니다/)).toBeTruthy();
    fireEvent.click(screen.getByText('단위 및 계산 기준'));
    expect(screen.getByText(/약 4글자를 1토큰으로 계산/)).toBeTruthy();
  });

  it('shows measured response coverage for the conversation', () => {
    render(
      <I18nProvider initial="ko">
        <TokenUsageDisclosure
          variant="conversation"
          metrics={{ measurementSource: 'unavailable' }}
          measuredResponses={0}
          totalResponses={2}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '이 대화의 호출 누적: 측정 불가' }));
    expect(screen.getByText('응답 2개 중 0개 측정')).toBeTruthy();
    expect(screen.getByText(/한 번에 열린 현재 컨텍스트 크기가 아니라 호출 누적량/)).toBeTruthy();
    expect(screen.getByText(/700만 토큰 컨텍스트를 한 번 열었다는 뜻이 아닙니다/)).toBeTruthy();
    expect(screen.getAllByText('측정 불가').length).toBeGreaterThan(0);
  });
});
