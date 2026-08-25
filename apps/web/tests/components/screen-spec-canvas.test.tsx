// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseScreenSpecDocument } from '@open-design/contracts';

import { ScreenSpecCanvas } from '../../src/components/screen-spec/ScreenSpecCanvas';

vi.mock('../../src/i18n', () => ({
  useT: () => (key: string) => key,
}));

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
    unobserve() {}
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ScreenSpecCanvas image fitting', () => {
  it('does not mutate an existing document merely because its image loaded', () => {
    const parsed = parseScreenSpecDocument({
      schemaVersion: 1,
      kind: 'screen-spec',
      name: 'Existing spec',
      screens: [{
        id: 'SCR-001',
        screenName: 'Login',
        imageDataUrl: 'data:image/png;base64,existing',
        visualSettings: { canvasHeightPx: 520 },
      }],
    });
    if (!parsed.ok) throw new Error(parsed.error);
    const onUpdateVisualSettings = vi.fn();
    const view = render(
      <ScreenSpecCanvas
        onAddCallout={vi.fn()}
        onImageUpload={vi.fn()}
        onMoveCallout={vi.fn()}
        onSelectCallout={vi.fn()}
        onUpdateVisualSettings={onUpdateVisualSettings}
        projectId="project-1"
        screen={parsed.doc.screens[0]!}
        selectedCalloutNo={null}
      />,
    );
    const frame = view.container.querySelector('[style*="--ss-canvas-height"]') as HTMLDivElement;
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({
      width: 800, height: 520, top: 0, left: 0, right: 800, bottom: 520, x: 0, y: 0,
      toJSON: () => ({}),
    });
    const image = view.container.querySelector('img') as HTMLImageElement;
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 1600 });
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 900 });

    fireEvent.load(image);

    expect(onUpdateVisualSettings).not.toHaveBeenCalled();
    fireEvent.click(view.getByText('screenSpec.fitImageRatio'));
    expect(onUpdateVisualSettings).toHaveBeenCalledWith({ canvasHeightPx: 450 });
  });
});
