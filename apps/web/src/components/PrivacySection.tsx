import type { Dispatch, SetStateAction } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';
import type { AppConfig } from '../types';

interface Props {
  cfg: AppConfig;
  setCfg: Dispatch<SetStateAction<AppConfig>>;
}

export function PrivacySection({ cfg, setCfg }: Props): JSX.Element {
  const t = useT();

  function clearLocalPrivacyState(): void {
    setCfg((c) => ({
      ...c,
      installationId: null,
      privacyDecisionAt: c.privacyDecisionAt ?? Date.now(),
      telemetry: { metrics: false, content: false, artifactManifest: false },
    }));
  }

  return (
    <section className="settings-section">
      <div className="settings-subsection">
        <div className="section-head">
          <div>
            <h4>{t('settings.privacyConsentKicker')}</h4>
            <p className="hint">{t('settings.privacyConsentLead')}</p>
          </div>
        </div>

        <dl className="settings-privacy-disclosure">
          <div>
            <dt>{t('settings.privacyMetrics')}</dt>
            <dd>{t('settings.privacyMetricsHint')}</dd>
          </div>
          <div>
            <dt>{t('settings.privacyContent')}</dt>
            <dd>{t('settings.privacyContentHint')}</dd>
          </div>
        </dl>

        <p className="hint">{t('settings.privacyConsentFooter')}</p>
      </div>

      <div className="settings-subsection">
        <div className="section-head">
          <div>
            <h4>{t('settings.privacyInstallationId')}</h4>
            <p className="hint">{t('settings.privacyDataDeletionHint')}</p>
          </div>
        </div>
        <div className="settings-field">
          <input
            type="text"
            readOnly
            value={cfg.installationId ?? t('settings.privacyOptedOut')}
            aria-label={t('settings.privacyInstallationId')}
          />
        </div>
        <button
          type="button"
          className="ghost"
          onClick={clearLocalPrivacyState}
          style={{ alignSelf: 'flex-start', marginTop: 12 }}
        >
          <Icon name="trash" size={13} />
          <span style={{ marginLeft: 6 }}>{t('settings.privacyDataDeletion')}</span>
        </button>
      </div>
    </section>
  );
}
