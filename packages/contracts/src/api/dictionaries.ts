export type DictionaryPreview = {
  columns: string[];
  rows: string[][];
};

export type DictionaryVersion = {
  id: string;
  dictionaryId: string;
  version: number;
  fileName: string;
  format: 'csv' | 'json' | 'xlsx' | 'xlsm';
  size: number;
  createdAt: number;
  preview: DictionaryPreview;
};

export type DictionaryLibraryItem = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  latestVersion: DictionaryVersion;
};

export type DictionaryLibraryDetail = DictionaryLibraryItem & {
  versions: DictionaryVersion[];
};

export type DictionaryLibraryListResponse = {
  dictionaries: DictionaryLibraryItem[];
};

export type DictionaryLibraryDetailResponse = {
  dictionary: DictionaryLibraryDetail;
};

export type DictionaryProjectSnapshot = {
  id: string;
  projectId: string;
  dictionaryId: string;
  versionId: string;
  dictionaryName: string;
  version: number;
  path: string;
  createdAt: number;
};

export type AttachDictionaryToProjectResponse = {
  snapshot: DictionaryProjectSnapshot;
};

export type ProjectDictionarySnapshotsResponse = {
  snapshots: DictionaryProjectSnapshot[];
};
