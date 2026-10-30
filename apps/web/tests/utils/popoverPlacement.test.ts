import { describe, expect, it } from 'vitest';

import { placePopover } from '../../src/utils/popoverPlacement';

const viewport = { width: 1280, height: 720 };

describe('placePopover', () => {
  it('opens below the trigger at its preferred height when there is room', () => {
    const placement = placePopover({ top: 100, bottom: 140, left: 80, width: 400 }, viewport);

    expect(placement.placement).toBe('down');
    expect(placement.top).toBe(146);
    expect(placement.bottom).toBeUndefined();
    expect(placement.left).toBe(80);
    expect(placement.width).toBe(400);
    expect(placement.maxHeight).toBe(420);
  });

  it('opens above a trigger near the bottom edge when that side is roomier', () => {
    const placement = placePopover({ top: 600, bottom: 640, left: 80, width: 400 }, viewport);

    expect(placement.placement).toBe('up');
    expect(placement.top).toBeUndefined();
    expect(placement.bottom).toBe(720 - 600 + 6);
    expect(placement.maxHeight).toBe(420);
  });

  it('shrinks to the space on the side it picks instead of overflowing the window', () => {
    // 360px window with the trigger low enough that above is the roomier side:
    // 102px below and 182px above, after the gap and margin.
    const placement = placePopover({ top: 200, bottom: 240, left: 20, width: 300 }, { width: 800, height: 360 });

    expect(placement.placement).toBe('up');
    expect(placement.maxHeight).toBe(200 - 6 - 12);
    // The popover's top edge stays on screen, one margin from the window top.
    const topEdge = 360 - (placement.bottom ?? 0) - placement.maxHeight;
    expect(topEdge).toBe(12);
  });

  it('never reports a negative height', () => {
    const placement = placePopover({ top: 4, bottom: 40, left: 0, width: 200 }, { width: 800, height: 60 });

    expect(placement.maxHeight).toBeGreaterThanOrEqual(0);
  });

  it('keeps the popover inside the window horizontally', () => {
    const right = placePopover({ top: 100, bottom: 140, left: 1200, width: 400 }, viewport);
    expect(right.left).toBe(1280 - 400 - 12);

    const left = placePopover({ top: 100, bottom: 140, left: -50, width: 400 }, viewport);
    expect(left.left).toBe(12);
  });

  it('narrows to the window when the trigger is wider than it', () => {
    const placement = placePopover({ top: 100, bottom: 140, left: 0, width: 900 }, { width: 500, height: 720 });

    expect(placement.width).toBe(500 - 24);
    expect(placement.left).toBe(12);
  });
});
