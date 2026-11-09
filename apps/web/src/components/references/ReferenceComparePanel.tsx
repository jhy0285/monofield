'use client';

import { useState } from 'react';
import { Button } from '@open-design/components';
import { referenceComparisonBlock, type ReferenceCompareDifference, type ReferenceCompareRow, type ReferenceCompareSide, type ReferenceItem, type ReferenceRemake } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import { referencesApi } from './api';
import { FLOW_STATUS_KEY, FlowStepsEditor, rowsFromSteps, stepFromRow, useStepLabel, type FlowStepRow } from './FlowStepsEditor';
import { BrowserPathField } from './ReferenceFlowPanel';
import styles from './ReferenceComparePanel.module.css';
import flowStyles from './ReferenceFlowPanel.module.css';

const VERDICT_KEY = {
  pass: 'references.compare.verdict.pass', fail: 'references.compare.verdict.fail',
  missing: 'references.compare.verdict.missing', extra: 'references.compare.verdict.extra',
} as const satisfies Record<ReferenceCompareRow['verdict'], string>;
const DIFF_KEY = {
  action: 'references.compare.diff.action', status: 'references.compare.diff.status', navigation: 'references.compare.diff.navigation',
  calls: 'references.compare.diff.calls', structure: 'references.compare.diff.structure',
} as const satisfies Record<ReferenceCompareDifference, string>;

/** The comparison of our screen with the reference, step by step; also shown on a card after a reload. */
export function ReferenceComparisonResult({ item, remake, onAppendToChat, onOpenFile }: {
  item: ReferenceItem;
  remake: ReferenceRemake;
  onAppendToChat?: (text: string, introIfEmpty?: string) => void;
  onOpenFile?: (name: string) => void;
}) {
  const { t } = useI18n();
  const stepLabel = useStepLabel();
  const [status, setStatus] = useState('');
  const { summary } = remake.comparison;
  // Steps are described from the step that was asked for, in the screen's language.
  const requests = new Map([...(item.flow?.steps ?? []), ...remake.flow.steps].map((step) => [step.id, step.request]));
  const label = (row: ReferenceCompareRow) => row.id === 'scenario_start' || row.id === 'page-settled'
    ? t('references.compare.openPage') : stepLabel({ label: row.label, request: requests.get(row.id) });
  const block = referenceComparisonBlock({ ...item, remake });
  const side = (value: ReferenceCompareSide | null) => value
    ? [FLOW_STATUS_KEY[value.status] ? t(FLOW_STATUS_KEY[value.status]!) : value.status, value.navigated ? t('references.compare.moved') : '',
      value.calls.length ? value.calls.join(' + ') : t('references.compare.noCalls')].filter(Boolean).join(' · ')
    : '—';
  return <div className={styles.result} data-testid="reference-compare-result">
    <strong>{t('references.compare.result', { pass: summary.pass, total: summary.total })}</strong>
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th>{t('references.compare.step')}</th><th>{t('references.compare.reference')}</th><th>{t('references.compare.ours')}</th><th>{t('references.compare.verdict')}</th></tr></thead>
        <tbody>{remake.comparison.rows.map((row) => <tr key={`${row.position}-${row.id}`} data-verdict={row.verdict}>
          <td>{row.position + 1}. {label(row)}</td>
          <td>{side(row.reference)}{row.onlyReference.length ? <div className={styles.roles}>{t('references.compare.onlyReference', { roles: row.onlyReference.join(', ') })}</div> : null}</td>
          <td>{side(row.ours)}{row.onlyOurs.length ? <div className={styles.roles}>{t('references.compare.onlyOurs', { roles: row.onlyOurs.join(', ') })}</div> : null}</td>
          <td><span className={styles.verdict} data-verdict={row.verdict}>{t(VERDICT_KEY[row.verdict])}</span>
            {row.differences.length ? <div className={styles.roles}>{row.differences.map((difference) => t(DIFF_KEY[difference])).join(', ')}</div> : null}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {block ? null : <p className={flowStyles.status}>{t('references.compare.allMatch')}</p>}
    {status ? <p className={flowStyles.status} role="status">{status}</p> : null}
    <div className={styles.buttons}>
      {block && onAppendToChat ? <Button onClick={() => { onAppendToChat(block, t('references.compare.chatIntro')); setStatus(t('references.compare.toChatDone')); }}
        data-testid="reference-compare-to-chat">{t('references.compare.toChat')}</Button> : null}
      {onOpenFile ? <Button variant="ghost" onClick={() => onOpenFile(remake.flow.file)}>{t('references.compare.openOurs')}</Button> : null}
    </div>
  </div>;
}

/**
 * "Compare with our screen": the reference's recorded steps are replayed on the project's own screen (usually the app
 * running locally) and the two recordings are compared as patterns, not text: whether each step can be done, whether it
 * moves to another page, the kind of server calls and the kinds of elements on screen.
 */
export function ReferenceComparePanel({ projectId, item, onClose, onCompared, onAppendToChat, onOpenFile }: {
  projectId: string;
  item: ReferenceItem;
  onClose: () => void;
  onCompared: (item: ReferenceItem) => void;
  onAppendToChat?: (text: string, introIfEmpty?: string) => void;
  onOpenFile?: (name: string) => void;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState(item.remake?.url ?? '');
  const [rows, setRows] = useState<FlowStepRow[]>(() => rowsFromSteps((item.flow?.steps ?? []).flatMap((step) => (step.request ? [step.request] : []))));
  const [browserPath, setBrowserPath] = useState('');
  const [phase, setPhase] = useState<'edit' | 'running'>('edit');
  const [error, setError] = useState('');
  const [current, setCurrent] = useState<{ item: ReferenceItem; remake: ReferenceRemake } | null>(null);

  async function compare() {
    setPhase('running'); setError(''); setCurrent(null);
    const result = await referencesApi.compare(projectId, item.id, { url: url.trim(), steps: rows.map(stepFromRow),
      ...(browserPath.trim() ? { browserPath: browserPath.trim() } : {}) });
    setPhase('edit');
    if (!result.ok) { setError(result.message); return; }
    setCurrent({ item: result.value.item, remake: result.value.remake });
    onCompared(result.value.item);
  }

  return <div className={flowStyles.root} data-testid="reference-compare-panel">
    <strong>{t('references.compare.title')} — {item.title}</strong>
    <p className={flowStyles.hint}>{t('references.compare.intro')}</p>
    <label className={styles.field}>{t('references.compare.url')}
      <input value={url} placeholder={t('references.compare.urlPlaceholder')} onChange={(event) => setUrl(event.target.value)} data-testid="reference-compare-url" />
    </label>
    <p className={flowStyles.hint}>{t('references.compare.stepsHint')}</p>
    <FlowStepsEditor rows={rows} onChange={setRows} disabled={phase === 'running'} />
    <BrowserPathField value={browserPath} onChange={setBrowserPath} />
    {phase === 'running' ? <p className={flowStyles.running} role="status">{t('references.compare.running')}</p> : null}
    {error ? <p className={flowStyles.error} role="alert">{error}</p> : null}
    {current ? <ReferenceComparisonResult item={current.item} remake={current.remake} {...(onAppendToChat ? { onAppendToChat } : {})} {...(onOpenFile ? { onOpenFile } : {})} /> : null}
    <div className={flowStyles.actions}>
      <Button variant="ghost" onClick={onClose} disabled={phase === 'running'}>{t('common.close')}</Button>
      <Button onClick={() => void compare()} disabled={phase === 'running' || !url.trim()} data-testid="reference-compare-start">{t('references.compare.start')}</Button>
    </div>
  </div>;
}
