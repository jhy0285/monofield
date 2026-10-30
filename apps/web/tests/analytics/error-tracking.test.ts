// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearExceptionTrackingContext,
  installErrorHandlers,
  patchExceptionTrackingAppVersion,
  reportHandledException,
  reportSafetyEvent,
  scrubFilePath,
  setExceptionTrackingContext,
} from '../../src/analytics/error-tracking';

/**
 * MonoField sends no browser exception, safety, or reliability telemetry. The
 * inherited call sites still go through this facade, so this suite pins the
 * privacy contract: nothing leaves the browser, whatever context a caller wires
 * up and whatever the page throws.
 */

const fetchMock = vi.fn();
const beaconMock = vi.fn();
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_BEACON = navigator.sendBeacon;

const CONTEXT = {
  apiKey: 'phc_test',
  host: 'https://telemetry.example.test',
  distinctId: 'user-1',
  appVersion: '1.2.3',
};

function nothingWasSent(): void {
  expect(fetchMock).not.toHaveBeenCalled();
  expect(beaconMock).not.toHaveBeenCalled();
}

beforeEach(() => {
  fetchMock.mockReset();
  beaconMock.mockReset();
  fetchMock.mockResolvedValue(new Response('', { status: 200 }));
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beaconMock });
  clearExceptionTrackingContext();
});

afterEach(() => {
  clearExceptionTrackingContext();
  globalThis.fetch = ORIGINAL_FETCH;
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: ORIGINAL_BEACON });
});

describe('exception tracking facade', () => {
  it('sends nothing for a handled exception, with or without a context', () => {
    reportHandledException(new Error('before-context'));
    setExceptionTrackingContext(CONTEXT);
    reportHandledException(new Error('after-context'));
    reportHandledException('a plain string');
    nothingWasSent();
  });

  it('does not hook window errors or unhandled rejections', () => {
    const add = vi.spyOn(window, 'addEventListener');
    installErrorHandlers();
    setExceptionTrackingContext(CONTEXT);
    const hooked = add.mock.calls.filter(([type]) => type === 'error' || type === 'unhandledrejection');
    add.mockRestore();
    expect(hooked).toEqual([]);

    // The page's own errors still happen; the test marks them handled so jsdom
    // does not report them as uncaught, and checks that nothing was sent.
    const handled = (event: Event) => event.preventDefault();
    window.addEventListener('error', handled);
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('sync-boom'), message: 'sync-boom', cancelable: true }));
    window.removeEventListener('error', handled);
    const rejection = new Event('unhandledrejection');
    Object.assign(rejection, { reason: new Error('async-boom') });
    window.dispatchEvent(rejection);
    nothingWasSent();
  });

  it('sends nothing for a safety event, and keeps accepting a version patch quietly', () => {
    setExceptionTrackingContext(CONTEXT);
    reportSafetyEvent('prompt_blocked', { reason: 'test' });
    patchExceptionTrackingAppVersion('9.9.9');
    nothingWasSent();
  });

  it('stays inert when the context is cleared and set again', () => {
    for (let index = 0; index < 3; index += 1) {
      setExceptionTrackingContext({ ...CONTEXT, distinctId: `user-${index}` });
      clearExceptionTrackingContext();
    }
    reportHandledException(new Error('after-churn'));
    nothingWasSent();
  });
});

describe('scrubFilePath', () => {
  it('rewrites an absolute workspace path to its app-relative form', () => {
    expect(scrubFilePath('Error: x\n    at run (/Users/dev/code/apps/web/src/App.tsx:10:5)')).toBe(
      'Error: x\n    at run (app://apps/web/src/App.tsx:10:5)',
    );
  });

  it('leaves non-strings and path-free text alone', () => {
    expect(scrubFilePath(42)).toBe(42);
    expect(scrubFilePath(null)).toBeNull();
    expect(scrubFilePath('plain message')).toBe('plain message');
  });
});
