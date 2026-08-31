// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  completeCreationWorkspaceTutorial,
  completeDevelopmentWorkspaceTutorial,
  CreationWorkspaceTutorial,
  DevelopmentWorkspaceTutorial,
  shouldOpenCreationWorkspaceTutorial,
  shouldOpenDevelopmentWorkspaceTutorial,
} from '../../src/components/DevelopmentWorkspaceTutorial';
import { I18nProvider } from '../../src/i18n';
import { en } from '../../src/i18n/locales/en';
import { ko } from '../../src/i18n/locales/ko';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('DevelopmentWorkspaceTutorial', () => {
  it('uses generic project and module guidance in every bundled locale', () => {
    const korean = String(ko['development.guideConfigBody']);
    const english = String(en['development.guideConfigBody']);

    expect(korean).toContain('프로젝트나 모듈');
    expect(english).toContain('project or module');
    expect(`${korean}\n${english}`).not.toMatch(/OSE|aauserver|acrserver|agwserver|aopserver/i);
  });

  it('opens once by default and persists completion', () => {
    expect(shouldOpenDevelopmentWorkspaceTutorial()).toBe(true);
    completeDevelopmentWorkspaceTutorial();
    expect(shouldOpenDevelopmentWorkspaceTutorial()).toBe(false);
  });

  it('follows the real development controls in order', async () => {
    const onClose = vi.fn();
    render(
      <I18nProvider initial="ko">
        <select data-testid="development-active-project" aria-label="활성 프로젝트" defaultValue="api-service">
          <option value="api-service">api-service</option>
          <option value="web-client">web-client</option>
        </select>
        <select data-testid="development-run-config" aria-label="실행 구성" defaultValue="spring">
          <option value="spring">Spring Boot</option>
          <option value="web">Web</option>
        </select>
        <button type="button" data-testid="development-run-settings">실행 설정</button>
        <button type="button" data-testid="development-run-action">실행</button>
        <select data-testid="development-database" aria-label="프로젝트 데이터베이스" defaultValue="">
          <option value="">연결 안 함</option>
          <option value="dev">개발 DB</option>
        </select>
        <button type="button" data-testid="development-open-changes">변경사항</button>
        <label data-testid="development-auto-verify">
          <input type="checkbox" /> 자동 검증
        </label>
        <DevelopmentWorkspaceTutorial open onClose={onClose} />
      </I18nProvider>,
    );

    const guide = screen.getByTestId('development-workspace-tutorial');
    expect(guide.getAttribute('data-step')).toBe('1');
    expect(screen.getByRole('heading', { name: '소프트웨어 개발' })).toBeTruthy();

    fireEvent.change(screen.getByTestId('development-active-project'), { target: { value: 'web-client' } });
    await waitFor(() => expect(guide.getAttribute('data-step')).toBe('2'));
    expect(guide.textContent).toContain('워크스페이스에서 작업할 프로젝트나 모듈을 선택하면');
    expect(guide.textContent).not.toMatch(/OSE|aauserver/);
    fireEvent.change(screen.getByTestId('development-run-config'), { target: { value: 'web' } });
    await waitFor(() => expect(guide.getAttribute('data-step')).toBe('3'));
    fireEvent.click(screen.getByTestId('development-run-settings'));
    await waitFor(() => expect(guide.getAttribute('data-step')).toBe('4'));
    fireEvent.click(screen.getByTestId('development-run-action'));
    await waitFor(() => expect(guide.getAttribute('data-step')).toBe('5'));
    fireEvent.change(screen.getByTestId('development-database'), { target: { value: 'dev' } });
    await waitFor(() => expect(guide.getAttribute('data-step')).toBe('6'));
    fireEvent.click(screen.getByRole('checkbox', { name: '자동 검증' }));
    await waitFor(() => expect(guide.getAttribute('data-step')).toBe('7'));
    fireEvent.click(screen.getByTestId('development-open-changes'));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(shouldOpenDevelopmentWorkspaceTutorial()).toBe(false);
  });

  it('recalculates the spotlight and callout from the live viewport and measured content', async () => {
    let targetRect = { left: 560, top: 64, width: 60, height: 26 };
    const rect = (input: { left: number; top: number; width: number; height: number }) => ({
      ...input,
      x: input.left,
      y: input.top,
      right: input.left + input.width,
      bottom: input.top + input.height,
      toJSON: () => input,
    }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      if (this.getAttribute('data-testid') === 'development-active-project') return rect(targetRect);
      if (this.getAttribute('data-testid') === 'development-tutorial-callout') {
        return rect({ left: 0, top: 0, width: 372, height: 380 });
      }
      return rect({ left: 0, top: 0, width: 0, height: 0 });
    });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 640, writable: true });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 480, writable: true });

    render(
      <I18nProvider initial="ko">
        <select data-testid="development-active-project" aria-label="활성 프로젝트"><option>api-service</option></select>
        <select data-testid="development-run-config" aria-label="실행 구성"><option>Spring Boot</option></select>
        <button type="button" data-testid="development-run-settings">실행 설정</button>
        <button type="button" data-testid="development-run-action">실행</button>
        <select data-testid="development-database" aria-label="프로젝트 데이터베이스"><option>연결 안 함</option></select>
        <button type="button" data-testid="development-open-changes">변경사항</button>
        <label data-testid="development-auto-verify"><input type="checkbox" /> 자동 검증</label>
        <DevelopmentWorkspaceTutorial open onClose={vi.fn()} />
      </I18nProvider>,
    );

    const spotlight = await screen.findByTestId('development-tutorial-spotlight');
    const callout = screen.getByTestId('development-tutorial-callout');
    await waitFor(() => expect(parseFloat(callout.style.top)).toBeLessThanOrEqual(88));
    expect(spotlight.style.right).toBe('');
    expect(spotlight.style.bottom).toBe('');

    targetRect = { left: 260, top: 120, width: 100, height: 30 };
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 420, writable: true });
    fireEvent(window, new Event('resize'));

    await waitFor(() => expect(spotlight.style.left).toBe('251px'));
    expect(parseFloat(callout.style.left)).toBeGreaterThanOrEqual(12);
    expect(parseFloat(callout.style.left) + parseFloat(callout.style.width)).toBeLessThanOrEqual(408);
  });
});

