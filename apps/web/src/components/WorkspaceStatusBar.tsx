import { UpdaterPopup } from './UpdaterPopup';
import type { AppVersionInfo } from '../types';
import styles from './WorkspaceStatusBar.module.css';

export function WorkspaceStatusBar({ appVersionInfo, desktopNotificationsEnabled }: {
  appVersionInfo: AppVersionInfo | null;
  desktopNotificationsEnabled: boolean;
}) {
  return (
    <footer className={styles.root} data-testid="workspace-status-bar">
      <span className={styles.identity}>MonoField{appVersionInfo?.version ? ` · ${appVersionInfo.version}` : ''}</span>
      <UpdaterPopup
        appVersionInfo={appVersionInfo}
        desktopNotificationsEnabled={desktopNotificationsEnabled}
        showLabel
      />
    </footer>
  );
}
