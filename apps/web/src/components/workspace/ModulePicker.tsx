'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { DevelopmentWorkspaceProject } from '@open-design/contracts';
import { useT } from '../../i18n';
import { Icon } from '../Icon';
import styles from './ModulePicker.module.css';

export type ModuleState = 'idle' | 'loading' | 'starting' | 'ready' | 'failed';

/** A folder of a few modules is scanned by eye; beyond this a filter earns its row. */
const SEARCH_THRESHOLD = 8;

/** The build system a module is, read from its marker files; null for a bare Git folder. */
export function moduleKindLabel(markers: readonly string[]): string | null {
  const has = (name: string) => markers.includes(name);
  if (has('pom.xml')) return 'Maven';
  if (markers.some((marker) => /^(settings|build)\.gradle(\.kts)?$/.test(marker))) return 'Gradle';
  if (has('package.json')) return 'Node';
  if (has('go.mod') || has('go.work')) return 'Go';
  if (has('Cargo.toml')) return 'Rust';
  if (['pyproject.toml', 'Pipfile', 'requirements.txt', 'manage.py'].some(has)) return 'Python';
  if (markers.some((marker) => marker.toLowerCase().endsWith('.csproj'))) return '.NET';
  if (has('index.html')) return 'Static';
  return null;
}

function parentFolder(path: string): string | null {
  const index = path.lastIndexOf('/');
  return index > 0 ? path.slice(0, index) : null;
}

type Props = {
  projects: DevelopmentWorkspaceProject[];
  activePath: string;
  /** State shown on the closed trigger. */
  triggerState: ModuleState;
  stateOf: (path: string) => ModuleState;
  stateLabel: (state: ModuleState) => string;
  disabled?: boolean;
  menuId: string;
  onSelect: (path: string) => void;
};

/**
 * Chooses the active module of a development workspace. A folder holding many
 * projects is the normal case for SI work, so the list stays quiet (only a
 * module that is not stopped shows a status), says what each module is, and
 * grows a filter once it is too long to scan.
 */
export function ModulePicker({ projects, activePath, triggerState, stateOf, stateLabel, disabled, menuId, onSelect }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const searchable = projects.length >= SEARCH_THRESHOLD;

  const visible = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return projects;
    return projects.filter((project) => {
      const haystack = `${project.label} ${project.path} ${moduleKindLabel(project.markers) ?? ''}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  }, [projects, query]);

  const activeProject = projects.find((project) => project.path === activePath) ?? null;

  function close(restoreFocus: boolean) {
    setOpen(false);
    setQuery('');
    if (restoreFocus) triggerRef.current?.focus();
  }

  function select(path: string) {
    close(false);
    onSelect(path);
  }

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      if (searchRef.current) {
        searchRef.current.focus();
        return;
      }
      const active = itemRefs.current.get(activePath);
      active?.focus();
      active?.scrollIntoView?.({ block: 'nearest' });
    });
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', dismiss);
    };
    // Re-focusing on every active-path change would steal focus mid-selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    const inSearch = event.target === searchRef.current;
    if (inSearch && event.key === 'Enter') {
      event.preventDefault();
      if (visible[0]) select(visible[0].path);
      return;
    }
    if (visible.length === 0) return;
    const targetIndex = visible.findIndex((project) => itemRefs.current.get(project.path) === event.target);
    const focusAt = (index: number) => itemRefs.current.get(visible[index]!.path)?.focus();
    let handled = true;
    if (event.key === 'ArrowDown') {
      if (inSearch) focusAt(0);
      else focusAt((Math.max(targetIndex, 0) + 1) % visible.length);
    } else if (event.key === 'ArrowUp') {
      if (inSearch) handled = false;
      else if (targetIndex <= 0 && searchRef.current) searchRef.current.focus();
      else focusAt((Math.max(targetIndex, 0) - 1 + visible.length) % visible.length);
    } else if (event.key === 'Home' && !inSearch) {
      focusAt(0);
    } else if (event.key === 'End' && !inSearch) {
      focusAt(visible.length - 1);
    } else {
      handled = false;
    }
    if (handled) event.preventDefault();
  }

  return (
    <div className={styles.picker} ref={rootRef} onKeyDown={handleKeyDown}>
      <button
        type="button"
        ref={triggerRef}
        className={styles.trigger}
        data-testid="development-active-project"
        aria-label={t('workspaceTabs.project')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={`${activeProject?.path ?? activePath} · ${stateLabel(triggerState)}`}
        disabled={disabled}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <i className={styles.dot} data-state={triggerState} aria-hidden="true" />
        <span className={styles.name}>{activeProject?.label ?? activePath}</span>
        <span className={styles.count}>{projects.length}</span>
        <Icon name="chevron-down" size={12} />
      </button>
      {open ? (
        <div className={styles.popover}>
          {searchable ? (
            <label className={styles.search}>
              <Icon name="search" size={13} />
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder={t('common.search')}
                aria-label={t('common.search')}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          ) : null}
          <div id={menuId} className={styles.list} role="menu" aria-label={t('workspaceTabs.project')}>
            {visible.map((project) => {
              const state = stateOf(project.path);
              const checked = project.path === activePath;
              const kind = moduleKindLabel(project.markers);
              const folder = parentFolder(project.path);
              return (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={checked}
                  key={project.path}
                  className={styles.item}
                  data-state={state}
                  ref={(element) => {
                    if (element) itemRefs.current.set(project.path, element);
                    else itemRefs.current.delete(project.path);
                  }}
                  onClick={() => select(project.path)}
                >
                  <i className={styles.dot} data-state={state} aria-hidden="true" />
                  <span className={styles.text}>
                    <span className={styles.line}>
                      <strong>{project.label}</strong>
                      {kind ? <small className={styles.kind}>{kind}</small> : null}
                    </span>
                    {folder ? <small className={styles.folder}>{folder}</small> : null}
                  </span>
                  <span className={styles.end}>
                    {state !== 'idle' ? <em className={styles.status} data-state={state}>{stateLabel(state)}</em> : null}
                    {checked ? <Icon name="check" size={13} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
          {visible.length === 0 ? <p className={styles.empty} role="status">{t('quickSwitcher.noMatches')}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
