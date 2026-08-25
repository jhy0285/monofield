import { describe, expect, it } from 'vitest';

import { resolveBrowserAccessPolicy } from '../../src/runtime/browser-access';

describe('embedded browser access policy', () => {
  it('keeps ordinary viewing available without page evidence or automation', () => {
    expect(resolveBrowserAccessPolicy('view', { desktopWebview: false })).toMatchObject({
      available: true,
      canAutomate: false,
      canCollectEvidence: false,
      canNavigate: true,
      requiresConfirmation: false,
    });
  });

  it('allows bounded evidence collection only through the desktop webview', () => {
    expect(resolveBrowserAccessPolicy('inspect', { desktopWebview: true })).toMatchObject({
      available: true,
      canAutomate: false,
      canCollectEvidence: true,
      requiresConfirmation: false,
    });
    expect(resolveBrowserAccessPolicy('inspect', { desktopWebview: false })).toMatchObject({
      available: false,
      canCollectEvidence: false,
    });
  });

  it('fails closed until the separate automation backend is connected', () => {
    expect(resolveBrowserAccessPolicy('automate', {
      automationBackendConnected: false,
      desktopWebview: true,
    })).toMatchObject({
      available: false,
      canAutomate: false,
      canCollectEvidence: false,
      requiresConfirmation: true,
    });
    expect(resolveBrowserAccessPolicy('automate', {
      automationBackendConnected: true,
      desktopWebview: true,
    })).toMatchObject({
      available: true,
      canAutomate: true,
      requiresConfirmation: true,
    });
  });
});
