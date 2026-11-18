import { useEffect, useState } from 'react';
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from '@open-design/components';
import {
  runCheckAttention,
  type RunCheckDetailResponse,
  type RunCheckFileStatus,
  type RunCheckSummary,
  type RunTouchedChange,
  type RunTouchedKind,
} from '@open-design/contracts';
import { useT } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { resultsApi } from './api';
import styles from './RunCheck.module.css';

type DictKey = keyof Dict;
type Translate = ReturnType<typeof useT>;

const KIND_KEY: Record<RunTouchedKind, DictKey> = {
  api: 'results.check.kind.api', screen: 'results.check.kind.screen', table: 'results.check.kind.table', class: 'results.check.kind.class',
};
const CHANGE_KEY: Record<RunTouchedChange, DictKey> = {
  added: 'results.check.change.added', removed: 'results.check.change.removed', changed: 'results.check.change.changed',
};
const FILE_KEY: Record<RunCheckFileStatus, DictKey> = {
  added: 'results.check.file.added', modified: 'results.check.file.modified', deleted: 'results.check.file.deleted', renamed: 'results.check.file.renamed',
};
const API_SKIP_KEY: Record<'no-python' | 'no-scanner' | 'error', DictKey> = {
  'no-python': 'results.check.api.noPython', 'no-scanner': 'results.check.api.noScanner', error: 'results.check.api.error',
};

/** One line for a run's check: what a person should look at first. */
export function checkLabel(check: RunCheckSummary, t: Translate): string {
  if (check.state === 'pending') return t('results.check.pending');
  if (check.state === 'skipped') return t('results.check.notGit');
  if (check.state === 'failed') return t(check.reason === 'restarted' ? 'results.check.restarted' : 'results.check.failed');
  if (check.api?.checked && check.api.counts.breaking > 0) return t('results.check.breaking', { n: check.api.counts.breaking });
  if (check.api?.checked && check.api.counts.warning > 0) return t('results.check.warning', { n: check.api.counts.warning });
  if (check.api?.checked && check.api.counts.info > 0) return t('results.check.additive', { n: check.api.counts.info });
  return check.files ? t('results.check.files', { n: check.files }) : t('results.check.noFiles');
}

/** The badge on a board card or a work-log row; opens the run's check. */
export function CheckBadge({ check, onOpen }: { check: RunCheckSummary | null; onOpen: () => void }) {
  const t = useT();
  if (!check) return null;
  const attention = runCheckAttention(check);
  return (
    <button type="button" className={`${styles.badge} ${styles[`badge_${attention}`] ?? ''}`} onClick={onOpen} data-testid="run-check-badge">
      {checkLabel(check, t)}
    </button>
  );
}

function ApiSection({ detail, t }: { detail: RunCheckDetailResponse; t: Translate }) {
  const api = detail.summary.api;
  if (!api) return <p className={styles.muted}>{t('results.check.api.notApplicable')}</p>;
  if (!api.checked) return <p className={styles.muted}>{t(API_SKIP_KEY[api.reason])}{api.message ? ` ${api.message}` : ''}</p>;
  return (
    <>
      <p className={styles.muted}>
        {t('results.check.api.endpoints', { before: api.endpoints.before, after: api.endpoints.after })}
        {api.level === 'none' ? ` · ${t('docs.impact.compat.level.none')}` : ''}
      </p>
      {detail.apiChanges.length ? (
        <table className={styles.table}>
          <tbody>
            {detail.apiChanges.map((change, index) => (
              <tr key={index}>
                <td><span className={`${styles.level} ${styles[`level_${change.level}`] ?? ''}`}>{t(`docs.impact.compat.level.${change.level}` as DictKey)}</span></td>
                <td className={styles.mono}>{change.route}</td>
                <td>{t(`docs.impact.compat.${change.code}` as DictKey)}</td>
                <td className={styles.mono}>
                  {change.field ?? ''}
                  {change.before !== undefined || change.after !== undefined ? ` ${change.before ?? '—'} → ${change.after ?? '—'}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}

/** What one run changed: files, API compatibility and the declarations it touched. */
export function CheckDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
  const t = useT();
  const [detail, setDetail] = useState<RunCheckDetailResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    const load = () => void resultsApi.check(runId).then((result) => {
      if (!live) return;
      if (result.ok) { setDetail(result.value); setError(''); } else setError(result.message);
    });
    load();
    // a check still running settles a few seconds after the run ends
    const timer = window.setInterval(() => { if (detail?.summary.state === 'pending' || !detail) load(); }, 3000);
    return () => { live = false; window.clearInterval(timer); };
  }, [runId, detail?.summary.state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog onClose={onClose} ariaLabel={detail ? t('results.check.title', { n: detail.number }) : t('results.check.titlePlain')} className={styles.dialog}>
      <DialogHeader>
        <DialogTitle>{detail ? t('results.check.title', { n: detail.number }) : t('results.check.titlePlain')}</DialogTitle>
      </DialogHeader>
      <DialogBody className={styles.body}>
        {error ? <p className={styles.error} role="alert">{t('results.loadFailed')} {error}</p> : null}
        {detail ? (
          <>
            <p className={`${styles.summary} ${styles[`summary_${runCheckAttention(detail.summary)}`] ?? ''}`} data-testid="run-check-summary">{checkLabel(detail.summary, t)}</p>
            <p className={styles.muted}>{t('results.check.note')}</p>
            {detail.summary.shared ? <p className={styles.warn}>{t('results.check.shared')}</p> : null}
            {detail.summary.message ? <p className={styles.muted}>{detail.summary.message}</p> : null}
            {detail.summary.state === 'done' ? (
              <>
                <section>
                  <h3 className={styles.heading}>{t('results.check.api.title')}</h3>
                  <ApiSection detail={detail} t={t} />
                </section>
                {detail.touched.length ? (
                  <section>
                    <h3 className={styles.heading}>{t('results.check.touched')}</h3>
                    <ul className={styles.list}>
                      {detail.touched.map((item) => (
                        <li key={`${item.kind}:${item.label}`}>
                          <span className={`${styles.tag} ${styles[`tag_${item.change}`] ?? ''}`}>{t(CHANGE_KEY[item.change])}</span>
                          <span className={styles.kind}>{t(KIND_KEY[item.kind])}</span>
                          <span className={styles.mono}>{item.label}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {detail.files.length ? (
                  <section>
                    <h3 className={styles.heading}>{t('results.check.changedFiles', { n: detail.files.length })}</h3>
                    <ul className={styles.list}>
                      {detail.files.map((file) => (
                        <li key={`${file.status}:${file.path}`}>
                          <span className={styles.tag}>{t(FILE_KEY[file.status])}</span>
                          <span className={styles.mono}>{file.path}{file.from ? ` ← ${file.from}` : ''}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogFooter>
    </Dialog>
  );
}
