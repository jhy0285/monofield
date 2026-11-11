export interface AppVersionInfo {
  version: string;
  channel: string;
  packaged: boolean;
  platform: string;
  arch: string;
  /**
   * How this copy was installed. `store`: from the Microsoft Store, which owns updates, so the app never points at
   * another installer. `direct`: everything else. Absent from daemons older than 0.11.7-preview.10.
   */
  distribution?: 'direct' | 'store';
}

export interface AppVersionResponse {
  version: AppVersionInfo;
}