describe('CreationWorkspaceTutorial', () => {
  it('opens once and follows the real document workspace controls', async () => {
    expect(shouldOpenCreationWorkspaceTutorial()).toBe(true);
    const onClose = vi.fn();
    render(
      <I18nProvider initial="ko">
        <button type="button" data-testid="design-files-tab">문서 파일</button>
        <button type="button" data-testid="workspace-add-tab">새 탭</button>
        <button type="button" data-testid="board-mode-toggle">표시</button>
        <div data-testid="chat-composer">요청 입력</div>
        <CreationWorkspaceTutorial open onClose={onClose} />
      </I18nProvider>,
    );

    const guide = screen.getByTestId('creation-workspace-tutorial');
    expect(guide.getAttribute('data-step')).toBe('1');
    fireEvent.click(screen.getByTestId('design-files-tab'));
    await waitFor(() => expect(guide.getAttribute('data-step')).toBe('2'));
    fireEvent.click(screen.getByTestId('workspace-add-tab'));
    await waitFor(() => expect(guide.getAttribute('data-step')).toBe('3'));
    fireEvent.click(screen.getByTestId('board-mode-toggle'));
    await waitFor(() => expect(guide.getAttribute('data-step')).toBe('4'));
    fireEvent.click(screen.getByTestId('chat-composer'));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(shouldOpenCreationWorkspaceTutorial()).toBe(false);
    completeCreationWorkspaceTutorial();
    expect(shouldOpenCreationWorkspaceTutorial()).toBe(false);
  });
});
