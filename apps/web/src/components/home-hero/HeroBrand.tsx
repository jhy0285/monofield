import { Fragment, type CSSProperties } from 'react';
import { VisuallyHidden } from '@open-design/components';

import styles from './HeroBrand.module.css';

/**
 * The subtitle names the path a project takes ("code / interface spec / screen
 * spec"). Every locale writes it with slashes, so the steps can be drawn as a
 * pipeline; a translation without them falls back to a single step.
 */
export function splitPipelineSteps(subtitle: string): string[] {
  const steps = subtitle
    .split('/')
    .map((step) => step.trim())
    .filter((step) => step.length > 0);
  return steps.length > 0 ? steps : [subtitle];
}

/** Words keep their trailing space so the heading still reads as one sentence. */
export function splitTitleWords(title: string): string[] {
  return title.split(/(?<=\s)/u).filter((word) => word.length > 0);
}

const RIGHT_TO_LEFT_CHARACTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;

/**
 * Text that mixes right-to-left and left-to-right runs must stay in one box:
 * the browser orders separate word boxes by the paragraph direction alone, which
 * scrambles a heading such as "من Codex وClaude Code".
 */
export function hasRightToLeftText(text: string): boolean {
  return RIGHT_TO_LEFT_CHARACTER.test(text);
}

// Each element sets its own delay through a custom property, so the stylesheet
// owns the timing curve and the component only says where in the order it is.
function order(index: number): CSSProperties {
  return { '--hero-order': index } as CSSProperties;
}

export function HeroBrand({
  brand,
  title,
  subtitle,
  trustLine,
}: {
  brand: string;
  title: string;
  subtitle: string;
  trustLine: string;
}) {
  const steps = splitPipelineSteps(subtitle);
  const words = hasRightToLeftText(title) ? [title] : splitTitleWords(title);
  const letters = hasRightToLeftText(brand) ? [brand.toLowerCase()] : Array.from(brand.toLowerCase());

  return (
    <div className={styles.stage} data-testid="home-hero-brand">
      <div className={styles.field} aria-hidden>
        <div className={styles.dots} />
        <div className={styles.sweep} />
        <span className={styles.ripple} />
        <span className={`${styles.ripple} ${styles.rippleLate}`} />
      </div>

      <div className={styles.brand}>
        <span className={styles.mark} aria-hidden>
          <svg viewBox="0 0 444 444" focusable="false">
            <rect className={styles.markTile} width="444" height="444" rx="104" />
            <path
              className={styles.markStroke}
              d="M92 312V138L222 306L352 138V312"
              pathLength={1}
            />
          </svg>
          <span className={styles.glint} />
        </span>
        <span className={styles.name}>
          <VisuallyHidden>{brand}</VisuallyHidden>
          <span aria-hidden dir="auto">
            {letters.map((letter, index) => (
              <span key={index} className={styles.letter} style={order(index)}>
                {letter}
              </span>
            ))}
          </span>
        </span>
      </div>

      {/* The heading's name comes from the hidden copy: name computation trims each
          word box, which would run the animated words together. */}
      <h1 className={styles.title}>
        <VisuallyHidden>{title}</VisuallyHidden>
        <span aria-hidden>
          {words.map((word, index) => {
            // The space stays outside the word's box, so lines break and balance
            // at real spaces as they did before the words moved.
            const text = word.trimEnd();
            return (
              <Fragment key={index}>
                <span className={styles.word} style={order(index)} data-word={index}>
                  {text}
                </span>
                {word.slice(text.length)}
              </Fragment>
            );
          })}
        </span>
      </h1>

      <p className={styles.pipeline}>
        <VisuallyHidden>{subtitle}</VisuallyHidden>
        {steps.map((step, index) => {
          const stepNode = (
            <span
              className={styles.step}
              style={order(index)}
              data-step={index}
              data-label={step}
              aria-hidden
            >
              {step}
            </span>
          );
          if (index === 0) return <Fragment key={index}>{stepNode}</Fragment>;
          // A link travels with the step it leads to, so a narrow screen wraps
          // before an arrow instead of leaving one at the end of a line.
          return (
            <span key={index} className={styles.pair} aria-hidden>
              <span className={styles.link} style={order(index)} data-link={index}>
                <span className={styles.track}>
                  <span className={styles.pulse} />
                </span>
              </span>
              {stepNode}
            </span>
          );
        })}
      </p>

      <p className={styles.trust}>{trustLine}</p>
    </div>
  );
}
