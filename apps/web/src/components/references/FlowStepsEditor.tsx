'use client';

import { Button } from '@open-design/components';
import type { ReferenceFlowStep, ReferenceFlowSummary } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import styles from './ReferenceFlowPanel.module.css';

export type FlowStepKind = 'button' | 'link' | 'tab' | 'fill' | 'wait-text' | 'wait';
export interface FlowStepRow { key: number; kind: FlowStepKind; target: string; value: string; ms: string }

export const FLOW_KIND_KEY = {
  button: 'references.flow.kind.button', link: 'references.flow.kind.link', tab: 'references.flow.kind.tab',
  fill: 'references.flow.kind.fill', 'wait-text': 'references.flow.kind.waitText', wait: 'references.flow.kind.wait',
} as const satisfies Record<FlowStepKind, string>;

export const FLOW_STATUS_KEY: Record<string, 'references.flow.status.completed' | 'references.flow.status.failed' | 'references.flow.status.cancelled'> = {
  completed: 'references.flow.status.completed', failed: 'references.flow.status.failed', cancelled: 'references.flow.status.cancelled',
};

export function stepFromRow(row: FlowStepRow): ReferenceFlowStep {
  if (row.kind === 'wait') return { kind: 'wait', ms: Number(row.ms) || 1000 };
  if (row.kind === 'fill') return { kind: 'fill', target: row.target, value: row.value };
  if (row.kind === 'wait-text') return { kind: 'wait-text', target: row.target };
  return { kind: 'click', target: row.target, role: row.kind };
}

export function rowsFromSteps(steps: ReferenceFlowStep[]): FlowStepRow[] {
  return steps.map((step, index) => {
    const key = index + 1;
    if (step.kind === 'wait') return { key, kind: 'wait', target: '', value: '', ms: String(step.ms) };
    if (step.kind === 'fill') return { key, kind: 'fill', target: step.target, value: step.value, ms: '1000' };
    if (step.kind === 'wait-text') return { key, kind: 'wait-text', target: step.target, value: '', ms: '1000' };
    const kind: FlowStepKind = step.role === 'link' || step.role === 'tab' ? step.role : 'button';
    return { key, kind, target: step.target, value: '', ms: '1000' };
  });
}

/** Describes a recorded step in the screen's language when the step that was asked for is known. */
export function useStepLabel() {
  const { t } = useI18n();
  return (step: Pick<ReferenceFlowSummary['steps'][number], 'label' | 'request'>) => {
    const request = step.request;
    if (!request) return step.label;
    if (request.kind === 'wait') return `${t('references.flow.kind.wait')} (${request.ms} ms)`;
    const kind: FlowStepKind = request.kind === 'click' ? (request.role === 'link' || request.role === 'tab' ? request.role : 'button') : request.kind;
    return `${t(FLOW_KIND_KEY[kind])} "${request.target}"`;
  };
}

/** The plain-step editor shared by "record the flow" and "compare with our screen". */
export function FlowStepsEditor({ rows, onChange, disabled }: { rows: FlowStepRow[]; onChange: (rows: FlowStepRow[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const update = (key: number, patch: Partial<FlowStepRow>) => onChange(rows.map((row) => row.key === key ? { ...row, ...patch } : row));
  const nextKey = rows.reduce((max, row) => Math.max(max, row.key), 0) + 1;
  return <>
    {rows.length ? <ol className={styles.rows}>{rows.map((row) => <li key={row.key} className={styles.row}>
      <select value={row.kind} aria-label={t('references.flow.kindLabel')} onChange={(event) => update(row.key, { kind: event.target.value as FlowStepKind })}>
        {(Object.keys(FLOW_KIND_KEY) as FlowStepKind[]).map((kind) => <option key={kind} value={kind}>{t(FLOW_KIND_KEY[kind])}</option>)}
      </select>
      {row.kind === 'wait'
        ? <input type="number" min={100} max={10000} step={100} value={row.ms} aria-label={t('references.flow.ms')} onChange={(event) => update(row.key, { ms: event.target.value })} />
        : <input value={row.target} maxLength={120} aria-label={t('references.flow.targetLabel')}
            placeholder={t(row.kind === 'fill' ? 'references.flow.placeholder.fill' : row.kind === 'wait-text' ? 'references.flow.placeholder.waitText' : 'references.flow.placeholder.click')}
            onChange={(event) => update(row.key, { target: event.target.value })} />}
      {row.kind === 'fill' ? <input value={row.value} maxLength={500} aria-label={t('references.flow.valueLabel')} placeholder={t('references.flow.placeholder.value')}
        onChange={(event) => update(row.key, { value: event.target.value })} /> : null}
      <Button variant="ghost" onClick={() => onChange(rows.filter((item) => item.key !== row.key))}>{t('references.flow.removeStep')}</Button>
    </li>)}</ol> : null}
    <span>
      <Button variant="ghost" disabled={rows.length >= 12 || disabled} data-testid="reference-flow-add"
        onClick={() => onChange([...rows, { key: nextKey, kind: 'button', target: '', value: '', ms: '1000' }])}>
        {t('references.flow.addStep')}
      </Button>
    </span>
  </>;
}
