export type DocumentGraphNode = {
  id: string; kind: 'api' | 'screen' | 'database' | 'code'; label: string;
  documentFile?: string; itemId?: string;
  database?: { connectionId: string; schema: string; table: string; column?: string | undefined };
};
export type DocumentGraphEdge = {
  dependentId: string; sourceId: string; documentFile: string; evidenceRef: string;
};
export type DocumentGraphImpact = { nodeId: string; sourceId: string; path: string[] };
export type DocumentGraphResponse = {
  ok: true; analyzedAt: string; documents: string[];
  nodes: DocumentGraphNode[]; edges: DocumentGraphEdge[];
  changedNodeIds: string[]; impacts: DocumentGraphImpact[];
  unlinkedNodeIds: string[]; warnings: string[];
  schemaWatch: import('./database.js').DatabaseSchemaWatchState | null;
};
