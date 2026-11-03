'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Button, Input, Select } from '@open-design/components';
import type { ReaBrowserView, ReaCaseComparison, ReaCompareStepRow, ReaCompareVerdict, ReaComparison, ReaEvidenceListResponse, ReaEvidenceView } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import { postJson } from './cite';
import styles from './ReaStudio.module.css';

const VERDICT_KEY = {
  pass: 'reaStudio.compare.pass', fail: 'reaStudio.compare.fail', missing: 'reaStudio.compare.missing', extra: 'reaStudio.compare.extra',
} as const satisfies Record<ReaCompareVerdict, string>;
const VERDICT_TONE: Readonly<Record<ReaCompareVerdict, string>> = { pass: 'ok', fail: 'fail', missing: 'warn', extra: 'warn' };
const DIFF_KEY = {
  action: 'reaStudio.compare.diff.action', status: 'reaStudio.compare.diff.status', url: 'reaStudio.compare.diff.url',
  calls: 'reaStudio.compare.diff.calls', text: 'reaStudio.compare.diff.text',
} as const;

function Verdict({ verdict }: { verdict: ReaCompareVerdict }) {
  const { t } = useI18n();
  return <span className={styles.badge} data-tone={VERDICT_TONE[verdict]} data-verdict={verdict}>{t(VERDICT_KEY[verdict])}</span>;
}

function Shot({ view, index }: { view: ReaBrowserView | null; index: number | undefined }) {
  const { t } = useI18n();
  const shot = index === undefined ? undefined : view?.steps.find((step) => step.index === index)?.screenshot;
  return shot?.dataUrl ? <img className={styles.shot} src={shot.dataUrl} alt={t('reaStudio.screenshot')} /> : <p className={styles.muted}>{t('reaStudio.compare.noScreenshot')}</p>;
}

/** One step pair opened: the two screenshots side by side, then the calls and screen lines that differ. */
function StepDetail({ row, original, remake }: { row: ReaCompareStepRow; original: ReaBrowserView | null; remake: ReaBrowserView | null }) {
  const { t } = useI18n();
  // Screenshots are shown only when at least one side recorded one; two empty frames would say nothing.
  const shots = row.screenshots.original || row.screenshots.remake;
  return <div className={styles.detail}>
    <div className={styles.sideBySide}>
      <figure><figcaption>{t('reaStudio.compare.original')}{row.original ? ` · ${row.original.action} · ${row.original.status}${row.original.path ? ` · ${row.original.path}` : ''}` : ''}</figcaption>{shots ? <Shot view={original} index={row.original?.index} /> : null}</figure>
      <figure><figcaption>{t('reaStudio.compare.remake')}{row.remake ? ` · ${row.remake.action} · ${row.remake.status}${row.remake.path ? ` · ${row.remake.path}` : ''}` : ''}</figcaption>{shots ? <Shot view={remake} index={row.remake?.index} /> : null}</figure>
    </div>
    {row.calls.length ? <ul className={styles.constraints}>{row.calls.map((call) => <li key={`${call.method} ${call.route}`} data-same={call.same}>
      <code>{call.method} {call.route}</code> <span className={styles.badge} data-tone={call.same ? 'ok' : 'fail'}>{call.original.join(', ') || '—'} → {call.remake.join(', ') || '—'}</span>
    </li>)}</ul> : null}
    {row.text.onlyOriginal.length || row.text.onlyRemake.length ? <pre className={styles.code} data-testid="rea-compare-text"><code>
      {row.text.onlyOriginal.map((line, index) => <span key={`o${index}`} className={styles.minus}>- {line}{'\n'}</span>)}
      {row.text.onlyRemake.map((line, index) => <span key={`r${index}`} className={styles.plus}>+ {line}{'\n'}</span>)}
    </code></pre> : null}
  </div>;
}

