// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionModeToggle } from '../../src/components/SessionModeToggle';
import { I18nProvider } from '../../src/i18n';

afterEach(() => cleanup());

describe('SessionModeToggle', () => {
  it('shows only the active mode until the menu is opened', () => {
    render(<SessionModeToggle mode="docs" onChange={vi.fn()} />);

    expect(screen.getByTestId('session-mode-trigger').textContent).toContain('Docs');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(screen.getByTestId('session-mode-trigger'));

    expect(screen.getByRole('menuitemradio', { name: /Docs mode/i }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: /Ask mode/i }).getAttribute('aria-checked')).toBe('false');
  });

  it('switches mode from the menu', () => {
    const onChange = vi.fn();
    render(<SessionModeToggle mode="docs" onChange={onChange} />);

    fireEvent.click(screen.getByTestId('session-mode-trigger'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Ask mode/i }));

    expect(onChange).toHaveBeenCalledWith('chat');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('renders Korean mode names and descriptions in Korean', () => {
    render(
      <I18nProvider initial="ko">
        <SessionModeToggle mode="chat" onChange={vi.fn()} />
      </I18nProvider>,
    );

    const trigger = screen.getByTestId('session-mode-trigger');
    fireEvent.pointerEnter(trigger);

    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.textContent).toContain('질문');
    expect(screen.getByRole('tooltip').textContent).toContain('질문 모드');

    const docsOption = screen.getByRole('menuitemradio', { name: '문서 모드' });
    fireEvent.pointerEnter(docsOption);

    const menu = screen.getByRole('menu');
    const card = screen.getByRole('tooltip');
    expect(menu.textContent).toContain('문서');
    expect(card.textContent).toContain('문서 모드');
    expect(card.textContent).toContain('화면명세서');
    expect(card.textContent).toContain('인터페이스 명세서');
    expect(card.textContent).toContain('인터랙티브 프로토타입');
    expect(card.textContent).not.toContain('랜딩 페이지');
  });

  it('uses the active non-Korean locale for both mode names', () => {
    render(
      <I18nProvider initial="zh-CN">
        <SessionModeToggle mode="chat" onChange={vi.fn()} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByTestId('session-mode-trigger'));

    expect(screen.getByRole('menuitemradio', { name: '提问模式' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: '文档模式' })).toBeTruthy();
  });

  it('can place the home popover below its trigger', () => {
    const { container } = render(
      <SessionModeToggle
        mode="docs"
        onChange={vi.fn()}
        popoverPlacement="below"
      />,
    );

    expect(container.firstElementChild?.className).toContain(
      'session-mode-toggle--below',
    );
  });
});
