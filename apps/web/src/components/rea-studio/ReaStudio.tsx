'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@open-design/components';
import type { ReaBrowserView, ReaEvidenceKind, ReaEvidenceView, ReaOtherView, ReaSqliteView, ReaStaticView, ReaTraceView } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import type { ProjectFile } from '../../types';
import { ReaBrowserPane } from './ReaBrowserPane';
import { ReaSqlitePane } from './ReaSqlitePane';
import { ReaFactsPane, ReaStaticPane, ReaTracePane } from './ReaStaticPane';
import styles from './ReaStudio.module.css';

const KIND_KEY = {
  browser: 'reaStudio.kind.browser', sqlite: 'reaStudio.kind.sqlite', static: 'reaStudio.kind.static',
  trace: 'reaStudio.kind.trace', view: 'reaStudio.kind.view', other: 'reaStudio.kind.other',
} as const satisfies Record<ReaEvidenceKind, string>;
const KIND_GLYPH: Readonly<Record<ReaEvidenceKind, string>> = { browser: '◫', sqlite: '▤', static: '◇', trace: '⇢', view: '◌', other: '◦' };

async function postJson<T>(path: string, body: unknown): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
      return { ok: false, message: payload.error?.message ?? `HTTP ${response.status}` };
    }
    return { ok: true, value: await response.json() as T };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : String(error) }; }
}

/**
 * REA Studio: an REA evidence file as a screen. The daemon checks the payload hashes and sends a view; this shows the
 * envelope (what ran, with which confidence), what REA said it could not establish, and the evidence itself.
 */
export function ReaStudio({ projectId, file, onShowRaw }: { projectId: string; file: string; onShowRaw?: () => void }) {
  const { t } = useI18n();
  const [view, setView] = useState<ReaEvidenceView | null>(null);
  const [error, setError] = useState('');
  const scope = useRef(0);

  useEffect(() => {
    scope.current += 1;
    const current = scope.current;
    setView(null); setError('');
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

  return <div className="viewer"><div className={`viewer-body ${styles.root}`} data-testid="rea-studio">
    <header className={styles.head}>
      <span className={styles.glyph} aria-hidden>{view ? KIND_GLYPH[view.kind] : '◦'}</span>
      <div className={styles.headText}>
        <h3>{view ? t(KIND_KEY[view.kind]) : 'REA Studio'} <span className={styles.operation}>{view?.envelope.operation}</span></h3>
        <p className={styles.muted}><code>{file}</code></p>
      </div>
      {onShowRaw ? <Button variant="ghost" onClick={onShowRaw} data-testid="rea-show-raw">{t('reaStudio.rawJson')}</Button> : null}
    </header>
    {error ? <p className={styles.alert} role="alert" data-testid="rea-error">{t('reaStudio.loadFailed')} {error}</p> : null}
    {!view && !error ? <p className={styles.muted}>{t('common.loading')}</p> : null}
    {view ? <>
      <div className={styles.chips} data-testid="rea-envelope">
        <span className={styles.chip}>{view.envelope.provider.name || view.envelope.provider.id} {view.envelope.provider.version}</span>
        {view.envelope.confidence ? <span className={styles.chip}>{t('reaStudio.confidence')} <b>{view.envelope.confidence}</b></span> : null}
        {view.envelope.authority ? <span className={styles.chip}>{t('reaStudio.authority')} <b>{view.envelope.authority}</b></span> : null}
        <span className={styles.chip} title={view.envelope.evidenceId}>{view.envelope.evidenceId.slice(0, 14)}…</span>
      </div>
      {pane}
      {view.unknowns.length ? <details className={styles.fold}><summary>{t('reaStudio.unknowns', { count: view.unknowns.length })}</summary><ul>{view.unknowns.map((unknown, index) => <li key={index}>{unknown}</li>)}</ul></details> : null}
      {view.envelope.limitations.length ? <details className={styles.fold}><summary>{t('reaStudio.limitations', { count: view.envelope.limitations.length })}</summary><ul>{view.envelope.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></details> : null}
      <p className={styles.muted}>{t('reaStudio.cliHint', { command: `monofield rea show --project ${projectId} --file ${file}` })}</p>
    </> : null}
  </div></div>;
}

/**
 * Wraps the normal text view of a JSON file: when the file is REA evidence (judged from its first bytes) the Studio is
 * shown, with a switch back to the raw JSON; any other JSON file is untouched.
 */
export function ReaEvidenceGate({ projectId, file, raw }: { projectId: string; file: ProjectFile; raw: ReactNode }) {
  const [state, setState] = useState<'checking' | 'evidence' | 'plain'>('checking');
  const [showRaw, setShowRaw] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    let current = true;
    setState('checking'); setShowRaw(false);
    void postJson<{ evidence: boolean }>(`/api/projects/${encodeURIComponent(projectId)}/rea-evidence/probe`, { file: file.name }).then((result) => {
      if (current) setState(result.ok && result.value.evidence ? 'evidence' : 'plain');
    });
    return () => { current = false; };
  }, [projectId, file.name, file.mtime]);

  if (state !== 'evidence') return <>{raw}</>;
  if (showRaw) return <div className={styles.rawWrap}><div className={styles.rawBar}><Button variant="ghost" onClick={() => setShowRaw(false)} data-testid="rea-show-studio">{t('reaStudio.studio')}</Button></div>{raw}</div>;
  return <ReaStudio projectId={projectId} file={file.name} onShowRaw={() => setShowRaw(true)} />;
}
