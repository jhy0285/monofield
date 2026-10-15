import type { DocumentGraphResponse } from './document-graph.js';

export interface CodeOntologyRequest {
  projectPath?: string;
  businessFiles?: string[];
  request?: string;
}
export interface CodeOntologyPlanRequest extends CodeOntologyRequest {
  inputFiles?: string[];
  rulesFile?: string;
}
export interface CodeOntologyPlanResponse {
  ontology: CodeOntologyResponse;
  plan: import('./change-plan.js').ChangePlanResponse;
  documentReviews: Array<{
    documentFile: string;
    itemId: string;
    label: string;
    state: 'review-required' | 'coverage-unknown' | 'no-recorded-impact';
    /** Paths are observed/static candidates, not proof of runtime or business completeness. */
    impactPath: string[];
  }>;
  documentHashes: Array<{ path: string; sha256: string }>;
  elapsedMs: number;
  modelCalls: 0;
}
export interface OntologyEvidence {
  path: string;
  line: number;
  sha256: string;
}
export interface CodeOntologyNode {
  id: string;
  kind: 'file' | 'class' | 'function' | 'field' | 'screen' | 'api' | 'request' | 'table' | 'concept' | 'business-rule' | 'business-document' | 'external';
  label: string;
  evidence: OntologyEvidence;
  api?: { method: string; path: string };
}
export interface CodeOntologyEdge {
  id: string;
  from: string;
  to: string;
  relation: 'declares' | 'imports' | 'references' | 'calls' | 'serves' | 'requests' | 'maps-table' | 'documents' | 'associated-with' | 'constrains';
  /** Syntactic observations are not proof of runtime behavior or business intent. */
  basis: 'syntax' | 'candidate';
  evidence: OntologyEvidence;
}
export interface CodeOntologyIssue {
  path: string;
  reason: 'unsupported-language' | 'parse-error' | 'unresolved-reference' | 'dynamic-expression' | 'excluded-file' | 'limit';
  message: string;
}
export interface CodeOntologyResponse {
  schemaVersion: 1;
  projectPath: string;
  analyzedAt: string;
  snapshotSha256: string;
  nodes: CodeOntologyNode[];
  edges: CodeOntologyEdge[];
  issues: CodeOntologyIssue[];
  /** Lexically similar rule lines with differing numbers. Context may legitimately differ. */
  businessRuleConflicts?: Array<{ ruleIds: string[]; reason: 'different-literal-values' }>;
  /** Optional when reading older exports. Documents improve evidence, not verified business semantics. */
  businessContext?: {
    basis: 'code-only' | 'document-candidates';
    documentCount: number;
    conceptCount: number;
    associationCount: number;
    businessRulesVerified: false;
  };
  coverage: {
    scannedFiles: number;
    parsedFiles: number;
    sourceBytes: number;
    businessDocuments: number;
    unsupportedFiles: number;
    languages: Array<{ id: string; files: number }>;
    truncated: boolean;
    /** Complete inventory is still not complete semantic/type/runtime analysis. */
    inventoryComplete: boolean;
    reusedParsedFiles?: number;
    parsedNowFiles?: number;
  };
  dependencyGraph: DocumentGraphResponse;
  handoff: string;
  elapsedMs: number;
  cacheHit: boolean;
  modelCalls: 0;
}

export interface CodeOntologyContextRequest extends CodeOntologyRequest {
  request: string;
  maxBytes?: number;
  focusNodeIds?: string[];
  /** Explicit opt-in; only an already configured loopback decision server may be used. */
  localJudge?: boolean;
  evidenceMode?: 'references' | 'excerpts';
}
export interface OntologyContextJudge {
  reason: 'disabled' | 'not-local' | 'not-needed' | 'reranked' | 'uncertain' | 'timeout' | 'unavailable';
  evaluationAttempts: number;
  cached: boolean;
  elapsedMs: number;
  model: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
}
export interface CodeOntologyContextResponse {
  schemaVersion: 1;
  projectPath: string;
  snapshotSha256: string;
  question: string;
  evidenceMode: 'references' | 'excerpts';
  businessContext: CodeOntologyResponse['businessContext'];
  evidence: Array<{ path: string; startLine: number; endLine: number; sha256: string; text: string; reason: 'direct-match' | 'graph-neighbor' | 'fallback'; nodeIds: string[] }>;
  businessRules: Array<{ id: string; text: string; evidence: OntologyEvidence; relatedCodePaths: string[]; state: 'unreviewed' }>;
  budget: { maxBytes: number; promptBytes: number; fullGraphBytes: number; existingHandoffBytes: number; includedEvidenceBytes: number; omittedCandidateFiles: number };
  /** Actual provider input/cache/output totals cannot be inferred from byte counts. */
  tokenUsage: null;
  judge: OntologyContextJudge;
  warnings: string[];
  prompt: string;
  constructionModelCalls: 0;
  elapsedMs: number;
}
