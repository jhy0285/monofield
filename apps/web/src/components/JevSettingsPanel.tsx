import { useEffect, useState } from 'react';
import type { JevConfig, JevEvaluation, JevModelsResponse, JevStatus } from '@open-design/contracts';
import { useT } from '../i18n';

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message ?? `HTTP ${response.status}`);
  return value as T;
}

export function JevSettingsPanel() {
  const t = useT();
  const [status, setStatus] = useState<JevStatus | null>(null);
  const [config, setConfig] = useState<JevConfig | null>(null);
  const [key, setKey] = useState('');
  const [state, setState] = useState('');
  const [models, setModels] = useState<JevModelsResponse | null>(null);
  const [result, setResult] = useState<JevEvaluation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    request<JevStatus>('/api/jev/status').then(s => { if (active) { setStatus(s); setConfig(s.config); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  const perform = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const refresh = async () => { const s = await request<JevStatus>('/api/jev/status'); setStatus(s); setConfig(s.config); };
  const dirty = JSON.stringify(config) !== JSON.stringify(status?.config);
  return <section className="jev-panel settings-section" data-testid="jev-panel" aria-labelledby="jev-title">
    <header><h2 id="jev-title">{t('jev.title')}</h2><p className="hint">{t('jev.description')}</p></header>
    {config ? <>
      <fieldset disabled={busy} className="jev-panel__fields">
        <label>{t('jev.backend')}<select data-testid="jev-backend" value={config.backend} onChange={e => {
          const backend = e.target.value as JevConfig['backend'];
          setConfig({ ...config, backend, model: backend === 'local' ? 'multilingual' : 'jev-latest' }); setModels(null); setResult(null);
        }}><option value="typesafe">{t('jev.hosted')}</option><option value="local">{t('jev.local')}</option></select></label>
        <p className="hint">{config.backend === 'local' ? t('jev.localHelp') : t('jev.hostedHelp')}</p>
        {config.backend === 'local' ? <label>{t('jev.url')}<input data-testid="jev-local-url" value={config.localBaseUrl} onChange={e => setConfig({ ...config, localBaseUrl: e.target.value })} /></label> :
          <label>{t('jev.key')}<input type="password" autoComplete="off" data-testid="jev-api-key" value={key} placeholder={status?.apiKeyTail ? `••••${status.apiKeyTail}` : ''} onChange={e => setKey(e.target.value)} /></label>}
        <label>{t('jev.model')}<input data-testid="jev-model" value={config.model} onChange={e => setConfig({ ...config, model: e.target.value })} list="jev-models" /><datalist id="jev-models">{models?.models.map(m => <option key={m.name} value={m.name}>{m.description}</option>)}</datalist></label>
        <div className="jev-panel__actions">
          <button type="button" className="btn btn-primary" data-testid="jev-save" onClick={() => void perform(async () => {
            // Validate configuration before changing encrypted credentials.
            await request('/api/jev/config', 'PUT', config);
            if (config.backend === 'typesafe' && key.trim()) { await request('/api/byok/credentials', 'PUT', { credentials: { typesafe: key.trim() } }); setKey(''); }
            await refresh(); setResult(null); setModels(null); setNotice(t('jev.saved'));
          })}>{t('jev.save')}</button>
          <button type="button" className="btn" data-testid="jev-test" disabled={dirty || !status?.ready} onClick={() => void perform(async () => { const m = await request<JevModelsResponse>('/api/jev/models'); setModels(m); setNotice(t('jev.connected', { count: m.models.length })); })}>{t('jev.test')}</button>
          {status?.credentialSource === 'stored' ? <button type="button" className="btn" data-testid="jev-clear-key" onClick={() => void perform(async () => { await request('/api/byok/credentials', 'PUT', { credentials: { typesafe: '' } }); setKey(''); await refresh(); setResult(null); setModels(null); })}>{t('jev.clearKey')}</button> : null}
        </div>
      </fieldset>
      {status?.config.backend === 'typesafe' && !status.ready ? <p className="hint" data-testid="jev-auth-required">{t('jev.missingKey')}</p> : null}
      <div className="jev-panel__evaluate">
        <label>{t('jev.input')}<textarea rows={3} data-testid="jev-state" value={state} onChange={e => { setState(e.target.value); setResult(null); }} placeholder={t('jev.placeholder')} disabled={busy} /></label>
        <button type="button" className="btn" data-testid="jev-evaluate" disabled={busy || dirty || !status?.ready || !state.trim()} onClick={() => void perform(async () => { setResult(null); setResult(await request<JevEvaluation>('/api/jev/triage', 'POST', { state })); })}>{busy ? t('jev.running') : t('jev.evaluate')}</button>
      </div>
      {result ? <div data-testid="jev-result" className="jev-panel__result">
        <p>{result.backend === 'local' ? t('jev.local') : t('jev.hosted')} · {result.requestedModel} · {result.elapsedMs} ms</p>
        <dl>{Object.entries(result.result.answers).map(([id, answer]) => <div key={id}><dt>{id === 'kind' ? t('jev.kind') : id === 'risk' ? t('jev.risk') : t('jev.clarification')}</dt><dd>{answer.type === 'choice' ? `${answer.choice} (${Math.round(answer.confidence * 100)}%)` : answer.type === 'score' ? `${answer.score.toFixed(2)} / 2` : `${Math.round(answer.noul * 100)}%`}</dd></div>)}</dl>
        <p className="hint">{t('jev.usage', { input: result.result.usage.input_tokens, output: result.result.usage.output_tokens })}</p>
        <p className="hint">{t('jev.advisory')}</p>
        <details><summary>{t('jev.raw')}</summary><pre>{JSON.stringify(result.result, null, 2)}</pre></details>
      </div> : null}
    </> : null}
    {error ? <p role="alert" data-testid="jev-error">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </section>;
}
