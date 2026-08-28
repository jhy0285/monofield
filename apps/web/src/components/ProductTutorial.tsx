import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@open-design/components';
import { useT } from '../i18n';
import { Icon } from './Icon';
import styles from './ProductTutorial.module.css';

const PRODUCT_TUTORIAL_STORAGE_KEY = 'monofield:product-tutorial:v1';
const PRODUCT_GUIDE_URL =
  'https://monofield.vercel.app/downloads/monofield-user-guide-ko.pdf';
const SPOTLIGHT_PADDING = 10;
const CALLOUT_GAP = 16;
const CALLOUT_WIDTH = 372;
const CALLOUT_HEIGHT_ESTIMATE = 268;
const WORK_MODE_SELECTOR = '[data-testid="work-mode-toggle"]';
const WORKING_DIR_SELECTOR = '[data-testid="working-dir-picker"]';
const COMPOSER_SELECTOR = '[data-testid="home-hero-input"]';
const SUBMIT_SELECTOR = '[data-testid="home-hero-submit"]';
const INPUT_CARD_SELECTOR = '[data-testid="home-hero-input-card"]';
const TEMPLATE_PICKER_SELECTOR = '[data-testid="home-hero-template-picker"]';
const TEMPLATE_MENU_SELECTOR = '[data-testid="home-hero-template-menu"]';
const DESIGN_SYSTEM_PICKER_SELECTOR = '[data-testid="home-hero-design-system-picker"]';
const DESIGN_SYSTEM_POPOVER_SELECTOR = '[data-testid="project-ds-picker-popover"]';
const COMPOSER_PLUS_MENU_SELECTOR = '[data-testid="composer-plus-menu"]';
const STEPS_PER_PHASE = 4;
const CREATION_MODE_STEP = 4;
const CREATION_TEMPLATE_STEP = 5;
const CREATION_STYLE_STEP = 6;

type TutorialKey =
  | 'productTutorial.stepChooseTitle'
  | 'productTutorial.stepChooseBody'
  | 'productTutorial.stepConnectTitle'
  | 'productTutorial.stepConnectBody'
  | 'productTutorial.stepAskTitle'
  | 'productTutorial.stepAskBody'
  | 'productTutorial.stepReviewTitle'
  | 'productTutorial.stepReviewBody'
  | 'productTutorial.creationChooseTitle'
  | 'productTutorial.creationChooseBody'
  | 'productTutorial.creationFormatTitle'
  | 'productTutorial.creationFormatBody'
  | 'productTutorial.creationStyleTitle'
  | 'productTutorial.creationStyleBody'
  | 'productTutorial.creationComposeTitle'
  | 'productTutorial.creationComposeBody';

type TutorialPhase = 'development' | 'creation';

type TourPlacement = 'top' | 'right' | 'bottom' | 'left' | 'center';

type SpotlightRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

type CalloutPosition = {
  placement: TourPlacement;
  style: CSSProperties;
};

type TutorialStep = {
  phase: TutorialPhase;
  title: TutorialKey;
  body: TutorialKey;
  selector: string;
  focusSelector?: string;
  includeSelectors?: readonly string[];
};

const FIRST_STEP: TutorialStep = {
  phase: 'development',
  title: 'productTutorial.stepChooseTitle',
  body: 'productTutorial.stepChooseBody',
  selector: WORK_MODE_SELECTOR,
  focusSelector: '[data-testid="work-mode-development"]',
};

