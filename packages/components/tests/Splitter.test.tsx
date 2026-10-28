// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Splitter, type SplitterProps } from '../src/splitter';

afterEach(() => {
  cleanup();
});

function renderSplitter(props: Partial<SplitterProps> = {}) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(
    <Splitter
      orientation="vertical"
      resizes="before"
      label="Resize panel"
      value={300}
      min={200}
      max={500}
      defaultValue={320}
      onChange={onChange}
      onCommit={onCommit}
      {...props}
    />,
  );
  return { separator: screen.getByRole('separator', { name: props.label ?? 'Resize panel' }), onChange, onCommit };
}

describe('Splitter', () => {
  it('is a focusable separator that reports its range', () => {
    const { separator } = renderSplitter({ value: 300.4 });

    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
    expect(separator.getAttribute('aria-valuenow')).toBe('300');
    expect(separator.getAttribute('aria-valuemin')).toBe('200');
    expect(separator.getAttribute('aria-valuemax')).toBe('500');
    expect(separator.tabIndex).toBe(0);
  });

  it('grows the pane before it with the arrow that moves the handle away', () => {
    const { separator, onChange, onCommit } = renderSplitter();

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(316);
    expect(onCommit).toHaveBeenLastCalledWith(316);

    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(284);
  });

  it('uses the large step with Shift and clamps to the range', () => {
    const { separator, onChange } = renderSplitter({ value: 480 });

    fireEvent.keyDown(separator, { key: 'ArrowRight', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(500);

    fireEvent.keyDown(separator, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(200);

    fireEvent.keyDown(separator, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(500);
  });

  it('restores the default size with Enter and with a double click', () => {
    const { separator, onChange, onCommit } = renderSplitter();

    fireEvent.keyDown(separator, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(320);
    expect(onCommit).toHaveBeenLastCalledWith(320);

    onChange.mockClear();
    onCommit.mockClear();
    fireEvent.doubleClick(separator);
    expect(onChange).toHaveBeenCalledWith(320);
    expect(onCommit).toHaveBeenCalledWith(320);
  });

  it('inverts the arrows when the pane after the handle is the one resized', () => {
    const { separator, onChange } = renderSplitter({ resizes: 'after' });

    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(316);
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(284);
  });

  it('answers the vertical arrows for a horizontal separator', () => {
    const { separator, onChange } = renderSplitter({ orientation: 'horizontal', resizes: 'after' });

    expect(separator.getAttribute('aria-orientation')).toBe('horizontal');
    // The pane below grows when the handle moves up.
    fireEvent.keyDown(separator, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(316);
    fireEvent.keyDown(separator, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith(284);
    // Left and right do nothing on a horizontal separator.
    onChange.mockClear();
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('follows a pointer drag and commits once when it ends', () => {
    const { separator, onChange, onCommit } = renderSplitter();

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100, clientY: 0, button: 0 });
    expect(separator.getAttribute('data-dragging')).toBe('true');

    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 140, clientY: 0 });
    expect(onChange).toHaveBeenLastCalledWith(340);

    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 1000, clientY: 0 });
    expect(onChange).toHaveBeenLastCalledWith(500);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 1000, clientY: 0 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(500);
    expect(separator.getAttribute('data-dragging')).toBeNull();
  });

  it('shrinks the pane after the handle as the pointer moves down', () => {
    const { separator, onChange } = renderSplitter({ orientation: 'horizontal', resizes: 'after' });

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 0, clientY: 400, button: 0 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 0, clientY: 340 });
    expect(onChange).toHaveBeenLastCalledWith(360);
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 0, clientY: 460 });
    expect(onChange).toHaveBeenLastCalledWith(240);
  });

  it('ignores moves from a different pointer and a pointer that never pressed', () => {
    const { separator, onChange } = renderSplitter();

    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 140, clientY: 0 });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100, clientY: 0, button: 0 });
    fireEvent.pointerMove(separator, { pointerId: 2, clientX: 140, clientY: 0 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('mirrors the horizontal directions in a right-to-left layout', () => {
    const { separator, onChange } = renderSplitter();
    separator.style.direction = 'rtl';

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(284);
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(316);

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100, clientY: 0, button: 0 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 140, clientY: 0 });
    expect(onChange).toHaveBeenLastCalledWith(260);
  });

  it('does not mirror a horizontal separator in a right-to-left layout', () => {
    const { separator, onChange } = renderSplitter({ orientation: 'horizontal', resizes: 'after' });
    separator.style.direction = 'rtl';

    fireEvent.keyDown(separator, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(316);
  });

  it('keeps a degenerate range usable', () => {
    const { separator, onChange } = renderSplitter({ min: 300, max: 100, value: 300 });

    fireEvent.keyDown(separator, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(300);
  });
});
