// @vitest-environment jsdom

/**
 * Analytics + behaviour coverage for the failed-run support card.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/analytics/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/analytics/events')>();
  return {
    ...actual,
    trackRunFailedToastSurfaceView: vi.fn(),
  };
});

import { AmrGuidance } from '../../src/components/AmrGuidance';
import { trackRunFailedToastSurfaceView } from '../../src/analytics/events';

beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => store.delete(key),
      setItem: (key: string, value: string) => store.set(key, value),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function renderGuidance() {
  render(
    <AmrGuidance
      errorCode="AGENT_AUTH_REQUIRED"
      projectId="proj-1"
      projectKind="prototype"
      conversationId="conv-1"
      assistantMessageId="msg-amr"
      runId="run-9"
    />,
  );
}

describe('AmrGuidance', () => {
  it('fires surface_view once on mount with the full prop set', () => {
    renderGuidance();
    expect(screen.getByTestId('amr-guidance')).toBeTruthy();
    expect(trackRunFailedToastSurfaceView).toHaveBeenCalledTimes(1);
    expect(vi.mocked(trackRunFailedToastSurfaceView).mock.calls[0]![1]).toMatchObject({
      page_name: 'chat_panel',
      area: 'chat_panel',
      element: 'run_failed_toast',
      error_code: 'AGENT_AUTH_REQUIRED',
      project_id: 'proj-1',
      project_kind: 'prototype',
      conversation_id: 'conv-1',
      assistant_message_id: 'msg-amr',
      run_id: 'run-9',
    });
  });

  it('offers direct GitHub issue and problem-report routes', () => {
    renderGuidance();
    expect(screen.getByRole('link', { name: 'Open GitHub issue' }).getAttribute('href')).toBe(
      'https://github.com/jhy0285/monofield/issues/new',
    );
    expect(screen.getByRole('link', { name: 'Report a problem' }).getAttribute('href')).toBe(
      'https://github.com/jhy0285/monofield/issues/new?labels=bug&title=%5BProblem%5D%20',
    );
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
  });
});
