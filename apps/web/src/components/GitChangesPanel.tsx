import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type {
  GitBranchMutationResponse,
  GitChangedFile,
  GitDiffScope,
  GitWorkspaceBranchesResponse,
  GitWorkspaceDiffResponse,
  GitWorkspaceDirtyResponse,
  GitWorkspaceStatusResponse,
  GitWorkingTreeStrategy,
} from '@open-design/contracts';
import { useT } from '../i18n';
import { splitUnifiedDiff, type SplitDiffCell } from '../runtime/git-diff';
import { Icon } from './Icon';
import styles from './GitChangesPanel.module.css';

type Props = {
  projectId: string;
  projectPath?: string | null;
  projectSelectionReady?: boolean;
  onOpenFile: (path: string) => void;
};

type GitWorkspaceUiSnapshot = {
  status: GitWorkspaceStatusResponse | null;
  branches: GitWorkspaceBranchesResponse | null;
  selectedBranch: string;
  scope: GitDiffScope;
  selectedPath: string | null;
  diff: GitWorkspaceDiffResponse | null;
  statusSourceKey: string;
  viewMode: 'split' | 'unified';
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

function workspaceFilePath(projectPath: string | null | undefined, filePath: string): string {
  const prefix = projectPath?.replace(/\\/g, '/').replace(/^\.\/?|\/$/g, '');
  return prefix ? `${prefix}/${filePath}` : filePath;
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

export function GitChangesPanel({
  projectId,
  projectPath,
  projectSelectionReady = true,
  onOpenFile,
}: Props) {
  const t = useT();
  const [status, setStatus] = useState<GitWorkspaceStatusResponse | null>(null);
  const [branches, setBranches] = useState<GitWorkspaceBranchesResponse | null>(null);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [scope, setScope] = useState<GitDiffScope>('working');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<GitWorkspaceDiffResponse | null>(null);
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split');
  const [statusLoading, setStatusLoading] = useState(false);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [statusSourceKey, setStatusSourceKey] = useState('');
  const [branchBusy, setBranchBusy] = useState(false);
  const [branchManagerOpen, setBranchManagerOpen] = useState(false);
  const [switchTarget, setSwitchTarget] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [pendingBranchAction, setPendingBranchAction] = useState<{ kind: 'switch' | 'create'; value: string; dirtyCount: number } | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusRequestRef = useRef(0);
  const branchRequestRef = useRef(0);
  const diffRequestRef = useRef(0);
  const statusAbortRef = useRef<AbortController | null>(null);
  const branchAbortRef = useRef<AbortController | null>(null);
  const diffAbortRef = useRef<AbortController | null>(null);
  const workspaceKey = `${projectId}::${projectPath?.replace(/\\/g, '/') || '.'}`;
  const workspaceKeyRef = useRef(workspaceKey);
  const branchWorkspaceKeyRef = useRef(workspaceKey);
  workspaceKeyRef.current = workspaceKey;
  const activeComparisonBranch = branchWorkspaceKeyRef.current === workspaceKey ? selectedBranch : '';
  const statusContextKey = `${workspaceKey}::${activeComparisonBranch}`;
  const workspaceSnapshotsRef = useRef(new Map<string, GitWorkspaceUiSnapshot>());
  const displayedWorkspaceKeyRef = useRef(workspaceKey);
  const [restoredWorkspaceKey, setRestoredWorkspaceKey] = useState(workspaceKey);
  const currentSnapshotRef = useRef<GitWorkspaceUiSnapshot>({
    status,
    branches,
    selectedBranch,
    scope,
    selectedPath,
    diff,
    statusSourceKey,
    viewMode,
  });
  currentSnapshotRef.current = {
    status,
    branches,
    selectedBranch,
    scope,
    selectedPath,
    diff,
    statusSourceKey,
    viewMode,
  };
  const workspaceRestored = restoredWorkspaceKey === workspaceKey;

  const files = useMemo(
    () => statusSourceKey === statusContextKey
      ? status?.files.filter((file) => scope === 'branch' || (scope === 'staged' ? file.staged : file.unstaged)) ?? []
      : [],
    [scope, status, statusContextKey, statusSourceKey],
  );

  const loadStatus = useCallback(async (refresh = false) => {
    if (!projectSelectionReady || !workspaceRestored) return;
    statusAbortRef.current?.abort();
    const controller = new AbortController();
    statusAbortRef.current = controller;
    const requestId = statusRequestRef.current + 1;
    statusRequestRef.current = requestId;
    setStatusLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (projectPath) params.set('projectPath', projectPath);
      if (activeComparisonBranch) params.set('branch', activeComparisonBranch);
      if (refresh) params.set('refresh', '1');
      const query = params.size > 0 ? `?${params}` : '';
      const next = await fetch(`/api/projects/${encodeURIComponent(projectId)}/development/git/status${query}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
        .then((response) => responseJson<GitWorkspaceStatusResponse>(response));
      if (controller.signal.aborted || requestId !== statusRequestRef.current) return;
      setStatus(next);
      setStatusSourceKey(statusContextKey);
      if (activeComparisonBranch) setScope('branch');
      else setScope((current) => current === 'branch' ? 'working' : current);
    } catch (caught) {
      if ((caught as { name?: string } | null)?.name === 'AbortError') return;
      if (requestId !== statusRequestRef.current) return;
      setError(caught instanceof Error ? caught.message : t('gitChanges.loadFailed'));
    } finally {
      if (requestId === statusRequestRef.current) setStatusLoading(false);
    }
  }, [activeComparisonBranch, projectId, projectPath, projectSelectionReady, statusContextKey, t, workspaceRestored]);

  const loadBranches = useCallback(async (refresh = false) => {
    if (!projectSelectionReady || !workspaceRestored) return;
    branchAbortRef.current?.abort();
    const controller = new AbortController();
    branchAbortRef.current = controller;
    const requestId = branchRequestRef.current + 1;
    branchRequestRef.current = requestId;
    setBranchesLoading(true);
    try {
      const params = new URLSearchParams();
      if (projectPath) params.set('projectPath', projectPath);
      if (refresh) params.set('refresh', '1');
      const query = params.size > 0 ? `?${params}` : '';
      const next = await fetch(`/api/projects/${encodeURIComponent(projectId)}/development/git/branches${query}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
        .then((response) => responseJson<GitWorkspaceBranchesResponse>(response));
      if (controller.signal.aborted || requestId !== branchRequestRef.current) return;
      setBranches(next);
      setSelectedBranch((current) => current && !next.branches.some((branch) => branch.fullName === current) ? '' : current);
    } catch (caught) {
      if ((caught as { name?: string } | null)?.name === 'AbortError') return;
      if (requestId !== branchRequestRef.current) return;
      setError(caught instanceof Error ? caught.message : t('gitChanges.loadFailed'));
    } finally {
      if (requestId === branchRequestRef.current) setBranchesLoading(false);
    }
  }, [projectId, projectPath, projectSelectionReady, t, workspaceRestored]);

  useLayoutEffect(() => {
    statusAbortRef.current?.abort();
    branchAbortRef.current?.abort();
    diffAbortRef.current?.abort();
    const previousWorkspaceKey = displayedWorkspaceKeyRef.current;
    if (previousWorkspaceKey !== workspaceKey) {
      const previousSnapshot = currentSnapshotRef.current;
      if (previousSnapshot.status || previousSnapshot.branches || previousSnapshot.diff) {
        workspaceSnapshotsRef.current.delete(previousWorkspaceKey);
        workspaceSnapshotsRef.current.set(previousWorkspaceKey, previousSnapshot);
        while (workspaceSnapshotsRef.current.size > 16) {
          const oldest = workspaceSnapshotsRef.current.keys().next().value as string | undefined;
          if (!oldest) break;
          workspaceSnapshotsRef.current.delete(oldest);
        }
      }

      const snapshot = workspaceSnapshotsRef.current.get(workspaceKey);
      if (snapshot) {
        workspaceSnapshotsRef.current.delete(workspaceKey);
        workspaceSnapshotsRef.current.set(workspaceKey, snapshot);
      }
      displayedWorkspaceKeyRef.current = workspaceKey;
      branchWorkspaceKeyRef.current = workspaceKey;
      setStatus(snapshot?.status ?? null);
      setBranches(snapshot?.branches ?? null);
      setStatusSourceKey(snapshot?.statusSourceKey ?? '');
      setSelectedBranch(snapshot?.selectedBranch ?? '');
      setScope(snapshot?.scope ?? 'working');
      setSelectedPath(snapshot?.selectedPath ?? null);
      setDiff(snapshot?.diff ?? null);
      setViewMode(snapshot?.viewMode ?? 'split');
      setStatusLoading(false);
      setBranchesLoading(false);
      setDiffLoading(false);
      setBranchManagerOpen(false);
      setPendingBranchAction(null);
      setBranchBusy(false);
      setActionNotice(null);
      setError(null);
    }
    setRestoredWorkspaceKey(workspaceKey);
  }, [workspaceKey]);
  useEffect(() => {
    if (!projectSelectionReady || !workspaceRestored) return;
    void loadStatus();
  }, [loadStatus, projectSelectionReady, workspaceRestored]);
  useEffect(() => {
    if (!projectSelectionReady || !workspaceRestored) return;
    void loadBranches();
  }, [loadBranches, projectSelectionReady, workspaceRestored]);
  useEffect(() => {
    if (projectSelectionReady) return;
    statusAbortRef.current?.abort();
    branchAbortRef.current?.abort();
    diffAbortRef.current?.abort();
    statusRequestRef.current += 1;
    branchRequestRef.current += 1;
    diffRequestRef.current += 1;
    setStatusLoading(false);
    setBranchesLoading(false);
    setDiffLoading(false);
  }, [projectSelectionReady, workspaceKey]);
  useEffect(() => () => {
    statusAbortRef.current?.abort();
    branchAbortRef.current?.abort();
    diffAbortRef.current?.abort();
  }, []);
  useEffect(() => {
    if (switchTarget && branches?.branches.some((candidate) => candidate.fullName === switchTarget && !candidate.current)) return;
    setSwitchTarget(branches?.branches.find((candidate) => !candidate.current)?.fullName ?? '');
  }, [branches, switchTarget]);

  useEffect(() => {
    if (files.some((file) => file.path === selectedPath)) return;
    setSelectedPath(files[0]?.path ?? null);
  }, [files, selectedPath]);

  useEffect(() => {
    if (!projectSelectionReady || !workspaceRestored) return;
    if (!selectedPath || !files.some((file) => file.path === selectedPath)) {
      diffAbortRef.current?.abort();
      setDiff(null);
      setDiffLoading(false);
      return;
    }
    diffAbortRef.current?.abort();
    const controller = new AbortController();
    diffAbortRef.current = controller;
    const requestId = diffRequestRef.current + 1;
    diffRequestRef.current = requestId;
    setDiffLoading(true);
    setError(null);
    const query = new URLSearchParams({ path: selectedPath, scope });
    if (projectPath) query.set('projectPath', projectPath);
    if (activeComparisonBranch) query.set('branch', activeComparisonBranch);
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/development/git/diff?${query}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => responseJson<GitWorkspaceDiffResponse>(response))
      .then((next) => {
        if (!controller.signal.aborted && requestId === diffRequestRef.current) setDiff(next);
      })
      .catch((caught) => {
        if ((caught as Error).name !== 'AbortError' && requestId === diffRequestRef.current) {
          setError(caught instanceof Error ? caught.message : t('gitChanges.loadFailed'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && requestId === diffRequestRef.current) setDiffLoading(false);
      });
    return () => controller.abort();
  }, [activeComparisonBranch, files, projectId, projectPath, projectSelectionReady, scope, selectedPath, status?.generatedAt, t, workspaceRestored]);

  const selected = files.find((file) => file.path === selectedPath) ?? null;
  const branch = status?.branch ?? status?.head ?? '—';
  const comparableBranches = branches?.branches.filter((candidate) => !candidate.current) ?? [];
  const visibleDiff = diff?.path === selectedPath && diff.scope === scope ? diff : null;
  const deferredPatch = useDeferredValue(visibleDiff?.patch ?? '');
  const splitRows = useMemo(() => splitUnifiedDiff(deferredPatch), [deferredPatch]);
  const diffRendering = Boolean(visibleDiff?.patch) && deferredPatch !== visibleDiff?.patch;
  const loading = statusLoading || branchesLoading;

  async function refreshAfterBranchMutation(result: GitBranchMutationResponse, sourceWorkspaceKey: string) {
    if (workspaceKeyRef.current !== sourceWorkspaceKey) return;
    branchWorkspaceKeyRef.current = sourceWorkspaceKey;
    setSelectedBranch('');
    setScope('working');
    setSelectedPath(null);
    setBranchManagerOpen(false);
    setPendingBranchAction(null);
    setNewBranchName('');
    setActionNotice(result.created ? t('gitChanges.branchCreated') : t('gitChanges.branchSwitched'));
    const params = new URLSearchParams();
    if (projectPath) params.set('projectPath', projectPath);
    params.set('refresh', '1');
    const query = params.size > 0 ? `?${params}` : '';
    const [nextStatus, nextBranches] = await Promise.all([
      fetch(`/api/projects/${encodeURIComponent(projectId)}/development/git/status${query}`, { cache: 'no-store' })
        .then((response) => responseJson<GitWorkspaceStatusResponse>(response)),
      fetch(`/api/projects/${encodeURIComponent(projectId)}/development/git/branches${query}`, { cache: 'no-store' })
        .then((response) => responseJson<GitWorkspaceBranchesResponse>(response)),
    ]);
    if (workspaceKeyRef.current !== sourceWorkspaceKey) return;
    setStatus(nextStatus);
    setStatusSourceKey(`${workspaceKey}::`);
    setBranches(nextBranches);
  }

  async function mutateBranch(
    action: { kind: 'switch' | 'create'; value: string },
    strategy: GitWorkingTreeStrategy,
  ) {
    const sourceWorkspaceKey = workspaceKey;
    setBranchBusy(true);
    setError(null);
    setActionNotice(null);
    try {
      const params = projectPath ? `?${new URLSearchParams({ projectPath })}` : '';
      const endpoint = action.kind === 'switch' ? 'switch' : 'branches';
      const payload = action.kind === 'switch'
        ? { branch: action.value, strategy }
        : { name: action.value, strategy };
      const result = await fetch(`/api/projects/${encodeURIComponent(projectId)}/development/git/${endpoint}${params}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((response) => responseJson<GitBranchMutationResponse>(response));
      if (workspaceKeyRef.current !== sourceWorkspaceKey) return;
      await refreshAfterBranchMutation(result, sourceWorkspaceKey);
    } catch (caught) {
      if (workspaceKeyRef.current === sourceWorkspaceKey) {
        setError(caught instanceof Error ? caught.message : t('gitChanges.branchActionFailed'));
      }
    } finally {
      setBranchBusy(false);
    }
  }

  async function prepareBranchAction(action: { kind: 'switch' | 'create'; value: string }) {
    if (!action.value.trim()) return;
    const sourceWorkspaceKey = workspaceKey;
    setBranchBusy(true);
    setError(null);
    setActionNotice(null);
    try {
      const params = projectPath ? `?${new URLSearchParams({ projectPath })}` : '';
      const working = await fetch(`/api/projects/${encodeURIComponent(projectId)}/development/git/dirty${params}`, { cache: 'no-store' })
        .then((response) => responseJson<GitWorkspaceDirtyResponse>(response));
      if (workspaceKeyRef.current !== sourceWorkspaceKey) return;
      if (working.dirty) {
        setPendingBranchAction({ ...action, dirtyCount: working.changeCount });
        return;
      }
      await mutateBranch(action, 'reject');
    } catch (caught) {
      if (workspaceKeyRef.current === sourceWorkspaceKey) {
        setError(caught instanceof Error ? caught.message : t('gitChanges.branchActionFailed'));
      }
    } finally {
      setBranchBusy(false);
    }
  }

  return (
    <section className={styles.root} data-testid="git-changes-panel">
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <Icon name="fork" size={15} />
          <h2>{t('gitChanges.title')}</h2>
          {status?.repository ? (
            <label className={styles.branchPicker} title={t('gitChanges.branchHint')}>
              <Icon name="fork" size={11} />
              <select
                aria-label={t('gitChanges.branch')}
                value={activeComparisonBranch}
                onChange={(event) => {
                  branchWorkspaceKeyRef.current = workspaceKey;
                  setSelectedBranch(event.target.value);
                }}
              >
                <option value="">{t('gitChanges.currentBranch')} · {branch}</option>
                {comparableBranches.map((candidate) => (
                  <option key={candidate.fullName} value={candidate.fullName}>
                    {t('gitChanges.compareBranch')} · {candidate.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className={styles.headerActions}>
          {status?.repository ? (
            <button type="button" className={styles.refresh} data-testid="git-branch-manager" onClick={() => setBranchManagerOpen((open) => !open)} disabled={branchBusy}>
              <Icon name="fork" size={13} />{t('gitChanges.manageBranches')}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.refresh}
            onClick={() => void Promise.all([loadStatus(true), loadBranches(true)])}
            disabled={!projectSelectionReady || !workspaceRestored || loading || branchBusy}
          >
            <Icon name={loading ? 'spinner' : 'reload'} size={13} />
            {t('gitChanges.refresh')}
          </button>
        </div>
      </header>

      {branchManagerOpen && status?.repository ? (
        <div className={styles.branchManager} data-testid="git-branch-manager-panel">
          <div className={styles.branchManagerTitle}>
            <strong>{t('gitChanges.workingBranch')} · {branches?.current ?? branch}</strong>
            <span>{t('gitChanges.workingBranchHint')}</span>
          </div>
          <label>
            <span>{t('gitChanges.switchBranch')}</span>
            <select value={switchTarget} disabled={branchBusy || comparableBranches.length === 0} onChange={(event) => setSwitchTarget(event.target.value)}>
              {comparableBranches.map((candidate) => (
                <option key={candidate.fullName} value={candidate.fullName}>
                  {candidate.name}{candidate.remote ? ` · ${t('gitChanges.remoteBranch')}` : ''}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void prepareBranchAction({ kind: 'switch', value: switchTarget })} disabled={branchBusy || !switchTarget}>
            {t('gitChanges.switchAction')}
          </button>
          <label>
            <span>{t('gitChanges.newBranch')}</span>
            <input value={newBranchName} placeholder="feature/orders" onChange={(event) => setNewBranchName(event.target.value)} />
          </label>
          <button type="button" onClick={() => void prepareBranchAction({ kind: 'create', value: newBranchName })} disabled={branchBusy || !newBranchName.trim()}>
            {t('gitChanges.createAndSwitch')}
          </button>
        </div>
      ) : null}

      {pendingBranchAction ? (
        <div className={styles.dirtyPrompt} role="alertdialog" aria-label={t('gitChanges.uncommittedTitle')}>
          <div>
            <strong>{t('gitChanges.uncommittedTitle')} · {pendingBranchAction.dirtyCount}</strong>
            <span>{t('gitChanges.uncommittedHint')}</span>
          </div>
          <button type="button" onClick={() => setPendingBranchAction(null)} disabled={branchBusy}>{t('common.cancel')}</button>
          <button type="button" onClick={() => void mutateBranch(pendingBranchAction, 'keep')} disabled={branchBusy}>{t('gitChanges.keepAndSwitch')}</button>
          <button type="button" className={styles.primaryAction} onClick={() => void mutateBranch(pendingBranchAction, 'stash')} disabled={branchBusy}>{t('gitChanges.stashAndSwitch')}</button>
        </div>
      ) : null}

      <div className={styles.scope} role="tablist" aria-label={t('gitChanges.title')}>
        {activeComparisonBranch ? (
          <button type="button" role="tab" aria-selected="true" className={styles.selectedScope}>
            {t('gitChanges.compareBranch')} · {status?.comparisonBranch ?? branches?.branches.find((candidate) => candidate.fullName === activeComparisonBranch)?.name}
            <span>{status?.files.length ?? 0}</span>
          </button>
        ) : (
          <>
            <button type="button" role="tab" aria-selected={scope === 'working'} className={scope === 'working' ? styles.selectedScope : ''} onClick={() => setScope('working')}>
              {t('gitChanges.working')} <span>{status?.files.filter((file) => file.unstaged).length ?? 0}</span>
            </button>
            <button type="button" role="tab" aria-selected={scope === 'staged'} className={scope === 'staged' ? styles.selectedScope : ''} onClick={() => setScope('staged')}>
              {t('gitChanges.staged')} <span>{status?.files.filter((file) => file.staged).length ?? 0}</span>
            </button>
          </>
        )}
      </div>

      {!projectSelectionReady ? (
        <div className={styles.loadingState} data-testid="git-project-loading" role="status" aria-live="polite" aria-busy="true">
          <Icon name="spinner" size={13} />{t('gitChanges.title')} · {t('common.loading')}
        </div>
      ) : null}
      {statusLoading ? (
        <div className={styles.loadingState} data-testid="git-status-loading" role="status" aria-live="polite" aria-busy="true">
          <Icon name="spinner" size={13} />{t('gitChanges.title')} · {t('common.loading')}
        </div>
      ) : null}
      {error ? <div className={styles.message} role="alert">{error}</div> : null}
      {actionNotice ? <div className={styles.notice} role="status">{actionNotice}</div> : null}
      {!statusLoading && status && !status.repository ? <div className={styles.message}>{t('gitChanges.noRepository')}</div> : null}
      {!statusLoading && status?.repository && files.length === 0 ? <div className={styles.message}>{t('gitChanges.noChanges')}</div> : null}

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
                  <button type="button" onClick={() => onOpenFile(workspaceFilePath(projectPath, selected.path))}>
                    <Icon name="file-code" size={13} />{t('gitChanges.openFile')}
                  </button>
                ) : null}
              </div>
            </div>
            {diffLoading || diffRendering ? (
              <div className={styles.diffLoading} data-testid="git-diff-loading" role="status" aria-live="polite" aria-busy="true">
                <Icon name="spinner" size={13} />{t('gitChanges.patch')} · {t('common.loading')}
              </div>
            ) : null}
            {!diffRendering && visibleDiff?.truncated ? <div className={styles.warning}>{t('gitChanges.truncated')}</div> : null}
            {!diffRendering && visibleDiff?.binary ? <div className={styles.message}>{t('gitChanges.binary')}</div> : null}
            {!diffRendering && !visibleDiff?.binary && visibleDiff?.patch && viewMode === 'split' ? (
              <div
                className={styles.splitPatch}
                role="table"
                aria-label={t('gitChanges.patch')}
                tabIndex={0}
                data-scroll-axis="both"
              >
                <div className={styles.splitCanvas} data-testid="git-split-canvas">
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
              </div>
            ) : !diffRendering && !visibleDiff?.binary && visibleDiff?.patch ? (
              <pre className={styles.patch} aria-label={t('gitChanges.patch')}>
                {visibleDiff.patch.split('\n').map((line, index) => <span key={index} className={patchLineClass(line)}>{line || ' '}</span>)}
              </pre>
            ) : !diffLoading && !diffRendering && !visibleDiff?.binary ? <div className={styles.message}>{t('gitChanges.emptyPatch')}</div> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
