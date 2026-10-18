'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import type { CodeOntologyResponse, CodeOntologyPlanResponse } from '@open-design/contracts';
import { useT } from '../i18n';
import styles from './CodeOntologyPanel.module.css';
import { OntologyTutorial } from './OntologyTutorial';
import { shouldShowOntologyTutorial } from '../state/ontology-tutorial';
import { OntologyContextPanel } from './OntologyContextPanel';

export function CodeOntologyPanel({ projectId, projectPath, ready = true, revisionKey, agentBusy = false, onRequestDraft, onOpenFile, initiallyOpen = false, sourceFile }: {
  projectId: string; projectPath?: string | null | undefined; ready?: boolean | undefined;
  revisionKey?: string | undefined; agentBusy?: boolean | undefined; onRequestDraft?: ((prompt: string) => void) | undefined;
  onOpenFile?: ((path: string) => void) | undefined;
  initiallyOpen?: boolean;
  sourceFile?: string | undefined;
}) {
  const t = useT();
  const [open, setOpen] = useState(initiallyOpen), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [documents, setDocuments] = useState(''), [request, setRequest] = useState('');
  const [workspace, setWorkspace] = useState(false);
  const [report, setReport] = useState<CodeOntologyResponse | null>(null);
  const [change, setChange] = useState<CodeOntologyPlanResponse | null>(null);
  const [automatic, setAutomatic] = useState(false);
  const [selected, setSelected] = useState(''), [draft, setDraft] = useState(false);
  const [search, setSearch] = useState('');
  const [stale, setStale] = useState(false);
  const [tutorial, setTutorial] = useState(false);
  const [contextBusy, setContextBusy] = useState(false);
  const tutorialSeen = useRef(false);
  const reportRef = useRef(report); reportRef.current = report;
  const generation = useRef(0), abort = useRef<AbortController | null>(null);
  const lastOperation = useRef<'build' | 'plan'>('build');
  const lastSimulationFiles = useRef<string[]>([]);
  const autoRevision = useRef<string | undefined>(revisionKey);
  useEffect(() => {
    generation.current++; abort.current?.abort(); setBusy(false); setError(''); setReport(null); setChange(null); setSelected(''); setSearch(''); setDraft(false); setStale(false); lastSimulationFiles.current = [];
    return () => { generation.current++; abort.current?.abort(); };
  }, [projectId, projectPath, documents, request, ready, workspace]);
  useEffect(() => {
    // The worker verifies its own source snapshot. Delayed watcher notifications
    // must not cancel a valid rebuild that already includes the observed edit.
    if (reportRef.current) { setStale(true); setDraft(false); }
  }, [revisionKey]);
  useEffect(() => {
    if (!automatic || !open || tutorial || !ready || agentBusy || busy || contextBusy || autoRevision.current === revisionKey) return;
    const timer = window.setTimeout(() => { autoRevision.current = revisionKey; void build(lastOperation.current, lastSimulationFiles.current); }, 1200);
    return () => window.clearTimeout(timer);
  }, [automatic, open, tutorial, ready, agentBusy, busy, contextBusy, revisionKey]);
  async function build(operation: 'build' | 'plan' = 'build', simulateFiles: string[] = []) {
    const current = ++generation.current;
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    lastOperation.current = operation; lastSimulationFiles.current = simulateFiles; autoRevision.current = revisionKey;
    setBusy(true); setError(''); setDraft(false); setReport(null); setChange(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/ontology/${operation}`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ ...(workspace ? { projectPath: '.' } : projectPath ? { projectPath } : {}), businessFiles: documents.split('\n').map(name => name.trim()).filter(Boolean), request,
          ...(operation === 'plan' && simulateFiles.length ? { simulateFiles } : {}) }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value?.error?.message ?? t('ontology.failed'));
      if (current === generation.current) {
        const nextReport = operation === 'plan' ? (value as CodeOntologyPlanResponse).ontology : value as CodeOntologyResponse;
        setReport(nextReport); setChange(operation === 'plan' ? value as CodeOntologyPlanResponse : null); setStale(false);
        if (!selected && sourceFile) {
          const prefix = nextReport.projectPath && nextReport.projectPath !== '.' ? `${nextReport.projectPath}/` : '';
          const source = nextReport.nodes.find(node => `${prefix}${node.evidence.path}` === sourceFile);
          if (source) setSelected(source.id);
        }
      }
    } catch (failure) { if (current === generation.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (current === generation.current) setBusy(false); }
  }
  const labels = new Map(report?.nodes.map(node => [node.id, node.kind === 'request' ? `${node.evidence.path} · ${node.label}` : node.label]));
  const related = report?.edges.filter(edge => !selected || edge.from === selected || edge.to === selected) ?? [];
  const selectable = report?.nodes.filter(node => node.kind !== 'external' && node.label.toLowerCase().includes(search.toLowerCase())) ?? [];
  const selectedNode = report?.nodes.find(node => node.id === selected);
  const selectedFile = selectedNode ? (report?.projectPath && report.projectPath !== '.' ? report.projectPath + '/' : '') + selectedNode.evidence.path : '';
  const canSimulate = !!selectedNode && report?.dependencyGraph.nodes.some(node => node.kind === 'code' && node.label === selectedNode.evidence.path);
  const documentCount = report?.businessContext?.documentCount ?? report?.coverage.businessDocuments ?? documents.split('\n').filter(name => name.trim()).length;
  const contextTitle = documentCount ? t('ontology.context.documentsTitle', { count: documentCount }) : t('ontology.context.codeOnlyTitle');
  const contextBody = documentCount ? t('ontology.context.documentsBody') : t('ontology.context.codeOnlyBody');
  return <section className={styles.panel} aria-label={t('ontology.title')}>
    <div className={styles.header}><Button aria-expanded={open} onClick={() => {
      if (!open && !tutorialSeen.current && shouldShowOntologyTutorial()) { tutorialSeen.current = true; setTutorial(true); }
      setOpen(value => !value);
    }}>{t('ontology.title')}</Button>
      {report ? <span className={styles.meta}>{t('ontology.counts', { nodes: report.nodes.length, edges: report.edges.length })}</span> : null}</div>
    {open ? <div className={styles.body}>
      <p className={styles.meta}>{t('ontology.workflow')}</p>
      <div className={styles.actions}><Button variant={report ? 'default' : 'primary'} disabled={busy || contextBusy || !ready || agentBusy} onClick={() => void build()}>{busy ? t('ontology.working') : t('ontology.build')}</Button>
        {busy ? <Button onClick={() => { generation.current++; abort.current?.abort(); setBusy(false); }}>{t('common.cancel')}</Button> : null}
        <Button variant="ghost" onClick={() => { tutorialSeen.current = true; setTutorial(true); }}>{t('ontology.tour.open')}</Button></div>
      <aside className={styles.context} aria-label={t('ontology.context.label')}><strong>{contextTitle}</strong>
        {documentCount ? <small>{t('ontology.context.unverified')}</small> : null}</aside>
      <details className={styles.disclosure}><summary>{t('ontology.options')}</summary><div className={styles.options}>
        <p>{t('ontology.description')}</p><p className={styles.meta}>{t('ontology.support')}</p>
        <label className={styles.scope}><input type="checkbox" checked={workspace} onChange={event => setWorkspace(event.target.checked)} />{t('ontology.workspace')}</label>
        <label>{t('ontology.documents')}<textarea rows={2} value={documents} onChange={event => setDocuments(event.target.value)} placeholder="docs/business.md" /></label>
        <label>{t('ontology.request')}<textarea rows={2} maxLength={2000} value={request} onChange={event => setRequest(event.target.value)} /></label>
        <label className={styles.scope}><input type="checkbox" checked={automatic} onChange={event => setAutomatic(event.target.checked)} />{t('ontology.autoRefresh')}</label>
        <Button disabled={busy || contextBusy || !ready || agentBusy} onClick={() => void build('plan')}>{t('ontology.plan')}</Button>
        <OntologyContextPanel projectId={projectId} projectPath={workspace ? '.' : projectPath} documents={documents} defaultQuestion={request}
          selectedNodeId={selected} revisionKey={revisionKey} ready={ready && !agentBusy && !busy && !tutorial} onRequestDraft={onRequestDraft} onBusyChange={setContextBusy} />
      </div></details>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {report ? <div className={styles.report}>
        <p role="status">{t('ontology.coverage', { parsed: report.coverage.parsedFiles, scanned: report.coverage.scannedFiles, unsupported: report.coverage.unsupportedFiles })}</p>
        {report.nodes.some(node=>node.kind==='business-rule')?<details className={styles.rules}><summary>{t('ontology.rules.pending',{count:report.nodes.filter(node=>node.kind==='business-rule').length})}</summary>
          <p>{t('ontology.rules.limit')}</p>
          {report.businessRuleConflicts?.length?<p className={styles.warning}>{t('ontology.rules.conflicts',{count:report.businessRuleConflicts.length})}</p>:null}
          <ul>{report.nodes.filter(node=>node.kind==='business-rule').slice(0,64).map(node=><li key={node.id}><strong>{node.label}</strong><small>{node.evidence.path}:{node.evidence.line}</small>
            {report.businessRuleConflicts?.some(c=>c.ruleIds.includes(node.id))?<span className={styles.warning}>{t('ontology.rules.conflictCandidate')}</span>:null}
            <Button onClick={()=>setSelected(node.id)}>{t('ontology.rules.focus')}</Button></li>)}</ul>
        </details>:null}
        {stale ? <p role="status" className={styles.warning}>{t('ontology.changed')}</p> : null}
        {report.coverage.truncated ? <p role="alert" className={styles.warning}>{t('ontology.partial')}</p> : null}
        <div className={styles.filters}><label>{t('common.search')}<input type="search" value={search} onChange={event => { setSearch(event.target.value); setSelected(''); }} /></label>
        <label>{t('ontology.inspect')}<select value={selected} onChange={event => setSelected(event.target.value)}>
          <option value="">{t('ontology.all')}</option>{selectable.slice(0, 1000).map(node => <option value={node.id} key={node.id}>{node.kind} · {node.label}</option>)}
        </select></label></div>
        {selectedNode ? <div className={styles.selection} role="group" aria-label={t('ontology.selectedSource')}>
          <strong>{selectedNode.label}</strong><code>{selectedFile}:{selectedNode.evidence.line}</code>
          <div className={styles.actions}>
            {canSimulate ? <Button variant="primary" disabled={stale || busy || contextBusy || !ready || agentBusy} onClick={() => void build('plan', [selectedFile])}>{t('ontology.simulate')}</Button> : null}
            {onOpenFile ? <Button variant="ghost" onClick={() => onOpenFile(selectedFile)}>{t('ontology.openSource')}</Button> : null}
          </div>
        </div> : null}
        {change ? <section className={styles.plan} aria-label={t('ontology.plan')}>
          <strong>{t(change.simulation ? 'ontology.simulationTitle' : 'ontology.observedTitle')}</strong>
          {change.simulation ? <p className={styles.meta}>{t('ontology.simulationHint')}</p> : null}
          <p role="status">{t('changePlan.summary', change.plan.summary)}</p>
          <h3>{t('ontology.documentReviews')}</h3>
          <ul className={styles.documents}>{change.documentReviews.slice(0, 100).map(item => <li key={`${item.documentFile}:${item.itemId}`}>
            <div className={styles.documentRow}><div><strong>{item.label || item.itemId}</strong><small>{item.documentFile} · {item.itemId}</small></div>
              <span>{t(`ontology.review.${item.state}`)}</span>
              {onOpenFile ? <Button variant="ghost" onClick={() => onOpenFile(item.documentFile)}>{t('ontology.openDocument')}</Button> : null}</div>
            {item.impactPath.length ? <details><summary>{t('ontology.impactPath')}</summary><small>{item.impactPath.join(' → ')}</small></details> : null}
          </li>)}</ul>
          <details><summary>{t('changePlan.title')}</summary>
            {change.simulation ? <p>{t('ontology.simulationScope', { files: change.simulation.sourceFiles.join(', ') })}</p> : null}
            <p className={styles.meta}>{t('ontology.planScope')}</p><ol>{change.plan.obligations.slice(0, 100).map(item => <li key={item.id}>
            {change.plan.graph.nodes.find(node => node.id === item.nodeId)?.label} · {t(`changePlan.state.${item.state}`)}
            <small>{item.checkId ?? (item.review ? t(`changePlan.review.${item.review}`) : item.requirement)}</small>
          </li>)}</ol></details>
          {change.plan.warnings.length ? <details><summary>{t('docs.graph.warnings')}</summary><ul>{change.plan.warnings.slice(0, 100).map(warning => <li key={warning}>{warning}</li>)}</ul></details> : null}
        </section> : null}
        {selectable.length > 1000 ? <p className={styles.meta}>1000 / {selectable.length}</p> : null}
        <details className={styles.disclosure}><summary>{t('ontology.relationships', { count: related.length })}</summary><ol className={styles.relations}>{related.slice(0, 150).map(edge => <li key={edge.id} data-basis={edge.basis}>
          <strong>{labels.get(edge.from)} → {labels.get(edge.to)}</strong>
          <span>{t(`ontology.relation.${edge.relation}`)} · {edge.basis === 'candidate' ? t('ontology.candidate') : t('ontology.syntax')}</span>
          <details><summary>{t('ontology.evidence')}</summary><code>{edge.evidence.path}:{edge.evidence.line}</code><small>SHA-256 {edge.evidence.sha256}</small></details>
        </li>)}</ol>
        {related.length > 150 ? <p className={styles.meta}>150 / {related.length}</p> : null}</details>
        {report.issues.length ? <details className={styles.disclosure}><summary>{t('ontology.issues', { count: report.issues.length })}</summary><ul>{report.issues.slice(0, 150).map((issue, index) => <li key={index}><code>{issue.path}</code> · {t(`ontology.issue.${issue.reason}`)}<small>{issue.message}</small></li>)}</ul></details> : null}
        <details className={styles.disclosure}><summary>{t('ontology.analysisDetails')}</summary><div className={styles.options}>
          <p>{contextBody}</p>
          <small>{t('ontology.context.counts', { documents: documentCount, concepts: report.businessContext?.conceptCount ?? report.nodes.filter(node => node.kind === 'concept').length,
            associations: report.businessContext?.associationCount ?? report.edges.filter(edge => edge.relation === 'associated-with').length })} · {t('ontology.context.unverified')}</small>
          <p className={styles.meta}>{t('ontology.elapsed', { ms: report.elapsedMs })} · {report.cacheHit ? t('ontology.cached') : t('ontology.fresh')} · {report.coverage.languages.map(item => `${item.id}: ${item.files}`).join(' · ')}</p>
          <p>{t('ontology.candidates')}</p>
          <p className={styles.meta}>{t('ontology.incremental', { reused: report.coverage.reusedParsedFiles ?? (report.cacheHit ? report.coverage.parsedFiles : 0), parsed: report.coverage.parsedNowFiles ?? (report.cacheHit ? 0 : report.coverage.parsedFiles) })}</p>
        </div></details>
        <div className={styles.actions}><Button disabled={stale} onClick={() => { setDraft(true); onRequestDraft?.(change?.plan.handoff ?? report.handoff); }}>{t('ontology.draft')}</Button>
          <Button variant="ghost" onClick={() => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(change ?? report, null, 2)], { type: 'application/json' }));
            const link = document.createElement('a'); link.href = url; link.download = 'monofield-code-ontology.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
          }}>{t('ontology.export')}</Button></div>
        {draft ? <textarea readOnly rows={6} value={change?.plan.handoff ?? report.handoff} aria-label={t('ontology.draft')} /> : null}
      </div> : null}
    </div> : null}
    {tutorial ? <OntologyTutorial hasDocuments={documentCount > 0} onClose={() => setTutorial(false)} /> : null}
  </section>;
}
