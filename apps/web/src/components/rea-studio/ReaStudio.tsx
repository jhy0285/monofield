'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@open-design/components';
import type { ReaBrowserView, ReaCitation, ReaCiteTarget, ReaEvidenceKind, ReaEvidenceView, ReaOtherView, ReaSqliteView, ReaStaticView, ReaTraceView } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import type { ProjectFile } from '../../types';
import { CiteButton, ReaCiteContext, postJson, type ReaCiteApi } from './cite';
import { ReaBrowserPane } from './ReaBrowserPane';
import { ReaComparePane } from './ReaComparePane';
import { ReaSqlitePane } from './ReaSqlitePane';
import { ReaFactsPane, ReaStaticPane, ReaTracePane } from './ReaStaticPane';
import styles from './ReaStudio.module.css';

const KIND_KEY = {
  browser: 'reaStudio.kind.browser', sqlite: 'reaStudio.kind.sqlite', static: 'reaStudio.kind.static',
  trace: 'reaStudio.kind.trace', view: 'reaStudio.kind.view', other: 'reaStudio.kind.other',
} as const satisfies Record<ReaEvidenceKind, string>;
const KIND_GLYPH: Readonly<Record<ReaEvidenceKind, string>> = { browser: '◫', sqlite: '▤', static: '◇', trace: '⇢', view: '◌', other: '◦' };

/**
 * REA Studio: an REA evidence file as a screen. The daemon checks the payload hashes and sends a view; this shows the
 * envelope (what ran, with which confidence), what REA said it could not establish, and the evidence itself.
 */
