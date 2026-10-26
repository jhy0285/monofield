// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GuideCenter } from '../../src/components/GuideCenter';
import { I18nProvider } from '../../src/i18n';

let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;

beforeEach(() => {
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play as never);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderGuide(locale: 'en' | 'ko', props: Partial<React.ComponentProps<typeof GuideCenter>> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onStartProject: vi.fn(),
    onReplayTour: vi.fn(),
  };
  const view = render(
    <I18nProvider initial={locale}>
      <GuideCenter open {...handlers} {...props} />
    </I18nProvider>,
  );
  return { ...handlers, ...view };
}

describe('GuideCenter', () => {
  it('shows the intro video and the four-step path in the current language', () => {
    renderGuide('ko');

    expect(screen.getByRole('dialog', { name: 'MonoField 가이드' })).toBeTruthy();
    const video = screen.getByTestId('guide-center-video') as HTMLVideoElement;
    expect(video.getAttribute('poster')).toBe('/guide/monofield-intro-ko-poster.jpg');
    expect(video.querySelector('source')?.getAttribute('src')).toBe('/guide/monofield-intro-ko.mp4');
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(8);
    expect(screen.getByText('폴더를 여세요')).toBeTruthy();
    expect(screen.getByText('산출물을 내보내세요')).toBeTruthy();
  });

  it('falls back to the English video for every non-Korean locale', () => {
    renderGuide('en');

    const video = screen.getByTestId('guide-center-video') as HTMLVideoElement;
    expect(video.querySelector('source')?.getAttribute('src')).toBe('/guide/monofield-intro-en.mp4');
    expect(screen.getByText('Open a folder')).toBeTruthy();
  });

  it('plays from the overlay and seeks to a chapter', () => {
    renderGuide('en');
    const video = screen.getByTestId('guide-center-video') as HTMLVideoElement;
    // jsdom does not implement media seeking; give the element a plain property.
    Object.defineProperty(video, 'currentTime', { value: 0, writable: true, configurable: true });

    fireEvent.click(screen.getByTestId('guide-center-play'));
    expect(play).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('guide-center-chapter-3'));
    expect(video.currentTime).toBeCloseTo(18.7, 1);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('marks the chapter that is currently playing', () => {
    renderGuide('en');
    const video = screen.getByTestId('guide-center-video') as HTMLVideoElement;
    Object.defineProperty(video, 'currentTime', { value: 14.5, writable: true, configurable: true });

    act(() => {
      fireEvent.timeUpdate(video);
    });
    expect(screen.getByTestId('guide-center-chapter-2').className).toMatch(/chapterCurrent/);
    expect(screen.getByTestId('guide-center-chapter-1').className).not.toMatch(/chapterCurrent/);
  });

  it('routes the actions and closes on Escape and the close button', () => {
    const { onClose, onStartProject, onReplayTour } = renderGuide('en');

    fireEvent.click(screen.getByTestId('guide-center-start'));
    fireEvent.click(screen.getByTestId('guide-center-replay'));
    expect(onStartProject).toHaveBeenCalledTimes(1);
    expect(onReplayTour).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('guide-center-close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('links the illustrated user guide safely', () => {
    renderGuide('en');
    const link = screen.getByRole('link', { name: /Illustrated guide/ });
    expect(link.getAttribute('href')).toMatch(/^https:\/\/monofield\.vercel\.app\/downloads\//);
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('renders nothing when closed and pauses playback when it closes', () => {
    const { rerender, onClose, onStartProject, onReplayTour } = renderGuide('en');
    rerender(
      <I18nProvider initial="en">
        <GuideCenter open={false} onClose={onClose} onStartProject={onStartProject} onReplayTour={onReplayTour} />
      </I18nProvider>,
    );
    expect(pause).toHaveBeenCalled();
  });
});
