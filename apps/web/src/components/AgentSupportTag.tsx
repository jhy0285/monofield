'use client';

import { useT } from '../i18n';
import { isCommunityAgent } from '../lib/agent-support';
import styles from './AgentSupportTag.module.css';

/** Small "Community" mark beside a local CLI that MonoField has not verified. */
export function AgentSupportTag({ id }: { id: string | null | undefined }) {
  const t = useT();
  if (!isCommunityAgent(id)) return null;
  return (
    <span className={styles.tag} title={t('agent.communityHint')}>
      {t('agent.community')}
    </span>
  );
}
