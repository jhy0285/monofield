import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addDictionaryVersion,
  createDictionaryLibrary,
  deleteDictionaryLibrary,
  getDictionaryLibrary,
  insertDictionaryProjectSnapshot,
  listDictionaryLibraries,
  listDictionaryProjectSnapshots,
  migrateDictionaries,
} from '../../src/dictionaries/store.js';

const databases: Database.Database[] = [];

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateDictionaries(db);
  databases.push(db);
  return db;
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe('dictionary library persistence', () => {
  it('keeps global versions ordered and updates the list latest version', () => {
    const db = createDb();
    const created = createDictionaryLibrary(db, {
      name: 'Korean-English terms',
      version: {
        fileName: 'terms.xlsx',
        format: 'xlsx',
        size: 120,
        filePath: 'library/terms/v1.xlsx',
        preview: { columns: ['ko', 'en'], rows: [['회원', 'member']] },
      },
    });
    const version = addDictionaryVersion(db, created.id, {
      fileName: 'terms-v2.xlsx',
      format: 'xlsx',
      size: 180,
      filePath: 'library/terms/v2.xlsx',
      preview: { columns: ['ko', 'en'], rows: [['회원', 'user']] },
    });

    expect(version?.version).toBe(2);
    expect(getDictionaryLibrary(db, created.id)?.versions.map((item) => item.version)).toEqual([2, 1]);
    expect(listDictionaryLibraries(db)[0]?.latestVersion.version).toBe(2);
  });

  it('keeps project snapshot metadata after deleting its global source', () => {
    const db = createDb();
    const dictionary = createDictionaryLibrary(db, {
      name: 'Terms',
      version: {
        fileName: 'terms.csv',
        format: 'csv',
        size: 20,
        filePath: 'library/terms/v1.csv',
        preview: { columns: ['ko', 'en'], rows: [['주문', 'order']] },
      },
    });
    const snapshot = insertDictionaryProjectSnapshot(db, {
      projectId: 'project-1',
      dictionaryId: dictionary.id,
      versionId: dictionary.latestVersion.id,
      dictionaryName: dictionary.name,
      version: dictionary.latestVersion.version,
      path: '_open-docs/dictionaries/terms-v1.csv',
    });

    deleteDictionaryLibrary(db, dictionary.id);

    expect(listDictionaryLibraries(db)).toEqual([]);
    expect(listDictionaryProjectSnapshots(db, 'project-1')).toEqual([snapshot]);
  });
});
