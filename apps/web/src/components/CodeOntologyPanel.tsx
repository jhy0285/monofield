'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import type { CodeOntologyResponse } from '@open-design/contracts';
import { useT } from '../i18n';
import styles from './CodeOntologyPanel.module.css';

export function CodeOntologyPanel({ projectId, projectPath, ready = true, revisionKey, agentBusy = false, onRequestDraft }: {
  projectId: string; projectPath?: string | null | undefined; ready?: boolean | undefined;
  revisionKey?: string | undefined; agentBusy?: boolean | undefined; onRequestDraft?: ((prompt: string) => void) | undefined;
}) {
  const t = useT();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [documents, setDocuments] = useState(''), [request, setRequest] = useState('');
  const [workspace, setWorkspace] = useState(false);
  const [report, setReport] = useState<CodeOntologyResponse | null>(null);
  const [selected, setSelected] = useState(''), [draft, setDraft] = useState(false);
  const [search, setSearch] = useState('');
  const [stale, setStale] = useState(false);
  const reportRef = useRef(report); reportRef.current = report;
  const generation = useRef(0), abort = useRef<AbortController | null>(null);
  useEffect(() => {
    generation.current++; abort.current?.abort(); setBusy(false); setError(''); setReport(null); setSelected(''); setSearch(''); setDraft(false); setStale(false);
    return () => { generation.current++; abort.current?.abort(); };
  }, [projectId, projectPath, documents, request, ready, workspace]);
  useEffect(() => {
    // The worker verifies its own source snapshot. Delayed watcher notifications
    // must not cancel a valid rebuild that already includes the observed edit.
    if (reportRef.current) { setStale(true); setDraft(false); }
  }, [revisionKey]);
  async function build() {
    const current = ++generation.current;
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    setBusy(true); setError(''); setDraft(false); setReport(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/ontology/build`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ ...(workspace ? { projectPath: '.' } : projectPath ? { projectPath } : {}), businessFiles: documents.split('\n').map(name => name.trim()).filter(Boolean), request }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value?.error?.message ?? t('ontology.failed'));
      if (current === generation.current) { setReport(value as CodeOntologyResponse); setStale(false); }
    } catch (failure) { if (current === generation.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (current === generation.current) setBusy(false); }
  }
  const labels = new Map(report?.nodes.map(node => [node.id, node.kind === 'request' ? `${node.evidence.path} · ${node.label}` : node.label]));
  const related = report?.edges.filter(edge => !selected || edge.from === selected || edge.to === selected) ?? [];
  const selectable = report?.nodes.filter(node => node.kind !== 'external' && node.label.toLowerCase().includes(search.toLowerCase())) ?? [];
  return <section className={styles.panel} aria-label={t('ontology.title')}>
    <div className={styles.header}><Button aria-expanded={open} onClick={() => setOpen(value => !value)}>{t('ontology.title')}</Button>
      {report ? <span className={styles.meta}>{t('ontology.counts', { nodes: report.nodes.length, edges: report.edges.length })}</span> : null}</div>
    {open ? <div className={styles.body}>
      <p>{t('ontology.description')}</p><p className={styles.meta}>{t('ontology.support')}</p>
      <label className={styles.scope}><input type="checkbox" checked={workspace} onChange={event => setWorkspace(event.target.checked)} />{t('ontology.workspace')}</label>
      <label>{t('ontology.documents')}<textarea rows={2} value={documents} onChange={event => setDocuments(event.target.value)} placeholder="docs/business.md" /></label>
      <label>{t('ontology.request')}<textarea rows={2} maxLength={2000} value={request} onChange={event => setRequest(event.target.value)} /></label>
      <div className={styles.actions}><Button disabled={busy || !ready || agentBusy} onClick={() => void build()}>{busy ? t('ontology.working') : t('ontology.build')}</Button>
        {busy ? <Button onClick={() => { generation.current++; abort.current?.abort(); setBusy(false); }}>{t('common.cancel')}</Button> : null}</div>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {report ? <div className={styles.report}>
        <p role="status">{t('ontology.coverage', { parsed: report.coverage.parsedFiles, scanned: report.coverage.scannedFiles, unsupported: report.coverage.unsupportedFiles })}</p>
        <p className={styles.meta}>{t('ontology.elapsed', { ms: report.elapsedMs })} · {report.cacheHit ? t('ontology.cached') : t('ontology.fresh')} · {report.coverage.languages.map(item => `${item.id}: ${item.files}`).join(' · ')}</p>
        <p>{t('ontology.candidates')}</p>
        {stale ? <p role="status" className={styles.warning}>{t('ontology.changed')}</p> : null}
        {report.coverage.truncated ? <p role="alert" className={styles.warning}>{t('ontology.partial')}</p> : null}
        <label>{t('common.search')}<input type="search" value={search} onChange={event => { setSearch(event.target.value); setSelected(''); }} /></label>
        <label>{t('ontology.inspect')}<select value={selected} onChange={event => setSelected(event.target.value)}>
          <option value="">{t('ontology.all')}</option>{selectable.slice(0, 1000).map(node => <option value={node.id} key={node.id}>{node.kind} · {node.label}</option>)}
        </select></label>
        {selectable.length > 1000 ? <p className={styles.meta}>1000 / {selectable.length}</p> : null}
        <ol className={styles.relations}>{related.slice(0, 150).map(edge => <li key={edge.id} data-basis={edge.basis}>
          <strong>{labels.get(edge.from)} → {labels.get(edge.to)}</strong>
          <span>{t(`ontology.relation.${edge.relation}`)} · {edge.basis === 'candidate' ? t('ontology.candidate') : t('ontology.syntax')}</span>
          <details><summary>{t('ontology.evidence')}</summary><code>{edge.evidence.path}:{edge.evidence.line}</code><small>SHA-256 {edge.evidence.sha256}</small></details>
        </li>)}</ol>
        {related.length > 150 ? <p className={styles.meta}>150 / {related.length}</p> : null}
        {report.issues.length ? <details open><summary>{t('ontology.issues', { count: report.issues.length })}</summary><ul>{report.issues.slice(0, 150).map((issue, index) => <li key={index}><code>{issue.path}</code> · {t(`ontology.issue.${issue.reason}`)}<small>{issue.message}</small></li>)}</ul></details> : null}
        <div className={styles.actions}><Button disabled={stale} onClick={() => { setDraft(true); onRequestDraft?.(report.handoff); }}>{t('ontology.draft')}</Button>
          <Button onClick={() => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
            const link = document.createElement('a'); link.href = url; link.download = 'monofield-code-ontology.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
          }}>{t('ontology.export')}</Button></div>
        {draft ? <textarea readOnly rows={6} value={report.handoff} aria-label={t('ontology.draft')} /> : null}
      </div> : null}
    </div> : null}
  </section>;
}
