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
  /** Caller compatibility of the proposal against the original (breaking / warning / info). */
  compatibility: import('../docs/interface-spec-compatibility.js').InterfaceSpecCompatibilityReport;
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
  /**
   * How `affected` was found. `rescan`: the code at the baseline revision and the current code were both read with the
   * document's scanner and compared, so only interfaces that really changed are listed. `files`: interfaces whose source
   * references include a changed file (wider; also lists interfaces whose file changed elsewhere).
   */
  analysis?: 'rescan' | 'files';
  /** Why the rescan was not used (no Python, a document not made by the scanner, the scanner failed, ...). */
  analysisNote?: string;
  /** Caller-visible differences between the baseline and the current code, from the rescan. */
  rescan?: import('../docs/interface-spec-compatibility.js').InterfaceSpecCompatibilityReport;
  /** `METHOD /path` routes found in the current code that the document does not list (rescan only). */
  newRoutes?: string[];
}
