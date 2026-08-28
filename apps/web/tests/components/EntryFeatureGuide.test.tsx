// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EntryFeatureGuide,
  shouldOpenEntryFeatureGuide,
} from '../../src/components/EntryFeatureGuide';
import { I18nProvider } from '../../src/i18n';

const originalResizeObserver = globalThis.ResizeObserver;

class ResizeObserverMock {
  observe() {}
  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
  window.localStorage.removeItem('monofield:entry-feature-guides:v1');
});

afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = originalResizeObserver;
  window.localStorage.removeItem('monofield:entry-feature-guides:v1');
});

describe('EntryFeatureGuide', () => {
  it('tracks the target across viewport changes and remembers completion', async () => {
    let left = 120;
    const target = document.createElement('button');
    target.dataset.testid = 'automations-new';
    target.getBoundingClientRect = vi.fn(() => ({
      x: left,
      y: 80,
      left,
      top: 80,
      right: left + 100,
      bottom: 120,
      width: 100,
      height: 40,
      toJSON: () => ({}),
    } as DOMRect));
    document.body.appendChild(target);
    const onClose = vi.fn();

    render(
      <I18nProvider initial="ko">
        <EntryFeatureGuide feature="tasks" onClose={onClose} />
      </I18nProvider>,
    );

    const spotlight = await screen.findByTestId('entry-feature-guide-spotlight');
    await waitFor(() => expect(spotlight.style.left).toBe('110px'));
    left = 320;
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(spotlight.style.left).toBe('310px'));

    expect(shouldOpenEntryFeatureGuide('tasks')).toBe(true);
    const closeButtons = screen.getAllByRole('button', { name: '닫기' });
    fireEvent.click(closeButtons[closeButtons.length - 1]!);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(shouldOpenEntryFeatureGuide('tasks')).toBe(false);
    target.remove();
  });
});
