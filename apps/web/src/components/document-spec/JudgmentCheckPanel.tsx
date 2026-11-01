'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import type {
  JevStatus,
  JudgmentCheckResponse,
  JudgmentItem,
  JudgmentKind,
  JudgmentScore,
  JudgmentScorecard,
} from '@open-design/contracts';
import { useI18n } from '../../i18n';
import styles from './JudgmentCheckPanel.module.css';

const KIND_KEY = { 'field-label': 'judgments.kind.fieldLabel', 'business-name': 'judgments.kind.businessName' } as const;
const VERDICT_KEY = { flag: 'judgments.verdict.flag', review: 'judgments.verdict.review', pass: 'judgments.verdict.pass' } as const;
const REASON_KEY = {
  empty: 'judgments.reason.empty', untranslated: 'judgments.reason.untranslated', observe: 'judgments.reason.observe',
  uncertain: 'judgments.reason.uncertain', disagrees: 'judgments.reason.disagrees', agrees: 'judgments.reason.agrees',
  'model-unavailable': 'judgments.reason.modelUnavailable', 'model-timeout': 'judgments.reason.modelUnavailable',
} as const;
const STATUS_KEY = {
  unavailable: 'judgments.status.unavailable', timeout: 'judgments.status.timeout', 'hosted-not-allowed': 'judgments.status.hostedNotAllowed',
} as const;

