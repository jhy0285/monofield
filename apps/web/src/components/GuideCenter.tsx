// Guide Center: the 30-second intro video, its chapters, and the four-step path
// from opening a folder to exporting deliverables. Opened from the Help menu.
//
// The video is a silent, captioned motion piece rendered by
// e2e/scripts/render-intro-video.ts and shipped in public/guide, so it plays
// offline and never reaches the network.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { Button } from '@open-design/components';
import { Icon, type IconName } from './Icon';
import { useI18n } from '../i18n';
import type { Dict } from '../i18n/types';
import { modalContent, modalOverlay } from '../motion';
import styles from './GuideCenter.module.css';

const USER_GUIDE_URL = 'https://monofield.vercel.app/downloads/monofield-user-guide-ko.pdf';

type GuideKey = Extract<keyof Dict, `guide.${string}`>;

const CHAPTERS: ReadonlyArray<{ at: number; label: GuideKey }> = [
  { at: 7.9, label: 'guide.chapter.spec' },
  { at: 13.7, label: 'guide.chapter.deliverables' },
  { at: 18.7, label: 'guide.chapter.diff' },
  { at: 24.3, label: 'guide.chapter.local' },
];

const STEPS: ReadonlyArray<{ icon: IconName; title: GuideKey; body: GuideKey }> = [
  { icon: 'folder', title: 'guide.step1.title', body: 'guide.step1.body' },
  { icon: 'file-code', title: 'guide.step2.title', body: 'guide.step2.body' },
  { icon: 'lightbulb', title: 'guide.step3.title', body: 'guide.step3.body' },
  { icon: 'download', title: 'guide.step4.title', body: 'guide.step4.body' },
];

export interface GuideCenterProps {
  open: boolean;
  onClose: () => void;
  onStartProject: () => void;
  onReplayTour: () => void;
}

// Presence only. The stateful dialog is its own component so playback state
// never re-renders AnimatePresence's children.
export function GuideCenter({ open, ...handlers }: GuideCenterProps) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open ? <GuideCenterDialog key="guide-center" {...handlers} /> : null}
    </AnimatePresence>,
    document.body,
  );
}

function GuideCenterDialog({ onClose, onStartProject, onReplayTour }: Omit<GuideCenterProps, 'open'>) {
  const { t, locale } = useI18n();
  const isPresent = useIsPresent();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [started, setStarted] = useState(false);
  const [currentChapter, setCurrentChapter] = useState(-1);
  const language = locale === 'ko' ? 'ko' : 'en';

  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], video[controls], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      returnFocus?.focus({ preventScroll: true });
    };
  }, [onClose]);

  // Closing stops playback right away rather than after the exit animation, and
  // an unmount or a language swap never leaves the old element playing.
  useEffect(() => {
    if (!isPresent) videoRef.current?.pause();
  }, [isPresent]);
  useEffect(() => {
    const video = videoRef.current;
    return () => video?.pause();
  }, [language]);

  function play(at?: number) {
    const video = videoRef.current;
    if (!video) return;
    if (typeof at === 'number') video.currentTime = at;
    setStarted(true);
    void video.play().catch(() => setStarted(false));
  }

  function handleTimeUpdate() {
    const time = videoRef.current?.currentTime ?? 0;
    let index = -1;
    CHAPTERS.forEach((chapter, position) => {
      if (time >= chapter.at - 0.2) index = position;
    });
    setCurrentChapter(index);
  }

  return (
    <motion.div
      className={styles.backdrop}
      role="presentation"
      variants={modalOverlay}
      initial="hidden"
      animate="visible"
      exit="exit"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      data-testid="guide-center-backdrop"
    >
      <motion.div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-center-title"
        aria-describedby="guide-center-subtitle"
        variants={modalContent}
        data-testid="guide-center"
      >
        <header className={styles.header}>
          <span className={styles.mark} aria-hidden>
            <svg viewBox="0 0 444 444" fill="none">
              <path d="M92 312V138L222 306L352 138V312" stroke="currentColor" strokeWidth="44" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className={styles.headline}>
            <h2 id="guide-center-title">{t('guide.title')}</h2>
            <p id="guide-center-subtitle">{t('guide.subtitle')}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label={t('common.close')}
            title={t('common.close')}
            data-testid="guide-center-close"
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className={styles.body}>
          <section className={styles.stage} aria-label={t('guide.videoLabel')}>
            <div className={`${styles.player}${started ? ` ${styles.playerStarted}` : ''}`}>
              <video
                // A language change swaps the source, so the element must be new.
                key={language}
                ref={videoRef}
                className={styles.video}
                controls
                playsInline
                preload="metadata"
                poster={`/guide/monofield-intro-${language}-poster.jpg`}
                aria-label={t('guide.videoLabel')}
                onPlay={() => setStarted(true)}
                onEnded={() => setStarted(false)}
                onTimeUpdate={handleTimeUpdate}
                data-testid="guide-center-video"
              >
                <source src={`/guide/monofield-intro-${language}.mp4`} type="video/mp4" />
              </video>
              <button
                type="button"
                className={styles.playButton}
                onClick={() => play()}
                aria-label={t('guide.playVideo')}
                data-testid="guide-center-play"
              >
                <Icon name="play" size={30} />
              </button>
            </div>
            <div className={styles.chapters}>
              <span className={styles.chaptersLabel}>{t('guide.chapters')}</span>
              <ol>
                {CHAPTERS.map((chapter, index) => (
                  <li key={chapter.label}>
                    <button
                      type="button"
                      className={index === currentChapter ? styles.chapterCurrent : undefined}
                      onClick={() => play(chapter.at)}
                      data-testid={`guide-center-chapter-${index + 1}`}
                    >
                      <span className={styles.chapterTime}>{formatTime(chapter.at)}</span>
                      <span>{t(chapter.label)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className={styles.steps} aria-labelledby="guide-center-steps">
            <h3 id="guide-center-steps">{t('guide.steps')}</h3>
            <ol className={styles.stepList}>
              {STEPS.map((step, index) => (
                <li key={step.title} style={{ animationDelay: `${120 + index * 70}ms` }}>
                  <span className={styles.stepNumber} aria-hidden>{index + 1}</span>
                  <span className={styles.stepIcon} aria-hidden><Icon name={step.icon} size={16} /></span>
                  <div>
                    <strong>{t(step.title)}</strong>
                    <p>{t(step.body)}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className={styles.requirement}>
              <Icon name="sparkles" size={13} />
              <span>{t('settings.onboardingAgentRequirement')}</span>
            </p>
            <div className={styles.actions}>
              <Button variant="primary" onClick={onStartProject} data-testid="guide-center-start">
                {t('guide.startProject')}
              </Button>
              <Button variant="ghost" onClick={onReplayTour} data-testid="guide-center-replay">
                {t('guide.replayTour')}
              </Button>
              <a className={styles.link} href={USER_GUIDE_URL} target="_blank" rel="noreferrer noopener">
                <span>{t('guide.userGuide')}</span>
                <Icon name="external-link" size={13} />
              </a>
            </div>
          </section>
        </div>
      </motion.div>
    </motion.div>
  );
}

function formatTime(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
