'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import type { DatabaseSchemaWatchState, DocumentGraphResponse } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import styles from './DocumentImpactPanel.module.css';
import { ChangePlanPanel } from './ChangePlanPanel';

export function DocumentDependencyPanel({ projectId, dirty, onRequestDraft }: { projectId: string; dirty: boolean; onRequestDraft?: ((prompt: string) => void) | undefined }) {
  const { t } = useI18n();
  const [watch, setWatch] = useState<DatabaseSchemaWatchState | null>(null);
  const [report, setReport] = useState<DocumentGraphResponse | null>(null);
  const [files, setFiles] = useState('');
  const [interval, setIntervalSeconds] = useState(60);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const scope = useRef(0);
  const busyRef = useRef(false);
  const watchUrl = `/api/projects/${encodeURIComponent(projectId)}/database/schema-watch`;
  useEffect(() => {
    const epoch = ++scope.current;
    busyRef.current = false;
    setWatch(null); setReport(null); setError(''); setBusy(false); setFiles('');
    const controller = new AbortController();
    let initial = true;
    const refresh = async () => {
      if (busyRef.current) return;
      try {
        const response = await fetch(watchUrl, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return;
        const result = await response.json() as { state: DatabaseSchemaWatchState | null };
        if (scope.current === epoch && !busyRef.current) {
          setWatch(result.state);
          if (initial) { setIntervalSeconds(result.state?.intervalSeconds ?? 60); initial = false; }
        }
      } catch { /* A disconnected Desktop is reported by an explicit check. */ }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { scope.current++; controller.abort(); window.clearInterval(timer); };
  }, [watchUrl]);

  async function action(operation: 'enable' | 'disable' | 'check' | 'acknowledge' | 'graph') {
    const epoch = scope.current;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const graph = operation === 'graph';
      const url = graph ? `/api/projects/${encodeURIComponent(projectId)}/documents/graph`
        : watchUrl + (operation === 'check' || operation === 'acknowledge' ? `/${operation}` : '');
      const body = graph ? (files.trim() ? { inputFiles: files.split('\n').map((file) => file.trim()).filter(Boolean) } : {})
        : operation === 'acknowledge' ? { expectedSha256: watch?.latestSha256 }
        : { enabled: operation === 'enable', intervalSeconds: interval };
      const response = await fetch(url, {
        method: operation === 'enable' || operation === 'disable' ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message ?? t('docs.graph.failed'));
      if (epoch !== scope.current) return;
      if (graph) setReport(result as DocumentGraphResponse);
      else { setWatch(result.state); setReport(null); }
    } catch (failure) { if (epoch === scope.current) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (epoch === scope.current) { busyRef.current = false; setBusy(false); } }
  }
  const labels = new Map(report?.nodes.map((node) => [node.id, node.label]));
  return <section className={styles.root} aria-label={t('docs.graph.title')}>
    <h3>{t('docs.graph.title')}</h3><p>{t('docs.graph.scope')}</p>
    <fieldset disabled={busy}>
      <legend>{t('docs.watch.title')}</legend>
      <label>{t('docs.watch.interval')} <input type="number" min={10} max={86400} value={interval} onChange={(event) => setIntervalSeconds(Number(event.target.value))} /></label>
      <div className={styles.actions}>
        <Button onClick={() => void action(watch?.enabled ? 'disable' : 'enable')}>{watch?.enabled ? t('docs.watch.disable') : t('docs.watch.enable')}</Button>
        <Button disabled={!watch?.enabled} onClick={() => void action('check')}>{t('docs.watch.check')}</Button>
        <Button disabled={!watch?.changes.length || watch.status === 'error'} onClick={() => void action('acknowledge')}>{t('docs.watch.acknowledge')}</Button>
      </div>
      <p role="status">{watch ? t(`docs.watch.status.${watch.status}`) : t('docs.watch.unconfigured')}{watch?.checkedAt ? ` · ${new Date(watch.checkedAt).toLocaleString()}` : ''}</p>
      {watch?.error ? <p role="alert" className={styles.error}>{watch.error}</p> : null}
      {watch?.changes.length ? <details open><summary>{t('docs.watch.changes', { count: watch.changes.length })}</summary>
        <ul>{watch.changes.slice(0, 200).map((change, index) => <li key={index}><strong>{change.schema}.{change.table}{change.column ? `.${change.column}` : ''}</strong>
          <span>{t(`docs.watch.change.${change.kind}`)} · {change.before ? `${change.before.type} (${change.before.nullable})` : '—'} → {change.after ? `${change.after.type} (${change.after.nullable})` : '—'}</span></li>)}</ul>
        {watch.changes.length > 200 ? <p>200 / {watch.changes.length}</p> : null}
      </details> : null}
    </fieldset>
    <label>{t('docs.graph.files')}<textarea rows={2} value={files} onChange={(event) => setFiles(event.target.value)} /></label>
    <div className={styles.actions}><Button disabled={busy || dirty} onClick={() => void action('graph')}>{t('docs.graph.analyze')}</Button></div>
    {dirty ? <p>{t('docs.impact.saveFirst')}</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <ChangePlanPanel projectId={projectId} dirty={dirty} inputFiles={files} onRequestDraft={onRequestDraft} />
    {report ? <div>
      <time dateTime={report.analyzedAt}>{new Date(report.analyzedAt).toLocaleString()}</time>
      <p>{t('docs.graph.summary', { documents: report.documents.length, affected: new Set(report.impacts.map((impact) => impact.nodeId)).size, unknown: report.unlinkedNodeIds.length })}</p>
      <ul>{report.impacts.slice(0, 200).map((impact, index) => <li key={index}>{impact.path.map((id) => labels.get(id) ?? id).join(' → ')}</li>)}</ul>
      {report.impacts.length > 200 ? <p>200 / {report.impacts.length}</p> : null}
      {report.warnings.length ? <details open><summary>{t('docs.graph.warnings')}</summary><ul>{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details> : null}
      {report.unlinkedNodeIds.length ? <details><summary>{t('docs.graph.unlinked')}</summary><ul>{report.unlinkedNodeIds.map((id) => <li key={id}>{labels.get(id)}</li>)}</ul></details> : null}
    </div> : null}
  </section>;
}