export function ReaStudio({ projectId, file, onShowRaw, onSendToChat }: {
  projectId: string;
  file: string;
  onShowRaw?: () => void;
  /** Appends text to the chat composer; `introIfEmpty` leads it when the composer was empty. */
  onSendToChat?: (text: string, introIfEmpty?: string) => void;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<ReaEvidenceView | null>(null);
  const [error, setError] = useState('');
  const [includeValues, setIncludeValues] = useState(false);
  const [citeBusy, setCiteBusy] = useState(false);
  const [citeStatus, setCiteStatus] = useState<{ ok: true; citation: ReaCitation } | { ok: false; message: string } | null>(null);
  const [comparing, setComparing] = useState(false);
  const scope = useRef(0);

  const cite = useCallback((target: ReaCiteTarget) => {
    if (!onSendToChat) return;
    setCiteBusy(true); setCiteStatus(null);
    void postJson<ReaCitation>(`/api/projects/${encodeURIComponent(projectId)}/rea-evidence/cite`, { file, target, includeValues }).then((result) => {
      setCiteBusy(false);
      if (!result.ok) { setCiteStatus(result); return; }
      onSendToChat(result.value.block, t('reaStudio.cite.intro'));
      setCiteStatus({ ok: true, citation: result.value });
    });
  }, [file, includeValues, onSendToChat, projectId, t]);
  const citeApi = useMemo<ReaCiteApi | null>(() => (onSendToChat ? { cite, busy: citeBusy } : null), [cite, citeBusy, onSendToChat]);

  useEffect(() => {
    scope.current += 1;
    const current = scope.current;
    setView(null); setError(''); setCiteStatus(null); setComparing(false);
    void postJson<ReaEvidenceView>(`/api/projects/${encodeURIComponent(projectId)}/rea-evidence/view`, { file }).then((result) => {
      if (current !== scope.current) return;
      if (result.ok) setView(result.value); else setError(result.message);
    });
    return () => { scope.current += 1; };
  }, [projectId, file]);

  let pane: ReactNode = null;
  if (view) {
    if (view.kind === 'browser') pane = <ReaBrowserPane view={view as ReaEvidenceView & ReaBrowserView} />;
    else if (view.kind === 'sqlite') pane = <ReaSqlitePane view={view as ReaEvidenceView & ReaSqliteView} />;
    else if (view.kind === 'static') pane = <ReaStaticPane view={view as ReaEvidenceView & ReaStaticView} />;
    else if (view.kind === 'trace') pane = <ReaTracePane view={view as ReaEvidenceView & ReaTraceView} />;
    else pane = <ReaFactsPane view={view as ReaEvidenceView & ReaOtherView} />;
  }

  return <ReaCiteContext.Provider value={citeApi}><div className="viewer"><div className={`viewer-body ${styles.root}`} data-testid="rea-studio">
    <header className={styles.head}>
      <span className={styles.glyph} aria-hidden>{view ? KIND_GLYPH[view.kind] : '◦'}</span>
      <div className={styles.headText}>
        <h3>{view ? t(KIND_KEY[view.kind]) : 'REA Studio'} <span className={styles.operation}>{view?.envelope.operation}</span></h3>
        <p className={styles.muted}><code>{file}</code></p>
      </div>
      {view?.kind === 'browser' ? <Button variant="ghost" onClick={() => setComparing((value) => !value)} aria-pressed={comparing} data-testid="rea-compare-open">{t('reaStudio.compare.open')}</Button> : null}
      {onShowRaw ? <Button variant="ghost" onClick={onShowRaw} data-testid="rea-show-raw">{t('reaStudio.rawJson')}</Button> : null}
    </header>
    {citeApi && view ? <div className={styles.citeBar} data-testid="rea-cite-bar">
      <CiteButton target={{ kind: 'file' }} label={t('reaStudio.cite.file')} />
      <label className={styles.check} title={t('reaStudio.cite.includeValuesHint')}><input type="checkbox" checked={includeValues} onChange={(event) => setIncludeValues(event.target.checked)} data-testid="rea-include-values" />{t('reaStudio.cite.includeValues')}</label>
      <span className={styles.muted}>{t('reaStudio.cite.includeValuesHint')}</span>
      {citeStatus ? (citeStatus.ok
        ? <span className={styles.citeDone} role="status">{t('reaStudio.cite.done', { label: citeStatus.citation.label })}{citeStatus.citation.files.map((name) => <span key={name}> · {t('reaStudio.cite.savedShot', { file: name })}</span>)}</span>
        : <span className={styles.alert} role="alert">{t('reaStudio.cite.failed')} {citeStatus.message}</span>) : null}
    </div> : null}
    {error ? <p className={styles.alert} role="alert" data-testid="rea-error">{t('reaStudio.loadFailed')} {error}</p> : null}
    {!view && !error ? <p className={styles.muted}>{t('common.loading')}</p> : null}
    {view ? <>
      <div className={styles.chips} data-testid="rea-envelope">
        <span className={styles.chip}>{view.envelope.provider.name || view.envelope.provider.id} {view.envelope.provider.version}</span>
        {view.envelope.confidence ? <span className={styles.chip}>{t('reaStudio.confidence')} <b>{view.envelope.confidence}</b></span> : null}
        {view.envelope.authority ? <span className={styles.chip}>{t('reaStudio.authority')} <b>{view.envelope.authority}</b></span> : null}
        <span className={styles.chip} title={view.envelope.evidenceId}>{view.envelope.evidenceId.slice(0, 14)}…</span>
      </div>
      {comparing && view.kind === 'browser' ? <ReaComparePane projectId={projectId} file={file} kind="browser" originalView={view as ReaEvidenceView & ReaBrowserView} onSendToChat={onSendToChat} onClose={() => setComparing(false)} /> : null}
      {pane}
      {view.unknowns.length ? <details className={styles.fold}><summary>{t('reaStudio.unknowns', { count: view.unknowns.length })}</summary><ul>{view.unknowns.map((unknown, index) => <li key={index}>{unknown}</li>)}</ul></details> : null}
      {view.envelope.limitations.length ? <details className={styles.fold}><summary>{t('reaStudio.limitations', { count: view.envelope.limitations.length })}</summary><ul>{view.envelope.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></details> : null}
      <p className={styles.muted}>{t('reaStudio.cliHint', { command: `monofield rea show --project ${projectId} --file ${file}` })} {t('reaStudio.cite.cliHint', { command: `monofield rea cite --project ${projectId} --file ${file} --step <n>` })}</p>
    </> : null}
  </div></div></ReaCiteContext.Provider>;
}

/** A case-result file: what it is, and the comparison with the same cases run on the other side. */
export function ReaCasesStudio({ projectId, file, onShowRaw, onSendToChat }: { projectId: string; file: string; onShowRaw?: () => void; onSendToChat?: (text: string, introIfEmpty?: string) => void }) {
  const { t } = useI18n();
  return <div className="viewer"><div className={`viewer-body ${styles.root}`} data-testid="rea-cases">
    <header className={styles.head}>
      <span className={styles.glyph} aria-hidden>⇄</span>
      <div className={styles.headText}>
        <h3>{t('reaStudio.cases.title')}</h3>
        <p className={styles.muted}><code>{file}</code></p>
      </div>
      {onShowRaw ? <Button variant="ghost" onClick={onShowRaw} data-testid="rea-show-raw">{t('reaStudio.rawJson')}</Button> : null}
    </header>
    <p className={styles.muted}>{t('reaStudio.cases.hint')}</p>
    <ReaComparePane projectId={projectId} file={file} kind="cases" originalView={null} onSendToChat={onSendToChat} />
    <p className={styles.muted}>{t('reaStudio.cliHint', { command: `monofield rea compare --project ${projectId} --original ${file} --remake <file>` })}</p>
  </div></div>;
}

/**
 * Wraps the normal text view of a JSON file: when the file is REA evidence (judged from its first bytes) the Studio is
 * shown, and a case-result file shows its comparison; both keep a switch back to the raw JSON. Any other JSON file is
 * untouched.
 */
export function ReaEvidenceGate({ projectId, file, raw, onSendToChat }: { projectId: string; file: ProjectFile; raw: ReactNode; onSendToChat?: (text: string, introIfEmpty?: string) => void }) {
  const [state, setState] = useState<'checking' | 'evidence' | 'cases' | 'plain'>('checking');
  const [showRaw, setShowRaw] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    let current = true;
    setState('checking'); setShowRaw(false);
    void postJson<{ evidence: boolean; cases?: boolean }>(`/api/projects/${encodeURIComponent(projectId)}/rea-evidence/probe`, { file: file.name }).then((result) => {
      if (current) setState(result.ok && result.value.evidence ? 'evidence' : result.ok && result.value.cases ? 'cases' : 'plain');
    });
    return () => { current = false; };
  }, [projectId, file.name, file.mtime]);

  if (state === 'checking' || state === 'plain') return <>{raw}</>;
  if (showRaw) return <div className={styles.rawWrap}><div className={styles.rawBar}><Button variant="ghost" onClick={() => setShowRaw(false)} data-testid="rea-show-studio">{t('reaStudio.studio')}</Button></div>{raw}</div>;
  if (state === 'cases') return <ReaCasesStudio projectId={projectId} file={file.name} onShowRaw={() => setShowRaw(true)} onSendToChat={onSendToChat} />;
  return <ReaStudio projectId={projectId} file={file.name} onShowRaw={() => setShowRaw(true)} onSendToChat={onSendToChat} />;
}
