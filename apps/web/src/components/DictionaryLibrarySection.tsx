import { useCallback, useEffect, useState } from 'react';
import type { DictionaryLibraryDetail, DictionaryLibraryItem } from '@open-design/contracts';
import { Button } from '@open-design/components';
import { useI18n } from '../i18n';
import {
  deleteDictionaryLibrary,
  fetchDictionaryLibraries,
  fetchDictionaryLibrary,
  renameDictionaryLibrary,
  uploadDictionaryLibrary,
  uploadDictionaryVersion,
} from '../providers/registry';
import { Icon } from './Icon';
import styles from './DictionaryLibrarySection.module.css';

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function DictionaryLibrarySection() {
  const { t } = useI18n();
  const [dictionaries, setDictionaries] = useState<DictionaryLibraryItem[]>([]);
  const [selected, setSelected] = useState<DictionaryLibraryDetail | null>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [newName, setNewName] = useState('');
  const [versionFile, setVersionFile] = useState<File | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const items = await fetchDictionaryLibraries();
    setDictionaries(items);
    return items;
  }, []);

  useEffect(() => {
    void refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : t('dictionaryLibrary.uploadFailed')));
  }, [refresh, t]);

  async function selectDictionary(id: string) {
    setError(null);
    setStatus(null);
    setConfirmDelete(false);
    try {
      const detail = await fetchDictionaryLibrary(id);
      setSelected(detail);
      setRenameValue(detail.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dictionaryLibrary.uploadFailed'));
    }
  }

  async function addDictionary() {
    if (!newFile || busy) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const name = newName.trim() || newFile.name.replace(/\.[^.]+$/, '');
      const dictionary = await uploadDictionaryLibrary(newFile, name);
      setNewFile(null);
      setNewName('');
      await refresh();
      setSelected(dictionary);
      setRenameValue(dictionary.name);
      setStatus(t('dictionaryLibrary.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dictionaryLibrary.uploadFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function addVersion() {
    if (!selected || !versionFile || busy) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await uploadDictionaryVersion(selected.id, versionFile);
      const detail = await fetchDictionaryLibrary(selected.id);
      setSelected(detail);
      setVersionFile(null);
      await refresh();
      setStatus(t('dictionaryLibrary.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dictionaryLibrary.uploadFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function rename() {
    if (!selected || !renameValue.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const detail = await renameDictionaryLibrary(selected.id, renameValue.trim());
      setSelected(detail);
      await refresh();
      setStatus(t('dictionaryLibrary.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dictionaryLibrary.uploadFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteDictionaryLibrary(selected.id);
      setSelected(null);
      setRenameValue('');
      setConfirmDelete(false);
      await refresh();
      setStatus(t('dictionaryLibrary.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dictionaryLibrary.uploadFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section">
      <div className={styles.createRow}>
        <label className={styles.field}>
          <span>{t('dictionaryLibrary.name')}</span>
          <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={t('dictionaryLibrary.namePlaceholder')} disabled={busy} />
        </label>
        <input className={styles.fileInput} type="file" accept=".csv,.json,.xlsx,.xlsm" disabled={busy} onChange={(event) => setNewFile(event.target.files?.[0] ?? null)} />
        <Button onClick={() => void addDictionary()} disabled={busy || !newFile}><Icon name="upload" size={15} />{t('dictionaryLibrary.add')}</Button>
      </div>
      <div className={styles.layout}>
        <div className={styles.list} aria-label={t('settings.dictionaryLibraryTitle')}>
          {dictionaries.length === 0 ? <p className="hint">{t('dictionaryLibrary.empty')}</p> : dictionaries.map((dictionary) => (
            <button key={dictionary.id} type="button" className={selected?.id === dictionary.id ? styles.selectedRow : styles.row} onClick={() => void selectDictionary(dictionary.id)}>
              <span className={styles.rowName}>{dictionary.name}</span>
              <span className={styles.rowMeta}>v{dictionary.latestVersion.version} · {dictionary.latestVersion.fileName}</span>
            </button>
          ))}
        </div>
        <div className={styles.detail}>
          {selected ? (
            <>
              <div className={styles.renameRow}>
                <input aria-label={t('dictionaryLibrary.name')} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} disabled={busy} />
                <Button variant="ghost" onClick={() => void rename()} disabled={busy || !renameValue.trim()}>{t('dictionaryLibrary.rename')}</Button>
              </div>
              <div className={styles.versionHeader}>
                <strong>{t('dictionaryLibrary.versions')}</strong>
                <span>v{selected.latestVersion.version} · {selected.latestVersion.fileName} · {formatBytes(selected.latestVersion.size)}</span>
              </div>
              <DictionaryPreview preview={selected.latestVersion.preview} emptyText={t('dictionaryLibrary.previewEmpty')} />
              <div className={styles.versionUpload}>
                <input type="file" accept=".csv,.json,.xlsx,.xlsm" disabled={busy} onChange={(event) => setVersionFile(event.target.files?.[0] ?? null)} />
                <Button variant="ghost" onClick={() => void addVersion()} disabled={busy || !versionFile}><Icon name="upload" size={15} />{t('dictionaryLibrary.uploadVersion')}</Button>
              </div>
              <div className={styles.dangerRow}>
                {confirmDelete ? <span className={styles.confirmText}>{t('dictionaryLibrary.deleteConfirm')}</span> : null}
                <Button variant="ghost" onClick={() => confirmDelete ? void remove() : setConfirmDelete(true)} disabled={busy}><Icon name="trash" size={15} />{t('dictionaryLibrary.delete')}</Button>
                {confirmDelete ? <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>{t('common.cancel')}</Button> : null}
              </div>
            </>
          ) : <p className="hint">{t('dictionaryLibrary.empty')}</p>}
        </div>
      </div>
      {status ? <p className="hint" role="status">{status}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </section>
  );
}

function DictionaryPreview({ preview, emptyText }: { preview: DictionaryLibraryDetail['latestVersion']['preview']; emptyText: string }) {
  if (preview.columns.length === 0) return <p className="hint">{emptyText}</p>;
  return (
    <div className={styles.previewWrap}>
      <table className={styles.preview}>
        <thead><tr>{preview.columns.map((column, index) => <th key={`${column}-${index}`}>{column || '—'}</th>)}</tr></thead>
        <tbody>{preview.rows.map((row, rowIndex) => <tr key={rowIndex}>{preview.columns.map((_column, columnIndex) => <td key={columnIndex}>{row[columnIndex] ?? ''}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
