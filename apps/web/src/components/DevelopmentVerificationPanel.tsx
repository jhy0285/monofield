import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import type { VerificationPlan, VerificationRepairResponse, VerificationRun, VerificationStatus } from '@open-design/contracts';
import { useT } from '../i18n';
import styles from './DevelopmentVerificationPanel.module.css';

type Props = {
  projectId: string;
  projectPath?: string | null;
  ready?: boolean;
  revisionKey?: string;
  agentBusy?: boolean;
  onRequestRepair?: (prompt: string) => void;
};
async function json<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message ?? `HTTP ${response.status}`);
  return data as T;
}

export function DevelopmentVerificationPanel({ projectId, projectPath, ready = true, revisionKey, agentBusy = false, onRequestRepair }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<VerificationPlan | null>(null);
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [runId, setRunId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [repairReady, setRepairReady] = useState(false);
  const key = `${projectId}\0${projectPath ?? '.'}`;
  const keyRef = useRef(key); keyRef.current = key;
  const readRef = useRef(0);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const base = `/api/projects/${encodeURIComponent(projectId)}/development/verification`;
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const query = useCallback((live = false) => {
    const params = new URLSearchParams();
    if (projectPath) params.set('projectPath', projectPath);
    if (runId) params.set('runId', runId);
    if (live) params.set('live', '1');
    return params.size ? `?${params}` : '';
  }, [projectPath, runId]);

  const load = useCallback(async (discover = false, live = false) => {
    if (!ready) return;
    abortRef.current?.abort(); const controller = new AbortController(); abortRef.current = controller;
    const version = ++readRef.current;
    const options = { cache: 'no-store' as const, signal: controller.signal };
    try {
      const [next, found] = await Promise.all([
        fetch(`${base}${query(live || agentBusy)}`, options).then(r => json<VerificationStatus>(r)),
        discover ? fetch(`${base}/plan${projectPath ? `?${new URLSearchParams({ projectPath })}` : ''}`, options).then(r => json<VerificationPlan>(r)) : Promise.resolve(null),
      ]);
      if (version !== readRef.current || controller.signal.aborted) return;
      setStatus(next); setError('');
      if (found) { setPlan(found); setSelected(previous => previous.length ? previous.filter(id => found.checks.some(c => c.id === id)) : found.checks.filter(c => c.recommended).map(c => c.id)); }
    } catch (e) { if (!controller.signal.aborted && version === readRef.current) setError(e instanceof Error ? e.message : String(e)); }
  }, [agentBusy, base, projectPath, query, ready]);

  useEffect(() => {
    setPlan(null); setStatus(null); setSelected([]); setRunId(''); setError(''); setBusy(false); setRepairReady(false);
    return () => { ++readRef.current; abortRef.current?.abort(); };
  }, [key]);
  useEffect(() => {
    if (!open || !ready) return;
    setStatus(previous => previous ? { ...previous, verified: false, freshness: 'unknown' } : previous);
    void load(true);
  }, [load, open, ready, revisionKey]);
  useEffect(() => {
    if (!open || !ready) return;
    const refresh = () => { if (document.visibilityState !== 'hidden') void load(); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [load, open, ready]);
  useEffect(() => {
    if (!open || status?.run?.state !== 'running') return;
    const timer = setTimeout(() => { void load(false, true); }, 700);
    return () => clearTimeout(timer);
  }, [load, open, status]);
  useEffect(() => {
    if (open && !agentBusy && status?.run?.endedAt && status.freshness === 'unknown') void load();
  }, [agentBusy, load, open, status?.run?.endedAt]);

  const mutate = async (kind: 'run' | 'cancel' | 'repair') => {
    const sourceKey = key; setBusy(true); setError(''); setRepairReady(false);
    try {
      const target = kind === 'run' ? base : `${base}/${encodeURIComponent(status?.run?.id ?? '')}/${kind}`;
      const response = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...(projectPath ? { projectPath } : {}), ...(kind === 'run' ? { checkIds: selected } : {}) }) });
      const data = await json<VerificationRun | VerificationStatus | VerificationRepairResponse>(response);
      if (!mountedRef.current || keyRef.current !== sourceKey) return;
      if (kind === 'run') {
        const run = data as VerificationRun; setRunId(run.id);
        setStatus({ checkedAt: new Date().toISOString(), run, freshness: 'unknown', verified: false, history: status?.history ?? [] });
      } else if (kind === 'cancel') setStatus(data as VerificationStatus);
      else { onRequestRepair?.((data as VerificationRepairResponse).prompt); setRepairReady(true); }
    } catch (e) { if (mountedRef.current && keyRef.current === sourceKey) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (mountedRef.current && keyRef.current === sourceKey) setBusy(false); }
  };
  const download = async () => {
    if (!status?.run) return;
    const sourceKey = key; setBusy(true); setError('');
    try {
      const fresh = await fetch(`${base}${query()}`, { cache: 'no-store' }).then(r => json<VerificationStatus>(r));
      if (!mountedRef.current || keyRef.current !== sourceKey || !fresh.run) return;
      setStatus(fresh);
      const url = URL.createObjectURL(new Blob([JSON.stringify(fresh, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `monofield-verification-${fresh.run.id}.json`; link.click(); URL.revokeObjectURL(url);
    } catch (e) { if (mountedRef.current && keyRef.current === sourceKey) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (mountedRef.current && keyRef.current === sourceKey) setBusy(false); }
  };
  const running = status?.run?.state === 'running';
  const verified = status?.verified && !agentBusy;
  const badge = verified ? t('verification.verified')
    : running ? t('verification.running')
      : status?.freshness === 'stale' ? t('verification.stale')
        : status?.run?.state === 'passed' ? t('verification.unverified')
          : status?.run ? t(`verification.${status.run.state}`) : t('verification.notRun');

  return <section className={styles.panel} aria-label={t('verification.title')} data-testid="development-verification">
    <div className={styles.header}>
      <Button variant="ghost" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-controls="verification-body">
        {open ? '▾' : '▸'} {t('verification.title')}
      </Button>
      <span className={styles.badge} data-verdict={verified ? 'verified' : running ? 'running' : status?.run ? 'attention' : 'none'} role="status">{badge}</span>
      {open ? <Button variant="ghost" disabled={busy || running || !ready} onClick={() => { void load(true); }}>{t('verification.refresh')}</Button> : null}
    </div>
    {open ? <div id="verification-body" className={styles.body}>
      <p className={styles.description}>{t('verification.description')}</p>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {!plan ? <p role="status">{t('common.loading')}</p> : !plan.checks.length ? <p>{t('verification.noChecks')}</p> : <>
        <fieldset className={styles.checks} disabled={busy || running || !ready}>
          <legend>{t('verification.selectChecks')}</legend>
          {plan.checks.map(check => <label key={check.id} className={styles.check}>
            <input type="checkbox" checked={selected.includes(check.id)} onChange={e => setSelected(previous => e.target.checked ? [...previous, check.id] : previous.filter(id => id !== check.id))} />
            <span><strong>{check.label}</strong><code>{check.command} {check.args.join(' ')}</code>{check.script ? <small title={check.script}>{check.script}</small> : null}</span>
          </label>)}
        </fieldset>
        <div className={styles.actions}>
          {running ? <Button disabled={busy} onClick={() => { void mutate('cancel'); }}>{t('verification.cancel')}</Button>
            : <Button variant="primary" disabled={busy || agentBusy || !ready || !selected.length} onClick={() => { void mutate('run'); }}>{t('verification.run')}</Button>}
          {status?.history.length ? <label className={styles.history}>{t('verification.history')}
            <select aria-label={t('verification.history')} disabled={busy || running} value={runId} onChange={e => setRunId(e.target.value)}>
              <option value="">{t('verification.latest')}</option>
              {status.history.map(run => <option key={run.id} value={run.id}>{new Date(run.startedAt).toLocaleString()} · {t(`verification.${run.state}`)}</option>)}
            </select>
          </label> : null}
        </div>
      </>}
      {status?.run ? <div className={styles.receipt}>
        <div className={styles.receiptHeader}><strong>{badge}</strong>
          <span>{t('verification.duration', { seconds: ((Date.parse(status.run.endedAt ?? new Date().toISOString()) - Date.parse(status.run.startedAt)) / 1000).toFixed(1) })}</span>
          <Button variant="ghost" disabled={running || busy || agentBusy} onClick={() => { void download(); }}>{t('verification.export')}</Button>
        </div>
        <p className={styles.scope}>{t('verification.scope')}</p>
        {status.freshness === 'stale' ? <p className={styles.warning}>{t('verification.staleHint')}</p> : null}
        {status.run.state === 'passed' && !verified && status.freshness !== 'stale' ? <p className={styles.warning}>{status.run.sourceAfter?.reason ?? t('verification.unverifiedHint')}</p> : null}
        {status.run.error ? <p role="alert" className={styles.error}>{status.run.error}</p> : null}
        <ul className={styles.results}>{status.run.steps.map(step => <li key={step.check.id}>
          <details open={step.state === 'failed' || step.state === 'timed-out'}>
            <summary><span data-state={step.state}>{t(`verification.${step.state}`)}</span><code>{step.check.command} {step.check.args.join(' ')}</code>
              {step.exitCode !== null ? <small>{t('verification.exit', { code: step.exitCode })}</small> : null}</summary>
            {step.output ? <pre>{step.output}</pre> : <p>{t('verification.noOutput')}</p>}
            {step.outputTruncated ? <p className={styles.warning}>{t('verification.truncated')}</p> : null}
          </details>
        </li>)}</ul>
        {!running && status.run.steps.some(s => s.state === 'failed' || s.state === 'timed-out') && onRequestRepair ? <Button disabled={busy} onClick={() => { void mutate('repair'); }}>{t('verification.repair')}</Button> : null}
        {repairReady ? <p role="status">{t('verification.repairReady')}</p> : null}
      </div> : null}
    </div> : null}
  </section>;
}
