'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, Splitter } from '@open-design/components';
import { usePersistentSize } from '../../hooks/usePersistentSize';
import { useViewportHeight } from '../../hooks/useViewportHeight';
import { useT } from '../../i18n';
import { Icon } from '../Icon';
import styles from './DevelopmentToolsDock.module.css';
import { DEV_DOCK_HEIGHT_STORAGE_KEY, developmentDockBounds, resolveDockHeight } from './developmentDockSize';

export type DevelopmentTool = 'changes' | 'terminal' | 'logs' | 'impact';
const tools: DevelopmentTool[] = ['changes', 'terminal', 'logs', 'impact'];
const labels = { changes: 'gitChanges.title', terminal: 'development.dock.terminal', logs: 'development.logs', impact: 'development.dock.impact' } as const;
const testIds = { changes: 'development-open-changes', terminal: 'development-open-terminal', logs: 'development-server-logs-toggle', impact: 'development-open-impact' } as const;

/** One tool surface below the editor. Visited tools retain their UI/session state. */
export function DevelopmentToolsDock({ active, onSelect, renderPanel }: {
  active: DevelopmentTool | null;
  onSelect: (tool: DevelopmentTool | null) => void;
  renderPanel: (tool: DevelopmentTool, visible: boolean) => ReactNode;
}) {
  const t = useT(), id = useId();
  const [visited, setVisited] = useState<DevelopmentTool[]>([]);
  const [expanded, setExpanded] = useState(false);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const size = usePersistentSize(DEV_DOCK_HEIGHT_STORAGE_KEY);
  const bounds = developmentDockBounds(useViewportHeight());
  const height = resolveDockHeight(bounds, size.stored, expanded);
  useEffect(() => { if (active) setVisited(current => current.includes(active) ? current : [...current, active]); }, [active]);
  return <section className={styles.dock} data-testid="development-tools-dock" aria-label={t('development.dock.title')}>
    {active ? <Splitter className={styles.splitter} orientation="horizontal" resizes="after"
      label={t('development.dock.resize')} value={height} min={bounds.min} max={bounds.max}
      defaultValue={bounds.defaultHeight} data-testid="development-dock-resizer"
      onChange={next => { setExpanded(false); size.preview(next); }}
      onCommit={next => { if (next === bounds.defaultHeight) size.reset(); else size.commit(next); }} /> : null}
    <div className={styles.toolbar}>
      <div role="tablist" aria-label={t('development.dock.title')} className={styles.tabs}>
        {tools.map((tool, index) => <button key={tool} ref={element => { buttons.current[index] = element; }}
          type="button" role="tab" id={`${id}-${tool}-tab`} aria-controls={`${id}-${tool}`} aria-selected={active === tool}
          tabIndex={active === null || active === tool ? 0 : -1} data-testid={testIds[tool]}
          onClick={() => onSelect(active === tool ? null : tool)}
          onKeyDown={event => {
            let next: number | undefined;
            if (event.key === 'ArrowRight') next = (index + 1) % tools.length;
            if (event.key === 'ArrowLeft') next = (index + tools.length - 1) % tools.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = tools.length - 1;
            if (next !== undefined) { event.preventDefault(); buttons.current[next]?.focus(); }
            if (event.key === 'Escape' && active) { event.preventDefault(); onSelect(null); }
          }}>{t(labels[tool])}</button>)}
      </div>
      {active ? <div className={styles.actions}>
        <Button variant="ghost" size="icon" aria-label={t(expanded ? 'development.dock.shrink' : 'development.dock.expand')}
          onClick={() => setExpanded(value => !value)}><Icon name={expanded ? 'chevron-down' : 'maximize'} size={14} /></Button>
        <Button variant="ghost" size="icon" aria-label={t('development.dock.close')} onClick={() => { buttons.current[tools.indexOf(active)]?.focus(); onSelect(null); }}><Icon name="close" size={14} /></Button>
      </div> : null}
    </div>
    {visited.map(tool => <div key={tool} id={`${id}-${tool}`} role="tabpanel" aria-labelledby={`${id}-${tool}-tab`}
      hidden={active !== tool} className={styles.content} style={{ height }}>
      {renderPanel(tool, active === tool)}
    </div>)}
  </section>;
}
