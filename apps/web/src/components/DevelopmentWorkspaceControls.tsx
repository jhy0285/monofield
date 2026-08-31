import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import type {
  DatabaseConnectionSummary,
  DevelopmentConfigsResponse,
  DevelopmentRunConfig,
  DevelopmentServersResponse,
  DevelopmentServerStatus,
  ProjectDatabaseContext,
  ProjectMetadata,
} from '@open-design/contracts';
import { getOpenDesignHost } from '@open-design/host';
import { useI18n } from '../i18n';
import { Icon } from './Icon';
import {
  getActiveBrowserVerification,
  subscribeActiveBrowserVerification,
} from '../runtime/browser-verification';
import styles from './DevelopmentWorkspaceControls.module.css';
import {
  DevelopmentWorkspaceTutorial,
  shouldOpenDevelopmentWorkspaceTutorial,
} from './DevelopmentWorkspaceTutorial';

type Props = {
  projectId: string;
  metadata: ProjectMetadata;
  resolvedDir?: string | null;
  automaticVerificationAvailable?: boolean;
  onMetadataChange: (metadata: ProjectMetadata) => void;
  onOpenUrl: (url: string) => void;
  onOpenChanges: () => void;
  onActiveProjectStateChange?: (state: { projectPath: string | null; ready: boolean }) => void;
};

function runtimePath(status: DevelopmentServerStatus): string {
  return status.projectPath?.trim().replace(/\\/g, '/') || '.';
}

