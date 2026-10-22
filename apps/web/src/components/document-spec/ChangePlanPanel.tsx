'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import type { ChangePlanRequest, ChangePlanResponse } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import styles from './ChangePlanPanel.module.css';

export function ChangePlanPanel({ projectId, dirty, inputFiles, onRequestDraft }: {
  projectId: string; dirty: boolean; inputFiles: string;
  onRequestDraft?: ((prompt: string) => void) | undefined;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [rulesFile, setRulesFile] = useState(''), [request, setRequest] = useState('');
  const [report, setReport] = useState<ChangePlanResponse | null>(null);
  const [simulation, setSimulation] = useState<string[]>([]);
  const [showHandoff, setShowHandoff] = useState(false);
  const epoch = useRef(0), controller = useRef<AbortController | null>(null);
  useEffect(() => {
    epoch.current++; controller.current?.abort(); setBusy(false); setReport(null); setError(''); setSimulation([]); setShowHandoff(false);
    return () => { epoch.current++; controller.current?.abort(); };
  }, [projectId, dirty, inputFiles, rulesFile, request]);
  async function analyze(ids: string[] = []) {
    const current = ++epoch.current;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setShowHandoff(false); setReport(null);
    const body: ChangePlanRequest = {
      ...(inputFiles.trim() ? { inputFiles: inputFiles.split('\n').map(file => file.trim()).filter(Boolean) } : {}),
      ...(rulesFile.trim() ? { rulesFile: rulesFile.trim() } : {}), request,
      ...(ids.length ? { simulateNodeIds: ids } : {}),
    };
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/documents/plan`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: abort.signal,
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value?.error?.message ?? t('docs.graph.failed'));
      if (current === epoch.current) setReport(value as ChangePlanResponse);
    } catch (failure) { if (current === epoch.current && !abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  const labels = new Map(report?.graph.nodes.map(node => [node.id, node.label]));
  return <section className={styles.root} aria-label={t('changePlan.title')}>
    <Button aria-expanded={open} onClick={() => setOpen(value => !value)}>{t('changePlan.title')}</Button>
    {open ? <div className={styles.body}>
      <p>{t('changePlan.description')}</p>
      <label>{t('changePlan.request')}<textarea value={request} maxLength={2000} rows={2} onChange={event => setRequest(event.target.value)} /></label>
      <label>{t('changePlan.rulesFile')}<input value={rulesFile} onChange={event => setRulesFile(event.target.value)} placeholder="change-policy.json" /></label>
      <p className={styles.hint}>{t('changePlan.policyHint')}</p>
      <Button disabled={busy || dirty} onClick={() => void analyze()}>{busy ? t('common.loading') : t('changePlan.analyze')}</Button>
      {dirty ? <p>{t('docs.impact.saveFirst')}</p> : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {report ? <div className={styles.report}>
        <p role="status">{t(`changePlan.mode.${report.mode}`)} · {t('changePlan.summary', report.summary)}</p>
        <p className={styles.hint}>{t('changePlan.elapsed', { ms: report.elapsedMs })} · <time dateTime={report.graph.analyzedAt}>{new Date(report.graph.analyzedAt).toLocaleString()}</time></p>
        <p>{t('changePlan.passMeaning')}</p>
        <details><summary>{t('changePlan.simulateTitle')}</summary>
          <p>{t('changePlan.simulateHint')}</p>
          <div className={styles.targets}>{report.graph.nodes.filter(node => node.kind === 'code' || node.kind === 'database').slice(0, 200).map(node => <label key={node.id}>
            <input type="checkbox" checked={simulation.includes(node.id)} disabled={busy || (simulation.length >= 32 && !simulation.includes(node.id))} onChange={event => {
              setSimulation(ids => event.target.checked ? [...ids, node.id] : ids.filter(id => id !== node.id)); setShowHandoff(false);
            }} />{node.kind} · {node.label}
          </label>)}</div>
          <Button disabled={busy || dirty || !simulation.length} onClick={() => void analyze(simulation)}>{t('changePlan.simulate')}</Button>
        </details>
        <ol className={styles.obligations}>{report.obligations.slice(0, 200).map(item => <li key={item.id} data-state={item.state}>
          <div><strong>{labels.get(item.nodeId)}</strong><span className={styles.state}>{t(`changePlan.state.${item.state}`)}</span></div>
          <p>{item.review ? t(`changePlan.review.${item.review}`) : item.requirement}{item.checkId ? ` · ${item.checkId}` : ''}</p>
          <details><summary>{t('changePlan.why')}</summary>{item.triggers.map(trigger => <div key={trigger.ruleId + trigger.condition}><code>{trigger.ruleId}: {trigger.condition}</code></div>)}<p>{item.path.map(id => labels.get(id) ?? id).join(' → ')}</p></details>
        </li>)}</ol>
        {report.obligations.length > 200 ? <p>200 / {report.obligations.length}</p> : null}
        {report.warnings.length || report.unmatchedChangedFiles.length ? <details open><summary>{t('docs.graph.warnings')}</summary>
          <ul>{report.warnings.map(warning => <li key={warning}>{warning}</li>)}{report.unmatchedChangedFiles.slice(0, 200).map(file => <li key={file}><code>{file}</code> · {t('changePlan.state.coverage-gap')}</li>)}</ul>
        </details> : null}
        <Button disabled={busy || dirty} onClick={() => { setShowHandoff(true); onRequestDraft?.(report.handoff); }}>{t('changePlan.handoff')}</Button>
        {showHandoff ? <label>{t('changePlan.handoffHint')}<textarea rows={8} readOnly value={report.handoff} /></label> : null}
      </div> : null}
    </div> : null}
  </section>;
}
