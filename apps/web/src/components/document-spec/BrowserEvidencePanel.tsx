'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import type {
  BrowserEvidenceApplyChanges,
  BrowserEvidenceApplyResponse,
  BrowserEvidenceCrossCheckResponse,
  BrowserEvidenceFinding,
  BrowserEvidenceFindingKind,
  BrowserEvidenceListEntry,
  InterfaceSpecDocument,
} from '@open-design/contracts';
import { useI18n } from '../../i18n';
import styles from './BrowserEvidencePanel.module.css';

const KIND_KEY = {
  'integrity-failed': 'browserEvidence.kind.integrityFailed',
  'undocumented-endpoint': 'browserEvidence.kind.undocumentedEndpoint',
  'undocumented-field': 'browserEvidence.kind.undocumentedField',
  'name-mismatch': 'browserEvidence.kind.nameMismatch',
  'type-mismatch': 'browserEvidence.kind.typeMismatch',
  'failed-request': 'browserEvidence.kind.failedRequest',
  'undocumented-error': 'browserEvidence.kind.undocumentedError',
  'unobserved-field': 'browserEvidence.kind.unobservedField',
  'body-unavailable': 'browserEvidence.kind.bodyUnavailable',
  'unexercised-endpoint': 'browserEvidence.kind.unexercisedEndpoint',
} as const satisfies Record<BrowserEvidenceFindingKind, string>;
const MAX_EVIDENCE_FILES = 10;
const MAX_SHOWN_FINDINGS = 300;

type ErrorPayload = { error?: { message?: string } };

async function failureMessage(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => ({})) as ErrorPayload;
  return payload.error?.message ?? fallback;
}

/**
 * Browser evidence check for an interface specification: what an REA browser
 * scenario actually sent and received, against what the specification says.
 * The comparison reads the saved file; applying hands the updated document to
 * the editor, so the reviewer sees the changes and saves them.
 */
