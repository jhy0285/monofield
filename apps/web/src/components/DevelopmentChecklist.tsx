import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button, VisuallyHidden } from '@open-design/components';

import { useT } from '../i18n';
import { Icon } from './Icon';
import styles from './DevelopmentChecklist.module.css';

export type DevelopmentChecklistItem = 'project' | 'run' | 'changes' | 'verify';
export const DEVELOPMENT_CHECKLIST_ITEMS: readonly DevelopmentChecklistItem[] = ['project', 'run', 'changes', 'verify'];

type Stored = { done: DevelopmentChecklistItem[]; hidden: boolean };

const STORAGE_PREFIX = 'monofield:development-checklist:v1:';

function read(projectId: string | null): Stored {
  const empty: Stored = { done: [], hidden: false };
  if (!projectId) return empty;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + projectId);
    const parsed = raw ? JSON.parse(raw) as Partial<Stored> : null;
    if (!parsed || !Array.isArray(parsed.done)) return empty;
    return {
      done: parsed.done.filter((item): item is DevelopmentChecklistItem => DEVELOPMENT_CHECKLIST_ITEMS.includes(item as DevelopmentChecklistItem)),
      hidden: parsed.hidden === true,
    };
  } catch {
    return empty;
  }
}

function write(projectId: string | null, value: Stored): void {
  if (!projectId) return;
  try { window.localStorage.setItem(STORAGE_PREFIX + projectId, JSON.stringify(value)); } catch { /* per-viewer convenience only */ }
}

/**
 * Per-project progress of the first-run checklist. Each item is ticked by the
 * real thing happening (a project was detected, the app became ready, the
 * changes view was opened, a verification run passed), never by the person
 * clicking a box. Browser storage only: it is a convenience, so a failed read
 * simply starts the list over.
 */
export function useDevelopmentChecklist(projectId: string | null) {
  const [state, setState] = useState<Stored>(() => read(projectId));
  const latest = useRef(state);
  useEffect(() => {
    const next = read(projectId);
    latest.current = next;
    setState(next);
  }, [projectId]);
  const mark = useCallback((item: DevelopmentChecklistItem) => {
    const current = latest.current;
    if (current.done.includes(item)) return;
    const next = { ...current, done: [...current.done, item] };
    latest.current = next;
    setState(next);
    write(projectId, next);
  }, [projectId]);
  const hide = useCallback(() => {
    const next = { ...latest.current, hidden: true };
    latest.current = next;
    setState(next);
    write(projectId, next);
  }, [projectId]);
  return { done: state.done, hidden: state.hidden, mark, hide };
}

const LABEL = {
  project: 'development.checklist.project',
  run: 'development.checklist.run',
  changes: 'development.checklist.changes',
  verify: 'development.checklist.verify',
} as const;
const HINT = {
  project: 'development.checklist.projectHint',
  run: 'development.checklist.runHint',
  changes: 'development.checklist.changesHint',
  verify: 'development.checklist.verifyHint',
} as const;
const ACTION = {
  run: 'development.checklist.runAction',
  changes: 'development.checklist.changesAction',
  verify: 'development.checklist.verifyAction',
} as const;

/**
 * A small "getting started" chip for the development dock. It stays out of the
 * way (no automatic pop-up) and shows how far along the first run is; the
 * popover lists what is left with a button for each step.
 */
export function DevelopmentChecklist({ done, onAction, onHide }: {
  done: readonly DevelopmentChecklistItem[];
  onAction: (item: Exclude<DevelopmentChecklistItem, 'project'>) => void;
  onHide: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement | null>(null);
  const total = DEVELOPMENT_CHECKLIST_ITEMS.length;
  const count = DEVELOPMENT_CHECKLIST_ITEMS.filter((item) => done.includes(item)).length;
  const complete = count === total;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && event.target instanceof Node && !root.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={root} data-testid="development-checklist">
      <button
        type="button"
        className={styles.chip}
        data-complete={complete ? 'true' : 'false'}
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="development-checklist-toggle"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={complete ? 'check' : 'sparkles'} size={12} />
        <span>{t('development.checklist.title')}</span>
        <span className={styles.count}>{t('development.checklist.progress', { done: count, total })}</span>
      </button>
      {open ? (
        <div className={styles.panel} id={panelId} role="group" aria-label={t('development.checklist.title')}>
          <ol className={styles.list}>
            {DEVELOPMENT_CHECKLIST_ITEMS.map((item) => {
              const finished = done.includes(item);
              return (
                <li key={item} className={styles.item} data-done={finished ? 'true' : 'false'}>
                  <span className={styles.mark} aria-hidden="true">{finished ? <Icon name="check" size={11} /> : null}</span>
                  <span className={styles.text}>
                    <strong>{t(LABEL[item])}</strong>
                    <small>{t(HINT[item])}</small>
                    <VisuallyHidden>{finished ? t('development.checklist.done') : t('development.checklist.todo')}</VisuallyHidden>
                  </span>
                  {!finished && item !== 'project' ? (
                    <Button variant="ghost" onClick={() => { setOpen(false); onAction(item); }}>{t(ACTION[item])}</Button>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <div className={styles.footer}>
            <small>{complete ? t('development.checklist.complete') : t('development.checklist.autoHint')}</small>
            <Button variant="ghost" onClick={() => { setOpen(false); onHide(); }}>{t('development.checklist.hide')}</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
