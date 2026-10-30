import { describe, expect, it } from 'vitest';

import {
  DEV_DOCK_MIN_HEIGHT,
  developmentDockBounds,
  resolveDockHeight,
} from '../../../src/components/workspace/developmentDockSize';

describe('developmentDockBounds', () => {
  it('keeps the previous default of a third of the window within 240-420px', () => {
    expect(developmentDockBounds(720).defaultHeight).toBe(245);
    expect(developmentDockBounds(500).defaultHeight).toBe(240);
    expect(developmentDockBounds(2000).defaultHeight).toBe(420);
  });

  it('lets the dock take up to 70% of the window and never less than its minimum', () => {
    expect(developmentDockBounds(900).max).toBe(630);
    expect(developmentDockBounds(100).max).toBe(DEV_DOCK_MIN_HEIGHT);
    expect(developmentDockBounds(100).defaultHeight).toBe(DEV_DOCK_MIN_HEIGHT);
  });

  it('expands to just over half the window, capped at 660px', () => {
    expect(developmentDockBounds(720).expandedHeight).toBe(418);
    expect(developmentDockBounds(3000).expandedHeight).toBe(660);
  });
});

describe('resolveDockHeight', () => {
  const bounds = developmentDockBounds(720);

  it('uses the default until a size is saved', () => {
    expect(resolveDockHeight(bounds, null, false)).toBe(bounds.defaultHeight);
  });

  it('uses a saved size, clamped to what the window allows now', () => {
    expect(resolveDockHeight(bounds, 300, false)).toBe(300);
    expect(resolveDockHeight(bounds, 5000, false)).toBe(bounds.max);
    expect(resolveDockHeight(bounds, 10, false)).toBe(DEV_DOCK_MIN_HEIGHT);
  });

  it('shows the expanded preset over a saved size', () => {
    expect(resolveDockHeight(bounds, 300, true)).toBe(bounds.expandedHeight);
  });
});
