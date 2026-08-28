import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  DatabaseConnectionSummary,
  DevelopmentConfigsResponse,
  DevelopmentRunConfig,
  DevelopmentServerStatus,
  ProjectMetadata,
} from '@open-design/contracts';
import { getOpenDesignHost } from '@open-design/host';
import { useT } from '../i18n';
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
  onMetadataChange: (metadata: ProjectMetadata) => void;
  onOpenUrl: (url: string) => void;
  onOpenChanges: () => void;
};

type DevelopmentServersResponse = {
  servers: DevelopmentServerStatus[];
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

export function DevelopmentWorkspaceControls({ projectId, metadata, resolvedDir, onMetadataChange, onOpenUrl, onOpenChanges }: Props) {
  const t = useT();
  const [detected, setDetected] = useState<DevelopmentConfigsResponse | null>(null);
  const [runtime, setRuntime] = useState<DevelopmentServerStatus | null>(null);
  const [runtimeStatuses, setRuntimeStatuses] = useState<DevelopmentServerStatus[]>([]);
  const [activeProjectPath, setActiveProjectPath] = useState(metadata.development?.activeProjectPath ?? '');
  const [connections, setConnections] = useState<DatabaseConnectionSummary[]>([]);
  const [busy, setBusy] = useState<'detect' | 'start' | 'stop' | null>(null);
  const [launchElapsedSeconds, setLaunchElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [runSettingsOpen, setRunSettingsOpen] = useState(false);
  const [draftProfile, setDraftProfile] = useState('');
  const [draftArguments, setDraftArguments] = useState('');
  const guideAutoOpenChecked = useRef(false);
  const openBrowserWhenReady = useRef(false);
  const activeProjectPathRef = useRef(activeProjectPath);
  const detectedByProjectPathRef = useRef(new Map<string, DevelopmentConfigsResponse>());
  const runtimeByProjectPathRef = useRef(new Map<string, DevelopmentServerStatus>());
  const detectionRequestRef = useRef(0);
  const resolvedDirRef = useRef<string | null>(null);
  const [browserVerificationActive, setBrowserVerificationActive] = useState(
    () => Boolean(getActiveBrowserVerification(projectId)),
  );
  const preferredId = metadata.development?.runConfigId;
  const selectedId = preferredId && detected?.configs.some((item) => item.id === preferredId)
    ? preferredId
    : detected?.recommendedConfigId ?? '';
  const selected = useMemo(
    () => detected?.configs.find((item) => item.id === selectedId) ?? null,
    [detected, selectedId],
  );
  const effectiveProfile = metadata.development?.runProfile ?? selected?.profile ?? '';
  const effectiveArguments = metadata.development?.runArguments ?? '';
  const springProfiles = useMemo(
    () => Array.from(new Set(detected?.configs
      .filter((item) => item.framework === 'Spring Boot' && item.profile)
      .map((item) => item.profile as string) ?? [])).sort(),
    [detected],
  );

  activeProjectPathRef.current = activeProjectPath;

  const rememberRuntimes = useCallback((statuses: DevelopmentServerStatus[]) => {
    const next = new Map(runtimeByProjectPathRef.current);
    for (const status of statuses) next.set(runtimePath(status), status);
    runtimeByProjectPathRef.current = next;
    setRuntimeStatuses([...next.values()]);
  }, []);

  const load = useCallback(async (refresh = false, requestedProjectPath?: string) => {
    if (!resolvedDir) return;
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
      const [configs, status, allStatuses] = await Promise.all([
        cachedDetection
          ? Promise.resolve(cachedDetection)
          : fetch(`/api/projects/${encodeURIComponent(projectId)}/development/configs${configQuery}`).then((response) => responseJson<DevelopmentConfigsResponse>(response)),
        fetch(`/api/projects/${encodeURIComponent(projectId)}/development/server${statusQuery}`).then((response) => responseJson<DevelopmentServerStatus>(response)),
        fetch(`/api/projects/${encodeURIComponent(projectId)}/development/servers`).then((response) => responseJson<DevelopmentServersResponse>(response)),
      ]);
      if (requestId !== detectionRequestRef.current) return;
      const resolvedProjectPath = configs.activeProjectPath || runtimePath(status);
      detectedByProjectPathRef.current.set(resolvedProjectPath, configs);
      setDetected(configs);
      if (configs.activeProjectPath) {
        activeProjectPathRef.current = configs.activeProjectPath;
        setActiveProjectPath(configs.activeProjectPath);
      }
      rememberRuntimes([...(allStatuses.servers ?? []), status]);
      setRuntime(status);
    } catch (caught) {
      if (requestId !== detectionRequestRef.current) return;
      setError(caught instanceof Error ? caught.message : t('development.detectFailed'));
    } finally {
      if (requestId === detectionRequestRef.current) setBusy(null);
    }
  }, [projectId, rememberRuntimes, resolvedDir, t]);

  useEffect(() => {
    if (!resolvedDir) return;
    const previousDir = resolvedDirRef.current;
    const folderChanged = previousDir != null && previousDir !== resolvedDir;
    resolvedDirRef.current = resolvedDir;
    if (folderChanged) {
      activeProjectPathRef.current = '';
      detectedByProjectPathRef.current.clear();
      runtimeByProjectPathRef.current.clear();
      setActiveProjectPath('');
      setDetected(null);
      setRuntime(null);
      setRuntimeStatuses([]);
      openBrowserWhenReady.current = false;
      void fetch(`/api/projects/${encodeURIComponent(projectId)}/development/server/stop-all`, { method: 'POST' })
        .catch(() => null)
        .finally(() => { void load(true, ''); });
      return;
    }
    void load();
  }, [load, projectId, resolvedDir]);
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
    persistDevelopment({ activeProjectPath: detectedPath });
  }, [detected?.activeProjectPath, metadata.development?.activeProjectPath]);
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
    if (runtime?.state !== 'starting') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const params = new URLSearchParams();
        if (activeProjectPathRef.current) params.set('projectPath', activeProjectPathRef.current);
        const query = params.size > 0 ? `?${params}` : '';
        const next = await fetch(`/api/projects/${encodeURIComponent(projectId)}/development/server${query}`)
          .then((response) => responseJson<DevelopmentServerStatus>(response));
        if (cancelled) return;
        rememberRuntimes([next]);
        setRuntime(next);
        if (next.state === 'ready' && next.url && openBrowserWhenReady.current) {
          openBrowserWhenReady.current = false;
          onOpenUrl(next.url);
        } else if (next.state === 'failed') {
          openBrowserWhenReady.current = false;
          setError(next.error ?? t('development.startFailed'));
        } else if (next.state === 'starting') {
          timer = setTimeout(() => void poll(), 750);
        }
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : t('development.startFailed'));
        timer = setTimeout(() => void poll(), 1_500);
      }
    };
    timer = setTimeout(() => void poll(), 300);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [onOpenUrl, projectId, rememberRuntimes, runtime?.state, t]);

  function persistDevelopment(next: Partial<NonNullable<ProjectMetadata['development']>>) {
    onMetadataChange({
      ...metadata,
      development: { autoVerify: metadata.development?.autoVerify !== false, ...metadata.development, ...next },
    });
  }

  async function start() {
    if (!selected) return;
    let applicationArgs: string[];
    try {
      applicationArgs = parseRunArguments(effectiveArguments);
    } catch {
      setError(t('development.invalidArguments'));
      return;
    }
    setBusy('start');
    setError(null);
    openBrowserWhenReady.current = true;
    persistDevelopment({ runConfigId: selected.id });
    try {
      const next = await fetch(`/api/projects/${encodeURIComponent(projectId)}/development/server/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          configId: selected.id,
          projectPath: activeProjectPath || undefined,
          overrides: {
            ...(selected.framework === 'Spring Boot' ? { profile: effectiveProfile } : {}),
            ...(applicationArgs.length > 0 ? { applicationArgs } : {}),
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
    if (config) persistDevelopment({ runConfigId: config.id, runProfile: undefined });
  }

  function openRunSettings() {
    setDraftProfile(effectiveProfile);
    setDraftArguments(effectiveArguments);
    setRunSettingsOpen(true);
  }

  function saveRunSettings() {
    try {
      parseRunArguments(draftArguments);
      const profile = draftProfile.trim();
      const matchingConfig = detected?.configs.find((item) => item.framework === 'Spring Boot' && (item.profile ?? '') === profile);
      persistDevelopment({
        runConfigId: matchingConfig?.id ?? selected?.id,
        runProfile: matchingConfig ? undefined : profile || undefined,
        runArguments: draftArguments.trim() || undefined,
      });
      setError(null);
      setRunSettingsOpen(false);
    } catch {
      setError(t('development.invalidArguments'));
    }
  }

  function resetRunSettings() {
    setDraftProfile(selected?.profile ?? '');
    setDraftArguments('');
    persistDevelopment({ runProfile: undefined, runArguments: undefined });
    setError(null);
  }

  function selectProject(projectPath: string) {
    activeProjectPathRef.current = projectPath;
    setActiveProjectPath(projectPath);
    setDetected(detectedByProjectPathRef.current.get(projectPath) ?? (detected
      ? { ...detected, configs: [], recommendedConfigId: null, activeProjectPath: projectPath }
      : null));
    setRuntime(runtimeByProjectPathRef.current.get(projectPath) ?? idleRuntime(projectId, projectPath));
    setError(null);
    openBrowserWhenReady.current = false;
    persistDevelopment({ activeProjectPath: projectPath, runConfigId: undefined });
    void load(false, projectPath);
  }

  function selectDatabase(connectionId: string) {
    const connection = connections.find((item) => item.id === connectionId);
    const { databaseContext: _currentDatabaseContext, ...metadataWithoutDatabase } = metadata;
    onMetadataChange({
      ...(connection ? metadata : metadataWithoutDatabase),
      ...(connection
        ? { databaseContext: { connectionId: connection.id, label: connection.label, useForDevelopment: true } }
        : {}),
    });
  }

  if (!resolvedDir) {
    return <span className={styles.notice}>{t('development.folderRequired')}</span>;
  }

  const state = busy === 'start' ? 'starting' : runtime?.state ?? 'idle';
  const canStop = state === 'starting' || state === 'ready' || Boolean(runtime?.pid);
  const launchConfig = runtime?.config ?? selected;
  const latestLaunchLog = [...(runtime?.logs ?? [])].reverse().find((line) => line.trim().length > 0);
  const displayedError = error ?? runtime?.error ?? null;
  const runningCount = runtimeStatuses.filter((status) => status.state === 'starting' || status.state === 'ready').length;
  const launchCommand = launchConfig
    ? [launchConfig.command.split(/[\\/]/).pop() ?? launchConfig.command, ...launchConfig.args].join(' ')
    : '';
  return (
    <Fragment>
      <div className={styles.root} data-testid="development-workspace-controls">
      <div className={styles.runGroup} data-testid="development-run-group">
        <span className={`${styles.state} ${styles[`state_${state}`] ?? ''}`} aria-label={t('development.serverStatus')}>
          <i />{state === 'ready' ? t('development.ready') : state === 'starting' ? t('development.starting') : state === 'failed' ? t('development.failed') : t('development.stopped')}
        </span>
        {(detected?.projects?.length ?? 0) > 1 ? (
          <select
            className={`${styles.select} ${styles.projectSelect}`}
            data-testid="development-active-project"
            aria-label={t('workspaceTabs.project')}
            title={detected?.projects?.find((project) => project.path === activeProjectPath)?.path ?? activeProjectPath}
            value={activeProjectPath}
            disabled={busy === 'start' || busy === 'stop'}
            onChange={(event) => selectProject(event.target.value)}
          >
            {detected?.projects?.map((project) => {
              const projectRuntime = runtimeStatuses.find((status) => runtimePath(status) === project.path);
              const marker = projectRuntime?.state === 'ready' ? '● '
                : projectRuntime?.state === 'starting' ? '◐ '
                  : projectRuntime?.state === 'failed' ? '! ' : '';
              return <option key={project.path} value={project.path}>{marker}{project.label} · {project.path}</option>;
            })}
          </select>
        ) : null}
        {runningCount > 0 ? (
          <span className={styles.runningCount} data-testid="development-running-count">
            {runningCount} {t('development.ready')}
          </span>
        ) : null}
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
          title={t('development.configureRun')}
          onClick={openRunSettings}
          disabled={busy != null || canStop || !selected}
        >
          <Icon name="settings" size={13} />
        </button>
        {canStop ? (
          <button type="button" className={styles.action} data-testid="development-run-action" onClick={() => void stop()} disabled={busy != null}><Icon name="stop" size={13} />{t('development.stop')}</button>
        ) : (
          <button type="button" className={styles.action} data-testid="development-run-action" onClick={() => void start()} disabled={busy != null || !selected}><Icon name="play" size={13} />{t('development.start')}</button>
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
      <div className={styles.contextGroup}>
        <select className={`${styles.select} ${styles.databaseSelect}`} data-testid="development-database" aria-label={t('development.database')} title={metadata.databaseContext?.label ?? t('development.noDatabase')} value={metadata.databaseContext?.connectionId ?? ''} onChange={(event) => selectDatabase(event.target.value)}>
          <option value="">{t('development.noDatabase')}</option>
          {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.label}</option>)}
        </select>
        <label
          className={`${styles.verify} od-tooltip`}
          data-testid="development-auto-verify"
          title={t('development.autoVerifyHint')}
          data-tooltip={t('development.autoVerifyHint')}
          data-tooltip-placement="bottom"
        >
          <input type="checkbox" checked={metadata.development?.autoVerify !== false} onChange={(event) => persistDevelopment({ autoVerify: event.target.checked })} />
          <i className={styles.verifyStatus} data-active={browserVerificationActive ? 'true' : 'false'} aria-hidden="true" />
          <span>{t('development.autoVerify')}</span>
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
          <label className={styles.argumentField}>
            <span>{t('development.additionalArguments')}</span>
            <input
              value={draftArguments}
              placeholder="--debug --feature=orders"
              onChange={(event) => setDraftArguments(event.target.value)}
            />
          </label>
          <div className={styles.runSettingsActions}>
            <button type="button" onClick={resetRunSettings}>{t('common.clear')}</button>
            <button type="button" onClick={() => setRunSettingsOpen(false)}>{t('common.cancel')}</button>
            <button type="button" className={styles.primaryAction} onClick={saveRunSettings}>{t('common.save')}</button>
          </div>
        </div>
      ) : null}
      {selected ? (
        <div
          className={styles.configurationSummary}
          data-testid="development-run-summary"
          title={`${selected.source} · ${selected.cwd} · ${selected.url}`}
        >
          {effectiveProfile ? <strong>SPRING_PROFILES_ACTIVE={effectiveProfile}</strong> : <strong>{selected.framework}</strong>}
          <code>{[selected.command.split(/[\\/]/).pop() ?? selected.command, ...selected.args, ...(effectiveArguments ? [effectiveArguments] : [])].join(' ')}</code>
          <span>{selected.url}</span>
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
