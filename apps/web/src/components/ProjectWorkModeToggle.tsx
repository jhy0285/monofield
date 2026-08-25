import type { ProjectWorkMode } from '@open-design/contracts';

import { useT } from '../i18n';
import styles from './ProjectWorkModeToggle.module.css';

interface Props {
  value: ProjectWorkMode;
  onChange: (value: ProjectWorkMode) => void;
  compact?: boolean;
}

export function ProjectWorkModeToggle({ value, onChange, compact = false }: Props) {
  const t = useT();
  const hint = value === 'development'
    ? t('workMode.developmentHint')
    : t('workMode.creationHint');

  return (
    <div className={`${styles.root}${compact ? ` ${styles.compact}` : ''}`}>
      <div className={styles.header}>{t('workMode.label')}</div>
      <div className={styles.options} role="radiogroup" aria-label={t('workMode.label')}>
        <button
          type="button"
          role="radio"
          aria-checked={value === 'development'}
          className={value === 'development' ? styles.selected : undefined}
          onClick={() => onChange('development')}
          data-testid="work-mode-development"
        >
          {t('workMode.development')}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value === 'creation'}
          className={value === 'creation' ? styles.selected : undefined}
          onClick={() => onChange('creation')}
          data-testid="work-mode-creation"
        >
          {t('workMode.creation')}
        </button>
      </div>
      <p className={styles.hint}>{hint}</p>
    </div>
  );
}
