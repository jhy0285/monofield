'use client';

import { useState } from 'react';
import { Button } from '@open-design/components';
import type { ReferenceFlowStep, ReferenceFlowSummary, ReferenceItem } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import { referencesApi } from './api';
import styles from './ReferenceFlowPanel.module.css';

type Kind = 'button' | 'link' | 'tab' | 'fill' | 'wait-text' | 'wait';
interface Row { key: number; kind: Kind; target: string; value: string; ms: string }

const KIND_KEY = {
  button: 'references.flow.kind.button', link: 'references.flow.kind.link', tab: 'references.flow.kind.tab',
  fill: 'references.flow.kind.fill', 'wait-text': 'references.flow.kind.waitText', wait: 'references.flow.kind.wait',
} as const satisfies Record<Kind, string>;
const STATUS_KEY: Record<string, 'references.flow.status.completed' | 'references.flow.status.failed' | 'references.flow.status.cancelled'> = {
  completed: 'references.flow.status.completed', failed: 'references.flow.status.failed', cancelled: 'references.flow.status.cancelled',
};

function toStep(row: Row): ReferenceFlowStep {
  if (row.kind === 'wait') return { kind: 'wait', ms: Number(row.ms) || 1000 };
  if (row.kind === 'fill') return { kind: 'fill', target: row.target, value: row.value };
  if (row.kind === 'wait-text') return { kind: 'wait-text', target: row.target };
  return { kind: 'click', target: row.target, role: row.kind };
}

/** Describes a recorded step in the screen's language when the step that was asked for is known. */
function useStepLabel() {
  const { t } = useI18n();
  return (step: ReferenceFlowSummary['steps'][number]) => {
    const request = step.request;
    if (!request) return step.label;
    if (request.kind === 'wait') return `${t('references.flow.kind.wait')} (${request.ms} ms)`;
    const kind: Kind = request.kind === 'click' ? (request.role === 'link' || request.role === 'tab' ? request.role : 'button') : request.kind;
    return `${t(KIND_KEY[kind])} "${request.target}"`;
  };
}

/** The flow recorded for a card, as the card and the panel show it. */
export function ReferenceFlowResult({ flow, onOpenFile }: { flow: ReferenceFlowSummary; onOpenFile?: (name: string) => void }) {
  const { t } = useI18n();
  const stepLabel = useStepLabel();
  return <div className={styles.result} data-testid="reference-flow-result">
    <strong>{t('references.flow.result', { completed: flow.completed, total: flow.total, count: flow.apiCalls.length })}</strong>
    <ol className={styles.steps}>{flow.steps.map((step) => <li key={step.id} data-status={step.status}>
      {stepLabel(step)} · {STATUS_KEY[step.status] ? t(STATUS_KEY[step.status]!) : step.status}{step.error ? <span className={styles.stepError}> — {step.error}</span> : null}
    </li>)}</ol>
    {flow.apiCalls.length ? <ul className={styles.calls}>{flow.apiCalls.map((call) => <li key={`${call.method} ${call.path} ${call.status}`}>
      <code>{call.method} {call.path}</code> → {call.status ?? '—'}
    </li>)}</ul> : null}
    {onOpenFile ? <Button variant="ghost" onClick={() => onOpenFile(flow.file)}>{t('references.flow.openStudio')}</Button> : null}
  </div>;
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
  const [rows, setRows] = useState<Row[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [browserPath, setBrowserPath] = useState('');
  const [phase, setPhase] = useState<'edit' | 'running'>('edit');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [flow, setFlow] = useState<ReferenceFlowSummary | null>(null);

  const update = (key: number, patch: Partial<Row>) => setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  const steps = rows.map(toStep);

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
    {rows.length ? <ol className={styles.rows}>{rows.map((row) => <li key={row.key} className={styles.row}>
      <select value={row.kind} aria-label={t('references.flow.kindLabel')} onChange={(event) => update(row.key, { kind: event.target.value as Kind })}>
        {(Object.keys(KIND_KEY) as Kind[]).map((kind) => <option key={kind} value={kind}>{t(KIND_KEY[kind])}</option>)}
      </select>
      {row.kind === 'wait'
        ? <input type="number" min={100} max={10000} step={100} value={row.ms} aria-label={t('references.flow.ms')} onChange={(event) => update(row.key, { ms: event.target.value })} />
        : <input value={row.target} maxLength={120} aria-label={t('references.flow.targetLabel')}
            placeholder={t(row.kind === 'fill' ? 'references.flow.placeholder.fill' : row.kind === 'wait-text' ? 'references.flow.placeholder.waitText' : 'references.flow.placeholder.click')}
            onChange={(event) => update(row.key, { target: event.target.value })} />}
      {row.kind === 'fill' ? <input value={row.value} maxLength={500} aria-label={t('references.flow.valueLabel')} placeholder={t('references.flow.placeholder.value')}
        onChange={(event) => update(row.key, { value: event.target.value })} /> : null}
      <Button variant="ghost" onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}>{t('references.flow.removeStep')}</Button>
    </li>)}</ol> : null}
    <span>
      <Button variant="ghost" disabled={rows.length >= 12 || phase === 'running'} data-testid="reference-flow-add"
        onClick={() => { setRows((current) => [...current, { key: nextKey, kind: 'button', target: '', value: '', ms: '1000' }]); setNextKey((key) => key + 1); }}>
        {t('references.flow.addStep')}
      </Button>
    </span>
    <details className={styles.advanced}>
      <summary>{t('references.flow.browser')}</summary>
      <input value={browserPath} placeholder={t('references.flow.browserPlaceholder')} aria-label={t('references.flow.browser')} onChange={(event) => setBrowserPath(event.target.value)} />
    </details>
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
