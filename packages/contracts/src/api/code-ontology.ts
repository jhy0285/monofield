import type { DocumentGraphResponse } from './document-graph.js';

export interface CodeOntologyRequest {
  projectPath?: string;
  businessFiles?: string[];
  request?: string;
}
export interface OntologyEvidence {
  path: string;
  line: number;
  sha256: string;
}
export interface CodeOntologyNode {
  id: string;
  kind: 'file' | 'class' | 'function' | 'field' | 'screen' | 'api' | 'request' | 'table' | 'concept' | 'business-document' | 'external';
  label: string;
  evidence: OntologyEvidence;
  api?: { method: string; path: string };
}
export interface CodeOntologyEdge {
  id: string;
  from: string;
  to: string;
  relation: 'declares' | 'imports' | 'references' | 'calls' | 'serves' | 'requests' | 'maps-table' | 'documents' | 'associated-with';
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
  };
  dependencyGraph: DocumentGraphResponse;
  handoff: string;
  elapsedMs: number;
  cacheHit: boolean;
  modelCalls: 0;
}
