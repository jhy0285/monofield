import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  DictionaryLibraryDetail,
  DictionaryLibraryItem,
  DictionaryPreview,
  DictionaryProjectSnapshot,
  DictionaryVersion,
} from '@open-design/contracts';

type SqliteDb = Database.Database;

type RawDictionary = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

type RawVersion = {
  id: string;
  dictionaryId: string;
  version: number;
  fileName: string;
  format: string;
  size: number;
  filePath: string;
  previewJson: string;
  createdAt: number;
};

type RawSnapshot = {
  id: string;
  projectId: string;
  dictionaryId: string;
  versionId: string;
  dictionaryName: string;
  version: number;
  filePath: string;
  createdAt: number;
};

export type DictionaryVersionRecord = DictionaryVersion & { filePath: string };

export function migrateDictionaries(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dictionary_libraries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_dictionary_libraries_name
      ON dictionary_libraries(name COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS dictionary_versions (
      id TEXT PRIMARY KEY,
      dictionary_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      format TEXT NOT NULL,
      size INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      preview_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(dictionary_id) REFERENCES dictionary_libraries(id) ON DELETE CASCADE,
      UNIQUE(dictionary_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_dictionary_versions_dictionary
      ON dictionary_versions(dictionary_id, version DESC);

    CREATE TABLE IF NOT EXISTS dictionary_project_snapshots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      dictionary_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      dictionary_name TEXT NOT NULL,
      version INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(project_id, version_id)
    );
    CREATE INDEX IF NOT EXISTS idx_dictionary_snapshots_project
      ON dictionary_project_snapshots(project_id, created_at DESC);
  `);
}

function parsePreview(raw: string): DictionaryPreview {
  try {
    const value = JSON.parse(raw) as Partial<DictionaryPreview>;
    const columns = Array.isArray(value.columns)
      ? value.columns.filter((item): item is string => typeof item === 'string').slice(0, 12)
      : [];
    const rows = Array.isArray(value.rows)
      ? value.rows
        .filter((row) => Array.isArray(row))
        .slice(0, 8)
        .map((row) => row.map((cell) => String(cell ?? '')).slice(0, 12))
      : [];
    return { columns, rows };
  } catch {
    return { columns: [], rows: [] };
  }
}

function toVersion(raw: RawVersion): DictionaryVersionRecord {
  return {
    id: raw.id,
    dictionaryId: raw.dictionaryId,
    version: Number(raw.version),
    fileName: raw.fileName,
    format: raw.format as DictionaryVersion['format'],
    size: Number(raw.size),
    filePath: raw.filePath,
    createdAt: Number(raw.createdAt),
    preview: parsePreview(raw.previewJson),
  };
}

function toSnapshot(raw: RawSnapshot): DictionaryProjectSnapshot {
  return {
    id: raw.id,
    projectId: raw.projectId,
    dictionaryId: raw.dictionaryId,
    versionId: raw.versionId,
    dictionaryName: raw.dictionaryName,
    version: Number(raw.version),
    path: raw.filePath,
    createdAt: Number(raw.createdAt),
  };
}

export function getDictionaryVersion(db: SqliteDb, versionId: string): DictionaryVersionRecord | null {
  const raw = db.prepare(`
    SELECT id, dictionary_id AS dictionaryId, version, file_name AS fileName,
      format, size, file_path AS filePath, preview_json AS previewJson,
      created_at AS createdAt
    FROM dictionary_versions WHERE id = ?
  `).get(versionId) as RawVersion | undefined;
  return raw ? toVersion(raw) : null;
}

function getLatestDictionaryVersion(db: SqliteDb, dictionaryId: string): DictionaryVersionRecord | null {
  const raw = db.prepare(`
    SELECT id, dictionary_id AS dictionaryId, version, file_name AS fileName,
      format, size, file_path AS filePath, preview_json AS previewJson,
      created_at AS createdAt
    FROM dictionary_versions WHERE dictionary_id = ? ORDER BY version DESC LIMIT 1
  `).get(dictionaryId) as RawVersion | undefined;
  return raw ? toVersion(raw) : null;
}

export function listDictionaryLibraries(db: SqliteDb): DictionaryLibraryItem[] {
  const records = db.prepare(`
    SELECT id, name, created_at AS createdAt, updated_at AS updatedAt
    FROM dictionary_libraries ORDER BY updated_at DESC, name COLLATE NOCASE ASC
  `).all() as RawDictionary[];
  return records.flatMap((record) => {
    const latestVersion = getLatestDictionaryVersion(db, record.id);
    return latestVersion ? [{ ...record, latestVersion }] : [];
  });
}

export function getDictionaryLibrary(db: SqliteDb, dictionaryId: string): DictionaryLibraryDetail | null {
  const dictionary = db.prepare(`
    SELECT id, name, created_at AS createdAt, updated_at AS updatedAt
    FROM dictionary_libraries WHERE id = ?
  `).get(dictionaryId) as RawDictionary | undefined;
  if (!dictionary) return null;
  const versions = db.prepare(`
    SELECT id, dictionary_id AS dictionaryId, version, file_name AS fileName,
      format, size, file_path AS filePath, preview_json AS previewJson,
      created_at AS createdAt
    FROM dictionary_versions WHERE dictionary_id = ? ORDER BY version DESC
  `).all(dictionaryId) as RawVersion[];
  if (versions.length === 0) return null;
  return {
    ...dictionary,
    latestVersion: toVersion(versions[0]!),
    versions: versions.map(toVersion),
  };
}

export function createDictionaryLibrary(
  db: SqliteDb,
  input: {
    id?: string;
    name: string;
    version: Omit<DictionaryVersionRecord, 'id' | 'dictionaryId' | 'version' | 'createdAt'>;
  },
): DictionaryLibraryDetail {
  const now = Date.now();
  const dictionaryId = input.id ?? randomUUID();
  const versionId = randomUUID();
  const create = db.transaction(() => {
    db.prepare(`INSERT INTO dictionary_libraries (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(dictionaryId, input.name, now, now);
    db.prepare(`
      INSERT INTO dictionary_versions
      (id, dictionary_id, version, file_name, format, size, file_path, preview_json, created_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
    `).run(
      versionId,
      dictionaryId,
      input.version.fileName,
      input.version.format,
      input.version.size,
      input.version.filePath,
      JSON.stringify(input.version.preview),
      now,
    );
  });
  create();
  return getDictionaryLibrary(db, dictionaryId)!;
}

export function addDictionaryVersion(
  db: SqliteDb,
  dictionaryId: string,
  input: Omit<DictionaryVersionRecord, 'id' | 'dictionaryId' | 'version' | 'createdAt'>,
): DictionaryVersionRecord | null {
  const dictionary = getDictionaryLibrary(db, dictionaryId);
  if (!dictionary) return null;
  const now = Date.now();
  const version: DictionaryVersionRecord = {
    ...input,
    id: randomUUID(),
    dictionaryId,
    version: dictionary.latestVersion.version + 1,
    createdAt: now,
  };
  db.transaction(() => {
    db.prepare(`
      INSERT INTO dictionary_versions
      (id, dictionary_id, version, file_name, format, size, file_path, preview_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      version.id,
      dictionaryId,
      version.version,
      version.fileName,
      version.format,
      version.size,
      version.filePath,
      JSON.stringify(version.preview),
      version.createdAt,
    );
    db.prepare(`UPDATE dictionary_libraries SET updated_at = ? WHERE id = ?`).run(now, dictionaryId);
  })();
  return version;
}

export function renameDictionaryLibrary(db: SqliteDb, dictionaryId: string, name: string): DictionaryLibraryDetail | null {
  const result = db.prepare(`UPDATE dictionary_libraries SET name = ?, updated_at = ? WHERE id = ?`)
    .run(name, Date.now(), dictionaryId);
  return result.changes > 0 ? getDictionaryLibrary(db, dictionaryId) : null;
}

export function deleteDictionaryLibrary(db: SqliteDb, dictionaryId: string): DictionaryVersionRecord[] | null {
  const dictionary = getDictionaryLibrary(db, dictionaryId);
  if (!dictionary) return null;
  const versions = dictionary.versions.map((version) => ({
    ...version,
    filePath: getDictionaryVersion(db, version.id)?.filePath ?? '',
  }));
  db.prepare(`DELETE FROM dictionary_libraries WHERE id = ?`).run(dictionaryId);
  return versions;
}

export function getDictionaryProjectSnapshot(
  db: SqliteDb,
  projectId: string,
  versionId: string,
): DictionaryProjectSnapshot | null {
  const raw = db.prepare(`
    SELECT id, project_id AS projectId, dictionary_id AS dictionaryId,
      version_id AS versionId, dictionary_name AS dictionaryName, version,
      file_path AS filePath, created_at AS createdAt
    FROM dictionary_project_snapshots WHERE project_id = ? AND version_id = ?
  `).get(projectId, versionId) as RawSnapshot | undefined;
  return raw ? toSnapshot(raw) : null;
}

export function listDictionaryProjectSnapshots(db: SqliteDb, projectId: string): DictionaryProjectSnapshot[] {
  const rows = db.prepare(`
    SELECT id, project_id AS projectId, dictionary_id AS dictionaryId,
      version_id AS versionId, dictionary_name AS dictionaryName, version,
      file_path AS filePath, created_at AS createdAt
    FROM dictionary_project_snapshots WHERE project_id = ? ORDER BY created_at DESC
  `).all(projectId) as RawSnapshot[];
  return rows.map(toSnapshot);
}

export function insertDictionaryProjectSnapshot(
  db: SqliteDb,
  input: Omit<DictionaryProjectSnapshot, 'id' | 'createdAt'>,
): DictionaryProjectSnapshot {
  const snapshot: DictionaryProjectSnapshot = {
    ...input,
    id: randomUUID(),
    createdAt: Date.now(),
  };
  db.prepare(`
    INSERT INTO dictionary_project_snapshots
    (id, project_id, dictionary_id, version_id, dictionary_name, version, file_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshot.id,
    snapshot.projectId,
    snapshot.dictionaryId,
    snapshot.versionId,
    snapshot.dictionaryName,
    snapshot.version,
    snapshot.path,
    snapshot.createdAt,
  );
  return snapshot;
}
