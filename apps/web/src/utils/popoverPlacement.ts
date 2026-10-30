export interface PopoverTriggerRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface PopoverPlacement {
  placement: 'up' | 'down';
  /** Set when the popover opens below the trigger. */
  top?: number;
  /** Set when it opens above, measured from the bottom of the window. */
  bottom?: number;
  left: number;
  width: number;
  /** The most height the popover may take; its content scrolls inside it. */
  maxHeight: number;
}

const GAP = 6;
const MARGIN = 12;
const PREFERRED_HEIGHT = 420;

/**
 * Where a dropdown should open so it stays inside the window. It opens on the
 * trigger's roomier side when the preferred side is short, and its height is the
 * space actually available there. A floor on that height would draw a box that
 * runs off a short window, so there is none: the list scrolls inside instead.
 */
export function placePopover(
  trigger: PopoverTriggerRect,
  viewport: { width: number; height: number },
  options: { preferredHeight?: number } = {},
): PopoverPlacement {
  const preferred = options.preferredHeight ?? PREFERRED_HEIGHT;
  const width = Math.min(trigger.width, Math.max(0, viewport.width - 2 * MARGIN));
  const left = Math.max(MARGIN, Math.min(viewport.width - width - MARGIN, trigger.left));
  const spaceBelow = Math.max(0, viewport.height - trigger.bottom - GAP - MARGIN);
  const spaceAbove = Math.max(0, trigger.top - GAP - MARGIN);
  const openUp = spaceBelow < preferred && spaceAbove > spaceBelow;
  const maxHeight = Math.min(preferred, openUp ? spaceAbove : spaceBelow);
  return openUp
    ? { placement: 'up', bottom: viewport.height - trigger.top + GAP, left, width, maxHeight }
    : { placement: 'down', top: trigger.bottom + GAP, left, width, maxHeight };
}
