// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EntryHelpMenu } from '../../src/components/EntryHelpMenu';
import { I18nProvider } from '../../src/i18n';

vi.mock('../../src/analytics/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/analytics/provider')>();
  return { ...actual, useAnalytics: () => ({ track: vi.fn() }) };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EntryHelpMenu links', () => {
  it('routes support and feature feedback to new GitHub issues', () => {
    render(
      <I18nProvider initial="en">
        <EntryHelpMenu />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByTestId('entry-help-trigger'));

    expect(
      screen.getByRole('menuitem', { name: 'Get help on GitHub' }).getAttribute('href'),
    ).toBe(
      'https://github.com/jhy0285/monofield/issues/new?title=%5BSupport%5D%20',
    );
    expect(
      screen
        .getByRole('menuitem', { name: 'Submit a feature request' })
        .getAttribute('href'),
    ).toBe(
      'https://github.com/jhy0285/monofield/issues/new?labels=enhancement&title=%5BFeature%5D%20',
    );
    expect(document.querySelector('a[href*="/pulls"]')).toBeNull();
  });

  it('opens the guide center from the first menu item', () => {
    const onOpenGuide = vi.fn();
    render(
      <I18nProvider initial="en">
        <EntryHelpMenu onOpenGuide={onOpenGuide} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByTestId('entry-help-trigger'));
    const items = screen.getAllByRole('menuitem');
    expect(items[0]?.textContent).toBe('Guide & intro video');
    fireEvent.click(screen.getByTestId('entry-help-guide-center'));

    expect(onOpenGuide).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
