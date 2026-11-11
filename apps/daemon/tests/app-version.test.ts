import { describe, expect, it } from 'vitest';
import {
  APP_VERSION_FALLBACK,
  isPackagedRuntime,
  resolveAppVersionInfo,
} from '../src/app-version.js';

describe('app version helpers', () => {
  it('resolves version info from package metadata', () => {
    expect(resolveAppVersionInfo({
      packageMetadata: { version: '1.2.3' },
      env: {},
      resourcesPath: undefined,
      execPath: '/usr/local/bin/node',
      platform: 'linux',
      arch: 'x64',
    })).toEqual({
      version: '1.2.3',
      channel: 'development',
      packaged: false,
      platform: 'linux',
      arch: 'x64',
      distribution: 'direct',
    });
  });

  it('uses a safe fallback when package metadata is missing', () => {
    expect(resolveAppVersionInfo({ packageMetadata: null, env: {} }).version).toBe(APP_VERSION_FALLBACK);
  });

  it('prefers packaged app version metadata from the environment', () => {
    expect(resolveAppVersionInfo({
      packageMetadata: { version: '0.3.0' },
      env: { OD_APP_VERSION: '0.3.1-beta.1' },
      resourcesPath: '/Applications/Open Design.app/Contents/Resources',
      execPath: '/Applications/Open Design.app/Contents/Resources/open-design/bin/node',
      platform: 'darwin',
      arch: 'arm64',
    })).toEqual({
      version: '0.3.1-beta.1',
      channel: 'beta',
      packaged: true,
      platform: 'darwin',
      arch: 'arm64',
      distribution: 'direct',
    });
  });

  // A Microsoft Store (MSIX) install runs from WindowsApps; the app then leaves updates to the Store.
  it('tells a Microsoft Store install from a directly installed one', () => {
    const store = resolveAppVersionInfo({
      packageMetadata: { version: '0.11.7' },
      env: {},
      resourcesPath: 'C:\\Program Files\\WindowsApps\\12345Pub.MonoField_0.11.7.0_x64__abcd\\app\\resources',
      execPath: 'C:\\Program Files\\WindowsApps\\12345Pub.MonoField_0.11.7.0_x64__abcd\\app\\MonoField.exe',
      platform: 'win32',
      arch: 'x64',
    });
    expect(store).toMatchObject({ packaged: true, distribution: 'store' });
    expect(resolveAppVersionInfo({
      packageMetadata: { version: '0.11.7' },
      env: {},
      resourcesPath: 'C:\\Users\\Ada\\AppData\\Local\\Programs\\MonoField\\resources',
      platform: 'win32',
      arch: 'x64',
    }).distribution).toBe('direct');
    // Only Windows has WindowsApps; a folder of that name elsewhere means nothing.
    expect(resolveAppVersionInfo({
      packageMetadata: { version: '0.11.7' }, env: {}, execPath: '/home/ada/WindowsApps/node', platform: 'linux', arch: 'x64',
    }).distribution).toBe('direct');
  });

  it('detects packaged runtimes without sidecar protocol knowledge', () => {
    expect(isPackagedRuntime({ resourcesPath: '/Applications/Open Design.app/Contents/Resources' })).toBe(true);
    expect(isPackagedRuntime({
      execPath: '/Applications/Open Design.app/Contents/Resources/open-design/bin/node',
      platform: 'darwin',
    })).toBe(true);
    expect(isPackagedRuntime({
      execPath: 'C:\\Users\\Ada\\AppData\\Local\\Programs\\Open Design\\resources\\open-design\\bin\\node.exe',
      platform: 'win32',
    })).toBe(true);
    expect(isPackagedRuntime({
      execPath: '/opt/Open Design/resources/open-design/bin/node',
      platform: 'linux',
    })).toBe(true);
    expect(isPackagedRuntime({ execPath: '/usr/local/bin/node', platform: 'linux' })).toBe(false);
  });

  it('honors an explicit release channel', () => {
    expect(resolveAppVersionInfo({
      packageMetadata: { version: '1.2.3' },
      env: { OD_RELEASE_CHANNEL: 'beta' },
    }).channel).toBe('beta');
  });

  it('infers prerelease channel from semver metadata', () => {
    expect(resolveAppVersionInfo({
      packageMetadata: { version: '0.1.0-beta.6' },
      env: {},
    }).channel).toBe('beta');
  });

  it('infers prerelease and preview release channels from app versions', () => {
    expect(resolveAppVersionInfo({
      packageMetadata: { version: '0.8.0-prerelease.2' },
      env: {},
    }).channel).toBe('prerelease');
    expect(resolveAppVersionInfo({
      packageMetadata: { version: '0.8.0-preview.1' },
      env: {},
    }).channel).toBe('preview');
  });
});
