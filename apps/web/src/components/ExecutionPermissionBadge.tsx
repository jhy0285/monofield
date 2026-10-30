import { useT } from '../i18n';
import { useExecutionPermissions } from '../providers/execution-permissions';
import { RemixIcon } from './RemixIcon';
import styles from './ExecutionPermissionBadge.module.css';

/**
 * Red "Full access" pill beside the settings cog while Settings → Execution
 * permissions is on `full`, so a widened agent sandbox is never out of sight.
 * Renders nothing at the other levels or while the daemon is unreachable.
 */
export function ExecutionPermissionBadge({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  const { permissions } = useExecutionPermissions();
  if (permissions?.level !== 'full') return null;
  return (
    <button
      type="button"
      className={`${styles.badge} od-tooltip`}
      onClick={onOpen}
      title={t('executionPermissions.badgeTooltip')}
      data-tooltip={t('executionPermissions.badgeTooltip')}
      data-tooltip-placement="bottom"
      data-testid="execution-permission-badge"
    >
      <RemixIcon name="shield-flash-line" size={13} />
      <span>{t('executionPermissions.badge')}</span>
    </button>
  );
}
