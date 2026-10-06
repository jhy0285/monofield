export interface DocumentImpactRequest {
  inputFile: string;
}

export interface DocumentProposalRequest {
  inputFile: string;
  proposalFile: string;
  expectedContentSha256: string;
  includeDocument?: boolean;
}

export interface DocumentProposalResponse {
  ok: true;
  inputFile: string;
  proposalFile: string;
  contentSha256: string;
  format: 'complete' | 'changes';
  changesApplied: number | null;
  document?: import('../docs/interface-spec.js').InterfaceSpecDocument;
}

export interface DocumentImpactItem {
  endpointIndex: number;
  endpointId: string;
  title: string;
  changedFiles: string[];
}

/** Direct source references only; transitive dependencies may need agent review. */
export interface DocumentImpactResponse {
  ok: true;
  inputFile: string;
  contentSha256: string;
  repository: boolean;
  baselineRevision: string | null;
  headRevision: string | null;
  changedFiles: string[];
  affected: DocumentImpactItem[];
  untrackedEndpointIndexes: number[];
  proposalFile: string;
  updatePrompt: string;
  analyzedAt: string;
}
