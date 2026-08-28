// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DevelopmentWorkspaceControls, parseRunArguments } from '../../src/components/DevelopmentWorkspaceControls';
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
  it('parses quoted additional run arguments without invoking a shell', () => {
    expect(parseRunArguments('--feature=orders "--label=Order service" --dry-run')).toEqual([
      '--feature=orders',
      '--label=Order service',
      '--dry-run',
    ]);
    expect(() => parseRunArguments('"unfinished')).toThrow('Unclosed quote');
  });

  it('shows a loading label and bypasses discovery cache on manual refresh', async () => {
    let resolveRefresh: (response: Response) => void = () => {};
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/development/configs?refresh=1')) {
        return await new Promise<Response>((resolve) => { resolveRefresh = resolve; });
      }
      const payload = url.includes('/development/configs')
        ? { configs: [], recommendedConfigId: null, scannedAt: '2026-08-27T00:00:00.000Z' }
        : { projectId: PROJECT_ID, state: 'idle', config: null, pid: null, url: null, startedAt: null, error: null, logs: [] };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <I18nProvider initial="ko">
        <DevelopmentWorkspaceControls
          projectId={PROJECT_ID}
          metadata={{ kind: 'other', workMode: 'development' }}
          resolvedDir="C:\\workspace"
          onMetadataChange={vi.fn()}
          onOpenUrl={vi.fn()}
          onOpenChanges={vi.fn()}
        />
      </I18nProvider>,
    );

    const refresh = await screen.findByTestId('development-detect');
    await waitFor(() => expect((refresh as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(refresh);
    await waitFor(() => expect(refresh.getAttribute('aria-busy')).toBe('true'));
    expect(refresh.textContent).toMatch(/불러오는 중|로딩/);
    expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${PROJECT_ID}/development/configs?refresh=1`);

    resolveRefresh(new Response(JSON.stringify({ configs: [], recommendedConfigId: null, scannedAt: '2026-08-27T00:00:01.000Z' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    await waitFor(() => expect(refresh.getAttribute('aria-busy')).toBe('false'));
  });

  it('drops the previous module path and forces detection when the working folder changes', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.includes('/development/configs')
        ? { configs: [], recommendedConfigId: null, scannedAt: '2026-08-27T00:00:00.000Z', activeProjectPath: '.' }
        : { projectId: PROJECT_ID, state: 'idle', config: null, pid: null, url: null, startedAt: null, error: null, logs: [] };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const props = {
      projectId: PROJECT_ID,
      metadata: { kind: 'other' as const, workMode: 'development' as const, development: { activeProjectPath: 'old-service' } },
      onMetadataChange: vi.fn(),
      onOpenUrl: vi.fn(),
      onOpenChanges: vi.fn(),
    };
    const view = render(
      <I18nProvider initial="ko">
        <DevelopmentWorkspaceControls {...props} resolvedDir="C:\\workspace-a" />
      </I18nProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('projectPath=old-service')));
    fetchMock.mockClear();

    view.rerender(
      <I18nProvider initial="ko">
        <DevelopmentWorkspaceControls {...props} resolvedDir="C:\\workspace-b" />
      </I18nProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${PROJECT_ID}/development/configs?refresh=1`));
  });

  it('selects an active module in a multi-project workspace and persists it', async () => {
    const onMetadataChange = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.includes('/development/configs')
        ? {
            configs: [],
            recommendedConfigId: null,
            scannedAt: '2026-08-27T00:00:00.000Z',
            activeProjectPath: 'aauserver',
            projects: [
              { path: 'aauserver', label: 'aauserver', markers: ['.git', 'pom.xml'] },
              { path: 'acrserver', label: 'acrserver', markers: ['.git', 'pom.xml'] },
            ],
          }
        : { projectId: PROJECT_ID, state: 'idle', config: null, pid: null, url: null, startedAt: null, error: null, logs: [] };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    render(
      <I18nProvider initial="ko">
        <DevelopmentWorkspaceControls
          projectId={PROJECT_ID}
          metadata={{ kind: 'other', workMode: 'development' }}
          resolvedDir="C:\\workspace"
          onMetadataChange={onMetadataChange}
          onOpenUrl={vi.fn()}
          onOpenChanges={vi.fn()}
        />
      </I18nProvider>,
    );

    const selector = await screen.findByTestId('development-active-project');
    expect((selector as HTMLSelectElement).value).toBe('aauserver');
    fireEvent.change(selector, { target: { value: 'acrserver' } });
    expect(onMetadataChange).toHaveBeenCalledWith(expect.objectContaining({
      development: expect.objectContaining({ activeProjectPath: 'acrserver' }),
    }));
  });

  it('shows Stop while the server starts, polls until ready, and can stop it', async () => {
    const config = {
      id: 'vite-dev',
      label: 'Vite · pnpm run dev',
      kind: 'node' as const,
      framework: 'Vite',
      cwd: '.',
      command: 'pnpm',
      args: ['run', 'dev'],
      source: './package.json#scripts.dev',
      port: 5173,
      url: 'http://127.0.0.1:5173',
    };
    let statusReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      let payload: unknown;
      if (url.endsWith('/development/configs')) {
        payload = { configs: [config], recommendedConfigId: config.id, scannedAt: '2026-08-27T00:00:00.000Z' };
      } else if (url.endsWith('/development/server/start') && method === 'POST') {
        payload = { projectId: PROJECT_ID, state: 'starting', config, pid: 4512, url: config.url, startedAt: '2026-08-27T00:00:00.000Z', error: null, logs: [] };
      } else if (url.endsWith('/development/server/stop') && method === 'POST') {
        payload = { projectId: PROJECT_ID, state: 'idle', config, pid: null, url: config.url, startedAt: '2026-08-27T00:00:00.000Z', error: null, logs: [] };
      } else {
        statusReads += 1;
        payload = statusReads === 1
          ? { projectId: PROJECT_ID, state: 'idle', config: null, pid: null, url: null, startedAt: null, error: null, logs: [] }
          : { projectId: PROJECT_ID, state: 'ready', config, pid: 4512, url: config.url, startedAt: '2026-08-27T00:00:00.000Z', error: null, logs: [] };
      }
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onOpenUrl = vi.fn();

    render(
      <I18nProvider initial="ko">
        <DevelopmentWorkspaceControls
          projectId={PROJECT_ID}
          metadata={{ kind: 'other', workMode: 'development' }}
          resolvedDir="C:\\workspace\\app"
          onMetadataChange={vi.fn()}
          onOpenUrl={onOpenUrl}
          onOpenChanges={vi.fn()}
        />
      </I18nProvider>,
    );

    const action = await screen.findByTestId('development-run-action');
    await waitFor(() => expect((action as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(action);
    await waitFor(() => expect(action.textContent).toContain('중지'));
    const progress = screen.getByTestId('development-launch-progress');
    expect(progress.textContent).toContain('시작 중');
    expect(progress.textContent).toContain('Vite · pnpm run dev');
    expect(progress.textContent).toContain('pnpm run dev');
    await waitFor(() => expect(onOpenUrl).toHaveBeenCalledTimes(1), { timeout: 2_000 });

    fireEvent.click(action);
    await waitFor(() => expect(action.textContent).toContain('실행'));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/development/server/stop`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
  });

  it('switches between independently running workspace modules without stopping siblings', async () => {
    const configA = {
      id: 'service-dev', label: 'Service A', kind: 'node' as const, framework: 'Vite', cwd: '.',
      command: 'pnpm', args: ['dev'], source: 'package.json', port: 5101, url: 'http://127.0.0.1:5101',
    };
    const configB = { ...configA, label: 'Service B', port: 5102, url: 'http://127.0.0.1:5102' };
    const statusA = { projectId: PROJECT_ID, projectPath: 'service-a', state: 'ready', config: configA, pid: 7101, url: configA.url, startedAt: '2026-08-28T00:00:00.000Z', error: null, logs: ['A ready'] };
    const statusB = { projectId: PROJECT_ID, projectPath: 'service-b', state: 'idle', config: null, pid: null, url: null, startedAt: null, error: null, logs: [] };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      let payload: unknown;
      if (url.includes('/development/configs')) {
        const activeProjectPath = url.includes('service-b') ? 'service-b' : 'service-a';
        payload = {
          configs: [activeProjectPath === 'service-a' ? configA : configB],
          recommendedConfigId: 'service-dev',
          scannedAt: '2026-08-28T00:00:00.000Z',
          activeProjectPath,
          projects: [
            { path: 'service-a', label: 'service-a', markers: ['package.json'] },
            { path: 'service-b', label: 'service-b', markers: ['package.json'] },
          ],
        };
      } else if (url.endsWith('/development/servers')) {
        payload = { servers: [statusA] };
      } else {
        payload = url.includes('projectPath=service-b') ? statusB : statusA;
      }
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <I18nProvider initial="ko">
        <DevelopmentWorkspaceControls
          projectId={PROJECT_ID}
          metadata={{ kind: 'other', workMode: 'development', development: { activeProjectPath: 'service-a' } }}
          resolvedDir="C:\\workspace"
          onMetadataChange={vi.fn()}
          onOpenUrl={vi.fn()}
          onOpenChanges={vi.fn()}
        />
      </I18nProvider>,
    );

    const selector = await screen.findByTestId('development-active-project');
    await waitFor(() => expect(screen.getByTestId('development-run-action').textContent).toContain('중지'));
    expect(screen.getByTestId('development-running-count').textContent).toContain('1');
    expect(selector.textContent).toContain('● service-a');

    fireEvent.change(selector, { target: { value: 'service-b' } });
    await waitFor(() => expect(screen.getByTestId('development-run-action').textContent).toContain('실행'));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/development/server?projectPath=service-b'));
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);

    fireEvent.change(selector, { target: { value: 'service-a' } });
    await waitFor(() => expect(screen.getByTestId('development-run-action').textContent).toContain('중지'));
  });

  it('keeps the complete development server error available instead of shortening it', async () => {
    const error = 'Port 8080 is already in use by another process. MonoField did not open that unrelated server.';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const payload = String(input).includes('/development/configs')
        ? { configs: [], recommendedConfigId: null, scannedAt: '2026-08-28T00:00:00.000Z' }
        : { projectId: PROJECT_ID, state: 'failed', config: null, pid: null, url: null, startedAt: null, error, logs: [] };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    render(
      <I18nProvider initial="ko">
        <DevelopmentWorkspaceControls
          projectId={PROJECT_ID}
          metadata={{ kind: 'other', workMode: 'development' }}
          resolvedDir="C:\\workspace\\app"
          onMetadataChange={vi.fn()}
          onOpenUrl={vi.fn()}
          onOpenChanges={vi.fn()}
        />
      </I18nProvider>,
    );

    const alert = await screen.findByTestId('development-run-error');
    expect(alert.textContent).toBe(error);
    expect(alert.getAttribute('title')).toBe(error);
  });

  it('shows the selected profile, exact command, URL, and a named configuration refresh action', async () => {
    const config = {
      id: 'spring-dev',
      label: 'Spring Boot · Maven Wrapper · dev',
      kind: 'java' as const,
      framework: 'Spring Boot',
      cwd: '.',
      command: 'C:\\workspace\\mvnw.cmd',
      args: ['spring-boot:run', '-Dspring-boot.run.profiles=dev'],
      source: 'pom.xml + src/main/resources/application-dev.yml',
      profile: 'dev',
      port: 8082,
      url: 'http://127.0.0.1:8082/aop',
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const payload = String(input).includes('/development/configs')
        ? { configs: [config], recommendedConfigId: config.id, scannedAt: '2026-08-27T00:00:00.000Z' }
        : { projectId: PROJECT_ID, state: 'idle', config: null, pid: null, url: null, startedAt: null, error: null, logs: [] };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    render(
      <I18nProvider initial="ko">
        <DevelopmentWorkspaceControls
          projectId={PROJECT_ID}
          metadata={{ kind: 'other', workMode: 'development' }}
          resolvedDir="C:\\workspace"
          onMetadataChange={vi.fn()}
          onOpenUrl={vi.fn()}
          onOpenChanges={vi.fn()}
        />
      </I18nProvider>,
    );

    const summary = await screen.findByTestId('development-run-summary');
    expect(summary.textContent).toContain('SPRING_PROFILES_ACTIVE=dev');
    expect(summary.textContent).toContain('mvnw.cmd spring-boot:run -Dspring-boot.run.profiles=dev');
    expect(summary.textContent).toContain('http://127.0.0.1:8082/aop');
    expect(screen.getByTestId('development-detect').textContent).toContain('실행 구성 다시 찾기');
  });

  it('persists a custom Spring profile and additional application arguments', async () => {
    const config = {
      id: 'spring-local',
      label: 'Spring Boot · Maven Wrapper · local',
      kind: 'java' as const,
      framework: 'Spring Boot',
      cwd: '.',
      command: 'C:\\workspace\\mvnw.cmd',
      args: ['spring-boot:run', '-Dspring-boot.run.profiles=local'],
      source: 'pom.xml + application-local.yml',
      profile: 'local',
      port: 9092,
      url: 'http://127.0.0.1:9092/aau',
    };
    const onMetadataChange = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const payload = String(input).includes('/development/configs')
        ? { configs: [config], recommendedConfigId: config.id, scannedAt: '2026-08-27T00:00:00.000Z' }
        : { projectId: PROJECT_ID, state: 'idle', config: null, pid: null, url: null, startedAt: null, error: null, logs: [] };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    render(
      <I18nProvider initial="ko">
        <DevelopmentWorkspaceControls
          projectId={PROJECT_ID}
          metadata={{ kind: 'other', workMode: 'development' }}
          resolvedDir="C:\\workspace"
          onMetadataChange={onMetadataChange}
          onOpenUrl={vi.fn()}
          onOpenChanges={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByTestId('development-run-settings'));
    fireEvent.change(screen.getByLabelText('Spring 프로필'), { target: { value: 'prod' } });
    fireEvent.change(screen.getByLabelText('추가 애플리케이션 인자'), { target: { value: '--feature=orders "--label=Order service"' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(onMetadataChange).toHaveBeenCalledWith(expect.objectContaining({
      development: expect.objectContaining({
        runConfigId: 'spring-local',
        runProfile: 'prod',
        runArguments: '--feature=orders "--label=Order service"',
      }),
    }));
  });

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
