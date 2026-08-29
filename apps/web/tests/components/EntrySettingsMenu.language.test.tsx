// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntrySettingsMenu } from '../../src/components/EntrySettingsMenu';
import { I18nProvider, type Locale } from '../../src/i18n';
import type { AppConfig } from '../../src/types';

vi.mock('../../src/analytics/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/analytics/provider')>();
  return { ...actual, useAnalytics: () => ({ track: vi.fn() }) };
});

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    mode: 'daemon',
    agentId: null,
    agentModels: {},
    apiProtocol: 'anthropic',
    apiProtocolConfigs: {},
    apiKey: '',
    baseUrl: '',
    model: '',
    theme: 'system',
    ...overrides,
  } as AppConfig;
}

function renderMenu(locale: Locale = 'en') {
  return render(
    <I18nProvider initial={locale}>
      <EntrySettingsMenu
        config={baseConfig()}
        onThemeChange={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    </I18nProvider>,
  );
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => jsonResponse({})) as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('EntrySettingsMenu language picker a11y', () => {
  it('keeps one consistent menu model and hides the collapsed locale list from a11y/focus', () => {
    const { container } = renderMenu();
    fireEvent.click(screen.getByTestId('entry-settings-menu-trigger'));

    // The picker trigger participates in the surrounding role="menu" popover as
    // a menuitem that opens a submenu — not a listbox combobox.
    const langTrigger = container.querySelector(
      '.entry-settings-menu__select-trigger',
    ) as HTMLElement;
    expect(langTrigger.getAttribute('role')).toBe('menuitem');
    expect(langTrigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(langTrigger.getAttribute('aria-expanded')).toBe('false');

    // No mixed listbox/option ARIA — locale choices are menuitemradios.
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(container.querySelector('[role="option"]')).toBeNull();
    const panel = container.querySelector(
      '.entry-settings-menu__select-panel',
    ) as HTMLElement;
    expect(panel.getAttribute('role')).toBe('menu');
    const radios = panel.querySelectorAll('[role="menuitemradio"]');
    expect(radios.length).toBeGreaterThan(1);
    expect(
      Array.from(radios).filter((r) => r.getAttribute('aria-checked') === 'true'),
    ).toHaveLength(1);

    // Collapsed: the list is inert, so the options stay out of the a11y tree
    // and the tab order even though they remain mounted for the animation.
    const list = container.querySelector(
      '.entry-settings-menu__select-list',
    ) as HTMLElement;
    expect(list.hasAttribute('inert')).toBe(true);

    // Opening flips aria-expanded and lifts inert.
    fireEvent.click(langTrigger);
    expect(langTrigger.getAttribute('aria-expanded')).toBe('true');
    expect(list.hasAttribute('inert')).toBe(false);
  });

  it('shows localized GitHub support links without exposing personal email addresses', () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('entry-settings-menu-trigger'));

    expect(
      screen
        .getByRole('menuitem', { name: 'Get help on GitHub' })
        .getAttribute('href'),
    ).toBe(
      'https://github.com/jhy0285/monofield/issues/new?title=%5BSupport%5D%20',
    );
    expect(
      screen.getByRole('menuitem', { name: 'Report a problem' }).getAttribute('href'),
    ).toBe(
      'https://github.com/jhy0285/monofield/issues/new?labels=bug&title=%5BProblem%5D%20',
    );
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(document.body.textContent).not.toContain('@lgcns.com');
    expect(document.body.textContent).not.toContain('@gmail.com');
  });

  it('uses natural Korean spacing for GitHub support copy', () => {
    renderMenu('ko');
    fireEvent.click(screen.getByTestId('entry-settings-menu-trigger'));

    expect(screen.getByRole('menuitem', { name: 'GitHub에서 도움 받기' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '문제 신고하기' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('GitHub 에서');
  });
});
