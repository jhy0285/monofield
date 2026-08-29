import { useEffect, useRef } from 'react';
import { useT } from '../i18n';
import { useAnalytics } from '../analytics/provider';
import { trackRunFailedToastSurfaceView } from '../analytics/events';
import type { TrackingProjectKind } from '@open-design/contracts/analytics';
import {
  GITHUB_ISSUES_URL,
  GITHUB_PROBLEM_REPORT_URL,
} from './useGithubStars';

export interface AmrGuidanceProps {
  errorCode: string;
  projectId: string;
  projectKind: TrackingProjectKind | null;
  conversationId: string | null;
  assistantMessageId: string;
  runId: string | null;
}

// Recovery card under a failed run. Users retry their selected provider first,
// then have direct support routes if the same failure continues.
export function AmrGuidance({
  errorCode,
  projectId,
  projectKind,
  conversationId,
  assistantMessageId,
  runId,
}: AmrGuidanceProps) {
  const t = useT();
  const analytics = useAnalytics();
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    trackRunFailedToastSurfaceView(analytics.track, {
      page_name: 'chat_panel',
      area: 'chat_panel',
      element: 'run_failed_toast',
      error_code: errorCode,
      project_id: projectId,
      project_kind: projectKind,
      conversation_id: conversationId,
      assistant_message_id: assistantMessageId,
      run_id: runId,
    });
  }, [
    analytics.track,
    errorCode,
    projectId,
    projectKind,
    conversationId,
    assistantMessageId,
    runId,
  ]);

  return (
    <div className="amr-card amr-card--switch" data-testid="amr-guidance">
      <div className="amr-card__head">
        <span className="amr-card__icon" aria-hidden="true">
          !
        </span>
        <strong className="amr-card__title">{t('chat.amrCard.switchTitle')}</strong>
      </div>
      <p className="amr-card__body">{t('chat.amrCard.switchBody')}</p>
      <div className="amr-card__actions">
        <a
          className="amr-card__cta"
          href={GITHUB_ISSUES_URL}
          target="_blank"
          rel="noreferrer"
        >
          {t('chat.amrCard.chipOfficial')}
        </a>
        <a
          className="amr-card__cta amr-card__cta--secondary"
          href={GITHUB_PROBLEM_REPORT_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          {t('chat.amrCard.chipNoKey')}
        </a>
      </div>
    </div>
  );
}
