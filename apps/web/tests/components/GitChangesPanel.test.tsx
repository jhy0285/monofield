// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const BRANCHES = {
  repository: true,
  current: 'feature_test_yj',
  branches: [
    { name: 'feature_test_yj', fullName: 'refs/heads/feature_test_yj', current: true, remote: false, upstream: null },
    { name: 'main', fullName: 'refs/heads/main', current: false, remote: false, upstream: null },
  ],
  generatedAt: '2026-08-25T00:00:00.000Z',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const payload = url.includes('/git/diff') ? DIFF : url.includes('/git/branches') ? BRANCHES : STATUS;
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
  it('waits for the active module to resolve before requesting Git data', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();
    const view = render(
      <I18nProvider initial="ko">
        <GitChangesPanel
          projectId="project-gated"
          projectPath={null}
          projectSelectionReady={false}
          onOpenFile={vi.fn()}
        />
      </I18nProvider>,
    );

    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();

    view.rerender(
      <I18nProvider initial="ko">
        <GitChangesPanel
          projectId="project-gated"
          projectPath="agwserver"
          projectSelectionReady={false}
          onOpenFile={vi.fn()}
        />
      </I18nProvider>,
    );
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();

    view.rerender(
      <I18nProvider initial="ko">
        <GitChangesPanel
          projectId="project-gated"
          projectPath="agwserver"
          projectSelectionReady
          onOpenFile={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(await screen.findByText('port: 9081')).toBeTruthy();
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some((url) => url.includes('/git/status?projectPath=agwserver'))).toBe(true);
    expect(urls.some((url) => url.includes('/git/branches?projectPath=agwserver'))).toBe(true);
    expect(urls.every((url) => !url.endsWith('/git/status') && !url.endsWith('/git/branches'))).toBe(true);
  });

  it('restores the last module snapshot while refreshing it in the background', async () => {
    const statusB = {
      ...STATUS,
      branch: 'develop',
      files: [{ ...STATUS.files[0], path: 'src/service-b.ts' }],
      generatedAt: '2026-08-28T00:00:01.000Z',
    };
    const diffB = {
      ...DIFF,
      path: 'src/service-b.ts',
      patch: '@@ -1 +1 @@\n-old service\n+new service',
    };
    let serviceAStatusReads = 0;
    let resolveServiceARefresh: (response: Response) => void = () => {};
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/git/status') && url.includes('projectPath=service-a')) {
        serviceAStatusReads += 1;
        if (serviceAStatusReads > 1) {
          return await new Promise<Response>((resolve) => { resolveServiceARefresh = resolve; });
        }
      }
      const payload = url.includes('/git/diff')
        ? (url.includes('projectPath=service-b') ? diffB : DIFF)
        : url.includes('/git/branches')
          ? BRANCHES
          : url.includes('projectPath=service-b')
            ? statusB
            : STATUS;
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const view = render(
      <I18nProvider initial="ko">
        <GitChangesPanel projectId="project-snapshots" projectPath="service-a" onOpenFile={vi.fn()} />
      </I18nProvider>,
    );
    expect(await screen.findByText('port: 9081')).toBeTruthy();

    view.rerender(
      <I18nProvider initial="ko">
        <GitChangesPanel projectId="project-snapshots" projectPath="service-b" onOpenFile={vi.fn()} />
      </I18nProvider>,
    );
    expect(await screen.findByText('new service')).toBeTruthy();

    view.rerender(
      <I18nProvider initial="ko">
        <GitChangesPanel projectId="project-snapshots" projectPath="service-a" onOpenFile={vi.fn()} />
      </I18nProvider>,
    );
    expect(await screen.findByText('port: 9081')).toBeTruthy();
    expect((await screen.findByTestId('git-status-loading')).getAttribute('aria-busy')).toBe('true');

    resolveServiceARefresh(new Response(JSON.stringify(STATUS), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    await waitFor(() => expect(screen.queryByTestId('git-status-loading')).toBeNull());
  });

  it('clears stale changes and labels status and diff loading while the active server changes', async () => {
    const statusB = {
      ...STATUS,
      branch: 'develop',
      files: [{ ...STATUS.files[0], path: 'src/service-b.ts' }],
      generatedAt: '2026-08-28T00:00:01.000Z',
    };
    const diffB = {
      ...DIFF,
      path: 'src/service-b.ts',
      patch: '@@ -1 +1 @@\n-old service\n+new service',
    };
    let resolveStatusB: (response: Response) => void = () => {};
    let resolveDiffB: (response: Response) => void = () => {};
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/git/status') && url.includes('projectPath=service-b')) {
        return await new Promise<Response>((resolve) => { resolveStatusB = resolve; });
      }
      if (url.includes('/git/diff') && url.includes('projectPath=service-b')) {
        return await new Promise<Response>((resolve) => { resolveDiffB = resolve; });
      }
      const payload = url.includes('/git/diff') ? DIFF : url.includes('/git/branches') ? BRANCHES : STATUS;
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const view = render(
      <I18nProvider initial="ko">
        <GitChangesPanel projectId="project-1" projectPath="service-a" onOpenFile={vi.fn()} />
      </I18nProvider>,
    );
    expect(await screen.findByText('port: 9081')).toBeTruthy();

    view.rerender(
      <I18nProvider initial="ko">
        <GitChangesPanel projectId="project-1" projectPath="service-b" onOpenFile={vi.fn()} />
      </I18nProvider>,
    );
    expect((await screen.findByTestId('git-status-loading')).getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText('port: 9081')).toBeNull();

    resolveStatusB(new Response(JSON.stringify(statusB), { status: 200, headers: { 'content-type': 'application/json' } }));
    expect((await screen.findByTestId('git-diff-loading')).getAttribute('aria-busy')).toBe('true');
    resolveDiffB(new Response(JSON.stringify(diffB), { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(await screen.findByText('new service')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('git-diff-loading')).toBeNull());
  });

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
    expect(screen.getByTestId('git-split-canvas')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '브랜치 보기' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '통합 보기' }));
    await waitFor(() => expect(screen.queryByRole('columnheader', { name: '변경 전' })).toBeNull());
    expect(screen.getByLabelText('Git diff').textContent).toContain('-  port: 8081');
  });

  it('bypasses daemon Git caches when the user explicitly refreshes', async () => {
    render(
      <I18nProvider initial="ko">
        <GitChangesPanel projectId="project-1" projectPath="service-a" onOpenFile={vi.fn()} />
      </I18nProvider>,
    );

    await screen.findByText('port: 9081');
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Git 새로고침' }));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([input]) => String(input));
      expect(urls.some((url) => url.includes('/git/status?') && url.includes('refresh=1'))).toBe(true);
      expect(urls.some((url) => url.includes('/git/branches?') && url.includes('refresh=1'))).toBe(true);
    });
  });

  it('compares another branch without checking it out', async () => {
    render(
      <I18nProvider initial="ko">
        <GitChangesPanel projectId="project-1" onOpenFile={vi.fn()} />
      </I18nProvider>,
    );

    const picker = await screen.findByRole('combobox', { name: '브랜치 보기' });
    fireEvent.change(picker, { target: { value: 'refs/heads/main' } });

    await waitFor(() => expect(screen.getByRole('tab', { name: /커밋 비교 · main/ })).toBeTruthy());
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('branch=refs%2Fheads%2Fmain'),
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('switches the real working branch with an explicit dirty-tree strategy', async () => {
    let switched = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/git/switch') && method === 'POST') {
        switched = true;
        return new Response(JSON.stringify({ previousBranch: 'feature_test_yj', currentBranch: 'main', created: false, stashed: true, stashRef: 'abc123' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/git/branches')) {
        return new Response(JSON.stringify(switched ? {
          ...BRANCHES,
          current: 'main',
          branches: BRANCHES.branches.map((branch) => ({ ...branch, current: branch.name === 'main' })),
        } : BRANCHES), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/git/dirty')) return new Response(JSON.stringify({ repository: true, dirty: !switched, changeCount: switched ? 0 : 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.includes('/git/diff')) return new Response(JSON.stringify(DIFF), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify(switched ? { ...STATUS, branch: 'main', files: [] } : STATUS), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <I18nProvider initial="ko">
        <GitChangesPanel projectId="project-1" onOpenFile={vi.fn()} />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByTestId('git-branch-manager'));
    const manager = screen.getByTestId('git-branch-manager-panel');
    fireEvent.click(within(manager).getByRole('button', { name: '전환' }));
    const prompt = await screen.findByRole('alertdialog', { name: '미커밋 변경사항' });
    expect(prompt.textContent).toContain('1');
    fireEvent.click(within(prompt).getByRole('button', { name: '임시 보관 후 전환' }));

    await waitFor(() => expect(screen.getByText('작업 브랜치를 전환했습니다.')).toBeTruthy());
    const switchCall = fetchMock.mock.calls.find(([input, init]) => String(input).includes('/git/switch') && init?.method === 'POST');
    expect(JSON.parse(String(switchCall?.[1]?.body))).toMatchObject({ branch: 'refs/heads/main', strategy: 'stash' });
  });
});
