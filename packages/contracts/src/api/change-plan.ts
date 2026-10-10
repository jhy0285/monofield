import type { DocumentGraphNode, DocumentGraphResponse } from './document-graph.js';
import type { VerificationCheck, VerificationSource } from './verification.js';

export type ChangeReview = 'browser' | 'keyboard' | 'responsive' | 'contrast' | 'schema' | 'migration';
/** All populated conditions must match. Prefixes match whole path segments. */
export interface ChangeSelector {
  kind: DocumentGraphNode['kind'];
  documentFile?: string;
  itemId?: string;
  pathPrefix?: string;
}
/** Declarative data only. No expressions, regexes, commands or executable hooks. */
export interface ChangePolicy {
  schemaVersion: 1;
  bindings: Array<{ target: ChangeSelector; checkIds: string[] }>;
  rules: Array<{ id: string; when: ChangeSelector; require: { checkIds: string[]; reviews: ChangeReview[] } }>;
}
export interface ChangePlanRequest {
  inputFiles?: string[];
  rulesFile?: string;
  simulateNodeIds?: string[];
  request?: string;
}
export type ChangeObligationState = 'needs-run' | 'passed-current' | 'stale' | 'missing-check' | 'manual-review' | 'coverage-gap';
export interface ChangeObligation {
  id: string;
  ruleId: string;
  nodeId: string;
  path: string[];
  condition: string;
  triggers: Array<{ ruleId: string; condition: string }>;
  requirement: string;
  state: ChangeObligationState;
  checkId: string | null;
  review: ChangeReview | null;
  receiptId: string | null;
}
export interface ChangePlanResponse {
  schemaVersion: 1;
  mode: 'observed' | 'simulation';
  graph: DocumentGraphResponse;
  ontology: {
    nodes: Array<DocumentGraphNode | { id: string; kind: 'check'; label: string }>;
    edges: Array<{ from: string; to: string; relation: 'depends-on' | 'verified-by'; evidence: string }>;
  };
  source: VerificationSource;
  checks: VerificationCheck[];
  changedFiles: string[];
  unmatchedChangedFiles: string[];
  affectedNodeIds: string[];
  obligations: ChangeObligation[];
  warnings: string[];
  summary: { affected: number; obligations: number; passed: number; outstanding: number; coverageGaps: number };
  handoff: string;
  handoffTruncated: boolean;
  elapsedMs: number;
  modelCalls: 0;
}
