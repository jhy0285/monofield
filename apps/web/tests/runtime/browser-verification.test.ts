import { describe, expect, it, vi } from 'vitest';

import {
  clearActiveBrowserVerification,
  getActiveBrowserVerification,
  setActiveBrowserVerification,
  subscribeActiveBrowserVerification,
} from '../../src/runtime/browser-verification';

describe('project browser verification registry', () => {
  it('keeps only an approved ephemeral project session and clears by matching id', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeActiveBrowserVerification(listener);
    setActiveBrowserVerification('project-1', {
      expiresAt: null,
      ok: true,
      origin: 'http://127.0.0.1:4173',
      scopes: ['page:read', 'page:pointer'],
      sessionId: 'browser_session_1234567890',
    }, 'http://127.0.0.1:4173/orders');
    expect(getActiveBrowserVerification('project-1')).toEqual({
      origin: 'http://127.0.0.1:4173',
      sessionId: 'browser_session_1234567890',
      url: 'http://127.0.0.1:4173/orders',
    });
    clearActiveBrowserVerification('project-1', 'different-session');
    expect(getActiveBrowserVerification('project-1')).toBeTruthy();
    clearActiveBrowserVerification('project-1', 'browser_session_1234567890');
    expect(getActiveBrowserVerification('project-1')).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
