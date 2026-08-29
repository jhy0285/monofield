import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { OpenDesignHostUpdaterStatusSnapshot } from '@open-design/host';

import { Icon } from './Icon';
import { popoverIn } from '../motion';
import {
  deriveUpdaterModel,
  openUpdaterInstaller,
  quitAfterUpdaterInstallerOpen,
  readUpdaterStatus,
  subscribeToUpdaterStatus,
  type UpdaterModel,
} from '../lib/updater';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import { useAnalytics, useAppVersion } from '../analytics/provider';
import {
  trackUpdateIndicatorClick,
  trackUpdateIndicatorSurfaceView,
  trackUpdateInstallResult,
  trackUpdatePromptSurfaceView,
} from '../analytics/events';
import {
  fetchLatestGithubReleaseInfo,
  openExternalUrl,
  type LatestGithubReleaseInfo,
} from '../providers/registry';
import type { AppVersionInfo } from '../types';
import { showCompletionNotification } from '../utils/notifications';
import { GITHUB_REPO_URL } from './useGithubStars';

const INSTALL_HANDOFF_WATCHDOG_MS = 10_000;
const RELEASE_CHECK_DELAY_MS = 1_500;
const UPDATE_DISMISSED_STORAGE_KEY = 'monofield:update-dismissed:v1';
const UPDATE_NOTIFIED_STORAGE_KEY = 'monofield:update-notified:v1';
const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`;

type InstallState = 'idle' | 'opening' | 'handoff' | 'recoverable';
type Translator = (key: keyof Dict, vars?: Record<string, string | number>) => string;
type ManualRelease = LatestGithubReleaseInfo & {
  currentVersion: string;
  version: string;
};

function numericVersionParts(raw: string): number[] {
  return raw.split('.').map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isFinite(value) ? value : 0;
  });
}

export function isNewerRelease(currentVersion: string, candidateVersion: string): boolean {
  const [currentCore, currentPrerelease] = currentVersion.replace(/^v/i, '').split('-', 2);
  const [candidateCore, candidatePrerelease] = candidateVersion.replace(/^v/i, '').split('-', 2);
  const current = numericVersionParts(currentCore ?? '0');
  const candidate = numericVersionParts(candidateCore ?? '0');
  const length = Math.max(current.length, candidate.length);
  for (let index = 0; index < length; index += 1) {
    const left = candidate[index] ?? 0;
    const right = current[index] ?? 0;
    if (left !== right) return left > right;
  }
  if (!currentPrerelease && candidatePrerelease) return false;
  if (currentPrerelease && !candidatePrerelease) return true;
  if (!currentPrerelease || !candidatePrerelease) return false;
  return candidatePrerelease.localeCompare(currentPrerelease, undefined, { numeric: true }) > 0;
}

function versionText(t: Translator, model: UpdaterModel): string {
  const version = model.availableVersion;
  if (model.updateKind === 'payload') {
    return version == null ? t('updater.payloadReadyGeneric') : t('updater.payloadReadyVersion', { version });
  }
  return version == null ? t('updater.readyGeneric') : t('updater.readyVersion', { version });
}

function installActionText(t: Translator, model: UpdaterModel, installBusy: boolean): string {
  if (model.updateKind === 'payload') {
    return installBusy ? t('updater.installingRestart') : t('updater.installRestart');
  }
  return installBusy ? t('updater.opening') : t('updater.openInstaller');
}

function channelLabelFor(t: Translator, channel: string | null | undefined): string | null {
  switch (channel) {
    case 'beta':
      return t('updater.channelBeta');
    case 'prerelease':
      return t('updater.channelPrerelease');
    case 'preview':
      return t('updater.channelPreview');
    case 'stable':
      return t('updater.channelStable');
    default:
      return null;
  }
}

function updateVersionProps(model: UpdaterModel, appVersionBefore: string | null) {
  return {
    ...(appVersionBefore ? { app_version_before: appVersionBefore } : {}),
    ...(model.availableVersion ? { app_version_after: model.availableVersion } : {}),
  };
}

function updaterErrorCode(model: UpdaterModel): string | undefined {
  return model.status?.error?.code;
}

export function UpdaterPopup({
  appVersionInfo = null,
  desktopNotificationsEnabled = false,
}: {
  appVersionInfo?: AppVersionInfo | null;
  desktopNotificationsEnabled?: boolean;
}) {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const actionInFlightRef = useRef(false);
  const handoffWatchdogRef = useRef<number | null>(null);
  const [model, setModel] = useState<UpdaterModel>(() => deriveUpdaterModel(null));
  const [panelOpen, setPanelOpen] = useState(false);
  const [installState, setInstallState] = useState<InstallState>('idle');
  const [manualRelease, setManualRelease] = useState<ManualRelease | null>(null);
  const lastAutoPromptVersionRef = useRef<string | null>(null);

  const clearHandoffWatchdog = useCallback(() => {
    if (handoffWatchdogRef.current == null) return;
    window.clearTimeout(handoffWatchdogRef.current);
    handoffWatchdogRef.current = null;
  }, []);

  const recoverFromInstallerHandoff = useCallback(() => {
    handoffWatchdogRef.current = null;
    actionInFlightRef.current = false;
    setInstallState('recoverable');
    setPanelOpen(true);
  }, []);

  const startHandoffWatchdog = useCallback(() => {
    clearHandoffWatchdog();
    // The quit IPC can resolve before Electron has actually torn down the
    // renderer. Keep the handoff UI up, but do not leave it stuck forever.
    handoffWatchdogRef.current = window.setTimeout(recoverFromInstallerHandoff, INSTALL_HANDOFF_WATCHDOG_MS);
  }, [clearHandoffWatchdog, recoverFromInstallerHandoff]);

  useEffect(() => clearHandoffWatchdog, [clearHandoffWatchdog]);

  useEffect(() => {
    let mounted = true;
    const applyStatus = (status: OpenDesignHostUpdaterStatusSnapshot) => {
      if (!mounted) return;
      setModel(deriveUpdaterModel(status, { hostAvailable: true }));
    };
    const unsubscribe = subscribeToUpdaterStatus(applyStatus);
    void readUpdaterStatus({ payload: { source: 'updater-indicator:mount' } }).then((result) => {
      if (!mounted) return;
      if (result.ok) {
        setModel(result.model);
      } else {
        setModel(deriveUpdaterModel(null, { hostAvailable: false }));
      }
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!appVersionInfo?.packaged || manualRelease != null) return;
    // A provisioned Desktop updater owns the normal check/download flow. The
    // public GitHub lookup below is only a safety net for packaged builds whose
    // host updater is unavailable or explicitly disabled.
    if (model.environment === 'desktop' && model.status == null) return;
    if (
      model.environment === 'desktop' &&
      model.enabled &&
      model.supported &&
      model.errorMessage == null
    ) return;
    let mounted = true;
    const timer = window.setTimeout(() => {
      void fetchLatestGithubReleaseInfo().then((latest) => {
        if (!mounted || !latest || latest.stale) return;
        const version = latest.tagName.replace(/^v/i, '');
        if (!version || !isNewerRelease(appVersionInfo.version, version)) return;
        setManualRelease({ ...latest, currentVersion: appVersionInfo.version, version });
      });
    }, RELEASE_CHECK_DELAY_MS);
    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, [
    appVersionInfo,
    manualRelease,
    model.enabled,
    model.environment,
    model.errorMessage,
    model.status,
    model.supported,
  ]);

  const nativeReady = model.environment === 'desktop' && model.shouldShowControl;
  const manualReady = manualRelease != null && !nativeReady;
  // A failed update check is not proof that an update exists. Only surface an
  // automatic failure prompt when the native updater had already identified a
  // version or downloaded artifact; otherwise the GitHub fallback may still
  // discover a real newer release without turning a transient check error into
  // a false update alert.
  const nativeErrorHasUpdateEvidence = Boolean(
    model.availableVersion != null ||
    model.status?.downloadPath ||
    model.status?.artifact,
  );
  const nativeErrorReady = Boolean(
    appVersionInfo?.packaged &&
    model.environment === 'desktop' &&
    model.enabled &&
    model.supported &&
    model.errorMessage != null &&
    nativeErrorHasUpdateEvidence &&
    !nativeReady &&
    !manualReady,
  );
  const ready = nativeReady || manualReady || nativeErrorReady;
  const displayModel = manualReady
    ? {
        ...model,
        availableVersion: manualRelease.version,
        currentVersion: manualRelease.currentVersion,
        updateKind: 'unknown' as const,
      }
    : model;
  const promptVersion = displayModel.availableVersion ?? (
    nativeErrorReady
      ? `error:${displayModel.currentVersion ?? appVersionInfo?.version ?? 'unknown'}:${updaterErrorCode(displayModel) ?? 'unknown'}`
      : null
  );
  const installBusy = installState === 'opening' || installState === 'handoff';
  const canStartInstall = ready || installState === 'recoverable';
  const showControl = ready || installState !== 'idle';
  const controlLabel = manualReady || nativeErrorReady
    ? t('updater.openReleasePage')
    : model.updateKind === 'payload'
      ? t('updater.installRestart')
      : t('updater.openInstaller');
  const channelLabel = channelLabelFor(t, displayModel.status?.channel);
  const analytics = useAnalytics();
  const appVersionBefore = useAppVersion();
  const versionProps = useMemo(
    () => updateVersionProps(displayModel, manualRelease?.currentVersion ?? appVersionBefore),
    [appVersionBefore, displayModel.availableVersion, manualRelease?.currentVersion],
  );

  useEffect(() => {
    if (!ready || promptVersion == null) return;
    try {
      if (window.localStorage.getItem(UPDATE_DISMISSED_STORAGE_KEY) === promptVersion) return;
    } catch {
      // Storage restrictions should never suppress an update alert.
    }
    if (lastAutoPromptVersionRef.current === promptVersion) return;
    lastAutoPromptVersionRef.current = promptVersion;
    setPanelOpen(true);

    if (!desktopNotificationsEnabled) return;
    const isHidden = typeof document !== 'undefined' && document.hidden;
    const isFocused = typeof document === 'undefined' ? true : document.hasFocus();
    if (!isHidden && isFocused) return;
    try {
      if (window.localStorage.getItem(UPDATE_NOTIFIED_STORAGE_KEY) === promptVersion) return;
    } catch {
      // Continue with a best-effort native notification.
    }
    const title = nativeErrorReady
      ? t('updater.failed')
      : manualReady
        ? t('updater.available')
        : t('updater.ready');
    const body = nativeErrorReady
      ? t('updater.openFailedFallback')
      : manualReady && manualRelease
      ? t('updater.availableBody', { version: manualRelease.version })
      : versionText(t, displayModel);
    void showCompletionNotification({
      status: 'succeeded',
      title,
      body,
      tag: `monofield-update-${promptVersion}`,
      onClick: () => setPanelOpen(true),
    }).then((result) => {
      if (result !== 'shown') return;
      try {
        window.localStorage.setItem(UPDATE_NOTIFIED_STORAGE_KEY, promptVersion);
      } catch {
        // In-app prompting remains available when persistence is blocked.
      }
    });
  }, [desktopNotificationsEnabled, displayModel, manualReady, manualRelease, nativeErrorReady, promptVersion, ready, t]);

  const indicatorSurfaceKey = `${displayModel.currentVersion ?? 'unknown'}->${displayModel.availableVersion ?? 'unknown'}:${displayModel.status?.downloadPath ?? manualRelease?.htmlUrl ?? 'unknown'}`;
  const lastIndicatorSurfaceKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) {
      lastIndicatorSurfaceKeyRef.current = null;
      return;
    }
    if (lastIndicatorSurfaceKeyRef.current === indicatorSurfaceKey) return;
    lastIndicatorSurfaceKeyRef.current = indicatorSurfaceKey;
    trackUpdateIndicatorSurfaceView(analytics.track, {
      page_name: 'home',
      area: 'update_indicator',
      ...versionProps,
    });
  }, [analytics.track, indicatorSurfaceKey, ready, versionProps]);

  const promptSurfaceKey = panelOpen ? indicatorSurfaceKey : null;
  const lastPromptSurfaceKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (promptSurfaceKey == null) {
      lastPromptSurfaceKeyRef.current = null;
      return;
    }
    if (lastPromptSurfaceKeyRef.current === promptSurfaceKey) return;
    lastPromptSurfaceKeyRef.current = promptSurfaceKey;
    trackUpdatePromptSurfaceView(analytics.track, {
      page_name: 'home',
      area: 'update_prompt',
      ...versionProps,
    });
  }, [analytics.track, promptSurfaceKey, versionProps]);

  const close = useCallback(() => {
    if (installBusy) return;
    trackUpdateIndicatorClick(analytics.track, {
      page_name: 'home',
      area: 'update_prompt',
      element: 'later',
      action: 'dismiss',
      ...versionProps,
    });
    if (promptVersion != null) {
      try {
        window.localStorage.setItem(UPDATE_DISMISSED_STORAGE_KEY, promptVersion);
      } catch {
        // A dismissed prompt stays closed for this session even without storage.
      }
    }
    setPanelOpen(false);
  }, [analytics.track, installBusy, promptVersion, versionProps]);

  useEffect(() => {
    if (!panelOpen) return;
    const onDocClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!wrapRef.current?.contains(target)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [close, panelOpen]);

  const installAndQuit = async () => {
    if (actionInFlightRef.current || !canStartInstall) return;
    actionInFlightRef.current = true;
    clearHandoffWatchdog();
    setInstallState('opening');
    setPanelOpen(true);
    trackUpdateIndicatorClick(analytics.track, {
      page_name: 'home',
      area: 'update_prompt',
      element: 'install_update',
      action: 'install',
      ...versionProps,
    });
    if ((manualReady && manualRelease) || nativeErrorReady) {
      const releaseUrl = manualRelease?.htmlUrl ?? GITHUB_RELEASES_URL;
      try {
        if (promptVersion != null) {
          window.localStorage.setItem(UPDATE_DISMISSED_STORAGE_KEY, promptVersion);
        }
      } catch {
        // Opening the release page is still a successful handoff without storage.
      }
      const opened = await openExternalUrl(releaseUrl);
      actionInFlightRef.current = false;
      setInstallState('idle');
      if (opened) setPanelOpen(false);
      return;
    }
    try {
      const result = await openUpdaterInstaller({ payload: { source: 'updater-prompt' } });
      if (!result.ok) {
        actionInFlightRef.current = false;
        setInstallState('idle');
        trackUpdateInstallResult(analytics.track, {
          page_name: 'home',
          area: 'update_prompt',
          result: 'failed',
          error_code: result.reason,
          ...versionProps,
        });
        return;
      }
      if (result.model.errorMessage != null) {
        actionInFlightRef.current = false;
        setInstallState('idle');
        trackUpdateInstallResult(analytics.track, {
          page_name: 'home',
          area: 'update_prompt',
          result: 'failed',
          ...(updaterErrorCode(result.model) ? { error_code: updaterErrorCode(result.model) } : {}),
          ...versionProps,
        });
        return;
      }
      setModel(result.model);
      setInstallState('handoff');
      startHandoffWatchdog();
      trackUpdateInstallResult(analytics.track, {
        page_name: 'home',
        area: 'update_prompt',
        result: 'success',
        ...versionProps,
      });
      const quitResult = await quitAfterUpdaterInstallerOpen({ payload: { source: 'updater-prompt' } });
      if (!quitResult.ok) {
        clearHandoffWatchdog();
        actionInFlightRef.current = false;
        setInstallState('recoverable');
        setPanelOpen(true);
      }
    } catch (error) {
      clearHandoffWatchdog();
      actionInFlightRef.current = false;
      setInstallState('idle');
      trackUpdateInstallResult(analytics.track, {
        page_name: 'home',
        area: 'update_prompt',
        result: 'failed',
        error_code: error instanceof Error ? error.name : 'unknown',
        ...versionProps,
      });
    }
  };

  if (!showControl) return null;

  return (
    <div className="entry-updater-menu" ref={wrapRef}>
      <button
        aria-disabled={installBusy ? 'true' : undefined}
        aria-expanded={panelOpen}
        aria-label={controlLabel}
        className={`entry-nav-rail__btn entry-updater-menu__button is-ready${panelOpen ? ' is-active' : ''}${installBusy ? ' is-disabled' : ''}`}
        data-testid="entry-nav-updater"
        data-tooltip={controlLabel}
        title={controlLabel}
        type="button"
        onClick={() => {
          if (installBusy) return;
          if (panelOpen) {
            close();
            return;
          }
          trackUpdateIndicatorClick(analytics.track, {
            page_name: 'home',
            area: 'update_indicator',
            element: 'ready_indicator',
            action: 'open_prompt',
            ...versionProps,
          });
          setPanelOpen(true);
        }}
      >
        <span className="entry-updater-menu__glyph">
          <Icon name="arrow-up" size={18} strokeWidth={2.25} />
        </span>
      </button>
      <AnimatePresence>
        {panelOpen ? (
          <motion.section
            aria-labelledby="updater-popup-title"
            className="updater-popup is-ready"
            data-testid="updater-popup"
            role="dialog"
            variants={popoverIn}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <div className="updater-popup__icon">
              <Icon name="arrow-up" size={20} strokeWidth={2.2} />
            </div>
            <div className="updater-popup__body">
              <h2 id="updater-popup-title">
                {nativeErrorReady
                  ? t('updater.failed')
                  : manualReady
                    ? t('updater.available')
                    : t('updater.ready')}
              </h2>
              <p>
                {nativeErrorReady
                  ? t('updater.openFailedFallback')
                  : manualReady && manualRelease
                  ? t('updater.availableBody', { version: manualRelease.version })
                  : versionText(t, displayModel)}
              </p>
              {channelLabel != null ? <span className="updater-popup__badge">{channelLabel}</span> : null}
              <button
                className="updater-popup__star"
                data-testid="updater-star-button"
                type="button"
                onClick={() => {
                  void openExternalUrl(GITHUB_REPO_URL);
                }}
              >
                <Icon name="github-filled" size={14} aria-hidden />
                {t('community.starAction')}
              </button>
            </div>
            <div className="updater-popup__actions">
              <button className="updater-popup__button" disabled={installBusy} type="button" onClick={close}>
                {t('updater.later')}
              </button>
              <button
                className="updater-popup__button updater-popup__button--primary"
                data-testid="updater-install-button"
                disabled={installBusy}
                type="button"
                onClick={() => {
                  void installAndQuit();
                }}
              >
                {manualReady || nativeErrorReady
                  ? t('updater.openReleasePage')
                  : installActionText(t, displayModel, installBusy)}
              </button>
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