const STEPS: readonly TutorialStep[] = [
  FIRST_STEP,
  {
    phase: 'development',
    title: 'productTutorial.stepConnectTitle',
    body: 'productTutorial.stepConnectBody',
    selector: WORKING_DIR_SELECTOR,
    focusSelector: '[data-testid="working-dir-trigger"]',
  },
  {
    phase: 'development',
    title: 'productTutorial.stepAskTitle',
    body: 'productTutorial.stepAskBody',
    selector: COMPOSER_SELECTOR,
  },
  {
    phase: 'development',
    title: 'productTutorial.stepReviewTitle',
    body: 'productTutorial.stepReviewBody',
    selector: SUBMIT_SELECTOR,
  },
  {
    phase: 'creation',
    title: 'productTutorial.creationChooseTitle',
    body: 'productTutorial.creationChooseBody',
    selector: WORK_MODE_SELECTOR,
    focusSelector: '[data-testid="work-mode-creation"]',
  },
  {
    phase: 'creation',
    title: 'productTutorial.creationFormatTitle',
    body: 'productTutorial.creationFormatBody',
    selector: TEMPLATE_PICKER_SELECTOR,
    focusSelector: '[data-testid="home-hero-template-trigger"]',
    includeSelectors: [TEMPLATE_MENU_SELECTOR],
  },
  {
    phase: 'creation',
    title: 'productTutorial.creationStyleTitle',
    body: 'productTutorial.creationStyleBody',
    selector: DESIGN_SYSTEM_PICKER_SELECTOR,
    focusSelector: '[data-testid="home-hero-design-system-trigger"]',
    includeSelectors: [DESIGN_SYSTEM_POPOVER_SELECTOR],
  },
  {
    phase: 'creation',
    title: 'productTutorial.creationComposeTitle',
    body: 'productTutorial.creationComposeBody',
    selector: INPUT_CARD_SELECTOR,
    focusSelector: COMPOSER_SELECTOR,
    includeSelectors: [COMPOSER_PLUS_MENU_SELECTOR],
  },
] as const;

export function scheduleProductTutorial(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PRODUCT_TUTORIAL_STORAGE_KEY, 'pending');
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
}

export function shouldOpenProductTutorial(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(PRODUCT_TUTORIAL_STORAGE_KEY) === 'pending';
  } catch {
    return false;
  }
}

export function completeProductTutorial(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PRODUCT_TUTORIAL_STORAGE_KEY, 'done');
  } catch {
    // Dismissal still works when persistence is unavailable.
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
  return {
    top,
    right,
    bottom,
    left,
    width: right - left,
    height: bottom - top,
  };
}

function targetElements(step: TutorialStep): HTMLElement[] {
  const selectors = [step.selector, ...(step.includeSelectors ?? [])];
  return selectors.flatMap((selector) =>
    Array.from(document.querySelectorAll<HTMLElement>(selector)),
  );
}

