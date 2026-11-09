'use client';

import { useState } from 'react';
import { Button } from '@open-design/components';
import type { ReferenceFlowSummary, ReferenceItem } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import { referencesApi } from './api';
import { FLOW_STATUS_KEY, FlowStepsEditor, stepFromRow, useStepLabel, type FlowStepRow } from './FlowStepsEditor';
import styles from './ReferenceFlowPanel.module.css';

/** The flow recorded for a card, as the card and the panel show it. */
export function ReferenceFlowResult({ flow, onOpenFile }: { flow: ReferenceFlowSummary; onOpenFile?: (name: string) => void }) {
  const { t } = useI18n();
  const stepLabel = useStepLabel();
  return <div className={styles.result} data-testid="reference-flow-result">
    <strong>{t('references.flow.result', { completed: flow.completed, total: flow.total, count: flow.apiCalls.length })}</strong>
    <ol className={styles.steps}>{flow.steps.map((step) => <li key={step.id} data-status={step.status}>
      {stepLabel(step)} · {FLOW_STATUS_KEY[step.status] ? t(FLOW_STATUS_KEY[step.status]!) : step.status}{step.error ? <span className={styles.stepError}> — {step.error}</span> : null}
    </li>)}</ol>
    {flow.apiCalls.length ? <ul className={styles.calls}>{flow.apiCalls.map((call) => <li key={`${call.method} ${call.path} ${call.status}`}>
      <code>{call.method} {call.path}</code> → {call.status ?? '—'}
    </li>)}</ul> : null}
    {onOpenFile ? <Button variant="ghost" onClick={() => onOpenFile(flow.file)}>{t('references.flow.openStudio')}</Button> : null}
  </div>;
}

/** The browser path box shared by the flow and compare panels. */
export function BrowserPathField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useI18n();
  return <details className={styles.advanced}>
    <summary>{t('references.flow.browser')}</summary>
    <input value={value} placeholder={t('references.flow.browserPlaceholder')} aria-label={t('references.flow.browser')} onChange={(event) => onChange(event.target.value)} />
  </details>;
}

/**
 * "Record the flow with REA" for one kept reference: the person lists the steps in plain terms, MonoField runs its own
 * REA copy on the reference's URL, and the card keeps each step's outcome and the API calls. Flows the steps cannot
 * express go to the agent as a request instead.
 */
export function ReferenceFlowPanel({ projectId, item, onClose, onRecorded, onAppendToChat, onOpenFile }: {
  projectId: string;
  item: ReferenceItem;
  onClose: () => void;
  onRecorded: (item: ReferenceItem) => void;
  onAppendToChat?: (text: string, introIfEmpty?: string) => void;
  onOpenFile?: (name: string) => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<FlowStepRow[]>([]);
  const [browserPath, setBrowserPath] = useState('');
  const [phase, setPhase] = useState<'edit' | 'running'>('edit');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [flow, setFlow] = useState<ReferenceFlowSummary | null>(null);
  const steps = rows.map(stepFromRow);

  async function record() {
    setPhase('running'); setError(''); setStatus(''); setFlow(null);
    const result = await referencesApi.recordFlow(projectId, item.id, { steps, ...(browserPath.trim() ? { browserPath: browserPath.trim() } : {}) });
    setPhase('edit');
    if (!result.ok) { setError(result.message); return; }
    setFlow(result.value.flow);
    onRecorded(result.value.item);
  }

  async function askAgent() {
    if (!onAppendToChat) return;
    setError('');
    const result = await referencesApi.flowRequest(projectId, item.id, { steps });
    if (!result.ok) { setError(result.message); return; }
    onAppendToChat(result.value.text, t('references.flow.agentIntro'));
    setStatus(t('references.flow.askAgentDone'));
  }

  return <div className={styles.root} data-testid="reference-flow-panel">
    <strong>{t('references.flow.title')} — {item.title}</strong>
    <p className={styles.hint}>{t('references.flow.intro')}</p>
    <FlowStepsEditor rows={rows} onChange={setRows} disabled={phase === 'running'} />
    <BrowserPathField value={browserPath} onChange={setBrowserPath} />
    <p className={styles.hint}>{t('references.flow.safety')}</p>
    {phase === 'running' ? <p className={styles.running} role="status">{t('references.flow.running')}</p> : null}
    {status ? <p className={styles.status} role="status">{status}</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {flow ? <ReferenceFlowResult flow={flow} {...(onOpenFile ? { onOpenFile } : {})} /> : null}
    <div className={styles.actions}>
      <Button variant="ghost" onClick={onClose} disabled={phase === 'running'}>{t('common.close')}</Button>
      {onAppendToChat ? <Button variant="ghost" onClick={() => void askAgent()} disabled={phase === 'running'} data-testid="reference-flow-agent">{t('references.flow.askAgent')}</Button> : null}
      <Button onClick={() => void record()} disabled={phase === 'running'} data-testid="reference-flow-start">{t('references.flow.start')}</Button>
    </div>
  </div>;
}
