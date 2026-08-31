// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectMetadata } from '@open-design/contracts';

import {
  activeModuleDatabaseContext,
  DevelopmentWorkspaceControls,
  metadataWithActiveDevelopmentModule,
  metadataWithSelectedModuleDatabase,
  parseRunArguments,
  parseRunEnvironment,
} from '../../src/components/DevelopmentWorkspaceControls';
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
  it('keeps database selections and their connection policies isolated by workspace module', () => {
    const legacy: ProjectMetadata = {
      kind: 'other',
      workMode: 'development',
      databaseContext: { connectionId: 'db-a', label: 'A', useForDevelopment: true },
      development: { activeProjectPath: 'service-a' },
    };

    const serviceB = metadataWithActiveDevelopmentModule(legacy, 'service-b', 'service-a');
    expect(serviceB.databaseContext).toBeUndefined();
    expect(serviceB.development?.databaseContextsByProject).toEqual({
      'service-a': { connectionId: 'db-a', label: 'A', useForDevelopment: true },
    });

    const selectedB = metadataWithSelectedModuleDatabase(
      serviceB,
      'service-b',
      { connectionId: 'db-b', label: 'B', useForDevelopment: true },
    );
    expect(activeModuleDatabaseContext(selectedB)?.connectionId).toBe('db-b');

    const serviceA = metadataWithActiveDevelopmentModule(selectedB, 'service-a', 'service-b');
    expect(activeModuleDatabaseContext(serviceA)?.connectionId).toBe('db-a');
    expect(serviceA.development?.databaseContextsByProject).toEqual({
      'service-a': { connectionId: 'db-a', label: 'A', useForDevelopment: true },
      'service-b': { connectionId: 'db-b', label: 'B', useForDevelopment: true },
    });

    const disconnectedA = metadataWithSelectedModuleDatabase(serviceA, 'service-a', null);
    expect(activeModuleDatabaseContext(disconnectedA)).toBeNull();
    expect(disconnectedA.databaseContext).toBeUndefined();
    expect(disconnectedA.development?.databaseContextsByProject).toEqual({
      'service-b': { connectionId: 'db-b', label: 'B', useForDevelopment: true },
    });
  });

  it('parses quoted additional run arguments without invoking a shell', () => {
    expect(parseRunArguments('--feature=orders "--label=Order service" --dry-run')).toEqual([
      '--feature=orders',
      '--label=Order service',
      '--dry-run',
    ]);
    expect(() => parseRunArguments('"unfinished')).toThrow('Unclosed quote');
  });

  it('parses session environment values while reserving broker-owned variables', () => {
    expect(parseRunEnvironment('FEATURE_ORDERS=true\n# local only\nLOG_LEVEL=debug=value')).toEqual({
      FEATURE_ORDERS: 'true',
      LOG_LEVEL: 'debug=value',
    });
    expect(() => parseRunEnvironment('PORT=9000')).toThrow(/reserved/i);
    expect(() => parseRunEnvironment('SERVER_PORT=9000')).toThrow(/reserved/i);
    expect(() => parseRunEnvironment('FEATURE=true\nFEATURE=false')).toThrow(/duplicated/i);
  });

  it('shows a loading label and bypasses discovery cache on manual refresh', async () => {
    let resolveRefresh: (response: Response) => void = () => {};
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/development/configs?') && url.includes('refresh=1')) {
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
    expect(screen.getByTestId('development-project-loading').textContent).toMatch(/불러오는 중|로딩/);
    expect(fetchMock.mock.calls.some(([input]) => {
      const url = String(input);
      return url.includes(`/api/projects/${PROJECT_ID}/development/configs?`) && url.includes('refresh=1');
    })).toBe(true);

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
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('projectPath=old-service'))).toBe(true));
    fetchMock.mockClear();

    view.rerender(
      <I18nProvider initial="ko">
        <DevelopmentWorkspaceControls {...props} resolvedDir="C:\\workspace-b" />
      </I18nProvider>,
    );
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === `/api/projects/${PROJECT_ID}/development/configs?refresh=1`)).toBe(true));
  });

  it('shows a partial stop-all failure when changing the working folder', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      let payload: unknown;
      if (url.endsWith('/development/server/stop-all') && init?.method === 'POST') {
        payload = {
          servers: [{
            projectId: PROJECT_ID,
            projectPath: 'service-a',
            state: 'ready',
            config: null,
            pid: 8123,
            url: 'http://127.0.0.1:8080',
            startedAt: '2026-08-28T00:00:00.000Z',
            error: 'taskkill denied',
            logs: [],
          }],
          failures: [{ projectPath: 'service-a', error: 'taskkill denied' }],
        };
      } else if (url.includes('/development/configs')) {
        payload = { configs: [], recommendedConfigId: null, scannedAt: '2026-08-28T00:00:00.000Z', activeProjectPath: '.' };
      } else if (url.includes('/development/servers')) {
        payload = { servers: [] };
      } else {
        payload = { projectId: PROJECT_ID, projectPath: '.', state: 'idle', config: null, pid: null, url: null, startedAt: null, error: null, logs: [] };
      }
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const props = {
      projectId: PROJECT_ID,
      metadata: { kind: 'other' as const, workMode: 'development' as const },
      onMetadataChange: vi.fn(),
      onOpenUrl: vi.fn(),
      onOpenChanges: vi.fn(),
    };
    const view = render(
      <I18nProvider initial="ko">
        <DevelopmentWorkspaceControls {...props} resolvedDir="C:\\workspace-a" />
      </I18nProvider>,
    );
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/development/configs'))).toBe(true));

    view.rerender(
      <I18nProvider initial="ko">
        <DevelopmentWorkspaceControls {...props} resolvedDir="C:\\workspace-b" />
      </I18nProvider>,
    );

    const alert = await screen.findByTestId('development-run-error');
    expect(alert.textContent).toContain('service-a: taskkill denied');
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
    expect(selector.textContent).toContain('aauserver');
    fireEvent.click(selector);
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /acrserver/ }));
    await waitFor(() => expect(onMetadataChange).toHaveBeenCalledWith(expect.objectContaining({
      development: expect.objectContaining({ activeProjectPath: 'acrserver' }),
    })));
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
        body: JSON.stringify({ projectPath: '.' }),
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
      } else if (url.includes('/development/servers')) {
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
    fireEvent.click(selector);
    expect(screen.getByRole('menuitemradio', { name: /service-a/ }).getAttribute('data-state')).toBe('ready');
    expect(screen.getByRole('menuitemradio', { name: /service-b/ }).getAttribute('data-state')).toBe('idle');

    fireEvent.click(screen.getByRole('menuitemradio', { name: /service-b/ }));
    await waitFor(() => expect(screen.getByTestId('development-run-action').textContent).toContain('실행'));
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/development/server?projectPath=service-b'))).toBe(true);
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);

    fireEvent.click(selector);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /service-a/ }));
    await waitFor(() => expect(screen.getByTestId('development-run-action').textContent).toContain('중지'));
  });

  it('keeps run configuration, profile, and arguments isolated across A to B to A module switches', async () => {
    const configA = {
      id: 'spring-a', label: 'Service A · Spring', kind: 'java' as const, framework: 'Spring Boot', cwd: '.',
      command: 'mvnw.cmd', args: ['spring-boot:run'], source: 'pom.xml', profile: 'local', port: 8101,
      url: 'http://127.0.0.1:8101',
    };
    const configB = {
      ...configA, id: 'spring-b', label: 'Service B · Spring', profile: 'dev', port: 8102,
      url: 'http://127.0.0.1:8102',
    };
    const startBodies: Array<Record<string, any>> = [];
    const idle = (projectPath: string) => ({
      projectId: PROJECT_ID, projectPath, state: 'idle', config: null, pid: null, url: null,
      startedAt: null, error: null, logs: [],
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const requestedPath = url.includes('projectPath=service-b') ? 'service-b' : 'service-a';
      if (url.includes('/development/configs')) {
        const config = requestedPath === 'service-b' ? configB : configA;
        return new Response(JSON.stringify({
          configs: [config], recommendedConfigId: config.id, scannedAt: '2026-08-28T00:00:00.000Z',
          activeProjectPath: requestedPath,
          projects: [
            { path: 'service-a', label: 'service-a', markers: ['pom.xml'] },
            { path: 'service-b', label: 'service-b', markers: ['pom.xml'] },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/development/servers')) {
        return new Response(JSON.stringify({ servers: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/development/server/start') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        startBodies.push(body);
        return new Response(JSON.stringify(idle(body.projectPath)), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify(idle(requestedPath)), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    render(
      <I18nProvider initial="ko">
        <DevelopmentWorkspaceControls
          projectId={PROJECT_ID}
          metadata={{
            kind: 'other',
            workMode: 'development',
            development: {
              activeProjectPath: 'service-a',
              runOverridesByProject: {
                'service-a': { configId: 'spring-a', profile: 'prod', arguments: '--module=A' },
                'service-b': { configId: 'spring-b', profile: 'test', arguments: '--module=B' },
              },
            },
          }}
          resolvedDir="C:\\workspace"
          onMetadataChange={vi.fn()}
          onOpenUrl={vi.fn()}
          onOpenChanges={vi.fn()}
        />
      </I18nProvider>,
    );

    const startCurrent = async (expectedCount: number) => {
      const action = await screen.findByTestId('development-run-action');
      await waitFor(() => expect((action as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(action);
      await waitFor(() => expect(startBodies).toHaveLength(expectedCount));
    };
    const switchTo = async (label: RegExp) => {
      fireEvent.click(screen.getByTestId('development-active-project'));
      fireEvent.click(screen.getByRole('menuitemradio', { name: label }));
      await waitFor(() => expect((screen.getByTestId('development-run-action') as HTMLButtonElement).disabled).toBe(false));
    };

    await startCurrent(1);
    await switchTo(/service-b/);
    await startCurrent(2);
    await switchTo(/service-a/);
    await startCurrent(3);

    expect(startBodies).toHaveLength(3);
    expect(startBodies[0]).toMatchObject({
      configId: 'spring-a', projectPath: 'service-a',
      overrides: { profile: 'prod', applicationArgs: ['--module=A'] },
    });
    expect(startBodies[1]).toMatchObject({
      configId: 'spring-b', projectPath: 'service-b',
      overrides: { profile: 'test', applicationArgs: ['--module=B'] },
    });
    expect(startBodies[2]).toMatchObject({
      configId: 'spring-a', projectPath: 'service-a',
      overrides: { profile: 'prod', applicationArgs: ['--module=A'] },
    });
  });

  it('discards an open module run-settings draft before switching to a sibling module', async () => {
    const configA = {
      id: 'spring-a', label: 'Service A · Spring', kind: 'java' as const, framework: 'Spring Boot', cwd: '.',
      command: 'mvnw.cmd', args: ['spring-boot:run'], source: 'pom.xml', profile: 'local', port: 8101,
      url: 'http://127.0.0.1:8101',
    };
    const configB = {
      ...configA, id: 'spring-b', label: 'Service B · Spring', profile: 'dev', port: 8102,
      url: 'http://127.0.0.1:8102',
    };
    const idle = (projectPath: string) => ({
      projectId: PROJECT_ID, projectPath, state: 'idle', config: null, pid: null, url: null,
      startedAt: null, error: null, logs: [],
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const requestedPath = url.includes('projectPath=service-b') ? 'service-b' : 'service-a';
      if (url.includes('/development/configs')) {
        const config = requestedPath === 'service-b' ? configB : configA;
        return new Response(JSON.stringify({
          configs: [config], recommendedConfigId: config.id, scannedAt: '2026-08-28T00:00:00.000Z',
          activeProjectPath: requestedPath,
          projects: [
            { path: 'service-a', label: 'service-a', markers: ['pom.xml'] },
            { path: 'service-b', label: 'service-b', markers: ['pom.xml'] },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/development/servers')) {
        return new Response(JSON.stringify({ servers: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify(idle(requestedPath)), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    render(
      <I18nProvider initial="ko">
        <DevelopmentWorkspaceControls
          projectId={PROJECT_ID}
          metadata={{
            kind: 'other',
            workMode: 'development',
            development: {
              activeProjectPath: 'service-a',
              runOverridesByProject: {
                'service-a': { configId: 'spring-a', profile: 'prod', arguments: '--module=A' },
                'service-b': { configId: 'spring-b', profile: 'test', arguments: '--module=B' },
              },
            },
          }}
          resolvedDir="C:\\workspace"
          onMetadataChange={vi.fn()}
          onOpenUrl={vi.fn()}
          onOpenChanges={vi.fn()}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect((screen.getByTestId('development-run-action') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('development-run-settings'));
    fireEvent.change(screen.getByLabelText('Spring 프로필'), { target: { value: 'should-stay-in-a' } });
    fireEvent.change(screen.getByLabelText('추가 애플리케이션 인자'), { target: { value: '--module=stale-a' } });

    fireEvent.click(screen.getByTestId('development-active-project'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /service-b/ }));

    await waitFor(() => expect((screen.getByTestId('development-run-action') as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole('button', { name: '저장' })).toBeNull();
    fireEvent.click(screen.getByTestId('development-run-settings'));
    expect((screen.getByLabelText('Spring 프로필') as HTMLInputElement).value).toBe('test');
    expect((screen.getByLabelText('추가 애플리케이션 인자') as HTMLInputElement).value).toBe('--module=B');
  });

  it('shows a loading state while switching modules and exposes the selected server log', async () => {
    const config = {
      id: 'service-dev', label: 'Service', kind: 'node' as const, framework: 'Vite', cwd: '.',
      command: 'pnpm', args: ['dev'], source: 'package.json', port: 5101, url: 'http://127.0.0.1:5101',
    };
    let resolveServiceB: (response: Response) => void = () => {};
    const statusA = {
      projectId: PROJECT_ID, projectPath: 'service-a', state: 'ready', config, pid: 7101,
      url: config.url, startedAt: '2026-08-28T00:00:00.000Z', error: null,
      logs: ['Service A booting', 'Service A ready'],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/development/configs') && url.includes('service-b')) {
        return await new Promise<Response>((resolve) => { resolveServiceB = resolve; });
      }
      if (url.includes('/development/configs')) {
        return new Response(JSON.stringify({
          configs: [config], recommendedConfigId: config.id, scannedAt: '2026-08-28T00:00:00.000Z',
          activeProjectPath: 'service-a',
          projects: [
            { path: 'service-a', label: 'service-a', markers: ['package.json'] },
            { path: 'service-b', label: 'service-b', markers: ['package.json'] },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/development/servers')) {
        return new Response(JSON.stringify({ servers: [{ ...statusA, logs: [] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const payload = url.includes('service-b')
        ? { ...statusA, projectPath: 'service-b', state: 'idle', config: null, pid: null, url: null, startedAt: null, logs: [] }
        : statusA;
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
    fireEvent.click(await screen.findByTestId('development-server-logs-toggle'));
    const log = await screen.findByTestId('development-server-logs');
    expect(log.textContent).toContain('Service A ready');

    fireEvent.click(selector);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /service-b/ }));
    expect((await screen.findByTestId('development-project-loading')).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByTestId('development-project-loading').textContent).toMatch(/service-b/);

    resolveServiceB(new Response(JSON.stringify({
      configs: [config], recommendedConfigId: config.id, scannedAt: '2026-08-28T00:00:01.000Z',
      activeProjectPath: 'service-b',
      projects: [
        { path: 'service-a', label: 'service-a', markers: ['package.json'] },
        { path: 'service-b', label: 'service-b', markers: ['package.json'] },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await waitFor(() => expect(screen.queryByTestId('development-project-loading')).toBeNull());
  });

  it('removes stale running summaries after the daemon no longer reports the process', async () => {
    const config = {
      id: 'vite-dev', label: 'Vite', kind: 'node' as const, framework: 'Vite', cwd: '.',
      command: 'pnpm', args: ['run', 'dev'], source: 'package.json', port: 5173,
      url: 'http://127.0.0.1:5173',
    };
    const ready = {
      projectId: PROJECT_ID, projectPath: '.', state: 'ready', config, pid: 5173,
      url: config.url, startedAt: '2026-08-28T00:00:00.000Z', error: null, logs: [],
    };
    let summaryCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      let payload: unknown;
      if (url.includes('/development/configs')) {
        payload = { configs: [config], recommendedConfigId: config.id, scannedAt: '2026-08-28T00:00:00.000Z', activeProjectPath: '.' };
      } else if (url.includes('/development/servers')) {
        summaryCalls += 1;
        payload = { servers: summaryCalls === 1 ? [ready] : [] };
      } else {
        payload = ready;
      }
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

    await waitFor(() => expect(screen.getByTestId('development-running-count').textContent).toContain('1'));
    await waitFor(() => expect(screen.queryByTestId('development-running-count')).toBeNull(), { timeout: 3_500 });
    expect(summaryCalls).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('development-run-action').textContent).toContain('실행');
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

  it('shows manual servlet-container setup and does not offer to run it automatically', async () => {
    const config = {
      id: 'spring-war-manual',
      label: 'Spring Framework · Maven WAR · Manual container setup',
      kind: 'java' as const,
      framework: 'Spring Framework',
      cwd: '.',
      command: 'mvn',
      args: [],
      source: 'pom.xml · WAR/Servlet project',
      launchMode: 'manual' as const,
      manualSetup: 'Configure a local Tomcat or Jetty container, build and deploy this WAR there.',
      port: 8080,
      url: 'http://127.0.0.1:8080',
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const payload = String(input).includes('/development/configs')
        ? { configs: [config], recommendedConfigId: config.id, scannedAt: '2026-08-31T00:00:00.000Z' }
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

    const run = await screen.findByTestId('development-run-action');
    expect((run as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('development-run-settings') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('development-manual-run-setup').textContent).toContain('Tomcat/Jetty/Cargo');
  });

  it('keeps servlet-plugin owned overrides out of the UI and start request', async () => {
    const config = {
      id: 'spring-framework-jetty',
      label: 'Spring Framework · Jetty · Maven',
      kind: 'java' as const,
      framework: 'Spring Framework',
      cwd: '.',
      command: 'mvn',
      args: ['jetty:run'],
      source: 'pom.xml · jetty-maven-plugin',
      launchMode: 'auto' as const,
      port: 9192,
      url: 'http://127.0.0.1:9192/catalog',
    };
    const startBodies: Array<Record<string, any>> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      let payload: unknown;
      if (url.includes('/development/configs')) {
        payload = { configs: [config], recommendedConfigId: config.id, scannedAt: '2026-08-31T00:00:00.000Z' };
      } else if (url.includes('/development/servers')) {
        payload = { servers: [] };
      } else if (url.endsWith('/development/server/start') && init?.method === 'POST') {
        startBodies.push(JSON.parse(String(init.body)));
        payload = { projectId: PROJECT_ID, state: 'idle', config: null, pid: null, url: null, startedAt: null, error: null, logs: [] };
      } else {
        payload = { projectId: PROJECT_ID, state: 'idle', config: null, pid: null, url: null, startedAt: null, error: null, logs: [] };
      }
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    render(
      <I18nProvider initial="ko">
        <DevelopmentWorkspaceControls
          projectId={PROJECT_ID}
          metadata={{
            kind: 'other',
            workMode: 'development',
            development: {
              runOverridesByProject: {
                '.': { configId: config.id, arguments: '"stale', port: 6553, url: 'not-a-url' },
              },
            },
          }}
          resolvedDir="C:\\workspace"
          onMetadataChange={vi.fn()}
          onOpenUrl={vi.fn()}
          onOpenChanges={vi.fn()}
        />
      </I18nProvider>,
    );

    const run = await screen.findByTestId('development-run-action');
    await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(run);
    await waitFor(() => expect(startBodies).toHaveLength(1));
    expect(startBodies[0]?.overrides).toEqual({});

    const settings = screen.getByTestId('development-run-settings');
    await waitFor(() => expect((settings as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(settings);
    expect(screen.getByTestId('development-servlet-plugin-settings').textContent).toContain('빌드 플러그인');
    expect(screen.queryByTestId('development-run-port')).toBeNull();
    expect(screen.queryByTestId('development-run-url')).toBeNull();
    expect(screen.getByTestId('development-run-environment')).toBeTruthy();
  });

  it('shows the active process command and port instead of stale detected defaults', async () => {
    const detected = {
      id: 'node-dev',
      label: 'Node.js · npm run dev',
      kind: 'node' as const,
      framework: 'Node.js',
      cwd: '.',
      command: 'npm',
      args: ['run', 'dev'],
      source: 'package.json',
      port: 3000,
      url: 'http://127.0.0.1:3000',
    };
    const running = {
      ...detected,
      args: ['run', 'dev', '--', '--port', '48761'],
      port: 48761,
      url: 'http://127.0.0.1:48761',
    };
    const status = {
      projectId: PROJECT_ID,
      projectPath: '.',
      state: 'ready',
      config: running,
      pid: 48761,
      url: running.url,
      startedAt: '2026-08-28T00:00:00.000Z',
      error: null,
      logs: [],
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.includes('/development/configs')
        ? { configs: [detected], recommendedConfigId: detected.id, scannedAt: '2026-08-28T00:00:00.000Z', activeProjectPath: '.' }
        : url.includes('/development/servers')
          ? { servers: [status] }
          : status;
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
    await waitFor(() => expect(summary.textContent).toContain('http://127.0.0.1:48761'));
    expect(summary.textContent).toContain('npm run dev -- --port 48761');
    expect(summary.textContent).not.toContain('http://127.0.0.1:3000');
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
        runOverridesByProject: {
          '.': expect.objectContaining({
            configId: 'spring-local',
            profile: 'prod',
            arguments: '--feature=orders "--label=Order service"',
          }),
        },
      }),
    }));
  });

  it('persists module network overrides but keeps environment values in the current UI session', async () => {
    const config = {
      id: 'vite-dev',
      label: 'Vite · pnpm run dev',
      kind: 'node' as const,
      framework: 'Vite',
      cwd: '.',
      command: 'pnpm',
      args: ['run', 'dev'],
      source: 'package.json',
      port: 5173,
      url: 'http://127.0.0.1:5173',
    };
    const onMetadataChange = vi.fn();
    const startedConfig = { ...config, port: 5199, url: 'http://127.0.0.1:5199/orders' };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      let payload: unknown;
      if (url.includes('/development/configs')) {
        payload = {
          configs: [config],
          recommendedConfigId: config.id,
          scannedAt: '2026-08-28T00:00:00.000Z',
          activeProjectPath: 'service-a',
        };
      } else if (url.includes('/development/servers')) {
        payload = { servers: [] };
      } else if (url.endsWith('/development/server/start') && init?.method === 'POST') {
        payload = {
          projectId: PROJECT_ID,
          projectPath: 'service-a',
          state: 'ready',
          config: startedConfig,
          pid: 5200,
          url: startedConfig.url,
          startedAt: '2026-08-28T00:00:00.000Z',
          error: null,
          logs: [],
        };
      } else {
        payload = {
          projectId: PROJECT_ID,
          projectPath: 'service-a',
          state: 'idle',
          config: null,
          pid: null,
          url: null,
          startedAt: null,
          error: null,
          logs: [],
        };
      }
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const baseMetadata = {
      kind: 'other' as const,
      workMode: 'development' as const,
      development: { activeProjectPath: 'service-a' },
    };
    const view = render(
      <I18nProvider initial="ko">
        <DevelopmentWorkspaceControls
          projectId={PROJECT_ID}
          metadata={baseMetadata}
          resolvedDir="C:\\workspace"
          onMetadataChange={onMetadataChange}
          onOpenUrl={vi.fn()}
          onOpenChanges={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByTestId('development-run-settings'));
    fireEvent.change(screen.getByTestId('development-run-port'), { target: { value: '5199' } });
    fireEvent.change(screen.getByTestId('development-run-url'), { target: { value: 'http://127.0.0.1:5199/orders' } });
    fireEvent.change(screen.getByTestId('development-run-environment'), {
      target: { value: 'FEATURE_ORDERS=true\nAPI_TOKEN=session-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    const savedMetadata = onMetadataChange.mock.calls.at(-1)?.[0];
    expect(savedMetadata).toEqual(expect.objectContaining({
      development: expect.objectContaining({
        runOverridesByProject: {
          'service-a': expect.objectContaining({
            configId: 'vite-dev',
            port: 5199,
            url: 'http://127.0.0.1:5199/orders',
          }),
        },
      }),
    }));
    expect(JSON.stringify(savedMetadata)).not.toContain('session-secret');
    expect(JSON.stringify(savedMetadata)).not.toContain('API_TOKEN');

    view.rerender(
      <I18nProvider initial="ko">
        <DevelopmentWorkspaceControls
          projectId={PROJECT_ID}
          metadata={savedMetadata}
          resolvedDir="C:\\workspace"
          onMetadataChange={onMetadataChange}
          onOpenUrl={vi.fn()}
          onOpenChanges={vi.fn()}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByTestId('development-run-action'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input, init]) => (
        String(input).endsWith('/development/server/start') && (init as RequestInit | undefined)?.method === 'POST'
      ));
      expect(call).toBeTruthy();
      const body = JSON.parse(String((call?.[1] as RequestInit).body));
      expect(body.overrides).toEqual(expect.objectContaining({
        port: 5199,
        url: 'http://127.0.0.1:5199/orders',
        environment: { FEATURE_ORDERS: 'true', API_TOKEN: 'session-secret' },
      }));
    });
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

  it('makes the local-CLI-only verification boundary explicit for BYOK runs', async () => {
    render(
      <I18nProvider initial="ko">
        <DevelopmentWorkspaceControls
          projectId={PROJECT_ID}
          metadata={{ kind: 'other', workMode: 'development', development: { autoVerify: true } }}
          resolvedDir="C:\\workspace\\app"
          automaticVerificationAvailable={false}
          onMetadataChange={vi.fn()}
          onOpenUrl={vi.fn()}
          onOpenChanges={vi.fn()}
        />
      </I18nProvider>,
    );

    const checkbox = await screen.findByRole('checkbox', { name: /자동 검증.*로컬 CLI 전용/ });
    expect((checkbox as HTMLInputElement).disabled).toBe(true);
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId('development-auto-verify').getAttribute('title')).toContain('BYOK');
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