function Summary({ result }: { result: ReaComparison }) {
  const { t } = useI18n();
  const { summary } = result;
  return <div className={styles.tiles} data-testid="rea-compare-summary">
    <div className={styles.tile} data-tone={summary.pass === summary.total ? 'ok' : 'warn'}><b>{summary.pass}/{summary.total}</b><span>{t('reaStudio.compare.pass')}</span></div>
    <div className={styles.tile} data-tone={summary.fail ? 'warn' : 'ok'}><b>{summary.fail}</b><span>{t('reaStudio.compare.fail')}</span></div>
    <div className={styles.tile}><b>{summary.missing}</b><span>{t('reaStudio.compare.missing')}</span></div>
    <div className={styles.tile}><b>{summary.extra}</b><span>{t('reaStudio.compare.extra')}</span></div>
  </div>;
}

function CaseTable({ result }: { result: ReaCaseComparison }) {
  const { t } = useI18n();
  const [showPassing, setShowPassing] = useState(false);
  const rows = showPassing ? result.rows : result.rows.filter((row) => row.verdict !== 'pass');
  return <>
    <label className={styles.check}><input type="checkbox" checked={showPassing} onChange={(event) => setShowPassing(event.target.checked)} />{t('reaStudio.compare.onlyPassing')}</label>
    <div className={styles.tableWrap}><table className={styles.table} data-testid="rea-compare-cases">
      <thead><tr><th /><th>ID</th><th>{t('reaStudio.compare.input')}</th><th>{t('reaStudio.compare.original')}</th><th>{t('reaStudio.compare.remake')}</th><th>{t('reaStudio.compare.at')}</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={`${row.key}-${index}`}>
        <td><Verdict verdict={row.verdict} /></td><td><code>{row.key}</code></td><td><code>{row.input ?? '—'}</code></td>
        <td><code>{row.original ?? '—'}</code></td><td><code>{row.remake ?? '—'}</code></td><td>{row.at ? <code>{row.at}</code> : null}</td>
      </tr>)}</tbody>
    </table></div>
    {result.truncated ? <p className={styles.muted}>{t('reaStudio.compare.truncated', { count: result.rows.length })}</p> : null}
  </>;
}

/**
 * The original (the file open in the Studio) next to a remake the person picks: two REA browser captures step by step,
 * or two case-result files case by case. The daemon compares; this shows the verdicts, the screenshots side by side,
 * and can put the differences into the chat so the agent fixes the remake.
 */
