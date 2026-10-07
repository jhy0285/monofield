/** Commands are discovered from the selected module, never supplied as shell text. */
export interface VerificationCheck {
  id: string;
  label: string;
  kind: 'test' | 'types' | 'lint' | 'build';
  command: string;
  args: string[];
  source: string;
  script: string | null;
  recommended: boolean;
}

export interface VerificationPlan {
  projectPath: string;
  checks: VerificationCheck[];
}

export interface VerificationSource {
  /** Git-visible files across the worktree; excludes ignored dependencies and runtime data. */
  scope: 'git-visible-worktree';
  head: string | null;
  digest: string | null;
  fileCount: number;
  reason: string | null;
}

export type VerificationStepState = 'pending' | 'running' | 'passed' | 'failed' | 'timed-out' | 'cancelled';
export interface VerificationStep {
  check: VerificationCheck;
  state: VerificationStepState;
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  output: string;
  outputTruncated: boolean;
}

export interface VerificationRun {
  schemaVersion: 1;
  id: string;
  projectId: string;
  projectPath: string;
  state: 'running' | 'passed' | 'failed' | 'cancelled' | 'interrupted';
  startedAt: string;
  endedAt: string | null;
  timeoutMs: number;
  sourceBefore: VerificationSource;
  sourceAfter: VerificationSource | null;
  /** A passing command is not proof for source changed while the command was running. */
  stableSource: boolean;
  steps: VerificationStep[];
  error: string | null;
}

export type VerificationFreshness = 'current' | 'stale' | 'unknown';
export interface VerificationStatus {
  /** Freshness is an observation at this instant, not a continuing watcher. */
  checkedAt: string;
  run: VerificationRun | null;
  freshness: VerificationFreshness;
  /** True only for completed, passing checks and an unchanged, measurable source snapshot. */
  verified: boolean;
  history: Array<Pick<VerificationRun, 'id' | 'state' | 'startedAt' | 'endedAt'>>;
}

export interface VerificationStartRequest {
  projectPath?: string;
  checkIds: string[];
  timeoutMs?: number;
}

export interface VerificationRepairRequest { request: string }
export interface VerificationRepairResponse { prompt: string; runId: string }
