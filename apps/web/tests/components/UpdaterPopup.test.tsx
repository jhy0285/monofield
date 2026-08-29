// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OpenDesignHostUpdaterStatusListener, OpenDesignHostUpdaterStatusSnapshot } from '@open-design/host';
import { installMockOpenDesignHost } from '@open-design/host/testing';

vi.mock('../../src/providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/providers/registry')>();
  return {
    ...actual,
    fetchLatestGithubReleaseInfo: vi.fn(),
    openExternalUrl: vi.fn(),
  };
});

vi.mock('../../src/utils/notifications', () => ({
  showCompletionNotification: vi.fn(),
}));

import { isNewerRelease, UpdaterPopup } from '../../src/components/UpdaterPopup';
import { I18nProvider } from '../../src/i18n';
import {
  fetchLatestGithubReleaseInfo,
  openExternalUrl,
} from '../../src/providers/registry';
import type { AppVersionInfo } from '../../src/types';
import { GITHUB_REPO_URL } from '../../src/components/useGithubStars';
import { showCompletionNotification } from '../../src/utils/notifications';

const PACKAGED_APP_VERSION: AppVersionInfo = {
  version: '0.1.0',
  channel: 'stable',
  packaged: true,
  platform: 'win32',
  arch: 'x64',
};

const UNPACKAGED_APP_VERSION: AppVersionInfo = {
  ...PACKAGED_APP_VERSION,
  channel: 'development',
  packaged: false,
};

function idleStatus(): OpenDesignHostUpdaterStatusSnapshot {
  return {
    arch: 'arm64',
    capabilities: {
      canApplyInPlace: false,
      canDownload: true,
      canOpenInstaller: true,
      requiresManualInstall: true,
    },
    channel: 'beta',
    currentVersion: '1.2.3-beta.3',
    enabled: true,
    mode: 'package-launcher',
    platform: 'darwin',
    state: 'idle',
    supported: true,
  };
}

function downloadedStatus(overrides: Partial<OpenDesignHostUpdaterStatusSnapshot> = {}): OpenDesignHostUpdaterStatusSnapshot {
  return {
    ...idleStatus(),
    availableVersion: '1.2.3-beta.4',
    downloadPath: '/tmp/open-design-updater/Open Design Beta.dmg',
    state: 'downloaded',
    ...overrides,
  };
}

function payloadDownloadedStatus(overrides: Partial<OpenDesignHostUpdaterStatusSnapshot> = {}): OpenDesignHostUpdaterStatusSnapshot {
  return downloadedStatus({
    artifact: {
      name: 'open-design-1.2.3-beta.4-mac-arm64-payload.zip',
      platformKey: 'mac',
      size: 1024,
      type: 'payload',
      url: 'https://example.test/payload.zip',
    },
    capabilities: {
      canApplyInPlace: true,
      canDownload: true,
      canOpenInstaller: false,
      requiresManualInstall: false,
    },
    downloadPath: '/tmp/open-design-updater/open-design-1.2.3-beta.4-mac-arm64-payload.zip',
    ...overrides,
  });
}

describe('isNewerRelease', () => {
  it('compares release versions numerically', () => {
    expect(isNewerRelease('0.11.3', 'v0.12.0')).toBe(true);
    expect(isNewerRelease('0.11.3', '0.11.3')).toBe(false);
    expect(isNewerRelease('1.10.0', '1.9.9')).toBe(false);
    expect(isNewerRelease('1.2.3-beta.4', '1.2.3')).toBe(true);
  });
});