export function ReaComparePane({ projectId, file, kind, originalView, onSendToChat, onClose }: {
  projectId: string;
  file: string;
  kind: 'browser' | 'cases';
  originalView: ReaBrowserView | null;
  onSendToChat?: (text: string, introIfEmpty?: string) => void;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const [remake, setRemake] = useState('');
  const [compareText, setCompareText] = useState(true);
  const [tolerance, setTolerance] = useState('0');
  const [result, setResult] = useState<ReaComparison | null>(null);
  const [remakeView, setRemakeView] = useState<ReaBrowserView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let current = true;
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/rea-evidence`).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const list = await response.json() as ReaEvidenceListResponse;
      const names = kind === 'browser' ? list.files.filter((entry) => entry.kind === 'browser').map((entry) => entry.file) : (list.cases ?? []).map((entry) => entry.file);
      if (!current) return;
      const others = names.filter((name) => name !== file);
      setCandidates(others);
      setRemake((value) => value || others[0] || '');
    }).catch((reason: unknown) => { if (current) { setCandidates([]); setError(reason instanceof Error ? reason.message : String(reason)); } });
    return () => { current = false; };
  }, [projectId, file, kind]);

  const run = async () => {
    if (!remake) return;
    setBusy(true); setError(''); setResult(null); setOpen(null); setSent(false);
    const body = kind === 'browser' ? { original: file, remake, compareText } : { original: file, remake, tolerance: Number(tolerance) || 0 };
    const compared = await postJson<ReaComparison>(`/api/projects/${encodeURIComponent(projectId)}/rea-evidence/compare`, body);
    if (!compared.ok) { setError(compared.message); setBusy(false); return; }
    setResult(compared.value);
    if (compared.value.kind === 'browser') {
      const viewed = await postJson<ReaEvidenceView>(`/api/projects/${encodeURIComponent(projectId)}/rea-evidence/view`, { file: remake });
      setRemakeView(viewed.ok && viewed.value.kind === 'browser' ? viewed.value as ReaEvidenceView & ReaBrowserView : null);
    }
    setBusy(false);
  };

  const failing = useMemo(() => (result ? result.summary.total - result.summary.pass : 0), [result]);

  return <section className={styles.panel} data-testid="rea-compare" aria-label={t('reaStudio.compare.open')}>
    <div className={styles.filters}>
      <b className={styles.sectionTitle}>{t('reaStudio.compare.open')}</b>
      <span className={styles.muted}>{t('reaStudio.compare.original')}: <code>{file}</code></span>
      {onClose ? <Button variant="ghost" onClick={onClose}>{t('reaStudio.compare.close')}</Button> : null}
    </div>
    {candidates === null ? <p className={styles.muted}>{t('common.loading')}</p> : candidates.length === 0 ? <p className={styles.muted} data-testid="rea-compare-none">{t('reaStudio.compare.none')}</p> : <div className={styles.filters}>
      <label className={styles.check}>{t('reaStudio.compare.remake')}
        <Select value={remake} onChange={(event) => setRemake(event.target.value)} aria-label={t('reaStudio.compare.pick')} data-testid="rea-compare-remake">
          {candidates.map((name) => <option key={name} value={name}>{name}</option>)}
        </Select>
      </label>
      {kind === 'browser'
        ? <label className={styles.check}><input type="checkbox" checked={compareText} onChange={(event) => setCompareText(event.target.checked)} />{t('reaStudio.compare.text')}</label>
        : <label className={styles.check}>{t('reaStudio.compare.tolerance')}<Input className={styles.number} type="number" min="0" step="any" value={tolerance} onChange={(event) => setTolerance(event.target.value)} aria-label={t('reaStudio.compare.tolerance')} /></label>}
      <Button variant="primary" onClick={() => void run()} disabled={busy || !remake} data-testid="rea-compare-run">{t('reaStudio.compare.run')}</Button>
    </div>}
    {error ? <p className={styles.alert} role="alert">{error}</p> : null}
    {result ? <>
      <Summary result={result} />
      <p className={styles.muted}>{t('reaStudio.compare.note')}</p>
      {onSendToChat && failing > 0 ? <div className={styles.filters}>
        <Button variant="ghost" data-testid="rea-compare-send" onClick={() => { onSendToChat(result.report, t('reaStudio.compare.sendIntro')); setSent(true); }}>{t('reaStudio.compare.send')}</Button>
        {sent ? <span className={styles.muted} role="status">{t('reaStudio.compare.sent', { count: failing })}</span> : null}
      </div> : null}
      {result.kind === 'browser' ? <div className={styles.tableWrap}><table className={styles.table} data-testid="rea-compare-steps">
        <thead><tr><th /><th>{t('reaStudio.compare.original')}</th><th>{t('reaStudio.compare.remake')}</th><th /></tr></thead>
        <tbody>{result.steps.map((row) => <Fragment key={row.position}>
          <tr data-open={open === row.position} data-testid="rea-compare-row" onClick={() => setOpen(open === row.position ? null : row.position)}>
            <td><Verdict verdict={row.verdict} /></td>
            <td><button type="button" className={styles.rowButton} aria-expanded={open === row.position}>{row.original ? `${row.original.index} ${row.original.id}` : '—'}</button></td>
            <td><code>{row.remake ? `${row.remake.index} ${row.remake.id}` : '—'}</code></td>
            <td>{row.differences.map((difference) => <span key={difference} className={styles.tag}>{t(DIFF_KEY[difference])}</span>)}</td>
          </tr>
          {open === row.position ? <tr><td colSpan={4}><StepDetail row={row} original={originalView} remake={remakeView} /></td></tr> : null}
        </Fragment>)}</tbody>
      </table></div> : <CaseTable result={result} />}
    </> : null}
  </section>;
}
