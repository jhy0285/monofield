'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import { REFERENCE_TAKES, type ReferenceItem, type ReferenceTake } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import { referencesApi } from './api';
import styles from './ReferenceCaptureDialog.module.css';

export const TAKE_KEY = {
  structure: 'references.take.structure', flow: 'references.take.flow', fields: 'references.take.fields', interaction: 'references.take.interaction',
} as const satisfies Record<ReferenceTake, string>;

/** Positions the dialog under the toolbar button that opens it. */
export const referenceAnchorClass = styles.anchor;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/**
 * "Keep as reference" for the page open in the built-in browser. The screenshot and the structure outline come from
 * the desktop webview; without it (the web fallback) only the address and the note are kept. The dialog hides itself
 * while the screenshot is taken, because the desktop capture records the window region the page occupies.
 */
export function ReferenceCaptureDialog({ projectId, url, title, canCapture, capture, readOutline, onClose, onSaved }: {
  projectId: string;
  url: string;
  title: string;
  canCapture: boolean;
  capture: () => Promise<string | null>;
  readOutline: () => Promise<unknown>;
  onClose: () => void;
  onSaved: (item: ReferenceItem) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(title);
  const [note, setNote] = useState('');
  const [takes, setTakes] = useState<ReferenceTake[]>(['structure']);
  const [withScreenshot, setWithScreenshot] = useState(canCapture);
  const [phase, setPhase] = useState<'edit' | 'capturing' | 'saving'>('edit');
  const [error, setError] = useState('');
  const noteRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => { noteRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && phase === 'edit') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, phase]);

  const toggle = (take: ReferenceTake) => setTakes((current) => current.includes(take)
    ? (current.length > 1 ? current.filter((item) => item !== take) : current)
    : REFERENCE_TAKES.filter((item) => item === take || current.includes(item)));

  async function save() {
    setError('');
    let screenshotBase64: string | undefined;
    let outline: unknown;
    if (canCapture) {
      try { outline = await readOutline(); } catch { outline = undefined; }
      if (withScreenshot) {
        setPhase('capturing');
        await nextFrame();
        const dataUrl = await capture().catch(() => null);
        screenshotBase64 = dataUrl ? dataUrl.split(',', 2)[1] : undefined;
      }
    }
    setPhase('saving');
    const result = await referencesApi.add(projectId, {
      url, title: name, note, takes, source: 'browser',
      ...(screenshotBase64 ? { screenshotBase64 } : {}),
      ...(outline !== undefined ? { outline } : {}),
    });
    if (!result.ok) { setPhase('edit'); setError(result.message || t('references.failed')); return; }
    onSaved(result.value.item);
  }

  return <div className={styles.popover} role="dialog" aria-label={t('references.keep')} hidden={phase === 'capturing'} data-testid="reference-capture-dialog">
    <strong className={styles.title}>{t('references.keep')}</strong>
    <label className={styles.field}>{t('references.titleLabel')}
      <input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
    </label>
    <label className={styles.field}>{t('references.noteLabel')}
      <textarea ref={noteRef} rows={3} maxLength={2000} value={note} placeholder={t('references.notePlaceholder')} onChange={(event) => setNote(event.target.value)} />
    </label>
    <fieldset className={styles.takes}>
      <legend>{t('references.takesLabel')}</legend>
      {REFERENCE_TAKES.map((take) => <label key={take} className={styles.take}>
        <input type="checkbox" checked={takes.includes(take)} onChange={() => toggle(take)} />{t(TAKE_KEY[take])}
      </label>)}
    </fieldset>
    {canCapture
      ? <label className={styles.check}><input type="checkbox" checked={withScreenshot} onChange={(event) => setWithScreenshot(event.target.checked)} />{t('references.includeScreenshot')}</label>
      : <p className={styles.hint}>{t('references.desktopOnly')}</p>}
    <p className={styles.hint}>{t('references.privacy')}</p>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <div className={styles.actions}>
      <Button variant="ghost" onClick={onClose} disabled={phase !== 'edit'}>{t('common.cancel')}</Button>
      <Button onClick={() => void save()} disabled={phase !== 'edit'} data-testid="reference-capture-save">{phase === 'edit' ? t('references.save') : t('references.saving')}</Button>
    </div>
  </div>;
}
