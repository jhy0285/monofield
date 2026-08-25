import { useCallback, useEffect, useMemo, useState } from 'react';

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

type Props = {
  projectId: string;
  metadata: ProjectMetadata;
  resolvedDir?: string | null;
  onMetadataChange: (metadata: ProjectMetadata) => void;
  onOpenUrl: (url: string) => void;
  onOpenChanges: () => void;
};

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as T | { error?: { message?: string } } | null;
  if (!response.ok) throw new Error((payload as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${response.status}`);
  return payload as T;
}

export function DevelopmentWorkspaceControls({ projectId, metadata, resolvedDir, onMetadataChange, onOpenUrl, onOpenChanges }: Props) {
  const t = useT();
  const [detected, setDetected] = useState<DevelopmentConfigsResponse | null>(null);
  const [runtime, setRuntime] = useState<DevelopmentServerStatus | null>(null);
  const [connections, setConnections] = useState<DatabaseConnectionSummary[]>([]);
  const [busy, setBusy] = useState<'detect' | 'start' | 'stop' | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const load = useCallback(async () => {
    if (!resolvedDir) return;
    setBusy('detect');
    setError(null);
    try {
      const [configs, status, database] = await Promise.all([
        fetch(`/api/projects/${encodeURIComponent(projectId)}/development/configs`).then((response) => responseJson<DevelopmentConfigsResponse>(response)),
        fetch(`/api/projects/${encodeURIComponent(projectId)}/development/server`).then((response) => responseJson<DevelopmentServerStatus>(response)),
        getOpenDesignHost()?.database?.list().then((connections) => ({ connections })).catch(() => ({ connections: [] }))
          ?? Promise.resolve({ connections: [] as DatabaseConnectionSummary[] }),
      ]);
      setDetected(configs);
      setRuntime(status);
      setConnections(database.connections);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('development.detectFailed'));
    } finally {
      setBusy(null);
    }
  }, [projectId, resolvedDir, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeActiveBrowserVerification((changedProjectId) => {
    if (changedProjectId === projectId) {
      setBrowserVerificationActive(Boolean(getActiveBrowserVerification(projectId)));
    }
  }), [projectId]);

  function persistDevelopment(next: Partial<NonNullable<ProjectMetadata['development']>>) {
    onMetadataChange({
      ...metadata,
      development: { autoVerify: metadata.development?.autoVerify !== false, ...metadata.development, ...next },
    });
  }

  async function start() {
    if (!selected) return;
    setBusy('start');
    setError(null);
    persistDevelopment({ runConfigId: selected.id });
    try {
      const next = await fetch(`/api/projects/${encodeURIComponent(projectId)}/development/server/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ configId: selected.id }),
      }).then((response) => responseJson<DevelopmentServerStatus>(response));
      setRuntime(next);
      if (next.state === 'ready' && next.url) onOpenUrl(next.url);
      if (next.state === 'failed') setError(next.error ?? t('development.startFailed'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('development.startFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function stop() {
    setBusy('stop');
    setError(null);
    try {
      setRuntime(await fetch(`/api/projects/${encodeURIComponent(projectId)}/development/server/stop`, { method: 'POST' }).then((response) => responseJson<DevelopmentServerStatus>(response)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('development.stopFailed'));
    } finally {
      setBusy(null);
    }
  }

  function selectConfig(config: DevelopmentRunConfig | null) {
    if (config) persistDevelopment({ runConfigId: config.id });
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
  return (
    <div className={styles.root} data-testid="development-workspace-controls">
      <div className={styles.runGroup}>
        <span className={`${styles.state} ${styles[`state_${state}`] ?? ''}`} aria-label={t('development.serverStatus')}>
          <i />{state === 'ready' ? t('development.ready') : state === 'starting' ? t('development.starting') : state === 'failed' ? t('development.failed') : t('development.stopped')}
        </span>
        <select
          className={`${styles.select} ${styles.runSelect}`}
          aria-label={t('development.runConfiguration')}
          title={selected?.label ?? t('development.noConfiguration')}
          value={selectedId}
          disabled={busy != null || (detected?.configs.length ?? 0) === 0}
          onChange={(event) => selectConfig(detected?.configs.find((item) => item.id === event.target.value) ?? null)}
        >
          {(detected?.configs.length ?? 0) === 0 ? <option value="">{t('development.noConfiguration')}</option> : null}
          {detected?.configs.map((config) => <option key={config.id} value={config.id}>{config.label}</option>)}
        </select>
        {runtime?.state === 'ready' ? (
          <button type="button" className={styles.action} onClick={() => void stop()} disabled={busy != null}><Icon name="stop" size={13} />{t('development.stop')}</button>
        ) : (
          <button type="button" className={styles.action} onClick={() => void start()} disabled={busy != null || !selected}><Icon name="play" size={13} />{t('development.start')}</button>
        )}
        <button type="button" className={styles.iconAction} aria-label={t('development.detectAgain')} title={t('development.detectAgain')} onClick={() => void load()} disabled={busy != null}><Icon name="reload" size={13} /></button>
        <button type="button" className={styles.action} onClick={onOpenChanges}><Icon name="fork" size={13} />{t('gitChanges.title')}</button>
      </div>
      <div className={styles.contextGroup}>
        <select className={`${styles.select} ${styles.databaseSelect}`} aria-label={t('development.database')} title={metadata.databaseContext?.label ?? t('development.noDatabase')} value={metadata.databaseContext?.connectionId ?? ''} onChange={(event) => selectDatabase(event.target.value)}>
          <option value="">{t('development.noDatabase')}</option>
          {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.label}</option>)}
        </select>
        <label
          className={`${styles.verify} od-tooltip`}
          title={t('development.autoVerifyHint')}
          data-tooltip={t('development.autoVerifyHint')}
          data-tooltip-placement="bottom"
        >
          <input type="checkbox" checked={metadata.development?.autoVerify !== false} onChange={(event) => persistDevelopment({ autoVerify: event.target.checked })} />
          <i className={styles.verifyStatus} data-active={browserVerificationActive ? 'true' : 'false'} aria-hidden="true" />
          <span>{t('development.autoVerify')}</span>
        </label>
      </div>
      {error ? <span className={styles.error} role="status" title={error}>{error}</span> : null}
    </div>
  );
}
