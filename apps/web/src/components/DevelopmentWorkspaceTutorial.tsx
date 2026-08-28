import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@open-design/components';

import { useT } from '../i18n';
import { Icon } from './Icon';
import styles from './ProductTutorial.module.css';

const STORAGE_KEY = 'monofield:development-workspace-tutorial:v2';
const SPOTLIGHT_PADDING = 9;
const CALLOUT_GAP = 14;
const CALLOUT_WIDTH = 372;
const CALLOUT_HEIGHT = 250;

type GuideKey =
  | 'workMode.development'
  | 'workMode.developmentHint'
  | 'development.configureRun'
  | 'development.runSettingsHint'
  | 'development.guideConfigTitle'
  | 'development.guideConfigBody'
  | 'development.guideRunTitle'
  | 'development.guideRunBody'
  | 'development.guideDatabaseTitle'
  | 'development.guideDatabaseBody'
  | 'development.guideChangesTitle'
  | 'development.guideChangesBody'
  | 'development.guideVerifyTitle'
  | 'development.guideVerifyBody';

type Step = {
  title: GuideKey;
  body: GuideKey;
  selector: string;
  focusSelector?: string;
  advanceOn: 'change' | 'click';
};

type SpotlightRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

const STEPS: readonly Step[] = [
  {
    title: 'workMode.development',
    body: 'workMode.developmentHint',
    selector: '[data-testid="development-active-project"]',
    advanceOn: 'change',
  },
  {
    title: 'development.guideConfigTitle',
    body: 'development.guideConfigBody',
    selector: '[data-testid="development-run-config"]',
    advanceOn: 'change',
  },
  {
    title: 'development.configureRun',
    body: 'development.runSettingsHint',
    selector: '[data-testid="development-run-settings"]',
    advanceOn: 'click',
  },
  {
    title: 'development.guideRunTitle',
    body: 'development.guideRunBody',
    selector: '[data-testid="development-run-action"]',
    advanceOn: 'click',
  },
  {
    title: 'development.guideDatabaseTitle',
    body: 'development.guideDatabaseBody',
    selector: '[data-testid="development-database"]',
    advanceOn: 'change',
  },
  {
    title: 'development.guideVerifyTitle',
    body: 'development.guideVerifyBody',
    selector: '[data-testid="development-auto-verify"]',
    focusSelector: '[data-testid="development-auto-verify"] input',
    advanceOn: 'change',
  },
  {
    title: 'development.guideChangesTitle',
    body: 'development.guideChangesBody',
    selector: '[data-testid="development-open-changes"]',
    advanceOn: 'click',
  },
] as const;

export function shouldOpenDevelopmentWorkspaceTutorial(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'done';
  } catch {
    return false;
  }
}

