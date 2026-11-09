'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import { REFERENCE_TAKES, referenceComparisonBlock, type ReferenceItem, type ReferenceTake } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import { fetchProjectFiles, projectRawUrl } from '../../providers/registry';
import { referencesApi } from './api';
import { TAKE_KEY } from './ReferenceCaptureDialog';
import { ReferenceComparePanel } from './ReferenceComparePanel';
import { ReferenceFlowPanel } from './ReferenceFlowPanel';
import styles from './ReferenceBoard.module.css';

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };

/**
 * The references kept in this project, on the built-in browser's start page. Pick some, say where they go and what
 * to do, and the request lands in the chat composer with the references' notes, screenshots and outlines and the
 * rules that keep it a pattern, not a copy. Without a composer the block is copied instead.
 */
export function ReferenceBoard({ projectId, onNavigate, onAppendToChat, onOpenFile }: {
  projectId: string;
  onNavigate: (url: string) => void;
  onAppendToChat?: (text: string, introIfEmpty?: string) => void;
  /** Opens a project file (the recorded flow opens in REA Studio). */
  onOpenFile?: (name: string) => void;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<ReferenceItem[] | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ id: string; note: string } | null>(null);
  const [applying, setApplying] = useState(false);
  const [recording, setRecording] = useState<string | null>(null);
  const [comparing, setComparing] = useState<string | null>(null);
  const scope = useRef(0);

  const load = useCallback(async () => {
    const current = ++scope.current;
    const result = await referencesApi.list(projectId);
    if (current !== scope.current) return;
    if (result.ok) { setItems(result.value.items); setError(''); return; }
    // The board is an optional part of the start page: without a daemon answer it stays hidden.
    if (result.network) { setItems(null); return; }
    setItems([]); setError(result.message);
  }, [projectId]);
  useEffect(() => { setSelected([]); setEditing(null); setApplying(false); setRecording(null); setComparing(null); setStatus(''); void load(); }, [load]);

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  async function remove(item: ReferenceItem) {
    if (!window.confirm(t('references.board.removeConfirm'))) return;
    const result = await referencesApi.remove(projectId, item.id);
    if (!result.ok) { setError(result.message); return; }
    setSelected((current) => current.filter((id) => id !== item.id));
    await load();
  }

  async function saveNote() {
    if (!editing) return;
    const result = await referencesApi.update(projectId, editing.id, { note: editing.note });
    if (!result.ok) { setError(result.message); return; }
    setEditing(null);
    setItems((current) => current?.map((item) => item.id === result.value.item.id ? result.value.item : item) ?? current);
  }

  if (items === null) return null;
  const chosen = items.filter((item) => selected.includes(item.id));
  const recordingItem = items.find((item) => item.id === recording);
  const comparingItem = items.find((item) => item.id === comparing);
  const replace = (updated: ReferenceItem) => setItems((current) => current?.map((item) => item.id === updated.id ? updated : item) ?? current);
  return <section className={styles.root} aria-label={t('references.board.title')} data-testid="reference-board">
    <div className={styles.heading}>
      <div>
        <h3>{t('references.board.title')} <span className={styles.count}>{t('references.board.count', { count: items.length })}</span></h3>
        <p>{t('references.board.intro')}</p>
      </div>
      {items.length ? <Button disabled={chosen.length === 0} onClick={() => { setApplying(true); setStatus(''); }} data-testid="reference-board-apply">
        {t('references.board.applySelected', { count: chosen.length })}
      </Button> : null}
    </div>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {status ? <p className={styles.status} role="status">{status}</p> : null}
    {applying && chosen.length ? <ReferenceApplyForm projectId={projectId} items={chosen} onAppendToChat={onAppendToChat}
      onCancel={() => setApplying(false)} onDone={(message) => { setApplying(false); setStatus(message); setSelected([]); }} /> : null}
    {recordingItem ? <ReferenceFlowPanel key={recordingItem.id} projectId={projectId} item={recordingItem} onClose={() => setRecording(null)}
      onRecorded={replace} {...(onAppendToChat ? { onAppendToChat } : {})} {...(onOpenFile ? { onOpenFile } : {})} /> : null}
    {comparingItem ? <ReferenceComparePanel key={comparingItem.id} projectId={projectId} item={comparingItem} onClose={() => setComparing(null)}
      onCompared={replace} {...(onAppendToChat ? { onAppendToChat } : {})} {...(onOpenFile ? { onOpenFile } : {})} /> : null}
    {items.length === 0 ? <p className={styles.empty}>{t('references.board.empty')}</p> : <ul className={styles.cards}>
      {items.map((item) => <li key={item.id} className={styles.card} data-selected={selected.includes(item.id) || undefined}>
        <button type="button" className={styles.thumb} onClick={() => onNavigate(item.url)} title={t('references.board.open')}>
          {item.screenshot || item.flow?.screenshot
            ? <img src={projectRawUrl(projectId, item.screenshot?.file ?? item.flow!.screenshot!)} alt="" loading="lazy" />
            : <span>{t('references.board.noScreenshot')}</span>}
        </button>
        <div className={styles.body}>
          <label className={styles.select}>
            <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} aria-label={t('references.board.select')} />
            <strong title={item.title}>{item.title}</strong>
          </label>
          <span className={styles.host}>{hostOf(item.url)}</span>
          <span className={styles.takes}>{item.takes.map((take) => <span key={take} className={styles.chip}>{t(TAKE_KEY[take])}</span>)}</span>
          {editing?.id === item.id
            ? <span className={styles.noteEdit}>
                <textarea rows={2} maxLength={2000} value={editing.note} onChange={(event) => setEditing({ id: item.id, note: event.target.value })} aria-label={t('references.noteLabel')} />
                <Button variant="ghost" onClick={() => void saveNote()}>{t('common.save')}</Button>
              </span>
            : item.note ? <p className={styles.note}>{item.note}</p> : null}
          {item.flow ? <span className={styles.flow}>
              {t('references.flow.summary', { completed: item.flow.completed, total: item.flow.total, count: item.flow.apiCalls.length })}
              {onOpenFile ? <Button variant="ghost" onClick={() => onOpenFile(item.flow!.file)}>{t('references.flow.openStudio')}</Button> : null}
            </span> : null}
          {item.remake ? <span className={styles.flow} data-testid="reference-card-remake">
              {t('references.compare.summary', { pass: item.remake.comparison.summary.pass, total: item.remake.comparison.summary.total })}
              {onAppendToChat && referenceComparisonBlock(item)
                ? <Button variant="ghost" onClick={() => { onAppendToChat(referenceComparisonBlock(item), t('references.compare.chatIntro')); setStatus(t('references.compare.toChatDone')); }}>
                    {t('references.compare.toChat')}
                  </Button>
                : null}
            </span> : null}
          <span className={styles.actions}>
            <Button variant="ghost" onClick={() => onNavigate(item.url)}>{t('references.board.open')}</Button>
            <Button variant="ghost" onClick={() => { setRecording(item.id); setComparing(null); setApplying(false); setStatus(''); }} data-testid="reference-flow-open">{t('references.flow.record')}</Button>
            {item.flow ? <Button variant="ghost" onClick={() => { setComparing(item.id); setRecording(null); setApplying(false); setStatus(''); }} data-testid="reference-compare-open">{t('references.compare.open')}</Button> : null}
            <Button variant="ghost" onClick={() => setEditing({ id: item.id, note: item.note })}>{t('references.board.editNote')}</Button>
            <Button variant="ghost" onClick={() => void remove(item)}>{t('common.delete')}</Button>
          </span>
        </div>
      </li>)}
    </ul>}
  </section>;
}

