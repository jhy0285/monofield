export const DEV_DOCK_MIN_HEIGHT = 96;
export const DEV_DOCK_HEIGHT_STORAGE_KEY = 'monofield:layout:development-dock-height';

export interface DevelopmentDockBounds {
  min: number;
  max: number;
  /** Height used until a person resizes the dock: a third of the window, within 240–420px. */
  defaultHeight: number;
  /** Height of the "expand" toggle: just over half the window, up to 660px. */
  expandedHeight: number;
}

export function developmentDockBounds(viewportHeight: number): DevelopmentDockBounds {
  const min = DEV_DOCK_MIN_HEIGHT;
  const max = Math.max(min, Math.round(viewportHeight * 0.7));
  return {
    min,
    max,
    defaultHeight: Math.min(max, Math.min(420, Math.max(240, Math.round(viewportHeight * 0.34)))),
    expandedHeight: Math.min(max, Math.min(660, Math.round(viewportHeight * 0.58))),
  };
}

/** The dock content height to render: the expanded preset, a saved size, or the default, kept in range. */
export function resolveDockHeight(
  bounds: DevelopmentDockBounds,
  stored: number | null,
  expanded: boolean,
): number {
  if (expanded) return bounds.expandedHeight;
  const wanted = stored ?? bounds.defaultHeight;
  return Math.min(bounds.max, Math.max(bounds.min, wanted));
}
