import { useEffect, useRef, useState } from 'react';
import { Button, Select, Textarea } from '@open-design/components';
import type { DecisionReviewInput, DecisionReviewResult } from '@open-design/contracts';
import { useT } from '../i18n';

export function JevEvidenceReview({ disabled, configurationKey }: { disabled: boolean; configurationKey: string }) {
  const t = useT();
  const [task, setTask] = useState<DecisionReviewInput['task']>('implementation');
  const [objective, setObjective] = useState(''), [evidence, setEvidence] = useState('');
  const [result, setResult] = useState<DecisionReviewResult | null>(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    pending.current?.abort(); pending.current = null; setBusy(false); setResult(null); setError('');
    return () => { pending.current?.abort(); pending.current = null; };
  }, [configurationKey, disabled]);
  const clear = () => { setResult(null); setError(''); };
  const review = async () => {
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); clear();
    try {
      const response = await fetch('/api/jev/review', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ task, objective, evidence }), signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? 'HTTP ' + response.status);
      if (pending.current === controller) setResult(data as DecisionReviewResult);
    } catch (error) { if (pending.current === controller && !controller.signal.aborted) setError(String(error)); }
    finally { if (pending.current === controller) { pending.current = null; setBusy(false); } }
  };
  return <details data-testid="jev-evidence-review">
    <summary>{t('jev.reviewTitle')}</summary>
    <p className="hint">{t('jev.reviewHelp')}</p>
    <fieldset disabled={disabled || busy}>
      <label>{t('jev.reviewTask')}<Select value={task} onChange={event => { setTask(event.target.value as typeof task); clear(); }}>
        <option value="implementation">{t('jev.reviewImplementation')}</option>
        <option value="design">{t('jev.reviewDesign')}</option>
        <option value="transfer">{t('jev.reviewTransfer')}</option>
        <option value="classification">{t('jev.reviewClassification')}</option>
      </Select></label>
      <label>{t('jev.reviewObjective')}<Textarea data-testid="jev-review-objective" rows={2} maxLength={200} value={objective} onChange={event => { setObjective(event.target.value); clear(); }} /></label>
      <label>{t('jev.reviewEvidence')}<Textarea data-testid="jev-review-evidence" rows={3} maxLength={600} value={evidence} onChange={event => { setEvidence(event.target.value); clear(); }} /></label>
      <Button type="button" data-testid="jev-review-submit" disabled={!objective.trim() || !evidence.trim()} onClick={() => void review()}>{busy ? t('jev.running') : t('jev.reviewSubmit')}</Button>
    </fieldset>
    {result ? <div data-testid="jev-review-result" role="status">
      <p>{result.status === 'suggestion' ? (result.suggestion === 'supported' ? t('jev.reviewSupported') : t('jev.reviewContradicted')) : t('jev.reviewUncertain')}</p>
      <p className="hint">{result.cached ? t('jev.reviewCached') : result.elapsedMs + ' ms'}</p>
      <p className="hint">{t('jev.advisory')}</p>
      <details><summary>{t('jev.raw')}</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
    </div> : null}
    {error ? <p role="alert">{error}</p> : null}
  </details>;
}
