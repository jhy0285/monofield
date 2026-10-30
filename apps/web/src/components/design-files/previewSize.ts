export const DF_PREVIEW_WIDTH_STORAGE_KEY = 'monofield:layout:design-files-preview-width';
export const DF_PREVIEW_MIN_WIDTH = 220;
export const DF_PREVIEW_DEFAULT_WIDTH = 360;
/** The file list never gets narrower than this, whatever width the preview is dragged to. */
export const DF_LIST_MIN_WIDTH = 280;
/** Upper bound used before the panel has been measured. */
const UNMEASURED_MAX_WIDTH = 720;

export interface DesignFilesPreviewBounds {
  min: number;
  max: number;
  defaultWidth: number;
}

export function designFilesPreviewBounds(panelWidth: number): DesignFilesPreviewBounds {
  const min = DF_PREVIEW_MIN_WIDTH;
  const max = panelWidth > 0
    ? Math.max(min, Math.floor(panelWidth) - DF_LIST_MIN_WIDTH)
    : UNMEASURED_MAX_WIDTH;
  return { min, max, defaultWidth: Math.min(DF_PREVIEW_DEFAULT_WIDTH, max) };
}

/** The preview column width to render: a saved size or the default, kept inside what the panel allows now. */
export function resolvePreviewWidth(bounds: DesignFilesPreviewBounds, stored: number | null): number {
  return Math.min(bounds.max, Math.max(bounds.min, stored ?? bounds.defaultWidth));
}
