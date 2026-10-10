import { useEffect, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import type { VerificationAdvice, VerificationPlan } from '@open-design/contracts';
import { useT } from '../i18n';
import styles from './VerificationAdviceAssistant.module.css';

type Props = {
  projectId: string;
  projectPath?: string | null;
  revisionKey?: string;
  plan: VerificationPlan;
  disabled?: boolean;
  onApply: (ids: string[], snapshotSha256: string) => void;
  onInvalidate: () => void;
  onRequestReview?: (prompt: string) => void;
};
export function VerificationAdviceAssistant({ projectId, projectPath, revisionKey, plan, disabled = false, onApply, onInvalidate, onRequestReview }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false), [request, setRequest] = useState('');
  const [advice, setAdvice] = useState<VerificationAdvice | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [applied, setApplied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const identity = JSON.stringify([projectId, projectPath, revisionKey, plan.checks, request, disabled, open]);
  const identityRef = useRef(identity); identityRef.current = identity;
  useEffect(() => {
    ++generation.current; abortRef.current?.abort();
    setAdvice(null); setError(''); setApplied(false); setBusy(false); onInvalidate();
    return () => { ++generation.current; abortRef.current?.abort(); };
  }, [identity, onInvalidate]);
  const suggest = async (mode: 'rules' | 'model') => {
    abortRef.current?.abort(); const controller = new AbortController(); abortRef.current = controller;
    const version = ++generation.current, sourceIdentity = identity;
    setBusy(true); setError(''); setApplied(false); setAdvice(null); onInvalidate();
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/development/verification/advice`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal, cache: 'no-store',
        body: JSON.stringify({ request, mode, ...(projectPath ? { projectPath } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? `HTTP ${response.status}`);
      if (!controller.signal.aborted && version === generation.current && identityRef.current === sourceIdentity) setAdvice(data as VerificationAdvice);
    } catch (e) {
      if (!controller.signal.aborted && version === generation.current && identityRef.current === sourceIdentity) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (version === generation.current && identityRef.current === sourceIdentity) setBusy(false);
    }
  };
  const review = () => {
    if (!advice?.manualReview.length || !onRequestReview) return;
    onRequestReview([request, '', t('verification.advice.reviewIntro'),
      ...advice.manualReview.map(item => `- ${t(`verification.advice.manual.${item}`)}`)].join('\n'));
  };
  return <section className={styles.panel} aria-label={t('verification.advice.title')}>
    <Button variant="ghost" onClick={() => setOpen(v => !v)} aria-expanded={open}>{open ? '▾' : '▸'} {t('verification.advice.title')}</Button>
    <div className={styles.body} hidden={!open}>
      <p>{t('verification.advice.description')}</p>
      <label>{t('verification.advice.input')}
        <textarea value={request} maxLength={4_000} placeholder={t('verification.advice.placeholder')} disabled={disabled}
          onChange={e => setRequest(e.target.value)} />
      </label>
      <p className={styles.hint}>{t('verification.advice.modelHint')}</p>
      <div className={styles.actions}>
        <Button disabled={disabled || busy || !request.trim()} onClick={() => { void suggest('rules'); }}>{t('verification.advice.rules')}</Button>
        <Button disabled={disabled || busy || !request.trim()} onClick={() => { void suggest('model'); }}>{t('verification.advice.model')}</Button>
      </div>
      {busy ? <p role="status">{t('verification.advice.working')}</p> : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {advice ? <div className={styles.result}>
        <p role="status">{t(`verification.advice.reason.${advice.reason}`)}</p>
        {advice.priorityCheckId ? <p>{t('verification.advice.priority', { label: plan.checks.find(c => c.id === advice.priorityCheckId)?.label ?? advice.priorityCheckId })}</p> : null}
        <ul>{advice.suggestedCheckIds.map(id => <li key={id}><code>{plan.checks.find(c => c.id === id)?.label ?? id}</code></li>)}</ul>
        <p className={styles.hint}>{t('verification.advice.elapsed', { ms: advice.elapsedMs, count: advice.evaluationAttempts })}</p>
        {advice.evaluationAttempts ? <p className={styles.hint}>{advice.usage
          ? t('jev.usage', { input: advice.usage.input_tokens, output: advice.usage.output_tokens })
          : t('verification.advice.unknownUsage')}</p> : null}
        <Button disabled={disabled || applied || !advice.snapshotSha256 || !advice.suggestedCheckIds.length}
          onClick={() => { if (advice.snapshotSha256) { onApply(advice.suggestedCheckIds, advice.snapshotSha256); setApplied(true); } }}>{t('verification.advice.apply')}</Button>
        {applied ? <p role="status">{t('verification.advice.applied')}</p> : null}
        {advice.manualReview.length ? <>
          <h4>{t('verification.advice.manualTitle')}</h4>
          <ul>{advice.manualReview.map(item => <li key={item}>{t(`verification.advice.manual.${item}`)}</li>)}</ul>
          {onRequestReview ? <Button disabled={disabled} onClick={review}>{t('verification.advice.review')}</Button> : null}
        </> : null}
      </div> : null}
    </div>
  </section>;
}
