import { createHash } from 'node:crypto';
import type { CodeOntologyEdge, CodeOntologyIssue, CodeOntologyNode, OntologyEvidence } from '@open-design/contracts';

export type Reference = {
  from: string; name: string; kind: 'module' | 'java-type' | 'call' | 'component';
  evidence: OntologyEvidence; importedFrom?: string;
};
export interface ParsedUnit {
  path: string; language: string; nodes: CodeOntologyNode[]; edges: CodeOntologyEdge[];
  references: Reference[]; issues: CodeOntologyIssue[];
  javaPackage?: string;
  javaImports?: string[];
}
// IDs occur in both endpoints and edge IDs. Nesting serialized identifiers
// inflated real codebase exports; fixed-length content IDs remain deterministic.
export const ontologyId = (...parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('base64url');
export function edge(from: string, to: string, relation: CodeOntologyEdge['relation'], evidence: OntologyEvidence, basis: CodeOntologyEdge['basis'] = 'syntax'): CodeOntologyEdge {
  return { id: ontologyId(from, to, relation), from, to, relation, basis, evidence };
}
export function unit(path: string, language: string, sha256: string): ParsedUnit {
  return { path, language, nodes: [{ id: ontologyId('file', path), kind: 'file', label: path, evidence: { path, line: 1, sha256 } }], edges: [], references: [], issues: [] };
}
