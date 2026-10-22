'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Dialog } from '@open-design/components';
import { useT } from '../i18n';
import { dismissOntologyTutorial, ontologyTutorialDismissed } from '../state/ontology-tutorial';
import styles from './OntologyTutorial.module.css';

const steps = ['scope', 'context', 'evidence', 'impact', 'verify'] as const;
const STEP_MS = 7000;

/** A local illustrative demo. It never reads project files or calls an analysis/model API. */
export function OntologyTutorial({ onClose, hasDocuments = false }: { onClose: () => void; hasDocuments?: boolean }) {
  const t = useT(), id = useId(), dialogId = `ontology-demo-${id}`;
  const [step, setStep] = useState(0), [playing, setPlaying] = useState(false);
  const [withDocuments, setWithDocuments] = useState(hasDocuments);
  const [neverAgain, setNeverAgain] = useState(ontologyTutorialDismissed);
  const [reducedMotion, setReducedMotion] = useState(false);
  const closeRef = useRef(() => {});
  closeRef.current = () => { dismissOntologyTutorial(neverAgain); onClose(); };

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    setReducedMotion(query?.matches ?? false);
    setPlaying(!query?.matches);
    const change = () => { setReducedMotion(query?.matches ?? false); if (query?.matches) setPlaying(false); };
    query?.addEventListener?.('change', change);
    return () => query?.removeEventListener?.('change', change);
  }, []);

  useEffect(() => {
    const dialog = document.getElementById(dialogId), previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab' || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, [dialogId]);

  useEffect(() => {
    if (!playing || reducedMotion || step >= steps.length - 1) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== 'visible') { setPlaying(false); return; }
      setStep(current => Math.min(steps.length - 1, current + 1));
    }, STEP_MS);
    return () => window.clearTimeout(timer);
  }, [playing, reducedMotion, step]);

  const active = steps[step]!;
  const go = (next: number) => { setPlaying(false); setStep(next); };
  return createPortal(<Dialog id={dialogId} className={styles.dialog} backdropClassName={styles.backdrop}
    ariaLabelledBy={`${dialogId}-title`} ariaDescribedBy={`${dialogId}-description`} onClose={() => closeRef.current()} closeOnBackdrop={false}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>{t('ontology.tour.demo')}</span><h2 id={`${dialogId}-title`}>{t('ontology.tour.title')}</h2></div>
      <Button variant="ghost" size="icon" aria-label={t('common.close')} onClick={() => closeRef.current()}><span aria-hidden="true">×</span></Button>
    </header>
    <p id={`${dialogId}-description`} className={styles.disclaimer}>{t('ontology.tour.disclaimer')}</p>
    <div className={styles.stage} data-demo-step={active} data-reduced-motion={reducedMotion}>
      <div className={styles.stageBar}><span aria-hidden="true">● ● ●</span><span>traffic / MonoField</span><span>{String(step + 1).padStart(2, '0')} / 05</span></div>
      <div className={styles.workspace}>
        <aside className={styles.files} aria-label={t('ontology.tour.files')}>
          <strong>traffic</strong>
          {['SignalService.java', 'SignalController.java', 'SignalDashboard.vue'].map(name => <span className={step === 0 ? styles.highlight : undefined} key={name}>{name}</span>)}
          <span className={step === 1 ? styles.highlight : undefined}>{withDocuments ? 'traffic-rules.md' : t('ontology.context.codeOnlyTitle')}</span>
        </aside>
        <div className={styles.preview}>
          {step < 2 ? <>
            <pre className={step === 0 ? styles.highlight : undefined}><code>{'class SignalService {\n  int readSignalCycle(long id) {\n    return repository.findCycle(id);\n  }\n}'}</code></pre>
            <div className={step === 1 ? styles.highlight : styles.note}><strong>{withDocuments ? 'traffic-rules.md' : t('ontology.context.codeOnlyTitle')}</strong><p>{withDocuments ? t('ontology.tour.documentExample') : t('ontology.context.codeOnlyBody')}</p></div>
          </> : <>
            <div className={styles.graph} aria-label={t('ontology.tour.relationships')}>
              {['SignalService', 'SignalController', 'GET /signal-cycle', 'SignalDashboard.vue'].map((name, index) => <div key={name} className={styles.graphRow}><span className={styles.node}>{name}</span>{index < 3 ? <span aria-hidden="true">↓</span> : null}</div>)}
            </div>
            <p className={styles.candidate}>{t('ontology.candidate')}</p>
            {step === 2 ? <code className={styles.evidence}>SignalController.java:12 · {t('ontology.evidence')}</code> : null}
            {step === 3 ? <div className={styles.highlight}><strong>API → {t('ontology.tour.screenSpec')}</strong><p>{t('ontology.tour.reviewExample')}</p></div> : null}
            {step === 4 ? <div className={styles.highlight}><p>Maven test · {t('ontology.tour.needsRun')}</p><p>{t('ontology.context.unverified')}</p></div> : null}
          </>}
        </div>
      </div>
    </div>
    <div className={styles.contextChoice} role="group" aria-label={t('ontology.tour.compare')}>
      <Button aria-pressed={!withDocuments} onClick={() => { setWithDocuments(false); go(1); }}>{t('ontology.tour.codeOnly')}</Button>
      <Button aria-pressed={withDocuments} onClick={() => { setWithDocuments(true); go(1); }}>{t('ontology.tour.withDocuments')}</Button>
    </div>
    <section className={styles.copy} aria-live={playing ? 'off' : 'polite'}>
      <span className={styles.eyebrow}>{t('ontology.tour.step', { current: step + 1, total: steps.length })}</span>
      <h3>{t(`ontology.tour.${active}.title`)}</h3><p>{t(`ontology.tour.${active}.body`)}</p>
    </section>
    <nav className={styles.progress} aria-label={t('ontology.tour.steps')}>
      {steps.map((key, index) => <Button key={key} aria-current={step === index ? 'step' : undefined}
        aria-label={t('ontology.tour.step', { current: index + 1, total: steps.length })} onClick={() => go(index)}>{index + 1}</Button>)}
    </nav>
    <footer className={styles.footer}>
      <label><input type="checkbox" checked={neverAgain} onChange={event => setNeverAgain(event.target.checked)} />{t('ontology.tour.neverAgain')}</label>
      <div className={styles.controls}>
        <Button variant="ghost" disabled={reducedMotion} onClick={() => { if (step === steps.length - 1) { setStep(0); setPlaying(true); } else setPlaying(value => !value); }}>{playing && step < steps.length - 1 ? t('ontology.tour.pause') : t('ontology.tour.play')}</Button>
        <Button disabled={step === 0} onClick={() => go(step - 1)}>{t('productTutorial.previous')}</Button>
        {step < steps.length - 1 ? <Button variant="primary" onClick={() => go(step + 1)}>{t('productTutorial.next')}</Button>
          : <Button variant="primary" onClick={() => closeRef.current()}>{t('ontology.tour.finish')}</Button>}
      </div>
    </footer>
  </Dialog>, document.body);
}
