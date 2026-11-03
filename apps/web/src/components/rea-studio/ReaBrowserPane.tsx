'use client';

import { Fragment, useMemo, useState } from 'react';
import type { ReaBrowserRequest, ReaBrowserStep, ReaBrowserView, ReaPayload } from '@open-design/contracts';
import { REA_TEXT_LIMIT } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import { CiteButton } from './cite';
import styles from './ReaStudio.module.css';

const statusClass = (status: number | null, failed: boolean) => (failed || status === null ? 'fail' : status >= 500 ? 'fail' : status >= 400 ? 'warn' : status >= 300 ? 'info' : 'ok');
const bytesLabel = (bytes: number | null) => (bytes === null ? '' : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`);

function PayloadView({ payload }: { payload: ReaPayload }) {
  const { t } = useI18n();
  const reason = payload.state === 'integrity-failed' ? t('reaStudio.integrityFailed')
    : payload.state === 'not_requested' || payload.state === 'not_exposed' ? t('reaStudio.notCaptured')
      : payload.state === 'unavailable' || payload.state === 'omitted' ? `${t('reaStudio.notCaptured')}${payload.reason ? ` (${payload.reason})` : ''}`
        : payload.state === 'missing' ? t('reaStudio.notCaptured') : '';
  return <div className={styles.payload} data-state={payload.state}>
    <div className={styles.payloadMeta}>
      {payload.mediaType ? <span>{payload.mediaType}</span> : null}
      {payload.bytes !== null ? <span>{bytesLabel(payload.bytes)}</span> : null}
      {payload.sha256 ? <span title={payload.sha256}>sha256 {payload.sha256.slice(0, 8)}…</span> : null}
      {payload.redacted ? <span className={styles.tag}>{t('reaStudio.redacted')}</span> : null}
    </div>
    {reason ? <p className={payload.state === 'integrity-failed' ? styles.alert : styles.muted} role={payload.state === 'integrity-failed' ? 'alert' : undefined}>{reason}</p> : null}
    {payload.dataUrl ? <img className={styles.shot} src={payload.dataUrl} alt={t('reaStudio.screenshot')} /> : null}
    {payload.state === 'captured' && payload.text !== undefined ? <pre className={styles.code}><code>{payload.text}</code></pre> : null}
    {payload.truncated ? <p className={styles.muted}>{t('reaStudio.truncated', { limit: REA_TEXT_LIMIT })}</p> : null}
  </div>;
}

function StepArtifacts({ step }: { step: ReaBrowserStep }) {
  const { t } = useI18n();
  const available = (['screenshot', 'dom', 'accessibility'] as const).filter((key) => step[key] !== undefined);
  const [tab, setTab] = useState<(typeof available)[number] | undefined>(available[0]);
  const active = tab && available.includes(tab) ? tab : available[0];
  if (!active) return <p className={styles.muted}>{t('reaStudio.noArtifacts')}</p>;
  const labels = { screenshot: t('reaStudio.screenshot'), dom: 'DOM', accessibility: t('reaStudio.accessibility') } as const;
  return <div>
    <div className={styles.tabs} role="tablist" aria-label={t('reaStudio.artifacts')}>
      {available.map((key) => <button key={key} type="button" role="tab" aria-selected={key === active} data-active={key === active} onClick={() => setTab(key)}>{labels[key]}</button>)}
    </div>
    <PayloadView payload={step[active]!} />
  </div>;
}

function RequestDetail({ request }: { request: ReaBrowserRequest }) {
  const { t } = useI18n();
  // The response is the interesting side whenever it holds anything to look at, a failed hash check included.
  const [side, setSide] = useState<'request' | 'response'>(['captured', 'captured-binary', 'integrity-failed'].includes(request.response.state) ? 'response' : 'request');
  return <div className={styles.detail}>
    <div className={styles.tabs} role="tablist">
      {(['request', 'response'] as const).map((key) => <button key={key} type="button" role="tab" aria-selected={side === key} data-active={side === key} onClick={() => setSide(key)}>
        {t(key === 'request' ? 'reaStudio.request' : 'reaStudio.response')}
      </button>)}
    </div>
    <div className={styles.itemBar}><CiteButton target={{ kind: 'request', id: request.id }} /></div>
    {request.queryNames.length ? <p className={styles.muted}>?{request.queryNames.join('&')}</p> : null}
    {request.failure ? <p className={styles.alert} role="alert">{t('reaStudio.requestFailed')}: {request.failure}</p> : null}
    <PayloadView payload={request[side]} />
  </div>;
}

/** A browser capture: the scenario's steps (with what each captured), and every request it made. */
export function ReaBrowserPane({ view }: { view: ReaBrowserView }) {
  const { t } = useI18n();
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const [apiOnly, setApiOnly] = useState(view.requests.some((request) => request.isApi));
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const step = stepIndex === null ? undefined : view.steps.find((item) => item.index === stepIndex);
  const longest = Math.max(1, ...view.steps.map((item) => item.elapsedMs ?? 0));
  const apiCount = view.requests.filter((request) => request.isApi).length;
  const completed = view.steps.filter((item) => item.status === 'completed').length;
  const rows = useMemo(() => view.requests.filter((request) => (!apiOnly || request.isApi)
    && (stepIndex === null || request.stepIndex === stepIndex)
    && (!query || request.path.toLowerCase().includes(query.toLowerCase()))), [view.requests, apiOnly, stepIndex, query]);

  return <div data-testid="rea-browser">
    <div className={styles.tiles}>
      <div className={styles.tile}><b>{completed}/{view.steps.length}</b><span>{t('reaStudio.steps')}</span></div>
      <div className={styles.tile}><b>{apiCount}</b><span>{t('reaStudio.apiCalls')}</span></div>
      <div className={styles.tile}><b>{view.requests.length}</b><span>{t('reaStudio.requests')}</span></div>
      <div className={styles.tile}><b>{view.durationMs === null ? '—' : `${view.durationMs} ms`}</b><span>{t('reaStudio.duration')}</span></div>
      <div className={styles.tile} data-tone={view.completeness.status === 'complete' ? 'ok' : 'warn'}><b>{view.completeness.status}</b><span>{t('reaStudio.completeness')}</span></div>
    </div>
    {view.completeness.missingSections.length ? <p className={styles.muted}>{t('reaStudio.missing')}: {view.completeness.missingSections.join(', ')}</p> : null}

    <h4 className={styles.sectionTitle}>{t('reaStudio.timeline')}</h4>
    <div className={styles.timeline} role="group" aria-label={t('reaStudio.timeline')}>
      <button type="button" className={styles.stepAll} data-active={stepIndex === null} aria-pressed={stepIndex === null} onClick={() => setStepIndex(null)}>{t('reaStudio.allSteps')}</button>
      {view.steps.map((item) => <button key={item.index} type="button" aria-pressed={stepIndex === item.index} className={styles.step} data-active={stepIndex === item.index}
        data-status={item.status} onClick={() => setStepIndex(item.index === stepIndex ? null : item.index)} title={item.url ?? undefined}>
        <span className={styles.stepName}>{item.id || item.action}</span>
        <span className={styles.stepBar}><i style={{ width: `${Math.max(6, ((item.elapsedMs ?? 0) / longest) * 100)}%` }} /></span>
        <span className={styles.stepMeta}>{item.action} · {item.elapsedMs ?? '—'} ms</span>
      </button>)}
    </div>
    {step ? <section className={styles.panel} aria-label={step.id}>
      <div className={styles.itemBar}>
        <h4 className={styles.sectionTitle}>{step.id} <span className={styles.muted}>{step.action} · {step.status}</span></h4>
        <CiteButton target={{ kind: 'step', index: step.index }} />
      </div>
      {step.error ? <p className={styles.alert} role="alert">{step.error}</p> : null}
      {step.url ? <p className={styles.muted}>{step.url}</p> : null}
      <StepArtifacts key={step.index} step={step} />
    </section> : null}

    <h4 className={styles.sectionTitle}>{t('reaStudio.requests')}</h4>
    <div className={styles.filters}>
      <label className={styles.check}><input type="checkbox" checked={apiOnly} onChange={(event) => setApiOnly(event.target.checked)} />{t('reaStudio.apiOnly')}</label>
      <input className={styles.search} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('reaStudio.filterPath')} aria-label={t('reaStudio.filterPath')} />
    </div>
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th>{t('reaStudio.method')}</th><th>{t('reaStudio.path')}</th><th>{t('reaStudio.status')}</th><th>{t('reaStudio.type')}</th><th>{t('reaStudio.size')}</th></tr></thead>
        <tbody>{rows.map((request) => <Fragment key={request.id}>
          <tr data-open={open === request.id} data-testid="rea-request-row" onClick={() => setOpen(open === request.id ? null : request.id)}>
            <td><code>{request.method}</code></td>
            <td className={styles.pathCell}><button type="button" className={styles.rowButton} aria-expanded={open === request.id}>{request.path}</button></td>
            <td><span className={styles.badge} data-tone={statusClass(request.status, Boolean(request.failure))}>{request.status ?? '—'}</span></td>
            <td>{request.resourceType}</td>
            <td>{bytesLabel(request.response.bytes)}{request.request.state === 'integrity-failed' || request.response.state === 'integrity-failed' ? <span className={styles.badge} data-tone="fail">!</span> : null}</td>
          </tr>
          {open === request.id ? <tr><td colSpan={5}><RequestDetail request={request} /></td></tr> : null}
        </Fragment>)}</tbody>
      </table>
      {rows.length === 0 ? <p className={styles.muted}>{t('reaStudio.noRequests')}</p> : null}
    </div>
  </div>;
}