describe('UpdaterPopup', () => {
  let restoreHost: (() => void) | null = null;

  beforeEach(() => {
    vi.mocked(fetchLatestGithubReleaseInfo).mockReset();
    vi.mocked(fetchLatestGithubReleaseInfo).mockResolvedValue(null);
    vi.mocked(openExternalUrl).mockReset();
    vi.mocked(openExternalUrl).mockResolvedValue(true);
    vi.mocked(showCompletionNotification).mockReset();
    vi.mocked(showCompletionNotification).mockResolvedValue('shown');
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    restoreHost?.();
    restoreHost = null;
  });

  it('does not contact GitHub for update metadata in an unpackaged web or dev session', async () => {
    vi.useFakeTimers();

    try {
      render(<UpdaterPopup appVersionInfo={UNPACKAGED_APP_VERSION} />);
      await act(async () => {
        vi.advanceTimersByTime(1_500);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fetchLatestGithubReleaseInfo).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses GitHub release metadata as a packaged-app fallback without a native updater', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchLatestGithubReleaseInfo).mockResolvedValue({
      tagName: 'v0.1.0',
      htmlUrl: 'https://github.com/jhy0285/monofield/releases/tag/v0.1.0',
      stale: false,
    });

    try {
      render(<UpdaterPopup appVersionInfo={PACKAGED_APP_VERSION} />);
      await act(async () => {
        vi.advanceTimersByTime(1_500);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fetchLatestGithubReleaseInfo).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not contact GitHub when the packaged native updater is provisioned', async () => {
    vi.useFakeTimers();
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          status: vi.fn(async () => idleStatus()),
        },
      },
    });

    try {
      render(<UpdaterPopup appVersionInfo={PACKAGED_APP_VERSION} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(1_500);
        await Promise.resolve();
      });

      expect(fetchLatestGithubReleaseInfo).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a safe release-page path visible when the provisioned updater fails', async () => {
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          status: vi.fn(async () => downloadedStatus({
            downloadPath: undefined,
            error: {
              code: 'update-checksum-mismatch',
              message: 'Downloaded update checksum did not match.',
            },
            state: 'error',
          })),
        },
      },
    });

    render(
      <I18nProvider initial="ko">
        <UpdaterPopup appVersionInfo={PACKAGED_APP_VERSION} />
      </I18nProvider>,
    );

    expect(await screen.findByRole('dialog', { name: '업데이트 실패' })).toBeTruthy();
    expect(screen.getByText('설치 프로그램을 열 수 없습니다.')).toBeTruthy();
    const action = screen.getByTestId('updater-install-button');
    expect(action.textContent).toBe('릴리스 페이지 열기');
    fireEvent.click(action);

    await waitFor(() => {
      expect(openExternalUrl).toHaveBeenCalledWith(`${GITHUB_REPO_URL}/releases`);
    });
  });

  it('does not turn a generic native check failure into an update prompt', async () => {
    vi.useFakeTimers();
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          status: vi.fn(async () => ({
            ...idleStatus(),
            error: {
              code: 'update-check-network-failed',
              message: 'The release feed could not be reached.',
            },
            state: 'error' as const,
          })),
        },
      },
    });

    try {
      render(
        <I18nProvider initial="ko">
          <UpdaterPopup
            appVersionInfo={PACKAGED_APP_VERSION}
            desktopNotificationsEnabled
          />
        </I18nProvider>,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(1_500);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fetchLatestGithubReleaseInfo).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('entry-nav-updater')).toBeNull();
      expect(screen.queryByTestId('updater-popup')).toBeNull();
      expect(showCompletionNotification).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays hidden for non-installable updater states', async () => {
    for (const status of [
      idleStatus(),
      { ...idleStatus(), state: 'not-available' as const },
      downloadedStatus({
        progress: {
          receivedBytes: 50,
          totalBytes: 100,
        },
        state: 'downloading',
      }),
      downloadedStatus({
        downloadPath: undefined,
        error: {
          code: 'update-store-invalid-shape',
          message: 'update store contains unexpected root entries',
        },
        state: 'error',
      }),
    ]) {
      restoreHost = installMockOpenDesignHost({
        host: {
          updater: {
            status: vi.fn(async () => status),
          },
        },
      });

      const view = render(<UpdaterPopup />);
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.queryByTestId('entry-nav-updater')).toBeNull();
      expect(screen.queryByTestId('updater-popup')).toBeNull();
      view.unmount();
      restoreHost?.();
      restoreHost = null;
    }
  });

  it('opens the install prompt automatically when a native update is ready', async () => {
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          status: vi.fn(async () => downloadedStatus()),
        },
      },
    });

    render(<UpdaterPopup />);

    const button = await screen.findByTestId('entry-nav-updater');
    expect(button.getAttribute('data-tooltip')).toBe('Install update');
    expect(await screen.findByRole('dialog', { name: 'Update ready' })).toBeTruthy();
    expect(screen.getByText('MonoField 1.2.3-beta.4 is ready. MonoField will close and open the installer.')).toBeTruthy();
    expect(screen.getByTestId('updater-install-button').textContent).toBe('Install update');
  });

  it('uses localized ready prompt copy from the app i18n provider', async () => {
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          status: vi.fn(async () => downloadedStatus()),
        },
      },
    });

    render(
      <I18nProvider initial="zh-CN">
        <UpdaterPopup />
      </I18nProvider>,
    );

    expect(await screen.findByRole('dialog', { name: '更新已就绪' })).toBeTruthy();
    expect(screen.getByTestId('updater-install-button').textContent).toBe('安装更新');
    expect(screen.getByText('MonoField 1.2.3-beta.4 已就绪。MonoField 会关闭并打开安装器。')).toBeTruthy();
    expect(screen.getByText('测试版频道')).toBeTruthy();
  });

  it('labels a manual update as a release-page action and opens that page', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchLatestGithubReleaseInfo).mockResolvedValue({
      tagName: 'v0.2.0',
      htmlUrl: 'https://github.com/jhy0285/monofield/releases/tag/v0.2.0',
      stale: false,
    });

    try {
      render(
        <I18nProvider initial="ko">
          <UpdaterPopup appVersionInfo={PACKAGED_APP_VERSION} />
        </I18nProvider>,
      );

      await act(async () => {
        vi.advanceTimersByTime(1_500);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByRole('dialog', { name: '업데이트 사용 가능' })).toBeTruthy();
      expect(screen.getByText('MonoField 0.2.0 새 버전이 나왔습니다. 릴리스 페이지에서 내 운영체제에 맞는 설치 파일을 선택해 다운로드하세요.')).toBeTruthy();
      const action = screen.getByTestId('updater-install-button');
      expect(action.textContent).toBe('릴리스 페이지 열기');
      fireEvent.click(action);

      await act(async () => {
        await Promise.resolve();
      });
      expect(openExternalUrl).toHaveBeenCalledWith('https://github.com/jhy0285/monofield/releases/tag/v0.2.0');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses install-and-restart copy for payload updates', async () => {
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          status: vi.fn(async () => payloadDownloadedStatus()),
        },
      },
    });

    render(
      <I18nProvider initial="zh-CN">
        <UpdaterPopup />
      </I18nProvider>,
    );

    const button = await screen.findByTestId('entry-nav-updater');
    expect(button.getAttribute('data-tooltip')).toBe('安装并重启');
    expect(await screen.findByRole('dialog', { name: '更新已就绪' })).toBeTruthy();
    expect(screen.getByTestId('updater-install-button').textContent).toBe('安装并重启');
    expect(screen.getByText('MonoField 1.2.3-beta.4 已就绪。MonoField 会关闭并自动重启。')).toBeTruthy();
  });

  it('dismisses the confirmation prompt before installation starts', async () => {
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          status: vi.fn(async () => downloadedStatus()),
        },
      },
    });

    render(<UpdaterPopup />);

    expect(await screen.findByRole('dialog', { name: 'Update ready' })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('updater-popup')).toBeNull();
    expect(window.localStorage.getItem('monofield:update-dismissed:v1')).toBe('1.2.3-beta.4');

    fireEvent.click(screen.getByTestId('entry-nav-updater'));
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByTestId('updater-popup')).toBeNull();
  });

  it('remembers a dismissed version across remounts while keeping manual access available', async () => {
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          status: vi.fn(async () => downloadedStatus()),
        },
      },
    });

    const first = render(<UpdaterPopup />);
    fireEvent.click(await screen.findByRole('button', { name: 'Later' }));
    expect(window.localStorage.getItem('monofield:update-dismissed:v1')).toBe('1.2.3-beta.4');
    first.unmount();

    render(<UpdaterPopup />);
    const indicator = await screen.findByTestId('entry-nav-updater');
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('updater-popup')).toBeNull();

    fireEvent.click(indicator);
    expect(await screen.findByRole('dialog', { name: 'Update ready' })).toBeTruthy();
  });

  it('does not reopen the same ready version automatically but opens the next version', async () => {
    const listeners = new Set<OpenDesignHostUpdaterStatusListener>();
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          status: vi.fn(async () => idleStatus()),
          subscribe: vi.fn((listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          }),
        },
      },
    });

    render(<UpdaterPopup />);
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      for (const listener of listeners) listener(downloadedStatus());
    });
    expect(await screen.findByRole('dialog', { name: 'Update ready' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));

    act(() => {
      for (const listener of listeners) listener(downloadedStatus());
    });
    expect(screen.queryByTestId('updater-popup')).toBeNull();

    act(() => {
      for (const listener of listeners) {
        listener(downloadedStatus({
          availableVersion: '1.2.3-beta.5',
          downloadPath: '/tmp/open-design-updater/Open Design Beta 5.dmg',
        }));
      }
    });
    expect(await screen.findByText('MonoField 1.2.3-beta.5 is ready. MonoField will close and open the installer.')).toBeTruthy();
  });

  it('opens the MonoField repository from the update Star action', async () => {
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          status: vi.fn(async () => downloadedStatus()),
        },
      },
    });

    render(<UpdaterPopup />);
    fireEvent.click(await screen.findByTestId('updater-star-button'));

    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledWith(GITHUB_REPO_URL));
  });

  it('shows one version-specific desktop notification when the enabled app is in the background', async () => {
    const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          status: vi.fn(async () => downloadedStatus()),
        },
      },
    });

    try {
      render(<UpdaterPopup desktopNotificationsEnabled />);

      await waitFor(() => expect(showCompletionNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'succeeded',
          title: 'Update ready',
          body: 'MonoField 1.2.3-beta.4 is ready. MonoField will close and open the installer.',
          tag: 'monofield-update-1.2.3-beta.4',
        }),
      ));
      await waitFor(() => {
        expect(window.localStorage.getItem('monofield:update-notified:v1')).toBe('1.2.3-beta.4');
      });
    } finally {
      hiddenSpy.mockRestore();
    }
  });

  it('keeps the prompt in handoff loading after opening the installer', async () => {
    let status = downloadedStatus();
    let resolveInstall: (status: OpenDesignHostUpdaterStatusSnapshot) => void = () => undefined;
    const install = vi.fn(() => new Promise<OpenDesignHostUpdaterStatusSnapshot>((resolve) => {
      resolveInstall = resolve;
    }));
    const quit = vi.fn(async () => ({ ok: true as const }));
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          install,
          quit,
          status: vi.fn(async () => status),
        },
      },
    });

    render(<UpdaterPopup />);

    fireEvent.click(await screen.findByTestId('updater-install-button'));
    fireEvent.click(screen.getByTestId('updater-install-button'));

    expect(install).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Opening installer...' }).getAttribute('disabled')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Later' }).getAttribute('disabled')).not.toBeNull();

    await act(async () => {
      status = downloadedStatus({
        installResult: {
          dryRun: true,
          openedAt: '2026-05-19T00:00:00.000Z',
          path: '/tmp/open-design-updater/Open Design Beta.dmg',
        },
      });
      resolveInstall(status);
      await Promise.resolve();
    });

    await waitFor(() => expect(install).toHaveBeenCalledWith({ payload: { source: 'updater-prompt' } }));
    await waitFor(() => expect(quit).toHaveBeenCalledWith({ payload: { source: 'updater-prompt' } }));
    expect(screen.getByTestId('entry-nav-updater')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Update ready' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Opening installer...' }).getAttribute('disabled')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Later' }).getAttribute('disabled')).not.toBeNull();
  });

  it('recovers the handoff prompt if the app has not closed after the watchdog', async () => {
    const install = vi.fn(async () => downloadedStatus({
      installResult: {
        dryRun: true,
        openedAt: '2026-05-19T00:00:00.000Z',
        path: '/tmp/open-design-updater/Open Design Beta.dmg',
      },
    }));
    const quit = vi.fn(async () => ({ ok: true as const }));
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          install,
          quit,
          status: vi.fn(async () => downloadedStatus()),
        },
      },
    });

    render(<UpdaterPopup />);
    const installButton = await screen.findByTestId('updater-install-button');

    vi.useFakeTimers();
    try {
      fireEvent.click(installButton);

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByRole('button', { name: 'Opening installer...' }).getAttribute('disabled')).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      expect(screen.getByRole('dialog', { name: 'Update ready' })).toBeTruthy();
      expect(screen.getByTestId('updater-install-button').textContent).toBe('Install update');
      expect(screen.getByTestId('updater-install-button').getAttribute('disabled')).toBeNull();
      fireEvent.click(screen.getByTestId('updater-install-button'));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(install).toHaveBeenCalledTimes(2);
      expect(quit).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps install failures internal and leaves the ready prompt usable', async () => {
    const install = vi.fn(async () => downloadedStatus({
      error: {
        code: 'open-installer-failed',
        message: 'fixture open failed',
      },
      state: 'error',
    }));
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          install,
          status: vi.fn(async () => downloadedStatus()),
        },
      },
    });

    render(<UpdaterPopup />);

    fireEvent.click(await screen.findByTestId('updater-install-button'));

    await waitFor(() => expect(install).toHaveBeenCalledWith({ payload: { source: 'updater-prompt' } }));
    expect(screen.queryByText('fixture open failed')).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Update failed' })).toBeNull();
    expect(await screen.findByRole('dialog', { name: 'Update ready' })).toBeTruthy();
    expect(screen.getByTestId('updater-install-button').getAttribute('disabled')).toBeNull();
  });

  it('reacts to updater subscription events by opening the ready prompt', async () => {
    const listeners = new Set<OpenDesignHostUpdaterStatusListener>();
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          status: vi.fn(async () => idleStatus()),
          subscribe: vi.fn((listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          }),
        },
      },
    });

    render(<UpdaterPopup />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('entry-nav-updater')).toBeNull();

    act(() => {
      for (const listener of listeners) listener(downloadedStatus());
    });

    expect(await screen.findByTestId('entry-nav-updater')).toBeTruthy();
    expect(await screen.findByRole('dialog', { name: 'Update ready' })).toBeTruthy();
  });
});
