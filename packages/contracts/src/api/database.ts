import { z } from 'zod';

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
/** Metadata only: no connection credentials, row values or default expressions. */
export type DatabaseSchemaTable = { schema: string; table: string; columns: Array<{ name: string; type: string; nullable: string }>; structureSha256?: string | undefined };
export type DatabaseSchemaSnapshot = { tables: DatabaseSchemaTable[] };
export type DatabaseSchemaChange = {
  schema: string; table: string; column?: string | undefined;
  kind: 'table-added' | 'table-removed' | 'table-changed' | 'column-added' | 'column-removed' | 'column-changed';
  before?: { type: string; nullable: string } | undefined;
  after?: { type: string; nullable: string } | undefined;
};
export type DatabaseSchemaWatchConfig = { enabled: boolean; intervalSeconds: number };
export type DatabaseSchemaWatchState = DatabaseSchemaWatchConfig & {
  projectId: string; connectionId: string; workspacePath: string;
  status: 'disabled' | 'pending' | 'current' | 'changed' | 'error';
  checkedAt: string | null; baselineSha256: string | null; latestSha256: string | null;
  baseline: DatabaseSchemaSnapshot | null; latest: DatabaseSchemaSnapshot | null;
  changes: DatabaseSchemaChange[];
  error: string | null;
};
const schemaColumn = z.object({ name: z.string().min(1), type: z.string(), nullable: z.enum(['YES', 'NO']) });
export const DatabaseSchemaSnapshotSchema = z.object({
  tables: z.array(z.object({ schema: z.string().min(1), table: z.string().min(1), columns: z.array(schemaColumn).max(50000), structureSha256: z.string().regex(/^[a-f0-9]{64}$/).optional() })).max(10000),
});
export const DatabaseSchemaWatchConfigSchema = z.object({ enabled: z.boolean(), intervalSeconds: z.number().int().min(10).max(86400) }).strict();
export const DatabaseSchemaWatchStateSchema = DatabaseSchemaWatchConfigSchema.extend({
  projectId: z.string().min(1), connectionId: z.string(), workspacePath: z.string(),
  status: z.enum(['disabled', 'pending', 'current', 'changed', 'error']),
  checkedAt: z.string().nullable(), baselineSha256: z.string().nullable(), latestSha256: z.string().nullable(),
  baseline: DatabaseSchemaSnapshotSchema.nullable(), latest: DatabaseSchemaSnapshotSchema.nullable(),
  changes: z.array(z.object({ schema: z.string(), table: z.string(), column: z.string().optional(),
    kind: z.enum(['table-added', 'table-removed', 'table-changed', 'column-added', 'column-removed', 'column-changed']),
    before: z.object({ type: z.string(), nullable: z.string() }).optional(), after: z.object({ type: z.string(), nullable: z.string() }).optional(),
  })), error: z.string().nullable(),
});
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
  /** Whether the committed mutation was also appended to the local audit log. */
  auditRecorded: boolean;
  /** Present when the mutation committed but durable local audit recording failed. */
  auditWarning?: string;
};
