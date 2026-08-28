// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../../src/i18n';
import {
  ProductTutorial,
  completeProductTutorial,
  scheduleProductTutorial,
  shouldOpenProductTutorial,
} from '../../src/components/ProductTutorial';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('ProductTutorial', () => {
  it('persists the pending and completed first-run states', () => {
    expect(shouldOpenProductTutorial()).toBe(false);
    scheduleProductTutorial();
    expect(shouldOpenProductTutorial()).toBe(true);
    completeProductTutorial();
    expect(shouldOpenProductTutorial()).toBe(false);
  });

  it('spotlights real controls and advances when the highlighted controls are used', async () => {
    const onClose = vi.fn();
    render(
      <I18nProvider initial="ko">
        <div data-testid="work-mode-toggle">
          <button type="button" data-testid="work-mode-development">소프트웨어 개발</button>
          <button type="button" data-testid="work-mode-creation">문서/디자인 제작</button>
        </div>
        <div data-testid="working-dir-picker">
          <button type="button" data-testid="working-dir-trigger">작업 폴더</button>
          <button type="button" data-testid="working-dir-pick">폴더 선택</button>
        </div>
        <div data-testid="home-hero-template-picker">
          <button type="button" data-testid="home-hero-template-trigger">결과 형식</button>
          <button type="button" data-testid="home-hero-template-card-deck">슬라이드 덱</button>
        </div>
        <div data-testid="home-hero-design-system-picker">
          <button type="button" data-testid="home-hero-design-system-trigger">브랜드·스타일</button>
        </div>
        <button type="button" data-testid="project-ds-picker-option-none">스타일 없음</button>
        <div data-testid="home-hero-input-card">
          <div data-testid="home-hero-input" role="textbox" tabIndex={0} />
          <button type="button" data-testid="home-hero-submit">전송</button>
        </div>
        <ProductTutorial open onClose={onClose} />
      </I18nProvider>,
    );

    const tutorial = screen.getByTestId('product-tutorial');
    expect(tutorial.getAttribute('data-step')).toBe('1');
    expect(screen.getByRole('heading', { name: '작업 방식을 선택하세요' })).toBeTruthy();

    fireEvent.click(screen.getByTestId('work-mode-development'));
    await waitFor(() => expect(tutorial.getAttribute('data-step')).toBe('2'));
    expect(screen.getByRole('heading', { name: '작업 폴더를 연결하세요' })).toBeTruthy();

    fireEvent.click(screen.getByTestId('working-dir-pick'));
    await waitFor(() => expect(tutorial.getAttribute('data-step')).toBe('3'));
    expect(screen.getByRole('heading', { name: '원하는 결과를 입력하세요' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(tutorial.getAttribute('data-step')).toBe('4');
    expect(screen.getByRole('heading', { name: '요청을 보내고 검토하세요' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(tutorial.getAttribute('data-step')).toBe('5');
    expect(screen.getByRole('heading', { name: '문서/디자인 제작으로 전환하세요' })).toBeTruthy();

    fireEvent.click(screen.getByTestId('work-mode-creation'));
    await waitFor(() => expect(tutorial.getAttribute('data-step')).toBe('6'));
    expect(screen.getByRole('heading', { name: '만들 결과 형식을 선택하세요' })).toBeTruthy();

    fireEvent.click(screen.getByTestId('home-hero-template-card-deck'));
    await waitFor(() => expect(tutorial.getAttribute('data-step')).toBe('7'));
    expect(screen.getByRole('heading', { name: '브랜드와 문서 스타일을 선택하세요' })).toBeTruthy();

    fireEvent.mouseDown(screen.getByTestId('project-ds-picker-option-none'));
    await waitFor(() => expect(tutorial.getAttribute('data-step')).toBe('8'));
    expect(screen.getByRole('heading', { name: '자료를 더하고 제작을 시작하세요' })).toBeTruthy();

    fireEvent.click(screen.getByTestId('home-hero-submit'));
    expect(onClose).toHaveBeenCalledOnce();
    expect(shouldOpenProductTutorial()).toBe(false);
  });
});
