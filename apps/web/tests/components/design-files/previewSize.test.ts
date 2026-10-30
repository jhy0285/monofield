import { describe, expect, it } from 'vitest';

import {
  DF_LIST_MIN_WIDTH,
  DF_PREVIEW_MIN_WIDTH,
  designFilesPreviewBounds,
  resolvePreviewWidth,
} from '../../../src/components/design-files/previewSize';

describe('designFilesPreviewBounds', () => {
  it('leaves the file list at least its minimum width', () => {
    const bounds = designFilesPreviewBounds(900);
    expect(bounds.max).toBe(900 - DF_LIST_MIN_WIDTH);
    expect(bounds.min).toBe(DF_PREVIEW_MIN_WIDTH);
  });

  it('keeps the previous 360px default when it fits and shrinks it when it does not', () => {
    expect(designFilesPreviewBounds(1200).defaultWidth).toBe(360);
    expect(designFilesPreviewBounds(560).defaultWidth).toBe(280);
  });

  it('never reports a maximum below the minimum, even for a very narrow panel', () => {
    const bounds = designFilesPreviewBounds(300);
    expect(bounds.max).toBe(DF_PREVIEW_MIN_WIDTH);
    expect(bounds.defaultWidth).toBe(DF_PREVIEW_MIN_WIDTH);
  });

  it('allows a generous range before the panel has been measured', () => {
    const bounds = designFilesPreviewBounds(0);
    expect(bounds.max).toBe(720);
    expect(bounds.defaultWidth).toBe(360);
  });
});

describe('resolvePreviewWidth', () => {
  const bounds = designFilesPreviewBounds(1000);

  it('uses the default until a width is saved', () => {
    expect(resolvePreviewWidth(bounds, null)).toBe(360);
  });

  it('uses a saved width, clamped to what the panel allows now', () => {
    expect(resolvePreviewWidth(bounds, 500)).toBe(500);
    expect(resolvePreviewWidth(bounds, 5000)).toBe(bounds.max);
    expect(resolvePreviewWidth(bounds, 40)).toBe(DF_PREVIEW_MIN_WIDTH);
  });
});
