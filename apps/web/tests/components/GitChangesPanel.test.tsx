// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitChangesPanel } from '../../src/components/GitChangesPanel';
import { I18nProvider } from '../../src/i18n';

const STATUS = {
  repository: true,
  branch: 'feature_test_yj',
  head: 'abc1234',
  files: [{
    path: 'src/main/resources/application.yml',
    status: 'modified',
    indexStatus: ' ',
    worktreeStatus: 'M',
    staged: false,
    unstaged: true,
  }],
  generatedAt: '2026-08-25T00:00:00.000Z',
};

const DIFF = {
  path: 'src/main/resources/application.yml',
  scope: 'working',
  patch: '@@ -1,2 +1,2 @@\n server:\n-  port: 8081\n+  port: 9081',
  binary: false,
  truncated: false,
  maxPatchBytes: 100_000,
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const payload = url.includes('/git/diff') ? DIFF : STATUS;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('GitChangesPanel', () => {
  it('defaults to a Korean Before / After comparison and keeps unified view available', async () => {
    render(
      <I18nProvider initial="ko">
        <GitChangesPanel projectId="project-1" onOpenFile={vi.fn()} />
      </I18nProvider>,
    );

    expect(await screen.findByRole('columnheader', { name: '변경 전' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: '변경 후' })).toBeTruthy();
    expect(screen.getByText('port: 8081')).toBeTruthy();
    expect(screen.getByText('port: 9081')).toBeTruthy();
    expect(screen.getByRole('button', { name: '좌우 비교' }).getAttribute('aria-pressed')).toBe('true');
    const splitPatch = screen.getByRole('table', { name: 'Git diff' });
    expect(splitPatch.getAttribute('tabindex')).toBe('0');
    expect(splitPatch.getAttribute('data-scroll-axis')).toBe('both');

    fireEvent.click(screen.getByRole('button', { name: '통합 보기' }));
    await waitFor(() => expect(screen.queryByRole('columnheader', { name: '변경 전' })).toBeNull());
    expect(screen.getByLabelText('Git diff').textContent).toContain('-  port: 8081');
  });
});
