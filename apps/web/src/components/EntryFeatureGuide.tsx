import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@open-design/components';
import { useT } from '../i18n';
import { Icon } from './Icon';
import styles from './EntryFeatureGuide.module.css';

export type EntryFeatureGuideId =
  | 'navigation'
  | 'new-project'
  | 'projects'
  | 'open-work'
  | 'design-systems'
  | 'tasks'
  | 'plugins'
  | 'integrations'
  | 'settings-overview'
  | 'settings-memory'
  | 'settings-media'
  | 'settings-review'
  | 'settings-pet'
  | 'settings-database'
  | 'settings-dictionaries';

const STORAGE_KEY = 'monofield:entry-feature-guides:v1';
const SPOTLIGHT_PADDING = 10;
const CALLOUT_WIDTH = 360;
const CALLOUT_GAP = 16;

type SpotlightRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

type GuideCopy = {
  title: string;
  description: string;
  points: string[];
  selectors: string[];
};

function completedGuides(): Record<string, true> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => value === true),
    ) as Record<string, true>;
  } catch {
    return {};
  }
}

export function shouldOpenEntryFeatureGuide(feature: EntryFeatureGuideId): boolean {
  return completedGuides()[feature] !== true;
}

export function completeEntryFeatureGuide(feature: EntryFeatureGuideId): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...completedGuides(),
      [feature]: true,
    }));
  } catch {
    // The guide can still close when storage is unavailable.
  }
}

function guideCopy(feature: EntryFeatureGuideId, t: ReturnType<typeof useT>): GuideCopy {
  switch (feature) {
    case 'navigation':
      return {
        title: t('entry.featureGuide'),
        description: t('productTutorial.body'),
        points: [
          t('entry.navProjects'),
          t('entry.navOpenWork'),
          t('entry.navDesignSystems'),
          t('entry.navTasks'),
          t('entry.navPlugins'),
          t('entry.navIntegrations'),
        ],
        selectors: ['.entry-nav-rail.is-open .entry-nav-rail__group'],
      };
    case 'new-project':
      return {
        title: t('entry.navNewProject'),
        description: t('productTutorial.stepChooseBody'),
        points: [t('workMode.development'), t('workMode.creation'), t('newproj.create')],
        selectors: ['[data-testid="new-project-tabs"]', '[data-testid="work-mode-toggle"]'],
      };
    case 'projects':
      return {
        title: t('entry.navProjects'),
        description: `${t('designs.subRecent')} · ${t('designs.subYours')}`,
        points: [t('designs.searchPlaceholder'), t('designs.viewGrid'), t('designs.viewKanban')],
        selectors: ['[data-testid="projects-toolbar"]'],
      };
    case 'open-work':
      return {
        title: t('entry.navOpenWork'),
        description: t('openWork.lede'),
        points: [t('openWork.catalogTitle'), t('openWork.manage')],
        selectors: ['[data-testid="open-work-manage-plugins"]'],
      };
    case 'design-systems':
      return {
        title: t('entry.navDesignSystems'),
        description: t('productTutorial.creationStyleBody'),
        points: [t('newproj.designSystem'), t('designs.searchPlaceholder')],
        selectors: ['[data-testid="design-systems-create"]', '[data-testid="design-systems-tab"]'],
      };
    case 'tasks':
      return {
        title: t('entry.navTasks'),
        description: t('automations.lede'),
        points: [t('automations.newAutomation'), t('automations.run'), t('automations.yourAutomations')],
        selectors: ['[data-testid="automations-new"]'],
      };
    case 'plugins':
      return {
        title: t('entry.navPlugins'),
        description: t('pluginsView.lede'),
        points: [t('pluginsView.tab.installed'), t('pluginsView.tab.available'), t('pluginsView.tab.sources')],
        selectors: ['[data-testid="plugins-tab-installed"]'],
      };
    case 'integrations':
      return {
        title: t('entry.navIntegrations'),
        description: t('integrations.lede'),
        points: [t('integrations.tabLabel.mcp'), t('entry.tabConnectors'), t('entry.useEverywhereTitle')],
        selectors: ['[data-testid="integrations-tab-mcp"]'],
      };
    case 'settings-overview':
      return {
        title: t('settings.title'),
        description: t('settings.subtitle'),
        points: [
          t('settings.memory'),
          t('settings.mediaProviders'),
          t('settings.databaseTitle'),
          t('settings.dictionaryLibraryTitle'),
        ],
        selectors: ['.modal-settings .settings-sidebar'],
      };
    case 'settings-memory':
      return {
        title: t('settings.memory'),
        description: t('settings.memoryDescription'),
        points: [
          t('settings.memoryEnableLabel'),
          t('settings.memoryNew'),
          t('settings.memoryHooksTitle'),
        ],
        selectors: ['[data-settings-guide-target="memory"]'],
      };
    case 'settings-media':
      return {
        title: t('settings.mediaProviders'),
        description: t('settings.mediaProvidersHint'),
        points: [
          t('settings.mediaProviderApiKey'),
          t('settings.mediaProviderBaseUrl'),
          t('settings.mediaProviderReload'),
        ],
        selectors: ['[data-settings-guide-target="media"]'],
      };
    case 'settings-review':
      return {
        title: t('critiqueTheater.settingsNav'),
        description: t('critiqueTheater.settingsEnabledDescription'),
        points: [
          t('critiqueTheater.settingsEnabledLabel'),
          t('critiqueTheater.settingsEnabledProjectHint'),
        ],
        selectors: ['[data-settings-guide-target="critiqueTheater"]'],
      };
    case 'settings-pet':
      return {
        title: t('pet.title'),
        description: t('pet.subtitle'),
        points: [t('pet.tabBuiltIn'), t('pet.tabCustom'), t('pet.wake')],
        selectors: ['[data-settings-guide-target="pet"]'],
      };
    case 'settings-database':
      return {
        title: t('settings.databaseTitle'),
        description: t('settings.databaseDevelopmentHint'),
        points: [
          t('settings.databaseWriteDisabled'),
          t('settings.databaseWriteApproveEach'),
          t('settings.databaseTest'),
        ],
        selectors: ['[data-settings-guide-target="database"]'],
      };
    case 'settings-dictionaries':
      return {
        title: t('settings.dictionaryLibraryTitle'),
        description: t('settings.dictionaryLibrarySubtitle'),
        points: [
          t('dictionaryLibrary.add'),
          t('dictionaryLibrary.versions'),
          t('dictionaryLibrary.uploadVersion'),
        ],
        selectors: ['[data-settings-guide-target="dictionaries"]'],
      };
  }
}