const percent = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}%`;

/**
 * Judgment check for an interface specification: rules first, then a System
 * One model (JEV or Laya) per item. A model+question pair observes until the
 * reviewer's labels support a policy and the reviewer applies it.
 */
export function JudgmentCheckPanel({ projectId, inputFile, dirty }: { projectId: string; inputFile: string; dirty: boolean }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<JevStatus | null>(null);
  const [result, setResult] = useState<JudgmentCheckResponse | null>(null);
  const [scorecard, setScorecard] = useState<JudgmentScorecard | null>(null);
  const [allowHosted, setAllowHosted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [labelled, setLabelled] = useState<Record<string, boolean>>({});
  const [showPass, setShowPass] = useState(false);
  const scope = useRef(0);

  const loadScorecard = useCallback(async () => {
    const response = await fetch('/api/judgments/scorecard');
    if (response.ok) setScorecard(await response.json() as JudgmentScorecard);
  }, []);

  useEffect(() => {
    scope.current += 1; setResult(null); setError(''); setLabelled({}); setBusy(false);
    void fetch('/api/jev/status').then(async (r) => { if (r.ok) setStatus(await r.json() as JevStatus); }).catch(() => undefined);
    void loadScorecard().catch(() => undefined);
    return () => { scope.current += 1; };
  }, [projectId, inputFile, loadScorecard]);

  async function run() {
    const current = scope.current;
    setBusy(true); setError(''); setLabelled({});
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/judgments/check`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inputFile, allowHosted }),
      });
      const payload = await response.json() as JudgmentCheckResponse | { error?: { message?: string } };
      if (!response.ok || !('ok' in payload)) throw new Error('error' in payload ? payload.error?.message : t('judgments.failed'));
      if (current === scope.current) setResult(payload);
    } catch (failure) { if (current === scope.current) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (current === scope.current) setBusy(false); }
  }

  async function label(group: JudgmentItem[], correct: boolean) {
    const item = group[0];
    if (!result || !item) return;
    const response = await fetch('/api/judgments/feedback', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: item.kind, subject: item.subject, correct, probability: item.probability,
        backend: result.backend, model: result.model, projectId, inputFile }) });
    if (!response.ok) { setError(t('judgments.failed')); return; }
    setLabelled((prev) => ({ ...prev, ...Object.fromEntries(group.map((member) => [member.id, correct])) }));
    void loadScorecard().catch(() => undefined);
  }

  async function setMode(kind: JudgmentKind, mode: 'active' | 'observe') {
    const response = await fetch('/api/judgments/policy', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, mode }) });
    const payload = await response.json() as { error?: { message?: string } };
    if (!response.ok) { setError(payload.error?.message ?? t('judgments.failed')); return; }
    await loadScorecard();
  }

  const hosted = status?.config.backend === 'typesafe';
  const currentScores = (scorecard?.scores ?? []).filter((s) => status && s.backend === status.config.backend && s.model === status.config.model);
  // The same field often appears on several endpoints: one row per distinct item, labelled once.
  const groups = (() => {
    const map = new Map<string, JudgmentItem[]>();
    for (const item of result?.items ?? []) {
      if (!showPass && item.verdict === 'pass') continue;
      const key = `${item.kind}\u0000${item.verdict}\u0000${JSON.stringify(item.subject)}`;
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.values()];
  })();

  return <section className={styles.root} aria-label={t('judgments.title')} data-testid="judgment-check">
    <div className={styles.heading}>
      <div>
        <h3>{t('judgments.title')}</h3>
        <p>{t('judgments.intro')}</p>
        {status ? <p className={styles.meta}>{t('judgments.backend', { backend: hosted ? 'TypeSafe JEV' : 'local', model: status.config.model })}</p> : null}
      </div>
      <Button disabled={busy || dirty} onClick={() => void run()} data-testid="judgment-check-run">{busy ? t('common.loading') : t('judgments.run')}</Button>
    </div>
    {hosted ? <label className={styles.consent}><input type="checkbox" checked={allowHosted} onChange={(e) => setAllowHosted(e.target.checked)} />{t('judgments.allowHosted')}</label> : null}
    {dirty ? <p role="status">{t('judgments.saveFirst')}</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}

    {result ? <div data-testid="judgment-check-result">
      <p className={styles.summary}>{t('judgments.summary', { flag: result.summary.flag, review: result.summary.review, pass: result.summary.pass })}</p>
      {result.modelStatus in STATUS_KEY ? <p role="status" className={styles.meta}>{t(STATUS_KEY[result.modelStatus as keyof typeof STATUS_KEY])}</p> : null}
      <ul className={styles.items}>{groups.slice(0, 300).map((group) => { const item = group[0]!; return <li key={item.id} data-verdict={item.verdict}>
        <span className={styles.badge} data-verdict={item.verdict}>{t(VERDICT_KEY[item.verdict])}</span>
        <span className={styles.kind}>{t(KIND_KEY[item.kind])}</span>
        <span className={styles.subject}>{item.kind === 'field-label'
          ? <><code>{item.subject.identifier}</code> → <strong>{item.subject.koreanLabel || '—'}</strong></>
          : <><code>{item.subject.method} {item.subject.path}</code> → <strong>{item.subject.businessName || '—'}</strong></>}
          {group.length > 1 ? <span className={styles.count}> ×{group.length}</span> : null}</span>
        <span className={styles.reason}>{item.reason ? t(REASON_KEY[item.reason]) : ''}{item.probability !== null ? ` · ${t('judgments.probability', { value: percent(item.probability) })}` : ''}</span>
        {item.source === 'model' ? labelled[item.id] === undefined
          ? <span className={styles.feedback}>
              <Button variant="ghost" onClick={() => void label(group, true)}>{t('judgments.markCorrect')}</Button>
              <Button variant="ghost" onClick={() => void label(group, false)}>{t('judgments.markIncorrect')}</Button>
            </span>
          : <span className={styles.recorded}>{t('judgments.recorded')}</span> : null}
      </li>; })}</ul>
      {result.summary.pass ? <Button variant="ghost" onClick={() => setShowPass((v) => !v)}>{t(showPass ? 'judgments.hidePass' : 'judgments.showPass', { count: result.summary.pass })}</Button> : null}
    </div> : null}

    <details className={styles.scorecard}>
      <summary>{t('judgments.scorecard')}</summary>
      <p className={styles.meta}>{t('judgments.scorecardIntro')}</p>
      {(['field-label', 'business-name'] as const).map((kind) => {
        const score: JudgmentScore | undefined = currentScores.find((s) => s.kind === kind);
        return <div key={kind} className={styles.score} data-testid={`judgment-score-${kind}`}>
          <strong>{t(KIND_KEY[kind])}</strong>
          <span className={styles.badge} data-mode={score?.mode ?? 'observe'}>{score?.mode === 'active'
            ? t('judgments.mode.active', { pass: percent(result?.policies[kind]?.passAt ?? null), flag: percent(result?.policies[kind]?.flagAt ?? null) })
            : t('judgments.mode.observe')}</span>
          <p>{t('judgments.scoreLine', { labels: score?.labels ?? 0, correct: score?.correctItems ?? 0, incorrect: score?.incorrectItems ?? 0,
            auc: score?.auc === null || score?.auc === undefined ? '—' : score.auc.toFixed(2) })}</p>
          {score?.suggested
            ? <p>{t('judgments.suggestion', { pass: percent(score.suggested.passAt > 1 ? null : score.suggested.passAt), flag: percent(score.suggested.flagAt),
                precision: percent(score.suggested.flagPrecision), recall: percent(score.suggested.flagRecall) })}</p>
            : <p className={styles.meta}>{t('judgments.noSuggestion', { min: scorecard?.minLabelsForPolicy ?? 20 })}</p>}
          <div className={styles.actions}>
            {score?.mode === 'active'
              ? <Button variant="ghost" onClick={() => void setMode(kind, 'observe')}>{t('judgments.observe')}</Button>
              : <Button disabled={!score?.suggested} onClick={() => void setMode(kind, 'active')}>{t('judgments.apply')}</Button>}
          </div>
        </div>;
      })}
      <a className={styles.export} href="/api/judgments/dataset" download="monofield-judgments.jsonl">{t('judgments.export')}</a>
    </details>
  </section>;
}
