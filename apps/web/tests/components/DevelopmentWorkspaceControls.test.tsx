// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DevelopmentWorkspaceControls } from '../../src/components/DevelopmentWorkspaceControls';
import { I18nProvider } from '../../src/i18n';
import {
  clearActiveBrowserVerification,
  setActiveBrowserVerification,
} from '../../src/runtime/browser-verification';

const PROJECT_ID = 'project-development';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const payload = url.endsWith('/development/configs')
      ? { configs: [], recommendedConfigId: null, scannedAt: '2026-08-25T00:00:00.000Z' }
      : { projectId: PROJECT_ID, state: 'idle', config: null, pid: null, url: null, startedAt: null, error: null, logs: [] };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});

afterEach(() => {
  clearActiveBrowserVerification(PROJECT_ID);
  cleanup();
  vi.unstubAllGlobals();
});

describe('DevelopmentWorkspaceControls', () => {
  it('lets the user disable automatic browser verification', async () => {
    const onMetadataChange = vi.fn();
    render(
      <I18nProvider initial="ko">
        <DevelopmentWorkspaceControls
          projectId={PROJECT_ID}
          metadata={{ kind: 'other', workMode: 'development', development: { autoVerify: true } }}
          resolvedDir="C:\\workspace\\app"
          onMetadataChange={onMetadataChange}
          onOpenUrl={vi.fn()}
          onOpenChanges={vi.fn()}
        />
      </I18nProvider>,
    );

    const checkbox = await screen.findByRole('checkbox', { name: '자동 검증' });
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    fireEvent.click(checkbox);

    expect(onMetadataChange).toHaveBeenCalledWith(expect.objectContaining({
      development: expect.objectContaining({ autoVerify: false }),
    }));
  });

  it('shows when an approved in-app browser tab is bound to the project', async () => {
    const { container } = render(
      <I18nProvider initial="ko">
        <DevelopmentWorkspaceControls
          projectId={PROJECT_ID}
          metadata={{ kind: 'other', workMode: 'development', development: { autoVerify: true } }}
          resolvedDir="C:\\workspace\\app"
          onMetadataChange={vi.fn()}
          onOpenUrl={vi.fn()}
          onOpenChanges={vi.fn()}
        />
      </I18nProvider>,
    );

    const indicator = container.querySelector('[data-active]');
    expect(indicator?.getAttribute('data-active')).toBe('false');

    setActiveBrowserVerification(PROJECT_ID, {
      expiresAt: null,
      ok: true,
      origin: 'http://127.0.0.1:9081',
      scopes: ['page:read', 'page:pointer'],
      sessionId: 'browser_session_1234567890',
    }, 'http://127.0.0.1:9081/aop');

    await waitFor(() => expect(indicator?.getAttribute('data-active')).toBe('true'));
  });
});
