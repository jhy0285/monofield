import { useCallback, useEffect, useRef, useState } from 'react';
import type { DevelopmentVerificationResponse } from '@open-design/contracts';
import { useI18n } from '../i18n';
import styles from './DevelopmentVerification.module.css';

export function DevelopmentVerification({ projectId, projectPath, revision }: {
  projectId: string; projectPath?: string | null; revision?: number | string;
}) {
  const { locale } = useI18n();
  const ko = locale === 'ko';
  const [data, setData] = useState<DevelopmentVerificationResponse | null>(null);
  const [script, setScript] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const endpoint = '/api/projects/' + encodeURIComponent(projectId) + '/development/verification';
  const load = useCallback(async (start?: string) => {
    const id = ++request.current;
    setBusy(true);
    setError('');
    try {
      const query = projectPath ? '?' + new URLSearchParams({ projectPath }) : '';
      const response = await fetch(endpoint + (start ? '' : query), start ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: start, projectPath }),
      } : { cache: 'no-store' });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error?.message ?? 'HTTP ' + response.status);
      if (id !== request.current) return;
      setData(next);
      setScript(current => next.scripts?.includes(current) ? current : next.scripts?.[0] ?? '');
    } catch (cause) {
      if (id === request.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setData(null); // Never leave an old green result after a failed freshness check.
      }
    } finally { if (id === request.current) setBusy(false); }
  }, [endpoint, projectPath]);
  useEffect(() => {
    void load();
    const focus = () => void load();
    window.addEventListener('focus', focus);
    return () => { ++request.current; window.removeEventListener('focus', focus); };
  }, [load, revision]);
  const running = data?.run?.state === 'running';
  useEffect(() => {
    if (!running || busy) return;
    const timer = window.setTimeout(() => void load(), 1_000);
    return () => window.clearTimeout(timer);
  }, [running, busy, load]);
  const run = data?.run;
  const freshness = data?.freshness;
  return <section className={styles.root} aria-label={ko ? '변경사항 검증' : 'Verify changes'} data-testid="development-verification">
    <div className={styles.controls}>
      <strong>{ko ? '검증' : 'Verification'}</strong>
      <select aria-label={ko ? '검증 명령' : 'Verification command'} value={script} disabled={busy || running || !data?.scripts?.length} onChange={event => setScript(event.target.value)}>
        {!data?.scripts?.length && <option value="">{ko ? '지원하는 package.json 스크립트 없음' : 'No supported package.json scripts'}</option>}
        {data?.scripts?.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
      <button type="button" disabled={busy || running || !script} onClick={() => void load(script)}>{running ? (ko ? '실행 중…' : 'Running…') : (ko ? '실행' : 'Run')}</button>
      <button type="button" disabled={busy || running} onClick={() => void load()}>{ko ? '결과 새로고침' : 'Refresh result'}</button>
    </div>
    <small>{ko ? '로컬 프로젝트의 스크립트를 실행합니다 · 최대 2분 · 현재 앱 세션의 결과' : 'Runs a local project script · 2 minute limit · Results for this app session'}</small>
    {error && <p role="alert">{error}</p>}
    {run && <details className={styles.result}>
      <summary>
        <span>{run.command} · {run.state === 'running' ? (ko ? '실행 중' : 'Running') : (ko ? '종료 코드 ' : 'Exit code ') + (run.exitCode ?? '—')}</span>
        <strong data-testid="verification-freshness">
          {busy ? (ko ? '확인 중…' : 'Checking…') : run.state === 'running' ? ''
            : freshness === 'stale' ? (ko ? '소스 변경됨 · 다시 검증 필요' : 'Source changed · Rerun required')
            : freshness === 'unknown' ? (ko ? '소스 일치 여부 확인 불가' : 'Source match unknown')
            : run.state === 'passed' ? (ko ? '현재 소스에서 성공' : 'Passed on current source') : (ko ? '현재 소스에서 실패' : 'Failed on current source')}
        </strong>
      </summary>
      <small>{new Date(run.startedAt).toLocaleString()} · {run.sourceFingerprint?.slice(0, 12) ?? (ko ? 'Git 소스 확인 불가' : 'Git source unavailable')}</small>
      <pre>{run.output || (ko ? '출력 대기 중…' : 'Waiting for output…')}{run.truncated ? '\n[Output truncated]' : ''}</pre>
    </details>}
  </section>;
}