export function BrowserEvidencePanel({ projectId, inputFile, dirty, loadedContentSha256, onApply }: {
  projectId: string;
  inputFile: string;
  dirty: boolean;
  /** SHA-256 of the file as the editor loaded it. */
  loadedContentSha256?: string | undefined;
  onApply: (doc: InterfaceSpecDocument) => void;
}) {
  const { locale, t } = useI18n();
  const [files, setFiles] = useState<BrowserEvidenceListEntry[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [result, setResult] = useState<BrowserEvidenceCrossCheckResponse | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [includeExamples, setIncludeExamples] = useState(false);
  const [attach, setAttach] = useState(true);
  const [applied, setApplied] = useState<BrowserEvidenceApplyChanges | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scope = useRef(0);
  // The translate function can change identity with the locale; effects must not restart on it.
  const translate = useRef(t);
  translate.current = t;

  const loadFiles = useCallback(async (current: number) => {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/browser-evidence`, { cache: 'no-store' });
    if (!response.ok) throw new Error(await failureMessage(response, translate.current('browserEvidence.failed')));
    const { files: list } = await response.json() as { files: BrowserEvidenceListEntry[] };
    if (current !== scope.current) return;
    setFiles(list);
    setChosen((previous) => {
      const kept = previous.filter((name) => list.some((entry) => entry.file === name));
      return kept.length ? kept : list.slice(0, MAX_EVIDENCE_FILES).map((entry) => entry.file);
    });
  }, [projectId]);

  useEffect(() => {
    scope.current += 1;
    const current = scope.current;
    setResult(null); setApplied(null); setError(''); setBusy(false); setFiles(null); setChosen([]); setPicked(new Set());
    void loadFiles(current).catch((failure) => { if (current === scope.current) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => { scope.current += 1; };
  }, [projectId, inputFile, loadFiles]);

  const stale = Boolean(result && loadedContentSha256 && result.contentSha256 !== loadedContentSha256);
  const selectedCount = useMemo(() => result?.findings.filter((finding) => finding.applicable && picked.has(finding.id)).length ?? 0, [result, picked]);
  const groups = useMemo(() => {
    const map = new Map<string, BrowserEvidenceFinding[]>();
    for (const finding of (result?.findings ?? []).slice(0, MAX_SHOWN_FINDINGS)) {
      const key = `${finding.endpoint.method} ${finding.endpoint.path}`;
      map.set(key, [...(map.get(key) ?? []), finding]);
    }
    return [...map.entries()];
  }, [result]);

  async function run() {
    const current = scope.current;
    setBusy(true); setError(''); setApplied(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/browser-evidence/cross-check`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inputFile, evidenceFiles: chosen }),
      });
      if (!response.ok) throw new Error(await failureMessage(response, translate.current('browserEvidence.failed')));
      const payload = await response.json() as BrowserEvidenceCrossCheckResponse;
      if (current !== scope.current) return;
      setResult(payload);
      setPicked(new Set(payload.findings.filter((finding) => finding.applicable).map((finding) => finding.id)));
    } catch (failure) { if (current === scope.current) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (current === scope.current) setBusy(false); }
  }

  async function apply() {
    if (!result || stale || dirty) return;
    const current = scope.current;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/browser-evidence/apply`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputFile, evidenceFiles: chosen, findingIds: [...picked], includeExamples, attachEvidence: attach,
          noteLanguage: locale === 'ko' ? 'ko' : 'en',
        }),
      });
      if (!response.ok) throw new Error(await failureMessage(response, translate.current('browserEvidence.failed')));
      const payload = await response.json() as BrowserEvidenceApplyResponse;
      if (current !== scope.current) return;
      // The editor now holds the changes unsaved; the comparison no longer describes the file.
      onApply(payload.doc);
      setApplied(payload.changes);
      setResult(null);
    } catch (failure) { if (current === scope.current) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (current === scope.current) setBusy(false); }
  }

  function toggleFile(name: string) {
    setChosen((previous) => previous.includes(name) ? previous.filter((item) => item !== name) : [...previous, name].slice(0, MAX_EVIDENCE_FILES));
  }

  function togglePicked(id: string) {
    setPicked((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  const summary = result?.summary;
  return <section className={styles.root} aria-label={t('browserEvidence.title')} data-testid="browser-evidence">
    <div className={styles.heading}>
      <div>
        <h3>{t('browserEvidence.title')}</h3>
        <p>{t('browserEvidence.intro')}</p>
      </div>
      <Button disabled={busy || dirty || chosen.length === 0} onClick={() => void run()} data-testid="browser-evidence-run">
        {busy && !result ? t('common.loading') : t('browserEvidence.run')}
      </Button>
    </div>
    {dirty ? <p role="status">{t('browserEvidence.saveFirst')}</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}

    {files !== null && files.length === 0
      ? <p className={styles.meta} data-testid="browser-evidence-empty">{t('browserEvidence.noFiles')}</p>
      : <ul className={styles.files} aria-label={t('browserEvidence.title')}>{(files ?? []).map((entry) => <li key={entry.file}>
          <label><input type="checkbox" checked={chosen.includes(entry.file)} onChange={() => toggleFile(entry.file)} data-testid="browser-evidence-file" />
            <code>{entry.file}</code></label>
        </li>)}</ul>}
    <div className={styles.options}>
      <Button variant="ghost" disabled={busy} onClick={() => { const current = scope.current; void loadFiles(current).catch((failure) => setError(failure instanceof Error ? failure.message : String(failure))); }}>{t('browserEvidence.refresh')}</Button>
      {chosen.length === 0 && files !== null && files.length > 0 ? <span className={styles.meta}>{t('browserEvidence.selectFile')}</span> : null}
    </div>

    {applied ? <p role="status" className={styles.applied} data-testid="browser-evidence-applied">{t('browserEvidence.applied', {
      endpoints: applied.endpointsAdded, fields: applied.fieldsAdded, renamed: applied.fieldsRenamed, types: applied.typesChanged,
      notes: applied.notesAdded, evidence: applied.evidenceAttached,
    })}</p> : null}

    {result && summary ? <div data-testid="browser-evidence-result">
      <p className={styles.summary}>{t('browserEvidence.summary', {
        calls: summary.observedApiCalls, exercised: summary.exercisedEndpoints, documented: summary.documentedEndpoints,
        undocumented: summary.undocumentedEndpoints, confirmed: summary.confirmedFields, fields: summary.documentedFields,
        errors: summary.errors, warnings: summary.warnings,
      })}</p>
      {result.sources.filter((source) => source.completeness.status !== 'complete').map((source) =>
        <p key={source.file} role="status" className={styles.meta}>{t('browserEvidence.incomplete', { file: source.file, status: source.completeness.status })}</p>)}
      {stale ? <p role="status" className={styles.error}>{t('browserEvidence.stale')}</p> : null}

      <details className={styles.coverage}>
        <summary>{t('browserEvidence.coverage')}</summary>
        <ul>{result.coverage.map((entry) => <li key={entry.index}>
          <code>{entry.method} {entry.path}</code>
          {entry.observed === 0
            ? <span className={styles.badge} data-severity="info">{t('browserEvidence.kind.unexercisedEndpoint')}</span>
            : <span className={styles.detail}>{t('browserEvidence.coverageRow', {
              calls: entry.observed, responseConfirmed: entry.response.confirmed, responseDocumented: entry.response.documented,
              requestConfirmed: entry.request.confirmed, requestDocumented: entry.request.documented,
            })}</span>}
        </li>)}</ul>
      </details>

      <h4>{t('browserEvidence.findings')}</h4>
      {result.findings.length === 0 ? <p className={styles.meta}>{t('browserEvidence.none')}</p> : <div className={styles.groups}>
        {groups.map(([key, findings]) => <div key={key} className={styles.group}>
          <code className={styles.endpoint}>{key}{findings[0]?.endpoint.interfaceId ? ` · ${findings[0].endpoint.interfaceId}` : ''}</code>
          <ul className={styles.items}>{findings.map((finding) => <li key={finding.id} data-severity={finding.severity}>
            {finding.applicable
              ? <input type="checkbox" checked={picked.has(finding.id)} onChange={() => togglePicked(finding.id)} aria-label={t(KIND_KEY[finding.kind])} data-testid="browser-evidence-finding" />
              : <span className={styles.spacer} aria-hidden />}
            <span className={styles.badge} data-severity={finding.severity}>{t(KIND_KEY[finding.kind])}</span>
            <span className={styles.subject}>
              {finding.side ? <span className={styles.side}>{t(finding.side === 'request' ? 'browserEvidence.side.request' : 'browserEvidence.side.response')}</span> : null}
              {finding.field && finding.kind !== 'failed-request' && finding.kind !== 'integrity-failed' ? <code>{finding.field}</code> : null}
              {finding.documentedField && finding.documentedField !== finding.field ? <> ≠ <code>{finding.documentedField}</code></> : null}
            </span>
            <span className={styles.detail}>
              {[finding.observedTypes?.join(' | '), finding.documentedType, ...(finding.details ?? [])].filter(Boolean).join(' · ')}
            </span>
            {!finding.applicable ? <span className={styles.meta}>{t('browserEvidence.notApplicable')}</span> : null}
          </li>)}</ul>
        </div>)}
      </div>}

      <div className={styles.apply}>
        <label className={styles.option}><input type="checkbox" checked={attach} onChange={(event) => setAttach(event.target.checked)} />{t('browserEvidence.attach')}</label>
        <label className={styles.option}><input type="checkbox" checked={includeExamples} onChange={(event) => setIncludeExamples(event.target.checked)} data-testid="browser-evidence-examples" />{t('browserEvidence.includeExamples')}</label>
        {includeExamples ? <p role="note" className={styles.warning}>{t('browserEvidence.examplesWarning')}</p> : null}
        <Button disabled={busy || dirty || stale || (selectedCount === 0 && !attach)} onClick={() => void apply()} data-testid="browser-evidence-apply">
          {t('browserEvidence.apply', { count: selectedCount })}
        </Button>
      </div>
    </div> : null}
  </section>;
}
