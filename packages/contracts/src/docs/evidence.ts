import { z } from 'zod';

/** A source reference, not a claim that the source was independently verified. */
export const DocumentEvidenceSchema = z.object({
  kind: z.enum(['code', 'requirement', 'browser', 'database', 'manual']),
  ref: z.string().min(1),
  symbol: z.string().optional(),
  line: z.number().int().positive().optional(),
  revision: z.string().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  capturedAt: z.string().optional(),
  summary: z.string().optional(),
  /** Explicit cross-document dependency. Paths stay relative to the project. */
  document: z.object({
    path: z.string().min(1).max(1024).refine((value) => !/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(value)
      && !value.replace(/\\/g, '/').split('/').includes('..') && /\.json$/i.test(value), 'Expected a project-relative JSON path'),
    itemId: z.string().min(1).optional(),
  }).optional(),
  /** A precise database target; opaque legacy refs retain unknown coverage. */
  database: z.object({
    connectionId: z.string().min(1), schema: z.string().min(1), table: z.string().min(1),
    column: z.string().min(1).optional(),
  }).optional(),
});
export type DocumentEvidence = z.infer<typeof DocumentEvidenceSchema>;

export const DocumentReviewStatusSchema = z.enum(['unreviewed', 'accepted', 'edited']);
export type DocumentReviewStatus = z.infer<typeof DocumentReviewStatusSchema>;
