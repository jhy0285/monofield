import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

import { joinClassNames } from './class-names';
import styles from './splitter.module.css';

export type SplitterOrientation = 'vertical' | 'horizontal';

export interface SplitterProps {
  /**
   * Orientation of the separator line, as ARIA defines it. A `vertical` splitter
   * sits between side-by-side panes and is dragged left or right; a `horizontal`
   * one sits between stacked panes and is dragged up or down.
   */
  orientation: SplitterOrientation;
  /** Which neighbour the splitter resizes: the pane before it or the pane after it. */
  resizes: 'before' | 'after';
  /** Accessible name of the separator. */
  label: string;
  /** Current size, in pixels, of the pane being resized. */
  value: number;
  min: number;
  max: number;
  /** Size restored by Enter and by a double click. */
  defaultValue?: number;
  /** Pixels moved by an arrow key; Shift uses `largeStep`. */
  step?: number;
  largeStep?: number;
  onChange: (next: number) => void;
  /** Called once when a drag or a key press settles, so a caller can persist the size. */
  onCommit?: (value: number) => void;
  className?: string;
  'data-testid'?: string;
}

const DEFAULT_STEP = 16;
const DEFAULT_LARGE_STEP = 64;

function clamp(value: number, min: number, max: number): number {
  const upper = Math.max(min, max);
  return Math.min(upper, Math.max(min, value));
}

/**
 * Draggable, keyboard-operable divider between two panes (WAI-ARIA window
 * splitter). It owns no layout: the caller sizes the pane from `value` and
 * stores the number it receives.
 */
export function Splitter({
  orientation,
  resizes,
  label,
  value,
  min,
  max,
  defaultValue,
  step = DEFAULT_STEP,
  largeStep = DEFAULT_LARGE_STEP,
  onChange,
  onCommit,
  className,
  'data-testid': testId,
}: SplitterProps) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    pointerId: number;
    origin: number;
    start: number;
    latest: number;
    sign: number;
  } | null>(null);
  const axis = orientation === 'vertical' ? 'clientX' : 'clientY';

  // Moving the handle toward the pane after it shrinks the pane before it, and
  // the other way round, so the pane being resized decides the sign. Side-by-side
  // panes swap sides in a right-to-left layout, which flips it again.
  const signFor = (element: Element) => {
    const base = resizes === 'before' ? 1 : -1;
    const mirrored = orientation === 'vertical' && window.getComputedStyle(element).direction === 'rtl';
    return mirrored ? -base : base;
  };

  const apply = (next: number, commit: boolean) => {
    const clamped = clamp(next, min, max);
    onChange(clamped);
    if (commit) onCommit?.(clamped);
    return clamped;
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag.current = {
      pointerId: event.pointerId,
      origin: event[axis],
      start: value,
      latest: value,
      sign: signFor(event.currentTarget),
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    setDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.latest = apply(current.start + current.sign * (event[axis] - current.origin), false);
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(false);
    onCommit?.(current.latest);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const increment = event.shiftKey ? largeStep : step;
    const sign = signFor(event.currentTarget);
    const grow = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
    const shrink = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
    let next: number | null = null;
    if (event.key === grow) next = value + sign * increment;
    else if (event.key === shrink) next = value - sign * increment;
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = Math.max(min, max);
    else if (event.key === 'Enter' && defaultValue !== undefined) next = defaultValue;
    if (next === null) return;
    event.preventDefault();
    apply(next, true);
  };

  const handleDoubleClick = () => {
    if (defaultValue !== undefined) apply(defaultValue, true);
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(Math.max(min, max))}
      tabIndex={0}
      title={label}
      data-testid={testId}
      data-dragging={dragging ? 'true' : undefined}
      className={joinClassNames(
        styles.splitter,
        orientation === 'vertical' ? styles.vertical : styles.horizontal,
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onKeyDown={handleKeyDown}
      onDoubleClick={handleDoubleClick}
    >
      <span className={styles.grip} aria-hidden />
    </div>
  );
}