function ReferenceApplyForm({ projectId, items, onAppendToChat, onCancel, onDone }: {
  projectId: string;
  items: ReferenceItem[];
  onAppendToChat?: (text: string, introIfEmpty?: string) => void;
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const { t } = useI18n();
  const initialTakes = useMemo(() => REFERENCE_TAKES.filter((take) => items.some((item) => item.takes.includes(take))), [items]);
  const [target, setTarget] = useState('');
  const [request, setRequest] = useState('');
  const [takes, setTakes] = useState<ReferenceTake[]>(initialTakes);
  const [withScreenshot, setWithScreenshot] = useState(true);
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    void fetchProjectFiles(projectId).then((list) => {
      if (live) setFiles(list.map((file) => file.name).filter((name) => !name.startsWith('references/')).slice(0, 500));
    }).catch(() => undefined);
    return () => { live = false; };
  }, [projectId]);

  const toggle = (take: ReferenceTake) => setTakes((current) => current.includes(take)
    ? (current.length > 1 ? current.filter((item) => item !== take) : current)
    : REFERENCE_TAKES.filter((item) => item === take || current.includes(item)));

  async function submit() {
    setBusy(true); setError('');
    const result = await referencesApi.apply(projectId, { referenceIds: items.map((item) => item.id), target, request, takes, includeScreenshot: withScreenshot });
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    const stale = result.value.screenshots.filter((shot) => shot.state !== 'verified').map((shot) => shot.file);
    const warning = stale.length ? ` ${t('references.apply.screenshotChanged', { files: stale.join(', ') })}` : '';
    if (onAppendToChat) {
      onAppendToChat(result.value.block, t('references.apply.intro'));
      onDone(`${t('references.apply.done')}${warning}`);
      return;
    }
    try { await navigator.clipboard.writeText(result.value.block); onDone(`${t('references.apply.copied')}${warning}`); }
    catch { setError(t('references.failed')); }
  }

  return <div className={styles.apply} data-testid="reference-apply-form">
    <strong>{t('references.apply.title')}</strong>
    <label className={styles.field}>{t('references.apply.target')}
      <input list={`reference-targets-${projectId}`} value={target} maxLength={1024} placeholder={t('references.apply.targetPlaceholder')} onChange={(event) => setTarget(event.target.value)} />
      <datalist id={`reference-targets-${projectId}`}>{files.map((name) => <option key={name} value={name} />)}</datalist>
    </label>
    <label className={styles.field}>{t('references.apply.request')}
      <textarea rows={3} maxLength={4000} value={request} placeholder={t('references.apply.requestPlaceholder')} onChange={(event) => setRequest(event.target.value)} />
    </label>
    <fieldset className={styles.takeSet}>
      <legend>{t('references.takesLabel')}</legend>
      {REFERENCE_TAKES.map((take) => <label key={take}><input type="checkbox" checked={takes.includes(take)} onChange={() => toggle(take)} />{t(TAKE_KEY[take])}</label>)}
    </fieldset>
    <label className={styles.check}><input type="checkbox" checked={withScreenshot} onChange={(event) => setWithScreenshot(event.target.checked)} />{t('references.apply.includeScreenshot')}</label>
    <p className={styles.hint}>{t('references.apply.rules')}</p>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <div className={styles.formActions}>
      <Button variant="ghost" onClick={onCancel} disabled={busy}>{t('common.cancel')}</Button>
      <Button onClick={() => void submit()} disabled={busy} data-testid="reference-apply-submit">{onAppendToChat ? t('references.apply.submit') : t('references.apply.copy')}</Button>
    </div>
  </div>;
}
