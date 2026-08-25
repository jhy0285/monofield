export type DatabaseConnectionSummary = {
  id: string;
  label: string;
  host: string;
  database: string;
  createdAt: string;
  readApproval: 'prompt' | 'always';
  accessMode: 'read-only' | 'read-write';
  writePolicy: 'disabled' | 'approve-each' | 'always';
};

export type DatabaseConnectionsResponse = { connections: DatabaseConnectionSummary[] };
export type DatabaseSchemasResponse = { tables: Array<{ schema: string; table: string }> };
export type DatabaseDescribeResponse = { columns: Array<{ name: string; type: string; nullable: string }> };
export type DatabaseSampleResponse = { rows: Array<Record<string, unknown>> };
export type DatabaseInspectConcurrency = 8 | 16 | 32;
export type DatabaseInspectRequest = {
  tables: Array<{ schema: string; table: string }>;
  limit?: number;
  concurrency?: DatabaseInspectConcurrency;
};
export type DatabaseInspectTable = {
  schema: string;
  table: string;
  columns: Array<{ name: string; type: string; nullable: string }>;
  sampleRows: Array<Record<string, unknown>>;
  error?: string;
};
export type DatabaseInspectResponse = { tables: DatabaseInspectTable[] };
export type DatabaseCandidateEvidence = { path: string; line: number; reason: string };
export type DatabaseCandidate = {
  schema: string | null;
  table: string;
  evidence: DatabaseCandidateEvidence[];
};
export type DatabaseCandidatesResponse = { candidates: DatabaseCandidate[] };

export type DatabaseMutationOperation = 'insert' | 'update' | 'delete';
export type DatabaseMutationValue = string | number | boolean | null;
export type DatabaseMutationRequest = {
  operation: DatabaseMutationOperation;
  schema: string;
  table: string;
  values?: Record<string, DatabaseMutationValue>;
  where?: Record<string, DatabaseMutationValue>;
  projectId?: string;
  reason: string;
};
export type DatabaseMutationResponse = {
  approved: true;
  affectedRows: number;
  operation: DatabaseMutationOperation;
  schema: string;
  table: string;
  auditId: string;
};
