// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { isPageHiding } from '../../src/runtime/page-lifecycle';

afterEach(() => {
  window.dispatchEvent(new Event('pageshow'));
  vi.useRealTimers();
});

describe('isPageHiding', () => {
  it('is false while the page is showing', () => {
    expect(isPageHiding()).toBe(false);
  });

  it('turns true before the page unloads, because the fetches are cut ahead of pagehide', () => {
    window.dispatchEvent(new Event('beforeunload'));
    expect(isPageHiding()).toBe(true);
  });

  it('expires after beforeunload when the user stays on the page', () => {
    vi.useFakeTimers();
    window.dispatchEvent(new Event('beforeunload'));
    vi.advanceTimersByTime(2999);
    expect(isPageHiding()).toBe(true);
    vi.advanceTimersByTime(2);
    expect(isPageHiding()).toBe(false);
  });

  it('stays true once the page is hiding, past the beforeunload grace period', () => {
    vi.useFakeTimers();
    window.dispatchEvent(new Event('beforeunload'));
    window.dispatchEvent(new Event('pagehide'));
    vi.advanceTimersByTime(10_000);
    expect(isPageHiding()).toBe(true);
  });

  it('turns false again when the page is shown, as after a back-forward cache restore', () => {
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));
    expect(isPageHiding()).toBe(false);
  });
});