function idleRuntime(projectId: string, projectPath: string): DevelopmentServerStatus {
  return {
    projectId,
    projectPath: projectPath || '.',
    state: 'idle',
    config: null,
    pid: null,
    url: null,
    startedAt: null,
    error: null,
    logs: [],
  };
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as T | { error?: { message?: string } } | null;
  if (!response.ok) throw new Error((payload as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${response.status}`);
  return payload as T;
}

function developmentModuleKey(value: string | null | undefined): string {
  return value?.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '') || '.';
}

export function activeModuleDatabaseContext(
  metadata: ProjectMetadata,
  projectPath = metadata.development?.activeProjectPath,
): ProjectDatabaseContext | null {
  const key = developmentModuleKey(projectPath);
  const scoped = metadata.development?.databaseContextsByProject;
  if (scoped !== undefined) return scoped[key] ?? null;
  return developmentModuleKey(metadata.development?.activeProjectPath) === key
    ? metadata.databaseContext ?? null
    : null;
}

export function metadataWithSelectedModuleDatabase(
  metadata: ProjectMetadata,
  projectPath: string,
  databaseContext: ProjectDatabaseContext | null,
): ProjectMetadata {
  const activeKey = developmentModuleKey(metadata.development?.activeProjectPath ?? projectPath);
  const targetKey = developmentModuleKey(projectPath);
  const scoped = { ...(metadata.development?.databaseContextsByProject ?? {}) };
  if (metadata.development?.databaseContextsByProject === undefined && metadata.databaseContext) {
    scoped[activeKey] = metadata.databaseContext;
  }
  if (databaseContext) scoped[targetKey] = databaseContext;
  else delete scoped[targetKey];
  const effectiveActiveContext = scoped[activeKey] ?? null;
  const { databaseContext: _legacyDatabaseContext, ...metadataWithoutDatabase } = metadata;
  return {
    ...metadataWithoutDatabase,
    ...(effectiveActiveContext ? { databaseContext: effectiveActiveContext } : {}),
    development: {
      ...metadata.development,
      // Keep an empty map authoritative after an explicit disconnect. This
      // prevents a stale top-level compatibility value from being inherited.
      databaseContextsByProject: scoped,
    },
  };
}

export function metadataWithActiveDevelopmentModule(
  metadata: ProjectMetadata,
  projectPath: string,
  previousProjectPath?: string,
): ProjectMetadata {
  const previousKey = developmentModuleKey(
    previousProjectPath ?? metadata.development?.activeProjectPath ?? projectPath,
  );
  const nextKey = developmentModuleKey(projectPath);
  const hadScopedContexts = metadata.development?.databaseContextsByProject !== undefined;
  const scoped = { ...(metadata.development?.databaseContextsByProject ?? {}) };
  if (!hadScopedContexts && metadata.databaseContext) scoped[previousKey] = metadata.databaseContext;
  const nextContext = scoped[nextKey] ?? null;
  const { databaseContext: _legacyDatabaseContext, ...metadataWithoutDatabase } = metadata;
  return {
    ...metadataWithoutDatabase,
    ...(nextContext ? { databaseContext: nextContext } : {}),
    development: {
      ...metadata.development,
      activeProjectPath: nextKey,
      ...(hadScopedContexts || Object.keys(scoped).length > 0
        ? { databaseContextsByProject: scoped }
        : { databaseContextsByProject: undefined }),
    },
  };
}

export function parseRunArguments(input: string): string[] {
  const values: string[] = [];
  let value = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;
  let started = false;
  for (const character of input.trim()) {
    if (escaping) {
      value += character;
      escaping = false;
      started = true;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      escaping = true;
      started = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else value += character;
      started = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) {
        values.push(value);
        value = '';
        started = false;
      }
      continue;
    }
    value += character;
    started = true;
  }
  if (escaping) value += '\\';
  if (quote) throw new Error('Unclosed quote in application arguments');
  if (started) values.push(value);
  return values;
}

const RUN_ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RUN_ENVIRONMENT_RESERVED_KEYS = new Set([
  'ASPNETCORE_URLS',
  'BROWSER',
  'GRADIO_SERVER_PORT',
  'PORT',
  'SERVER_PORT',
  'STREAMLIT_SERVER_PORT',
]);

export function parseRunEnvironment(input: string): Record<string, string> {
  const environment: Record<string, string> = {};
  const lines = input.split(/\r?\n/);
  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
    const separator = rawLine.indexOf('=');
    if (separator < 1) throw new Error('Environment variables must use NAME=value');
    const key = rawLine.slice(0, separator).trim();
    const value = rawLine.slice(separator + 1);
    if (!RUN_ENVIRONMENT_KEY_PATTERN.test(key) || RUN_ENVIRONMENT_RESERVED_KEYS.has(key.toUpperCase())) {
      throw new Error(`Environment variable ${key} is invalid or reserved`);
    }
    if (Object.hasOwn(environment, key)) throw new Error(`Environment variable ${key} is duplicated`);
    if (value.length > 8_192 || value.includes('\0')) throw new Error(`Environment variable ${key} is too long`);
    environment[key] = value;
    if (Object.keys(environment).length > 64) throw new Error('At most 64 environment variables are supported');
  }
  return environment;
}

function normalizeRunNetwork(portInput: string, urlInput: string): { port: number; url: string } {
  const port = Number(portInput.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Port must be an integer between 1 and 65535');
  }
  let url: URL;
  try {
    url = new URL(urlInput.trim());
  } catch {
    throw new Error('URL must be a valid local HTTP(S) URL');
  }
  const hostname = url.hostname.toLowerCase();
  if ((url.protocol !== 'http:' && url.protocol !== 'https:')
    || (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]' && hostname !== '::1')
    || url.username || url.password) {
    throw new Error('URL must use HTTP(S), a loopback host, and no credentials');
  }
  url.port = String(port);
  return { port, url: url.toString().replace(/\/$/, url.pathname === '/' ? '' : '/') };
}

export function DevelopmentWorkspaceControls({
  projectId,
  metadata,
  resolvedDir,
  automaticVerificationAvailable = true,
  onMetadataChange,
  onOpenUrl,
  onOpenChanges,
  onActiveProjectStateChange,
}: Props) {
  const { locale, t } = useI18n();
  const runCopy = locale === 'ko'
    ? {
        environment: '세션 환경변수',
        environmentHint: 'NAME=value 형식입니다. 이 앱 세션에서만 실행 프로세스에 전달되고 프로젝트에는 저장되지 않습니다. 공유 비밀값은 OS 또는 CLI 자격 증명 저장소를 사용하세요.',
        invalidEnvironment: '세션 환경변수를 확인하세요. NAME=value 형식이며 포트·브라우저 제어 변수는 실행 설정에서 관리합니다.',
        invalidNetwork: '포트와 로컬 URL을 확인하세요.',
        manualServletContainerSetup: '원클릭 실행을 사용하려면 활성 Tomcat/Jetty/Cargo 빌드 플러그인을 추가하세요. 또는 외부 컨테이너에 배포한 뒤 해당 URL을 MonoField 브라우저에서 열 수 있습니다.',
        servletPluginOverridesLocked: '포트·URL·애플리케이션 인자는 선택된 서블릿 빌드 플러그인에서 관리합니다. 여기서는 이 실행에만 적용할 세션 환경변수를 설정할 수 있습니다.',
        automaticVerificationUnavailable: '자동 화면 검증은 로컬 CLI 실행에서만 사용할 수 있습니다. BYOK에서는 사용할 수 없습니다.',
        localCliOnly: '로컬 CLI 전용',
        port: '포트',
        url: '준비 상태 URL',
      }
    : {
        environment: 'Session environment',
        environmentHint: 'Use NAME=value. Values are passed only to this process for the current app session and are never saved in the project. Keep shared secrets in the OS or CLI credential store.',
        invalidEnvironment: 'Check the session environment. Use NAME=value; port and browser control variables are managed by the run settings.',
        invalidNetwork: 'Check the port and local URL.',
        manualServletContainerSetup: 'Add an active Tomcat/Jetty/Cargo build plugin for one-click launch, or deploy to an external container and open its URL in the MonoField browser.',
        servletPluginOverridesLocked: 'The selected servlet build plugin owns the port, URL, and application arguments. Only session environment variables can be configured here.',
        automaticVerificationUnavailable: 'Automatic screen verification is available only for local CLI runs, not BYOK.',
        localCliOnly: 'Local CLI only',
        port: 'Port',
        url: 'Readiness URL',
      };
  const [detected, setDetected] = useState<DevelopmentConfigsResponse | null>(null);
  const [runtime, setRuntime] = useState<DevelopmentServerStatus | null>(null);
  const [runtimeStatuses, setRuntimeStatuses] = useState<DevelopmentServerStatus[]>([]);
  const [activeProjectPath, setActiveProjectPath] = useState(metadata.development?.activeProjectPath ?? '');
  const [resolvedProjectSelection, setResolvedProjectSelection] = useState<{
    loadKey: string;
    projectPath: string;
  } | null>(null);
  const [connections, setConnections] = useState<DatabaseConnectionSummary[]>([]);
  const [busy, setBusy] = useState<'detect' | 'start' | 'stop' | null>(null);
  const [launchElapsedSeconds, setLaunchElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [runSettingsOpen, setRunSettingsOpen] = useState(false);
  const [runSettingsProjectKey, setRunSettingsProjectKey] = useState<string | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [draftProfile, setDraftProfile] = useState('');
  const [draftArguments, setDraftArguments] = useState('');
  const [draftPort, setDraftPort] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [draftEnvironment, setDraftEnvironment] = useState('');
  const guideAutoOpenChecked = useRef(false);
  const openBrowserWhenReady = useRef(false);
  const activeProjectPathRef = useRef(activeProjectPath);
  const detectedByProjectPathRef = useRef(new Map<string, DevelopmentConfigsResponse>());
  const runtimeByProjectPathRef = useRef(new Map<string, DevelopmentServerStatus>());
  const detectionRequestRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const runtimeSummaryAbortRef = useRef<AbortController | null>(null);
  const projectPickerRef = useRef<HTMLDivElement | null>(null);
  const projectTriggerRef = useRef<HTMLButtonElement | null>(null);
  const projectOptionRefs = useRef(new Map<string, HTMLButtonElement>());
  const logViewportRef = useRef<HTMLPreElement | null>(null);
  const logFollowRef = useRef(true);
  const metadataRef = useRef(metadata);
  const sessionEnvironmentByProjectRef = useRef(new Map<string, string>());
  const resolvedDirRef = useRef<string | null>(null);
  const initialLoadKeyRef = useRef('');
  const [browserVerificationActive, setBrowserVerificationActive] = useState(
    () => Boolean(getActiveBrowserVerification(projectId)),
  );
  const runOverrideKey = activeProjectPath || '.';
  const activeDatabaseContext = activeModuleDatabaseContext(metadata, runOverrideKey);
  const moduleOverride = metadata.development?.runOverridesByProject?.[runOverrideKey];
  // Top-level fields predate multi-module workspaces. Read them only while the
  // metadata still points at this exact module; persistActiveProjectPath
  // migrates them into the module map before switching away.
  const legacySettingsApply = (metadata.development?.activeProjectPath || '.') === runOverrideKey;
  const preferredId = moduleOverride?.configId
    ?? (legacySettingsApply ? metadata.development?.runConfigId : undefined);
  const selectedId = preferredId && detected?.configs.some((item) => item.id === preferredId)
    ? preferredId
    : detected?.recommendedConfigId ?? '';
  const selected = useMemo(
    () => detected?.configs.find((item) => item.id === selectedId) ?? null,
    [detected, selectedId],
  );
  const effectiveProfile = moduleOverride?.profile
    ?? (legacySettingsApply ? metadata.development?.runProfile : undefined)
    ?? selected?.profile
    ?? '';
  const effectiveArguments = moduleOverride?.arguments
    ?? (legacySettingsApply ? metadata.development?.runArguments : undefined)
    ?? '';
  const effectivePort = moduleOverride?.port ?? selected?.port ?? null;
  const effectiveUrl = moduleOverride?.url ?? selected?.url ?? '';
  const springProfiles = useMemo(
    () => Array.from(new Set(detected?.configs
      .filter((item) => item.framework === 'Spring Boot' && item.profile)
      .map((item) => item.profile as string) ?? [])).sort(),
    [detected],
  );

  activeProjectPathRef.current = activeProjectPath;
  metadataRef.current = metadata;

  const rememberRuntimes = useCallback((
    statuses: DevelopmentServerStatus[],
    options: { preserveLogs?: boolean; replace?: boolean } = {},
  ) => {
    const previousStatuses = runtimeByProjectPathRef.current;
    const next = options.replace ? new Map<string, DevelopmentServerStatus>() : new Map(previousStatuses);
    for (const status of statuses) {
      const path = runtimePath(status);
      const previous = previousStatuses.get(path);
      next.set(path, options.preserveLogs && status.logs.length === 0 && (previous?.logs.length ?? 0) > 0
        ? { ...status, logs: previous!.logs }
        : status);
    }
    runtimeByProjectPathRef.current = next;
    setRuntimeStatuses([...next.values()]);
    return next;
  }, []);

  const loadRuntimeSummaries = useCallback(async (refresh = false) => {
    if (!resolvedDir) return;
    runtimeSummaryAbortRef.current?.abort();
    const controller = new AbortController();
    runtimeSummaryAbortRef.current = controller;
    try {
      const params = new URLSearchParams({ logs: '0' });
      if (refresh) params.set('refresh', '1');
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/development/servers?${params}`,
        { signal: controller.signal },
      ).then((value) => responseJson<DevelopmentServersResponse>(value));
      if (controller.signal.aborted) return;
      const next = rememberRuntimes(response.servers ?? [], { preserveLogs: true, replace: true });
      const selectedPath = activeProjectPathRef.current || '.';
      setRuntime(next.get(selectedPath) ?? idleRuntime(projectId, selectedPath));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
    } finally {
      if (runtimeSummaryAbortRef.current === controller) runtimeSummaryAbortRef.current = null;
    }
  }, [projectId, rememberRuntimes, resolvedDir]);

  const load = useCallback(async (refresh = false, requestedProjectPath?: string) => {
    if (!resolvedDir) return;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const requestId = detectionRequestRef.current + 1;
    detectionRequestRef.current = requestId;
    const projectPath = requestedProjectPath ?? activeProjectPathRef.current;
    const cachedDetection = !refresh
      ? detectedByProjectPathRef.current.get(projectPath || '.')
      : undefined;
    if (cachedDetection) setDetected(cachedDetection);
    else setBusy('detect');
    setError(null);
    try {
      const configParams = new URLSearchParams();
      const statusParams = new URLSearchParams();
      if (projectPath) {
        configParams.set('projectPath', projectPath);
        statusParams.set('projectPath', projectPath);
      }
      if (refresh) configParams.set('refresh', '1');
      const configQuery = configParams.size > 0 ? `?${configParams}` : '';
      const statusQuery = statusParams.size > 0 ? `?${statusParams}` : '';
      const [configs, status] = await Promise.all([
        cachedDetection
          ? Promise.resolve(cachedDetection)
          : fetch(
            `/api/projects/${encodeURIComponent(projectId)}/development/configs${configQuery}`,
            { signal: controller.signal },
          ).then((response) => responseJson<DevelopmentConfigsResponse>(response)),
        fetch(
          `/api/projects/${encodeURIComponent(projectId)}/development/server${statusQuery}`,
          { signal: controller.signal },
        ).then((response) => responseJson<DevelopmentServerStatus>(response)),
      ]);
      if (controller.signal.aborted || requestId !== detectionRequestRef.current) return;
      const resolvedProjectPath = projectPath || configs.activeProjectPath || runtimePath(status);
      const selectedConfigs = configs.activeProjectPath === resolvedProjectPath
        ? configs
        : { ...configs, activeProjectPath: resolvedProjectPath };
      if (resolvedProjectPath !== activeProjectPathRef.current) {
        // A settings draft belongs to the module that opened it. Never let a
        // delayed detection response move that draft onto a sibling module.
        setRunSettingsOpen(false);
        setRunSettingsProjectKey(null);
      }
      detectedByProjectPathRef.current.set(resolvedProjectPath, selectedConfigs);
      setDetected(selectedConfigs);
      if (resolvedProjectPath) {
        activeProjectPathRef.current = resolvedProjectPath;
        setActiveProjectPath(resolvedProjectPath);
        setResolvedProjectSelection({
          loadKey: `${projectId}\0${resolvedDir}`,
          projectPath: resolvedProjectPath,
        });
      }
      rememberRuntimes([status]);
      setRuntime(status);
    } catch (caught) {
      if ((caught as { name?: string } | null)?.name === 'AbortError') return;
      if (requestId !== detectionRequestRef.current) return;
      setError(caught instanceof Error ? caught.message : t('development.detectFailed'));
    } finally {
      if (requestId === detectionRequestRef.current) {
        setBusy(null);
        if (loadAbortRef.current === controller) loadAbortRef.current = null;
      }
    }
  }, [projectId, rememberRuntimes, resolvedDir, t]);

  useEffect(() => {
    if (!resolvedDir) return;
    const loadKey = `${projectId}\0${resolvedDir}`;
    if (initialLoadKeyRef.current === loadKey) return;
    initialLoadKeyRef.current = loadKey;
    const previousDir = resolvedDirRef.current;
    const folderChanged = previousDir != null && previousDir !== resolvedDir;
    resolvedDirRef.current = resolvedDir;
    if (folderChanged) {
      loadAbortRef.current?.abort();
      runtimeSummaryAbortRef.current?.abort();
      activeProjectPathRef.current = '';
      detectedByProjectPathRef.current.clear();
      runtimeByProjectPathRef.current.clear();
      setActiveProjectPath('');
      setResolvedProjectSelection(null);
      setDetected(null);
      setRuntime(null);
      setRuntimeStatuses([]);
      setBusy('detect');
      setRunSettingsOpen(false);
      setRunSettingsProjectKey(null);
      openBrowserWhenReady.current = false;
      void (async () => {
        let stopFailure: string | null = null;
        try {
          const stopped = await fetch(
            `/api/projects/${encodeURIComponent(projectId)}/development/server/stop-all`,
            { method: 'POST' },
          ).then((value) => responseJson<DevelopmentServersResponse>(value));
          if (stopped.failures?.length) {
            stopFailure = stopped.failures
              .map((failure) => `${failure.projectPath}: ${failure.error}`)
              .join('\n');
          }
        } catch (caught) {
          stopFailure = caught instanceof Error ? caught.message : String(caught);
        }
        if (initialLoadKeyRef.current !== loadKey) return;
        await Promise.all([load(true, ''), loadRuntimeSummaries(true)]);
        if (initialLoadKeyRef.current === loadKey && stopFailure) setError(stopFailure);
      })();
      return;
    }
    void load();
    void loadRuntimeSummaries(true);
  }, [load, loadRuntimeSummaries, projectId, resolvedDir]);
  useEffect(() => () => {
    loadAbortRef.current?.abort();
    runtimeSummaryAbortRef.current?.abort();
  }, []);
  useEffect(() => {
    let cancelled = false;
    const database = getOpenDesignHost()?.database;
    if (!database) {
      setConnections([]);
      return undefined;
    }
    void database.list()
      .then((next) => { if (!cancelled) setConnections(next); })
      .catch(() => { if (!cancelled) setConnections([]); });
    return () => { cancelled = true; };
  }, [projectId, resolvedDir]);
  useEffect(() => {
    const detectedPath = detected?.activeProjectPath;
    if (!detectedPath || metadata.development?.activeProjectPath === detectedPath) return;
    persistActiveProjectPath(detectedPath);
  }, [detected?.activeProjectPath, metadata.development?.activeProjectPath]);
  useEffect(() => {
    if (!onActiveProjectStateChange) return;
    const projectPath = activeProjectPath || null;
    const loadKey = `${projectId}\0${resolvedDir ?? ''}`;
    onActiveProjectStateChange({
      projectPath,
      ready: Boolean(
        projectPath
        && busy !== 'detect'
        && resolvedProjectSelection?.loadKey === loadKey
        && resolvedProjectSelection.projectPath === projectPath
      ),
    });
  }, [
    activeProjectPath,
    busy,
    onActiveProjectStateChange,
    projectId,
    resolvedDir,
    resolvedProjectSelection,
  ]);
  useEffect(() => {
    if (!resolvedDir || !detected || busy != null || guideAutoOpenChecked.current) return;
    guideAutoOpenChecked.current = true;
    if (shouldOpenDevelopmentWorkspaceTutorial()) setGuideOpen(true);
  }, [busy, detected, resolvedDir]);
  useEffect(() => subscribeActiveBrowserVerification((changedProjectId) => {
    if (changedProjectId === projectId) {
      setBrowserVerificationActive(Boolean(getActiveBrowserVerification(projectId)));
    }
  }), [projectId]);
  useEffect(() => {
    const active = runtimeStatuses.some((status) => status.state === 'starting' || status.state === 'ready');
    if (!active) return;
    const timer = window.setInterval(() => { void loadRuntimeSummaries(true); }, 2_500);
    return () => window.clearInterval(timer);
  }, [loadRuntimeSummaries, runtimeStatuses]);
  useEffect(() => {
    if (!projectMenuOpen) return;
    const frame = window.requestAnimationFrame(() => {
      projectOptionRefs.current.get(activeProjectPath)?.focus();
    });
    const close = (event: PointerEvent) => {
      if (!projectPickerRef.current?.contains(event.target as Node)) setProjectMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', close);
    };
  }, [activeProjectPath, projectMenuOpen]);
  useEffect(() => {
    if (!logsOpen || !logViewportRef.current || !logFollowRef.current) return;
    logViewportRef.current.scrollTop = logViewportRef.current.scrollHeight;
  }, [logsOpen, runtime?.logs.length]);
  useEffect(() => { logFollowRef.current = true; }, [activeProjectPath]);
  useEffect(() => {
    if (busy !== 'start' && runtime?.state !== 'starting') {
      setLaunchElapsedSeconds(0);
      return;
    }
    const parsedStartedAt = runtime?.startedAt ? Date.parse(runtime.startedAt) : Number.NaN;
    const startedAt = Number.isFinite(parsedStartedAt) ? parsedStartedAt : Date.now();
    const tick = () => setLaunchElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)));
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [busy, runtime?.startedAt, runtime?.state]);
  useEffect(() => {
    const shouldPoll = runtime?.state === 'starting' || logsOpen;
    if (!shouldPoll) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    const poll = async () => {
      try {
        controller?.abort();
        controller = new AbortController();
        const requestedPath = activeProjectPathRef.current || '.';
        const params = new URLSearchParams();
        if (requestedPath) params.set('projectPath', requestedPath);
        const query = params.size > 0 ? `?${params}` : '';
        const next = await fetch(`/api/projects/${encodeURIComponent(projectId)}/development/server${query}`, { signal: controller.signal })
          .then((response) => responseJson<DevelopmentServerStatus>(response));
        if (cancelled || requestedPath !== (activeProjectPathRef.current || '.')) return;
        rememberRuntimes([next]);
        if (runtimePath(next) !== (activeProjectPathRef.current || '.')) return;
        setRuntime(next);
        if (next.state === 'ready' && next.url && openBrowserWhenReady.current) {
          openBrowserWhenReady.current = false;
          onOpenUrl(next.url);
        } else if (next.state === 'failed') {
          openBrowserWhenReady.current = false;
          setError(next.error ?? t('development.startFailed'));
        }
        if (next.state === 'starting' || (logsOpen && next.state === 'ready')) {
          timer = setTimeout(() => void poll(), next.state === 'starting' ? 750 : 1_250);
        }
      } catch (caught) {
        if (cancelled || (caught as { name?: string } | null)?.name === 'AbortError') return;
        setError(caught instanceof Error ? caught.message : t('development.startFailed'));
        timer = setTimeout(() => void poll(), 1_500);
      }
    };
    timer = setTimeout(() => void poll(), 300);
    return () => {
      cancelled = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [activeProjectPath, logsOpen, onOpenUrl, projectId, rememberRuntimes, runtime?.state, t]);

  function persistDevelopment(next: Partial<NonNullable<ProjectMetadata['development']>>) {
    const currentMetadata = metadataRef.current;
    const nextMetadata: ProjectMetadata = {
      ...currentMetadata,
      development: { autoVerify: currentMetadata.development?.autoVerify !== false, ...currentMetadata.development, ...next },
    };
    // Keep consecutive same-tick edits (for example save settings then switch
    // module) based on the latest optimistic metadata instead of waiting for
    // the parent persistence round trip to re-render this component.
    metadataRef.current = nextMetadata;
    onMetadataChange(nextMetadata);
  }

  function persistActiveProjectPath(projectPath: string, previousProjectPath?: string) {
    const currentMetadata = metadataRef.current;
    const development = currentMetadata.development;
    if (development?.activeProjectPath === projectPath) return;
    const previousKey = previousProjectPath
      || development?.activeProjectPath
      || activeProjectPathRef.current
      || projectPath
      || '.';
    const currentOverrides = { ...(development?.runOverridesByProject ?? {}) };
    const previousOverride = { ...(currentOverrides[previousKey] ?? {}) };
    if (development?.runConfigId && previousOverride.configId == null) previousOverride.configId = development.runConfigId;
    if (development?.runProfile && previousOverride.profile == null) previousOverride.profile = development.runProfile;
    if (development?.runArguments && previousOverride.arguments == null) previousOverride.arguments = development.runArguments;
    if (Object.keys(previousOverride).length > 0) currentOverrides[previousKey] = previousOverride;
    const moduleMetadata = metadataWithActiveDevelopmentModule(currentMetadata, projectPath, previousKey);
    const nextMetadata: ProjectMetadata = {
      ...moduleMetadata,
      development: {
        autoVerify: moduleMetadata.development?.autoVerify !== false,
        ...moduleMetadata.development,
        runConfigId: undefined,
        runProfile: undefined,
        runArguments: undefined,
        runOverridesByProject: Object.keys(currentOverrides).length > 0 ? currentOverrides : undefined,
      },
    };
    metadataRef.current = nextMetadata;
    onMetadataChange(nextMetadata);
  }

  function persistModuleRunSettings(next: {
    arguments?: string;
    configId?: string;
    profile?: string;
  }) {
    const currentOverrides = { ...(metadataRef.current.development?.runOverridesByProject ?? {}) };
    const current = { ...(currentOverrides[runOverrideKey] ?? {}) };
    const merged = { ...current, ...next };
    for (const key of ['arguments', 'configId', 'profile'] as const) {
      if (!merged[key]) delete merged[key];
    }
    if (Object.keys(merged).length > 0) currentOverrides[runOverrideKey] = merged;
    else delete currentOverrides[runOverrideKey];
    persistDevelopment({
      runConfigId: undefined,
      runProfile: undefined,
      runArguments: undefined,
      runOverridesByProject: Object.keys(currentOverrides).length > 0 ? currentOverrides : undefined,
    });
  }

  async function start() {
    if (!selected) return;
    if (selected.launchMode === 'manual') {
      setError(runCopy.manualServletContainerSetup);
      return;
    }
    const usesServletBuildPlugin = selected.runSettingsMode === 'build-plugin'
      || selected.framework === 'Spring Framework';
    let applicationArgs: string[] = [];
    let environment: Record<string, string>;
    let network: { port: number; url: string } | null = null;
    if (!usesServletBuildPlugin) {
      try {
        applicationArgs = parseRunArguments(effectiveArguments);
      } catch {
        setError(t('development.invalidArguments'));
        return;
      }
    }
    try {
      environment = parseRunEnvironment(sessionEnvironmentByProjectRef.current.get(runOverrideKey) ?? '');
    } catch {
      setError(runCopy.invalidEnvironment);
      return;
    }
    if (!usesServletBuildPlugin) {
      try {
        network = normalizeRunNetwork(String(effectivePort ?? ''), effectiveUrl);
      } catch {
        setError(runCopy.invalidNetwork);
        return;
      }
    }
    setBusy('start');
    setError(null);
    openBrowserWhenReady.current = true;
    persistModuleRunSettings({ configId: selected.id });
    try {
      const next = await fetch(`/api/projects/${encodeURIComponent(projectId)}/development/server/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          configId: selected.id,
          projectPath: activeProjectPath || undefined,
          overrides: {
            ...(selected.framework === 'Spring Boot' ? { profile: effectiveProfile } : {}),
            ...(!usesServletBuildPlugin && applicationArgs.length > 0 ? { applicationArgs } : {}),
            ...(!usesServletBuildPlugin ? { port: network!.port, url: network!.url } : {}),
            ...(Object.keys(environment).length > 0 ? { environment } : {}),
          },
        }),
      }).then((response) => responseJson<DevelopmentServerStatus>(response));
      rememberRuntimes([next]);
      setRuntime(next);
      if (next.state === 'ready' && next.url) {
        openBrowserWhenReady.current = false;
        onOpenUrl(next.url);
      }
      if (next.state === 'failed') {
        openBrowserWhenReady.current = false;
        setError(next.error ?? t('development.startFailed'));
      }
    } catch (caught) {
      openBrowserWhenReady.current = false;
      setError(caught instanceof Error ? caught.message : t('development.startFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function stop() {
    setBusy('stop');
    setError(null);
    openBrowserWhenReady.current = false;
    try {
      const next = await fetch(`/api/projects/${encodeURIComponent(projectId)}/development/server/stop`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectPath: activeProjectPath || undefined }),
      }).then((response) => responseJson<DevelopmentServerStatus>(response));
      rememberRuntimes([next]);
      setRuntime(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('development.stopFailed'));
    } finally {
      setBusy(null);
    }
  }

  function selectConfig(config: DevelopmentRunConfig | null) {
    if (config) persistModuleRunSettings({ configId: config.id, profile: undefined });
  }

  function openRunSettings() {
    const usesServletBuildPlugin = selected?.runSettingsMode === 'build-plugin'
      || selected?.framework === 'Spring Framework';
    setDraftProfile(effectiveProfile);
    setDraftArguments(usesServletBuildPlugin ? '' : effectiveArguments);
    setDraftPort(String(effectivePort ?? selected?.port ?? ''));
    setDraftUrl(effectiveUrl || selected?.url || '');
    setDraftEnvironment(sessionEnvironmentByProjectRef.current.get(runOverrideKey) ?? '');
    setRunSettingsProjectKey(runOverrideKey);
    setRunSettingsOpen(true);
  }

  function saveRunSettings() {
    const settingsKey = runSettingsProjectKey;
    if (settingsKey == null || settingsKey !== runOverrideKey) {
      setRunSettingsOpen(false);
      setRunSettingsProjectKey(null);
      return;
    }
    const usesServletBuildPlugin = selected?.runSettingsMode === 'build-plugin'
      || selected?.framework === 'Spring Framework';
    let network: { port: number; url: string } | null = null;
    if (!usesServletBuildPlugin) {
      try {
        parseRunArguments(draftArguments);
      } catch {
        setError(t('development.invalidArguments'));
        return;
      }
    }
    try {
      parseRunEnvironment(draftEnvironment);
    } catch {
      setError(runCopy.invalidEnvironment);
      return;
    }
    if (!usesServletBuildPlugin) {
      try {
        network = normalizeRunNetwork(draftPort, draftUrl);
      } catch {
        setError(runCopy.invalidNetwork);
        return;
      }
    }
    try {
      const profile = draftProfile.trim();
      const matchingConfig = detected?.configs.find((item) => item.framework === 'Spring Boot' && (item.profile ?? '') === profile);
      const currentOverrides = { ...(metadataRef.current.development?.runOverridesByProject ?? {}) };
      const nextOverride = {
        ...(currentOverrides[settingsKey] ?? {}),
        configId: matchingConfig?.id ?? selected?.id,
        profile: matchingConfig ? undefined : profile || undefined,
        arguments: usesServletBuildPlugin ? undefined : draftArguments.trim() || undefined,
      };
      if (usesServletBuildPlugin || (network?.port === selected?.port && network?.url === selected?.url)) {
        delete nextOverride.port;
        delete nextOverride.url;
      } else {
        nextOverride.port = network!.port;
        nextOverride.url = network!.url;
      }
      for (const key of ['arguments', 'configId', 'profile'] as const) {
        if (!nextOverride[key]) delete nextOverride[key];
      }
      if (Object.keys(nextOverride).length > 0) currentOverrides[settingsKey] = nextOverride;
      else delete currentOverrides[settingsKey];
      sessionEnvironmentByProjectRef.current.set(settingsKey, draftEnvironment.trim());
      persistDevelopment({
        runConfigId: undefined,
        runProfile: undefined,
        runArguments: undefined,
        runOverridesByProject: Object.keys(currentOverrides).length > 0 ? currentOverrides : undefined,
      });
      setError(null);
      setRunSettingsOpen(false);
      setRunSettingsProjectKey(null);
    } catch {
      setError(t('development.invalidArguments'));
    }
  }

  function resetRunSettings() {
    const settingsKey = runSettingsProjectKey;
    if (settingsKey == null || settingsKey !== runOverrideKey) {
      setRunSettingsOpen(false);
      setRunSettingsProjectKey(null);
      return;
    }
    setDraftProfile(selected?.profile ?? '');
    setDraftArguments('');
    setDraftPort(String(selected?.port ?? ''));
    setDraftUrl(selected?.url ?? '');
    setDraftEnvironment('');
    sessionEnvironmentByProjectRef.current.delete(settingsKey);
    const currentOverrides = { ...(metadataRef.current.development?.runOverridesByProject ?? {}) };
    delete currentOverrides[settingsKey];
    persistDevelopment({
      runConfigId: undefined,
      runProfile: undefined,
      runArguments: undefined,
      runOverridesByProject: Object.keys(currentOverrides).length > 0 ? currentOverrides : undefined,
    });
    setError(null);
  }

  function selectProject(projectPath: string) {
    if (projectPath === activeProjectPathRef.current) {
      setProjectMenuOpen(false);
      return;
    }
    const previousProjectPath = activeProjectPathRef.current || '.';
    // Draft profile/arguments are intentionally not portable. Closing the
    // editor before the identity changes prevents A's unsaved values from
    // being saved under B after its asynchronous config detection completes.
    setRunSettingsOpen(false);
    setRunSettingsProjectKey(null);
    activeProjectPathRef.current = projectPath;
    setActiveProjectPath(projectPath);
    setDetected(detectedByProjectPathRef.current.get(projectPath) ?? (detected
      ? { ...detected, configs: [], recommendedConfigId: null, activeProjectPath: projectPath }
      : null));
    setRuntime(runtimeByProjectPathRef.current.get(projectPath) ?? idleRuntime(projectId, projectPath));
    setError(null);
    openBrowserWhenReady.current = false;
    setProjectMenuOpen(false);
    persistActiveProjectPath(projectPath, previousProjectPath);
    void load(false, projectPath);
  }

  function handleProjectMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const projects = detected?.projects ?? [];
    if (projects.length === 0) return;
    const focusedPath = [...projectOptionRefs.current.entries()]
      .find(([, element]) => element === document.activeElement)?.[0] ?? activeProjectPath;
    const currentIndex = Math.max(0, projects.findIndex((project) => project.path === focusedPath));
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % projects.length;
    else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + projects.length) % projects.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = projects.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      setProjectMenuOpen(false);
      projectTriggerRef.current?.focus();
      return;
    }
    if (nextIndex == null) return;
    event.preventDefault();
    projectOptionRefs.current.get(projects[nextIndex]!.path)?.focus();
  }

  function selectDatabase(connectionId: string) {
    const connection = connections.find((item) => item.id === connectionId);
    const nextMetadata = metadataWithSelectedModuleDatabase(
      metadataRef.current,
      activeProjectPathRef.current || '.',
      connection
        ? { connectionId: connection.id, label: connection.label, useForDevelopment: true }
        : null,
    );
    metadataRef.current = nextMetadata;
    onMetadataChange(nextMetadata);
  }

  if (!resolvedDir) {
    return <span className={styles.notice}>{t('development.folderRequired')}</span>;
  }

  const state = busy === 'start' ? 'starting' : runtime?.state ?? 'idle';
  const canStop = state === 'starting' || state === 'ready' || Boolean(runtime?.pid);
  const launchConfig = runtime?.config ?? selected;
  const displayedConfig = canStop && runtime?.config ? runtime.config : selected;
  const displayedProfile = canStop && runtime?.config ? (runtime.config.profile ?? '') : effectiveProfile;
  const displayedUrl = canStop
    ? (runtime?.url ?? runtime?.config?.url ?? effectiveUrl)
    : effectiveUrl;
  const displayedPort = canStop
    ? (runtime?.config?.port ?? effectivePort)
    : effectivePort;
  const displayedCommand = displayedConfig
    ? [
        displayedConfig.command.split(/[\\/]/).pop() ?? displayedConfig.command,
        ...displayedConfig.args,
        ...(!canStop && effectiveArguments ? [effectiveArguments] : []),
      ].join(' ')
    : '';
  const latestLaunchLog = [...(runtime?.logs ?? [])].reverse().find((line) => line.trim().length > 0);
  const displayedError = error ?? runtime?.error ?? null;
  const runningCount = runtimeStatuses.filter((status) => status.state === 'starting' || status.state === 'ready').length;
  const activeProject = detected?.projects?.find((project) => project.path === activeProjectPath) ?? null;
  const runtimeStateLabel = (value: DevelopmentServerStatus['state']) => value === 'ready'
    ? t('development.ready')
    : value === 'starting'
      ? t('development.starting')
      : value === 'failed'
        ? t('development.failed')
        : t('development.stopped');
  const launchCommand = launchConfig
    ? [launchConfig.command.split(/[\\/]/).pop() ?? launchConfig.command, ...launchConfig.args].join(' ')
    : '';
  const selectedRequiresManualSetup = selected?.launchMode === 'manual';
  const selectedUsesServletBuildPlugin = selected?.runSettingsMode === 'build-plugin'
    || selected?.framework === 'Spring Framework';
  const manualSetupMessage = selectedRequiresManualSetup ? runCopy.manualServletContainerSetup : undefined;
  return (
    <Fragment>
      <div className={styles.root} data-testid="development-workspace-controls">
      <div className={styles.runGroup} data-testid="development-run-group">
        <span className={`${styles.state} ${styles[`state_${state}`] ?? ''}`} aria-label={t('development.serverStatus')}>
          <i />{state === 'ready' ? t('development.ready') : state === 'starting' ? t('development.starting') : state === 'failed' ? t('development.failed') : t('development.stopped')}
        </span>
        {(detected?.projects?.length ?? 0) > 1 ? (
          <div className={styles.projectPicker} ref={projectPickerRef}>
            <button
              type="button"
              ref={projectTriggerRef}
              className={styles.projectSelect}
              data-testid="development-active-project"
              aria-label={t('workspaceTabs.project')}
              aria-haspopup="menu"
              aria-expanded={projectMenuOpen}
              aria-controls={`development-project-menu-${projectId}`}
              title={activeProject?.path ?? activeProjectPath}
              disabled={busy === 'start' || busy === 'stop'}
              onClick={() => setProjectMenuOpen((open) => !open)}
            >
              <i className={styles.projectStateDot} data-state={busy === 'detect' ? 'loading' : state} aria-hidden="true" />
              <span>{activeProject?.label ?? activeProjectPath}</span>
              <Icon name="chevron-down" size={12} />
            </button>
            {projectMenuOpen ? (
              <div
                id={`development-project-menu-${projectId}`}
                className={styles.projectMenu}
                role="menu"
                aria-label={t('workspaceTabs.project')}
                onKeyDown={handleProjectMenuKeyDown}
              >
                {detected?.projects?.map((project) => {
                  const projectRuntime = runtimeByProjectPathRef.current.get(project.path) ?? idleRuntime(projectId, project.path);
                  const projectState = busy === 'detect' && project.path === activeProjectPath ? 'loading' : projectRuntime.state;
                  return (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={project.path === activeProjectPath}
                      ref={(element) => {
                        if (element) projectOptionRefs.current.set(project.path, element);
                        else projectOptionRefs.current.delete(project.path);
                      }}
                      key={project.path}
                      data-state={projectState}
                      onClick={() => selectProject(project.path)}
                    >
                      <i className={styles.projectStateDot} data-state={projectState} aria-hidden="true" />
                      <span><strong>{project.label}</strong><small>{project.path}</small></span>
                      <em>{projectState === 'loading' ? t('common.loading') : runtimeStateLabel(projectRuntime.state)}</em>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
        {runningCount > 0 ? (
          <span className={styles.runningCount} data-testid="development-running-count">
            {runningCount} {t('development.ready')}
          </span>
        ) : null}
        <button
          type="button"
          className={styles.action}
          data-testid="development-server-logs-toggle"
          aria-expanded={logsOpen}
          onClick={() => setLogsOpen((open) => !open)}
        >
          <Icon name="terminal" size={13} />{t('development.logs')}
        </button>
        <select
          className={`${styles.select} ${styles.runSelect}`}
          data-testid="development-run-config"
          aria-label={t('development.runConfiguration')}
          title={selected?.label ?? t('development.noConfiguration')}
          value={selectedId}
          disabled={busy != null || (detected?.configs.length ?? 0) === 0}
          onChange={(event) => selectConfig(detected?.configs.find((item) => item.id === event.target.value) ?? null)}
        >
          {(detected?.configs.length ?? 0) === 0 ? <option value="">{t('development.noConfiguration')}</option> : null}
          {detected?.configs.map((config) => <option key={config.id} value={config.id}>{config.label}</option>)}
        </select>
        <button
          type="button"
          className={styles.iconAction}
          data-testid="development-run-settings"
          aria-label={t('development.configureRun')}
          title={manualSetupMessage ?? t('development.configureRun')}
          onClick={openRunSettings}
          disabled={busy != null || canStop || !selected || selectedRequiresManualSetup}
        >
          <Icon name="settings" size={13} />
        </button>
        {canStop ? (
          <button type="button" className={styles.action} data-testid="development-run-action" onClick={() => void stop()} disabled={busy != null}><Icon name="stop" size={13} />{t('development.stop')}</button>
        ) : (
          <button type="button" className={styles.action} data-testid="development-run-action" onClick={() => void start()} disabled={busy != null || !selected || selectedRequiresManualSetup} title={manualSetupMessage}><Icon name="play" size={13} />{t('development.start')}</button>
        )}
        <button
          type="button"
          className={`${styles.action} ${styles.refreshAction}`}
          data-testid="development-detect"
          data-loading={busy === 'detect' ? 'true' : 'false'}
          aria-label={busy === 'detect' ? t('common.loading') : t('development.detectAgain')}
          aria-busy={busy === 'detect'}
          title={busy === 'detect' ? t('common.loading') : t('development.detectAgain')}
          onClick={() => void load(true)}
          disabled={busy != null}
        >
          <Icon name={busy === 'detect' ? 'spinner' : 'reload'} size={13} />
          <span>{busy === 'detect' ? t('common.loading') : t('development.detectAgain')}</span>
        </button>
        <button type="button" className={styles.action} data-testid="development-open-changes" onClick={onOpenChanges}><Icon name="fork" size={13} />{t('gitChanges.title')}</button>
      </div>
      {manualSetupMessage ? (
        <div className={styles.notice} data-testid="development-manual-run-setup" title={manualSetupMessage}>
          {manualSetupMessage}
        </div>
      ) : null}
      <div className={styles.contextGroup}>
        <select className={`${styles.select} ${styles.databaseSelect}`} data-testid="development-database" aria-label={t('development.database')} title={activeDatabaseContext?.label ?? t('development.noDatabase')} value={activeDatabaseContext?.connectionId ?? ''} onChange={(event) => selectDatabase(event.target.value)}>
          <option value="">{t('development.noDatabase')}</option>
          {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.label}</option>)}
        </select>
        <label
          className={`${styles.verify} od-tooltip`}
          data-testid="development-auto-verify"
          data-unavailable={automaticVerificationAvailable ? 'false' : 'true'}
          title={automaticVerificationAvailable ? t('development.autoVerifyHint') : runCopy.automaticVerificationUnavailable}
          data-tooltip={automaticVerificationAvailable ? t('development.autoVerifyHint') : runCopy.automaticVerificationUnavailable}
          data-tooltip-placement="bottom"
        >
          <input
            type="checkbox"
            checked={automaticVerificationAvailable && metadata.development?.autoVerify !== false}
            disabled={!automaticVerificationAvailable}
            onChange={(event) => persistDevelopment({ autoVerify: event.target.checked })}
          />
          <i className={styles.verifyStatus} data-active={automaticVerificationAvailable && browserVerificationActive ? 'true' : 'false'} aria-hidden="true" />
          <span>{t('development.autoVerify')}{automaticVerificationAvailable ? '' : ` · ${runCopy.localCliOnly}`}</span>
        </label>
        <button
          type="button"
          className={styles.iconAction}
          data-testid="development-guide-trigger"
          aria-label={t('development.guide')}
          title={t('development.guide')}
          onClick={() => setGuideOpen(true)}
        >
          <Icon name="help-circle" size={13} />
        </button>
      </div>
      {busy === 'detect' ? (
        <div
          className={styles.projectLoading}
          data-testid="development-project-loading"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <Icon name="spinner" size={12} />
          <span>{activeProjectPath || t('workspaceTabs.project')} · {t('common.loading')}</span>
        </div>
      ) : null}
      {runSettingsOpen && selected ? (
        <div className={styles.runSettings} data-testid="development-run-settings-panel">
          <div className={styles.runSettingsHeading}>
            <strong>{t('development.configureRun')}</strong>
            <span>{t('development.runSettingsHint')}</span>
          </div>
          {selected.framework === 'Spring Boot' ? (
            <label>
              <span>{t('development.springProfile')}</span>
              <input
                list={`spring-profiles-${projectId}`}
                value={draftProfile}
                placeholder={t('development.springProfilePlaceholder')}
                onChange={(event) => setDraftProfile(event.target.value)}
              />
              <datalist id={`spring-profiles-${projectId}`}>
                {springProfiles.map((profile) => <option key={profile} value={profile} />)}
              </datalist>
            </label>
          ) : null}
          {selectedUsesServletBuildPlugin ? (
            <div className={styles.notice} data-testid="development-servlet-plugin-settings">
              {runCopy.servletPluginOverridesLocked}
            </div>
          ) : (
            <Fragment>
              <label>
                <span>{runCopy.port}</span>
                <input
                  inputMode="numeric"
                  data-testid="development-run-port"
                  value={draftPort}
                  placeholder={String(selected.port)}
                  onChange={(event) => setDraftPort(event.target.value)}
                />
              </label>
              <label className={styles.runUrlField}>
                <span>{runCopy.url}</span>
                <input
                  data-testid="development-run-url"
                  value={draftUrl}
                  placeholder={selected.url}
                  onChange={(event) => setDraftUrl(event.target.value)}
                />
              </label>
              <label className={styles.argumentField}>
                <span>{t('development.additionalArguments')}</span>
                <input
                  value={draftArguments}
                  placeholder="--debug --feature=orders"
                  onChange={(event) => setDraftArguments(event.target.value)}
                />
              </label>
            </Fragment>
          )}
          <label className={styles.environmentField}>
            <span>{runCopy.environment}</span>
            <textarea
              data-testid="development-run-environment"
              value={draftEnvironment}
              placeholder={'FEATURE_ORDERS=true\nLOG_LEVEL=debug'}
              onChange={(event) => setDraftEnvironment(event.target.value)}
              spellCheck={false}
            />
            <small>{runCopy.environmentHint}</small>
          </label>
          <div className={styles.runSettingsActions}>
            <button type="button" onClick={resetRunSettings}>{t('common.clear')}</button>
            <button type="button" onClick={() => {
              setRunSettingsOpen(false);
              setRunSettingsProjectKey(null);
            }}>{t('common.cancel')}</button>
            <button type="button" className={styles.primaryAction} onClick={saveRunSettings}>{t('common.save')}</button>
          </div>
        </div>
      ) : null}
      {displayedConfig ? (
        <div
          className={styles.configurationSummary}
          data-testid="development-run-summary"
          title={`${displayedConfig.source} · ${displayedConfig.cwd} · ${displayedUrl}`}
        >
          {displayedProfile ? <strong>SPRING_PROFILES_ACTIVE={displayedProfile}</strong> : <strong>{displayedConfig.framework}</strong>}
          <code>{displayedCommand}</code>
          <span>{displayedUrl}{displayedPort ? ` · ${runCopy.port} ${displayedPort}` : ''}</span>
        </div>
      ) : null}
      {state === 'starting' ? (
        <div
          className={styles.launchProgress}
          data-testid="development-launch-progress"
          role="status"
          aria-live="polite"
          aria-label={t('development.serverStatus')}
        >
          <div className={styles.launchSummary}>
            <strong>{t('development.starting')}</strong>
            {launchConfig ? <span>{launchConfig.label}</span> : null}
          </div>
          <time dateTime={`PT${launchElapsedSeconds}S`}>{launchElapsedSeconds}s</time>
          <div className={styles.launchTrack} aria-hidden="true"><i /></div>
          <code title={latestLaunchLog ?? launchCommand}>{latestLaunchLog ?? launchCommand}</code>
        </div>
      ) : null}
      {logsOpen ? (
        <section className={styles.logPanel} data-testid="development-server-logs" aria-label={t('development.logs')}>
          <header>
            <span><i className={styles.projectStateDot} data-state={state} aria-hidden="true" />{activeProject?.label ?? (activeProjectPath || '.')}</span>
            <small>{runtimeStateLabel(state)}{runtime?.pid ? ` · PID ${runtime.pid}` : ''}</small>
          </header>
          <pre
            ref={logViewportRef}
            onScroll={(event) => {
              const viewport = event.currentTarget;
              logFollowRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 40;
            }}
          >{runtime?.logs.length ? runtime.logs.join('\n') : t('development.logsEmpty')}</pre>
        </section>
      ) : null}
      {displayedError ? (
        <div
          className={styles.error}
          data-testid="development-run-error"
          role="alert"
          aria-live="assertive"
          title={displayedError}
        >
          {displayedError}
        </div>
      ) : null}
      </div>
      <DevelopmentWorkspaceTutorial open={guideOpen} onClose={() => setGuideOpen(false)} />
    </Fragment>
  );
}
