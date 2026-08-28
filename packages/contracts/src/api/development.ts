export type ProjectWorkMode = 'development' | 'creation';

export function defaultConversationModeForWorkMode(
  mode: ProjectWorkMode,
): import('./chat.js').ChatSessionMode {
  return mode === 'development' ? 'chat' : 'docs';
}

export type DevelopmentRuntimeKind =
  | 'node'
  | 'python'
  | 'go'
  | 'java'
  | 'dotnet'
  | 'rust'
  | 'static';

export interface DevelopmentRunConfig {
  id: string;
  label: string;
  kind: DevelopmentRuntimeKind;
  framework: string;
  cwd: string;
  command: string;
  args: string[];
  source: string;
  /** Runtime profile selected by this configuration, for example a Spring profile. */
  profile?: string;
  port: number;
  url: string;
  packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun';
  dependenciesReady?: boolean;
}

export interface DevelopmentWorkspaceProject {
  /** POSIX-style path relative to the selected workspace root. */
  path: string;
  label: string;
  markers: string[];
}

export interface DevelopmentConfigsResponse {
  configs: DevelopmentRunConfig[];
  recommendedConfigId: string | null;
  scannedAt: string;
  projects?: DevelopmentWorkspaceProject[];
  activeProjectPath?: string;
}

export type DevelopmentServerState = 'idle' | 'starting' | 'ready' | 'failed';

export interface DevelopmentServerStatus {
  projectId: string;
  /** Active workspace module that owns this process. */
  projectPath: string | null;
  state: DevelopmentServerState;
  config: DevelopmentRunConfig | null;
  pid: number | null;
  url: string | null;
  startedAt: string | null;
  error: string | null;
  logs: string[];
}

export interface DevelopmentServerStartRequest {
  configId: string;
  projectPath?: string;
  overrides?: {
    /** Optional runtime profile override, for example `local` or `dev`. */
    profile?: string;
    /** Additional arguments passed to the application without invoking a shell. */
    applicationArgs?: string[];
  };
}

export type ProjectDatabaseContext = {
  connectionId: string;
  label?: string;
  useForDevelopment: boolean;
};

export type GitDiffScope = 'working' | 'staged' | 'branch';

export interface GitBranchRef {
  /** Display name, for example `feature/orders` or `origin/feature/orders`. */
  name: string;
  /** Unambiguous ref passed back to Git, for example `refs/heads/feature/orders`. */
  fullName: string;
  current: boolean;
  remote: boolean;
  upstream: string | null;
}

export interface GitWorkspaceBranchesResponse {
  repository: boolean;
  current: string | null;
  branches: GitBranchRef[];
  generatedAt: string;
}

export type GitWorkingTreeStrategy = 'reject' | 'keep' | 'stash';

export interface GitBranchSwitchRequest {
  branch: string;
  strategy?: GitWorkingTreeStrategy;
}

export interface GitBranchCreateRequest {
  name: string;
  strategy?: GitWorkingTreeStrategy;
}

export interface GitBranchMutationResponse {
  previousBranch: string | null;
  currentBranch: string | null;
  created: boolean;
  stashed: boolean;
  stashRef?: string;
}

export interface GitWorkspaceDirtyResponse {
  repository: boolean;
  dirty: boolean;
  changeCount: number;
}

export type GitChangeStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'
  | 'type-changed';

export interface GitChangedFile {
  path: string;
  oldPath?: string;
  status: GitChangeStatus;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
}

export interface GitWorkspaceStatusResponse {
  repository: boolean;
  branch: string | null;
  /** Present when files describe committed changes from this branch to HEAD. */
  comparisonBranch?: string;
  head: string | null;
  files: GitChangedFile[];
  generatedAt: string;
}

export interface GitWorkspaceDiffResponse {
  path: string;
  scope: GitDiffScope;
  comparisonBranch?: string;
  patch: string;
  binary: boolean;
  truncated: boolean;
  maxPatchBytes: number;
}
