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

    fireEvent.click(screen.getByRole('button', { name: '모델 사용량: 실측' }));
    expect(screen.getAllByText('실측').length).toBeGreaterThan(0);
    expect(screen.getByText('새 입력')).toBeTruthy();
    expect(screen.getByText('캐시 재사용 · 포함됨')).toBeTruthy();
    expect(screen.getByText('400')).toBeTruthy();
    expect(screen.getByText('추론')).toBeTruthy();
    expect(screen.getAllByText('1,500').length).toBe(2);
    expect(screen.getByText('$0.01')).toBeTruthy();
    expect(screen.getAllByText('토큰').length).toBeGreaterThan(1);
    expect(screen.getAllByText('USD').length).toBeGreaterThan(0);
    expect(screen.getByText(/MonoField가 추가로 사용한 토큰이 아닙니다/)).toBeTruthy();
    expect(screen.getByText(/해당 모델이나 CLI에 직접 입력해도/)).toBeTruthy();

    fireEvent.click(screen.getByText('단위 및 계산 기준'));
    expect(screen.getByText(/글자나 단어 수가 아니라 모델의 토크나이저 단위/)).toBeTruthy();
    expect(screen.getByText(/새 입력은 전체 입력에서 이를 뺀 값/)).toBeTruthy();
    expect(screen.getByText(/과금 금액을 반환한 경우에만 표시/)).toBeTruthy();
    expect(screen.getByText(/기본 지침과 도구 스키마/)).toBeTruthy();
    expect(screen.getByText(/추가 맥락만 정확히 분리해 표시할 수 없습니다/)).toBeTruthy();
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

    fireEvent.click(screen.getByRole('button', { name: '모델 사용량: 추정' }));
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

    fireEvent.click(screen.getByRole('button', { name: '이 대화의 모델 사용량: 측정 불가' }));
    expect(screen.getByText('응답 2개 중 0개 측정')).toBeTruthy();
    expect(screen.getByText(/MonoField만의 추가 사용량을 뜻하지 않으며/)).toBeTruthy();
    expect(screen.getByText(/브라우저·파일 탭을 새로 열어도/)).toBeTruthy();
    expect(screen.getAllByText('측정 불가').length).toBeGreaterThan(0);
  });
});
