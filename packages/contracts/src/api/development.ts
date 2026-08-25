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
  port: number;
  url: string;
  packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun';
  dependenciesReady?: boolean;
}

export interface DevelopmentConfigsResponse {
  configs: DevelopmentRunConfig[];
  recommendedConfigId: string | null;
  scannedAt: string;
}

export type DevelopmentServerState = 'idle' | 'starting' | 'ready' | 'failed';

export interface DevelopmentServerStatus {
  projectId: string;
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
}

export type ProjectDatabaseContext = {
  connectionId: string;
  label?: string;
  useForDevelopment: boolean;
};

export type GitDiffScope = 'working' | 'staged';

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
  head: string | null;
  files: GitChangedFile[];
  generatedAt: string;
}

export interface GitWorkspaceDiffResponse {
  path: string;
  scope: GitDiffScope;
  patch: string;
  binary: boolean;
  truncated: boolean;
  maxPatchBytes: number;
}