export function completeDevelopmentWorkspaceTutorial(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, 'done');
  } catch {
    // The guide can still close when storage is unavailable.
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function viewportBounds() {
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  return {
    left,
    top,
    right: left + (viewport?.width ?? window.innerWidth),
    bottom: top + (viewport?.height ?? window.innerHeight),
  };
}

function paddedRect(rect: DOMRect): SpotlightRect {
  const viewport = viewportBounds();
  const left = clamp(rect.left - SPOTLIGHT_PADDING, viewport.left + 6, viewport.right - 6);
  const top = clamp(rect.top - SPOTLIGHT_PADDING, viewport.top + 6, viewport.bottom - 6);
  const right = clamp(rect.right + SPOTLIGHT_PADDING, left, viewport.right - 6);
  const bottom = clamp(rect.bottom + SPOTLIGHT_PADDING, top, viewport.bottom - 6);
  return { top, right, bottom, left, width: right - left, height: bottom - top };
}

function calloutPosition(rect: SpotlightRect | null, measuredHeight: number): { placement: string; style: CSSProperties } {
  const viewport = viewportBounds();
  const viewportWidth = viewport.right - viewport.left;
  const viewportHeight = viewport.bottom - viewport.top;
  const width = Math.min(CALLOUT_WIDTH, Math.max(0, viewportWidth - 24));
  const height = Math.min(measuredHeight, viewportHeight - 24);
  const minLeft = viewport.left + 12;
  const maxLeft = viewport.right - width - 12;
  const minTop = viewport.top + 12;
  const maxTop = viewport.bottom - height - 12;
  if (!rect) {
    return {
      placement: 'center',
      style: {
        width,
        left: clamp(viewport.left + (viewportWidth - width) / 2, minLeft, maxLeft),
        top: clamp(viewport.top + (viewportHeight - height) / 2, minTop, maxTop),
      },
    };
  }
  if (rect.bottom + CALLOUT_GAP + height <= viewport.bottom - 12) {
    return {
      placement: 'bottom',
      style: {
        width,
        left: clamp(rect.left + (rect.width - width) / 2, minLeft, maxLeft),
        top: rect.bottom + CALLOUT_GAP,
      },
    };
  }
  if (rect.top - CALLOUT_GAP - height >= viewport.top + 12) {
    return {
      placement: 'top',
      style: {
        width,
        left: clamp(rect.left + (rect.width - width) / 2, minLeft, maxLeft),
        top: rect.top - CALLOUT_GAP - height,
      },
    };
  }
  return {
    placement: 'center',
    style: {
      width,
      left: clamp(viewport.left + (viewportWidth - width) / 2, minLeft, maxLeft),
      top: clamp(viewport.bottom - height - 18, minTop, maxTop),
    },
  };
}

export function DevelopmentWorkspaceTutorial({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<SpotlightRect | null>(null);
  const [calloutHeight, setCalloutHeight] = useState(CALLOUT_HEIGHT);
  const calloutRef = useRef<HTMLElement>(null);
  const activeStep: Step = STEPS[step] ?? STEPS[0]!;

  const target = useCallback(
    () => document.querySelector<HTMLElement>(activeStep.selector),
    [activeStep],
  );
  const updateTarget = useCallback(() => {
    if (!open) return;
    const rect = target()?.getBoundingClientRect();
    setTargetRect(rect && rect.width > 0 && rect.height > 0 ? paddedRect(rect) : null);
  }, [open, target]);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const element = target();
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    element?.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    const frame = window.requestAnimationFrame(() => {
      updateTarget();
      document.querySelector<HTMLElement>(activeStep.focusSelector ?? activeStep.selector)?.focus({ preventScroll: true });
    });
    const settleTimer = window.setTimeout(updateTarget, reduceMotion ? 0 : 220);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateTarget);
    if (element) {
      resizeObserver?.observe(element);
      if (element.parentElement) resizeObserver?.observe(element.parentElement);
    }
    resizeObserver?.observe(document.documentElement);
    const mutationObserver = new MutationObserver(updateTarget);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', updateTarget);
    window.addEventListener('scroll', updateTarget, true);
    window.visualViewport?.addEventListener('resize', updateTarget);
    window.visualViewport?.addEventListener('scroll', updateTarget);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('resize', updateTarget);
      window.removeEventListener('scroll', updateTarget, true);
      window.visualViewport?.removeEventListener('resize', updateTarget);
      window.visualViewport?.removeEventListener('scroll', updateTarget);
    };
  }, [activeStep, open, target, updateTarget]);

  useEffect(() => {
    if (!open) return;
    const callout = calloutRef.current;
    if (!callout) return;
    const measure = () => {
      const next = callout.getBoundingClientRect().height;
      if (next > 0) setCalloutHeight(next);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(callout);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [activeStep, open]);

  useEffect(() => {
    if (!open) return;
    function finish() {
      completeDevelopmentWorkspaceTutorial();
      onClose();
    }
    function advance(event: Event) {
      const element = target();
      if (!element || !element.contains(event.target as Node)) return;
      if (activeStep.advanceOn !== event.type) return;
      if (step >= STEPS.length - 1) finish();
      else setStep((current) => current + 1);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      finish();
    }
    document.addEventListener('click', advance, true);
    document.addEventListener('change', advance, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', advance, true);
      document.removeEventListener('change', advance, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [activeStep, onClose, open, step, target]);

  const placement = useMemo(() => calloutPosition(targetRect, calloutHeight), [calloutHeight, targetRect]);
  if (!open || typeof document === 'undefined') return null;

  function close() {
    completeDevelopmentWorkspaceTutorial();
    onClose();
  }

  return createPortal(
    <div className={styles.tour} data-testid="development-workspace-tutorial" data-step={step + 1}>
      {targetRect ? (
        <>
          <div className={styles.blind} style={{ top: 0, left: 0, right: 0, height: targetRect.top }} />
          <div className={styles.blind} style={{ top: targetRect.top, left: 0, width: targetRect.left, height: targetRect.height }} />
          <div className={styles.blind} style={{ top: targetRect.top, left: targetRect.right, right: 0, height: targetRect.height }} />
          <div className={styles.blind} style={{ top: targetRect.bottom, left: 0, right: 0, bottom: 0 }} />
          <div
            className={styles.spotlight}
            data-testid="development-tutorial-spotlight"
            style={{
              top: targetRect.top,
              left: targetRect.left,
              width: targetRect.width,
              height: targetRect.height,
            }}
          />
        </>
      ) : (
        <div className={styles.blind} style={{ inset: 0 }} />
      )}
      <section
        ref={calloutRef}
        className={styles.callout}
        data-testid="development-tutorial-callout"
        style={placement.style}
        data-placement={placement.placement}
        role="dialog"
        aria-modal="true"
        aria-labelledby="development-guide-title"
        aria-describedby="development-guide-description"
      >
        <div className={styles.calloutTopline}>
          <span className={styles.eyebrow}>{t('development.guide')} / {STEPS.length}</span>
          <Button size="icon" variant="ghost" onClick={close} aria-label={t('productTutorial.close')}>
            <Icon name="close" size={15} />
          </Button>
        </div>
        <div className={`${styles.progress} ${styles.developmentProgress}`} aria-label={t('productTutorial.progressLabel')}>
          {STEPS.map((item, index) => (
            <button
              key={item.title}
              type="button"
              className={index === step ? styles.progressActive : undefined}
              onClick={() => setStep(index)}
              aria-label={t('productTutorial.stepOf', { current: index + 1, total: STEPS.length })}
              aria-current={index === step ? 'step' : undefined}
            />
          ))}
        </div>
        <div className={styles.copy} key={activeStep.title}>
          <span>{String(step + 1).padStart(2, '0')}</span>
          <h2 id="development-guide-title">{t(activeStep.title)}</h2>
          <p id="development-guide-description">{t(activeStep.body)}</p>
        </div>
        <footer className={styles.footer}>
          <span className={styles.eyebrow}>{t('development.guide')}</span>
          <div>
            <Button variant="ghost" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0}>
              {t('productTutorial.previous')}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button variant="primary" onClick={() => setStep((current) => current + 1)}>
                {t('productTutorial.next')}
              </Button>
            ) : (
              <Button variant="primary" onClick={close}>{t('development.guideFinish')}</Button>
            )}
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
