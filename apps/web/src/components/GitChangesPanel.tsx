import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  GitChangedFile,
  GitDiffScope,
  GitWorkspaceDiffResponse,
  GitWorkspaceStatusResponse,
} from '@open-design/contracts';
import { useT } from '../i18n';
import { splitUnifiedDiff, type SplitDiffCell } from '../runtime/git-diff';
import { Icon } from './Icon';
import styles from './GitChangesPanel.module.css';

type Props = {
  projectId: string;
  onOpenFile: (path: string) => void;
};

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as T | { error?: { message?: string } } | null;
  if (!response.ok) throw new Error((payload as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${response.status}`);
  return payload as T;
}

function statusMark(file: GitChangedFile): string {
  if (file.status === 'untracked') return 'U';
  if (file.status === 'renamed') return 'R';
  if (file.status === 'copied') return 'C';
  if (file.status === 'deleted') return 'D';
  if (file.status === 'added') return 'A';
  if (file.status === 'conflicted') return '!';
  if (file.status === 'type-changed') return 'T';
  return 'M';
}

function patchLineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return styles.patchMeta ?? '';
  if (line.startsWith('+')) return styles.patchAdd ?? '';
  if (line.startsWith('-')) return styles.patchDelete ?? '';
  if (line.startsWith('@@')) return styles.patchHunk ?? '';
  if (line.startsWith('diff ') || line.startsWith('index ')) return styles.patchMeta ?? '';
  return '';
}

function SplitCell({ value }: { value: SplitDiffCell }) {
  return (
    <span role="cell" className={`${styles.splitCell} ${styles[`splitCell_${value.kind}`] ?? ''}`}>
      <span className={styles.lineNumber} aria-hidden>{value.lineNumber ?? ''}</span>
      <span className={styles.lineMark} aria-hidden>
        {value.kind === 'added' ? '+' : value.kind === 'deleted' ? '−' : ''}
      </span>
      <code>{value.text || ' '}</code>
    </span>
  );
}

export function GitChangesPanel({ projectId, onOpenFile }: Props) {
  const t = useT();
  const [status, setStatus] = useState<GitWorkspaceStatusResponse | null>(null);
  const [scope, setScope] = useState<GitDiffScope>('working');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<GitWorkspaceDiffResponse | null>(null);
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const files = useMemo(
    () => status?.files.filter((file) => scope === 'staged' ? file.staged : file.unstaged) ?? [],
    [scope, status],
  );

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetch(`/api/projects/${encodeURIComponent(projectId)}/development/git/status`)
        .then((response) => responseJson<GitWorkspaceStatusResponse>(response));
      setStatus(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('gitChanges.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  useEffect(() => {
    if (files.some((file) => file.path === selectedPath)) return;
    setSelectedPath(files[0]?.path ?? null);
  }, [files, selectedPath]);

  useEffect(() => {
    if (!selectedPath || !files.some((file) => file.path === selectedPath)) {
      setDiff(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ path: selectedPath, scope });
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/development/git/diff?${query}`, { signal: controller.signal })
      .then((response) => responseJson<GitWorkspaceDiffResponse>(response))
      .then(setDiff)
      .catch((caught) => {
        if ((caught as Error).name !== 'AbortError') setError(caught instanceof Error ? caught.message : t('gitChanges.loadFailed'));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [files, projectId, scope, selectedPath, status?.generatedAt, t]);

  const selected = files.find((file) => file.path === selectedPath) ?? null;
  const branch = status?.branch ?? status?.head ?? '—';
  const splitRows = useMemo(() => splitUnifiedDiff(diff?.patch ?? ''), [diff?.patch]);

  return (
    <section className={styles.root} data-testid="git-changes-panel">
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <Icon name="fork" size={15} />
          <h2>{t('gitChanges.title')}</h2>
          {status?.repository ? <span className={styles.branch}>{branch}</span> : null}
        </div>
        <button type="button" className={styles.refresh} onClick={() => void loadStatus()} disabled={loading}>
          <Icon name={loading ? 'spinner' : 'reload'} size={13} />
          {t('gitChanges.refresh')}
        </button>
      </header>

      <div className={styles.scope} role="tablist" aria-label={t('gitChanges.title')}>
        <button type="button" role="tab" aria-selected={scope === 'working'} className={scope === 'working' ? styles.selectedScope : ''} onClick={() => setScope('working')}>
          {t('gitChanges.working')} <span>{status?.files.filter((file) => file.unstaged).length ?? 0}</span>
        </button>
        <button type="button" role="tab" aria-selected={scope === 'staged'} className={scope === 'staged' ? styles.selectedScope : ''} onClick={() => setScope('staged')}>
          {t('gitChanges.staged')} <span>{status?.files.filter((file) => file.staged).length ?? 0}</span>
        </button>
      </div>

      {error ? <div className={styles.message} role="alert">{error}</div> : null}
      {status && !status.repository ? <div className={styles.message}>{t('gitChanges.noRepository')}</div> : null}
      {status?.repository && files.length === 0 ? <div className={styles.message}>{t('gitChanges.noChanges')}</div> : null}

      {status?.repository && files.length > 0 ? (
        <div className={styles.content}>
          <nav className={styles.files} aria-label={t('gitChanges.files')}>
            {files.map((file) => (
              <button
                key={`${scope}:${file.path}`}
                type="button"
                className={file.path === selectedPath ? styles.selectedFile : ''}
                aria-current={file.path === selectedPath ? 'true' : undefined}
                onClick={() => setSelectedPath(file.path)}
                title={file.path}
              >
                <span className={styles.status} data-status={file.status}>{statusMark(file)}</span>
                <span className={styles.path}>{file.path}</span>
              </button>
            ))}
          </nav>
          <div className={styles.diff}>
            <div className={styles.diffHeader}>
              <span title={selected?.path}>{selected?.path}</span>
              <div className={styles.diffActions}>
                <div className={styles.viewToggle} role="group" aria-label={t('gitChanges.viewMode')}>
                  <button
                    type="button"
                    className={viewMode === 'split' ? styles.activeView : ''}
                    aria-pressed={viewMode === 'split'}
                    onClick={() => setViewMode('split')}
                  >
                    {t('gitChanges.splitView')}
                  </button>
                  <button
                    type="button"
                    className={viewMode === 'unified' ? styles.activeView : ''}
                    aria-pressed={viewMode === 'unified'}
                    onClick={() => setViewMode('unified')}
                  >
                    {t('gitChanges.unifiedView')}
                  </button>
                </div>
                {selected ? (
                  <button type="button" onClick={() => onOpenFile(selected.path)}>
                    <Icon name="file-code" size={13} />{t('gitChanges.openFile')}
                  </button>
                ) : null}
              </div>
            </div>
            {diff?.truncated ? <div className={styles.warning}>{t('gitChanges.truncated')}</div> : null}
            {diff?.binary ? <div className={styles.message}>{t('gitChanges.binary')}</div> : null}
            {!diff?.binary && diff?.patch && viewMode === 'split' ? (
              <div
                className={styles.splitPatch}
                role="table"
                aria-label={t('gitChanges.patch')}
                tabIndex={0}
                data-scroll-axis="both"
              >
                <div className={styles.splitHead} role="row">
                  <span role="columnheader">{t('gitChanges.before')}</span>
                  <span role="columnheader">{t('gitChanges.after')}</span>
                </div>
                <div className={styles.splitBody}>
                  {splitRows.map((row, index) => row.kind === 'hunk' ? (
                    <div key={`hunk:${index}`} className={styles.splitHunk} role="row">{row.text}</div>
                  ) : (
                    <div key={`line:${index}`} className={styles.splitRow} role="row">
                      <SplitCell value={row.before} />
                      <SplitCell value={row.after} />
                    </div>
                  ))}
                </div>
              </div>
            ) : !diff?.binary && diff?.patch ? (
              <pre className={styles.patch} aria-label={t('gitChanges.patch')}>
                {diff.patch.split('\n').map((line, index) => <span key={index} className={patchLineClass(line)}>{line || ' '}</span>)}
              </pre>
            ) : !loading && !diff?.binary ? <div className={styles.message}>{t('gitChanges.emptyPatch')}</div> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