function viewportBounds() {
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  return {
    left,
    top,
    right: left + (viewport?.width ?? window.innerWidth),
    bottom: top + (viewport?.height ?? window.innerHeight),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function findTarget(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const target = document.querySelector<HTMLElement>(selector);
    if (target && target.getBoundingClientRect().width > 0 && target.getBoundingClientRect().height > 0) return target;
  }
  return null;
}

function paddedRect(rect: DOMRect): SpotlightRect {
  const viewport = viewportBounds();
  const left = clamp(rect.left - SPOTLIGHT_PADDING, viewport.left + 6, viewport.right - 6);
  const top = clamp(rect.top - SPOTLIGHT_PADDING, viewport.top + 6, viewport.bottom - 6);
  const right = clamp(rect.right + SPOTLIGHT_PADDING, left, viewport.right - 6);
  const bottom = clamp(rect.bottom + SPOTLIGHT_PADDING, top, viewport.bottom - 6);
  return { top, right, bottom, left, width: right - left, height: bottom - top };
}

function calloutStyle(rect: SpotlightRect | null, height: number): CSSProperties {
  const viewport = viewportBounds();
  const width = Math.min(CALLOUT_WIDTH, viewport.right - viewport.left - 24);
  const minLeft = viewport.left + 12;
  const maxLeft = viewport.right - width - 12;
  const minTop = viewport.top + 12;
  const maxTop = viewport.bottom - height - 12;
  if (rect && rect.right + CALLOUT_GAP + width <= viewport.right - 12) {
    return { width, left: rect.right + CALLOUT_GAP, top: clamp(rect.top, minTop, maxTop) };
  }
  if (rect && rect.left - CALLOUT_GAP - width >= viewport.left + 12) {
    return { width, left: rect.left - CALLOUT_GAP - width, top: clamp(rect.top, minTop, maxTop) };
  }
  if (rect && rect.bottom + CALLOUT_GAP + height <= viewport.bottom - 12) {
    return { width, left: clamp(rect.left, minLeft, maxLeft), top: rect.bottom + CALLOUT_GAP };
  }
  if (rect && rect.top - CALLOUT_GAP - height >= viewport.top + 12) {
    return { width, left: clamp(rect.left, minLeft, maxLeft), top: rect.top - CALLOUT_GAP - height };
  }
  return {
    width,
    left: clamp(viewport.left + (viewport.right - viewport.left - width) / 2, minLeft, maxLeft),
    top: clamp(viewport.top + (viewport.bottom - viewport.top - height) / 2, minTop, maxTop),
  };
}

export function EntryFeatureGuide({
  feature,
  onClose,
}: {
  feature: EntryFeatureGuideId | null;
  onClose: () => void;
}) {
  const t = useT();
  const copy = useMemo(() => feature ? guideCopy(feature, t) : null, [feature, t]);
  const [targetRect, setTargetRect] = useState<SpotlightRect | null>(null);
  const [calloutHeight, setCalloutHeight] = useState(250);
  const calloutRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const updateTarget = useCallback(() => {
    if (!copy) return;
    const target = findTarget(copy.selectors);
    setTargetRect(target ? paddedRect(target.getBoundingClientRect()) : null);
  }, [copy]);

  useEffect(() => {
    if (!feature || !copy) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = findTarget(copy.selectors);
    target?.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    const frame = window.requestAnimationFrame(updateTarget);
    const settle = window.setTimeout(updateTarget, 260);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateTarget);
    if (target) resizeObserver?.observe(target);
    resizeObserver?.observe(document.documentElement);
    const mutationObserver = new MutationObserver(updateTarget);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', updateTarget);
    window.addEventListener('scroll', updateTarget, true);
    window.visualViewport?.addEventListener('resize', updateTarget);
    window.visualViewport?.addEventListener('scroll', updateTarget);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('resize', updateTarget);
      window.removeEventListener('scroll', updateTarget, true);
      window.visualViewport?.removeEventListener('resize', updateTarget);
      window.visualViewport?.removeEventListener('scroll', updateTarget);
      returnFocusRef.current?.focus({ preventScroll: true });
    };
  }, [copy, feature, updateTarget]);

  useEffect(() => {
    if (!feature) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      completeEntryFeatureGuide(feature);
      onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [feature, onClose]);

  useEffect(() => {
    const callout = calloutRef.current;
    if (!feature || !callout) return;
    const measure = () => setCalloutHeight(callout.getBoundingClientRect().height || 250);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(callout);
    return () => observer?.disconnect();
  }, [feature, copy]);

  if (!feature || !copy || typeof document === 'undefined') return null;
  const masks = targetRect
    ? [
        { top: 0, left: 0, right: 0, height: targetRect.top },
        { top: targetRect.top, left: 0, width: targetRect.left, height: targetRect.height },
        { top: targetRect.top, left: targetRect.right, right: 0, height: targetRect.height },
        { top: targetRect.bottom, left: 0, right: 0, bottom: 0 },
      ]
    : [{ inset: 0 }];
  const close = () => {
    completeEntryFeatureGuide(feature);
    onClose();
  };

  return createPortal(
    <div className={styles.tour} data-testid="entry-feature-guide" data-feature={feature}>
      {masks.map((mask, index) => <div key={index} className={styles.blind} style={mask} aria-hidden />)}
      {targetRect ? (
        <div className={styles.spotlight} data-testid="entry-feature-guide-spotlight" style={{
          top: targetRect.top,
          left: targetRect.left,
          width: targetRect.width,
          height: targetRect.height,
        }} aria-hidden />
      ) : null}
      <section
        ref={calloutRef}
        className={styles.callout}
        data-testid="entry-feature-guide-callout"
        style={calloutStyle(targetRect, calloutHeight)}
        role="dialog"
        aria-labelledby="entry-feature-guide-title"
        aria-describedby="entry-feature-guide-description"
      >
        <header>
          <span>{t('entry.featureGuide')}</span>
          <Button size="icon" variant="ghost" onClick={close} aria-label={t('common.close')} title={t('common.close')}>
            <Icon name="close" size={15} />
          </Button>
        </header>
        <div className={styles.copy}>
          <h2 id="entry-feature-guide-title">{copy.title}</h2>
          <p id="entry-feature-guide-description">{copy.description}</p>
          <ul>{copy.points.map((point) => <li key={point}>{point}</li>)}</ul>
        </div>
        <footer><Button variant="primary" onClick={close}>{t('common.close')}</Button></footer>
      </section>
    </div>,
    document.body,
  );
}