function targetBounds(step: TutorialStep): DOMRect | null {
  const rects = targetElements(step)
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

function calloutPosition(rect: SpotlightRect | null, measuredHeight: number): CalloutPosition {
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
  if (rect.right + CALLOUT_GAP + width <= viewport.right - 12) {
    return {
      placement: 'right',
      style: {
        width,
        left: rect.right + CALLOUT_GAP,
        top: clamp(rect.top + (rect.height - height) / 2, minTop, maxTop),
      },
    };
  }
  if (rect.left - CALLOUT_GAP - width >= viewport.left + 12) {
    return {
      placement: 'left',
      style: {
        width,
        left: rect.left - CALLOUT_GAP - width,
        top: clamp(rect.top + (rect.height - height) / 2, minTop, maxTop),
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

export function ProductTutorial({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<SpotlightRect | null>(null);
  const [targetFound, setTargetFound] = useState(false);
  const [calloutHeight, setCalloutHeight] = useState(CALLOUT_HEIGHT_ESTIMATE);
  const calloutRef = useRef<HTMLElement>(null);
  const activeStep: TutorialStep = STEPS[step] ?? FIRST_STEP;

  const updateTarget = useCallback(() => {
    if (!open) return;
    const rect = targetBounds(activeStep);
    if (!rect) {
      setTargetFound(false);
      setTargetRect(null);
      return;
    }
    setTargetFound(true);
    setTargetRect(paddedRect(rect));
  }, [activeStep, open]);

  useEffect(() => {
    if (!open) return;
    setStep(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const targets = targetElements(activeStep);
    const target = targets[0] ?? null;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target?.scrollIntoView?.({
      block: 'center',
      inline: 'nearest',
      behavior: reduceMotion ? 'auto' : 'smooth',
    });

    const frame = window.requestAnimationFrame(() => {
      updateTarget();
      const focusTarget = document.querySelector<HTMLElement>(
        activeStep.focusSelector ?? activeStep.selector,
      );
      focusTarget?.focus({ preventScroll: true });
    });
    const settleTimer = window.setTimeout(updateTarget, reduceMotion ? 0 : 260);
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateTarget);
    for (const element of targets) {
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
  }, [activeStep, open, updateTarget]);

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
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      completeProductTutorial();
      onClose();
    }
    function onTargetClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (step === 0 && target.closest('[data-testid="work-mode-development"]')) {
        window.setTimeout(() => setStep(1), 120);
        return;
      }
      if (
        step === 1
        && (target.closest('[data-testid="working-dir-pick"]')
          || target.closest('[data-testid="working-dir-recent-list"] button'))
      ) {
        window.setTimeout(() => setStep(2), 120);
        return;
      }
      if (step === CREATION_MODE_STEP && target.closest('[data-testid="work-mode-creation"]')) {
        window.setTimeout(() => setStep(CREATION_TEMPLATE_STEP), 120);
        return;
      }
      if (
        step === CREATION_TEMPLATE_STEP
        && target.closest('[data-testid^="home-hero-template-card-"]')
      ) {
        window.setTimeout(() => setStep(CREATION_STYLE_STEP), 120);
        return;
      }
      if (step === STEPS.length - 1) {
        const submit = target.closest<HTMLButtonElement>(SUBMIT_SELECTOR);
        if (submit && !submit.disabled) {
          completeProductTutorial();
          onClose();
        }
      }
    }
    function onTargetMouseDown(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (
        step === CREATION_STYLE_STEP
        && target?.closest('[data-testid^="project-ds-picker-option-"]')
      ) {
        window.setTimeout(() => setStep(CREATION_STYLE_STEP + 1), 120);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onTargetClick);
    document.addEventListener('mousedown', onTargetMouseDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onTargetClick);
      document.removeEventListener('mousedown', onTargetMouseDown);
    };
  }, [onClose, open, step]);

  const position = useMemo(
    () => (typeof window === 'undefined' ? null : calloutPosition(targetRect, calloutHeight)),
    [calloutHeight, targetRect],
  );

  if (!open || typeof document === 'undefined' || !position) return null;

  function closeTutorial() {
    completeProductTutorial();
    onClose();
  }

  const masks = targetRect
    ? [
        { top: 0, left: 0, right: 0, height: targetRect.top },
        { top: targetRect.top, left: 0, width: targetRect.left, height: targetRect.height },
        { top: targetRect.top, left: targetRect.right, right: 0, height: targetRect.height },
        { top: targetRect.bottom, left: 0, right: 0, bottom: 0 },
      ]
    : [{ inset: 0 }];
  const phaseStep = step % STEPS_PER_PHASE;
  const phaseLabel = activeStep.phase === 'development'
    ? t('workMode.development')
    : t('workMode.creation');

  return createPortal(
    <div
      className={styles.tour}
      data-testid="product-tutorial"
      data-step={step + 1}
      data-target-found={targetFound ? 'true' : 'false'}
    >
      {masks.map((style, index) => (
        <div key={index} className={styles.blind} style={style} aria-hidden />
      ))}
      {targetRect ? (
        <div
          className={styles.spotlight}
          style={{
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
          }}
          aria-hidden
        />
      ) : null}

      <section
        ref={calloutRef}
        className={styles.callout}
        data-placement={position.placement}
        style={position.style}
        role="dialog"
        aria-labelledby="product-tutorial-title"
        aria-describedby="product-tutorial-description"
      >
        <div className={styles.calloutTopline}>
          <span className={styles.eyebrow}>
            {phaseLabel} · {t('productTutorial.stepOf', {
              current: phaseStep + 1,
              total: STEPS_PER_PHASE,
            })}
          </span>
          <Button
            size="icon"
            variant="ghost"
            onClick={closeTutorial}
            aria-label={t('productTutorial.close')}
            title={t('productTutorial.close')}
          >
            <Icon name="close" size={15} />
          </Button>
        </div>

        <div className={styles.progress} aria-label={t('productTutorial.progressLabel')}>
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
          <span>{String(phaseStep + 1).padStart(2, '0')}</span>
          <h2 id="product-tutorial-title">{t(activeStep.title)}</h2>
          <p id="product-tutorial-description">{t(activeStep.body)}</p>
        </div>

        <footer className={styles.footer}>
          <a href={PRODUCT_GUIDE_URL} target="_blank" rel="noreferrer noopener" download>
            <Icon name="download" size={14} />
            <span>{t('productTutorial.download')}</span>
          </a>
          <div>
            <Button
              variant="ghost"
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              disabled={step === 0}
            >
              {t('productTutorial.previous')}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button
                variant="primary"
                onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))}
              >
                {t('productTutorial.next')}
              </Button>
            ) : (
              <Button variant="primary" onClick={closeTutorial}>
                {t('productTutorial.finish')}
              </Button>
            )}
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
