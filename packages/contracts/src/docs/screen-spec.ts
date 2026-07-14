import { z } from 'zod';

/**
 * screen-spec document contract (v1).
 *
 * Ported from Screen Spec Studio's domain model (wireFrame repo,
 * src/domain/screenSpec.ts). The JSON document is the single source of
 * truth for a Korean SI-style screen specification ("화면명세서"): agents
 * and the structured editor both edit this document, and the deterministic
 * PPTX renderer reads it. Nobody edits the rendered .pptx directly.
 */

export const SCREEN_SPEC_SCHEMA_VERSION = 1 as const;

export const ScreenSpecGenerationModeSchema = z.enum([
  'document-existing-screen',
  'generate-new-screen',
  'enhance-existing-spec',
  'capture-url-or-local',
]);
export type ScreenSpecGenerationMode = z.infer<typeof ScreenSpecGenerationModeSchema>;

export const ScreenSpecThemeSchema = z.enum(['enterprise-si-basic']);
export type ScreenSpecTheme = z.infer<typeof ScreenSpecThemeSchema>;

export const ScreenSpecSourceAssetTypeSchema = z.enum([
  'screenshot',
  'existing-spec-ppt',
  'existing-spec-image',
  'requirement',
  'style-reference',
  'url',
  'api-spec',
  'erd',
  'code',
  'business-kb',
]);
export type ScreenSpecSourceAssetType = z.infer<typeof ScreenSpecSourceAssetTypeSchema>;

export const ScreenSpecSourceAssetSchema = z.object({
  id: z.string().min(1),
  type: ScreenSpecSourceAssetTypeSchema,
  title: z.string().default(''),
  /** Project-relative file path or URL the asset came from. */
  contentRef: z.string().default(''),
  summary: z.string().optional(),
});
export type ScreenSpecSourceAsset = z.infer<typeof ScreenSpecSourceAssetSchema>;

/** Position normalized to the screen image (0..1 on both axes). */
export const ScreenSpecPositionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
export type ScreenSpecPosition = z.infer<typeof ScreenSpecPositionSchema>;

/** One red numbered marker with its description-table row. */
export const ScreenSpecCalloutSchema = z.object({
  no: z.number().int().min(1),
  label: z.string().default(''),
  description: z.string().default(''),
  position: ScreenSpecPositionSchema,
});
export type ScreenSpecCallout = z.infer<typeof ScreenSpecCalloutSchema>;

export const ScreenSpecRelationLineModeSchema = z.enum(['straight', 'orthogonal']);

export const ScreenSpecCalloutRelationSchema = z.object({
  fromNo: z.number().int().min(1),
  toNo: z.number().int().min(1),
  label: z.string().optional(),
  lineMode: ScreenSpecRelationLineModeSchema.optional(),
});
export type ScreenSpecCalloutRelation = z.infer<typeof ScreenSpecCalloutRelationSchema>;

export const ScreenSpecVisualSettingsSchema = z.object({
  markerSizePx: z.number().positive().default(24),
  relationLineWidthPx: z.number().positive().default(2),
  canvasHeightPx: z.number().positive().default(520),
});
export type ScreenSpecVisualSettings = z.infer<typeof ScreenSpecVisualSettingsSchema>;

export const ScreenSpecScreenSchema = z.object({
  id: z.string().min(1),
  pageTitle: z.string().default(''),
  /** 화면ID/명 metadata row. */
  screenName: z.string().default(''),
  screenPath: z.string().default(''),
  /** 개요 metadata row. */
  overview: z.string().default(''),
  /** Dynamic "Level n" metadata values. */
  levels: z.array(z.string()).default([]),
  companyName: z.string().default(''),
  author: z.string().default(''),
  date: z.string().default(''),
  version: z.string().default(''),
  /**
   * Screen image: either a data URL (self-contained document) or a
   * project-relative file reference via `imageRef`.
   */
  imageDataUrl: z.string().optional(),
  imageRef: z.string().optional(),
  callouts: z.array(ScreenSpecCalloutSchema).default([]),
  calloutRelations: z.array(ScreenSpecCalloutRelationSchema).default([]),
  visualSettings: ScreenSpecVisualSettingsSchema.default({}),
  /** Check Point bullet list. */
  checkpoints: z.array(z.string()).default([]),
});
export type ScreenSpecScreen = z.infer<typeof ScreenSpecScreenSchema>;

/** Root document. This is the artifact entry file for `kind: "screen-spec"`. */
export const ScreenSpecDocumentSchema = z.object({
  schemaVersion: z.literal(SCREEN_SPEC_SCHEMA_VERSION),
  kind: z.literal('screen-spec'),
  name: z.string().min(1),
  mode: ScreenSpecGenerationModeSchema.default('document-existing-screen'),
  theme: ScreenSpecThemeSchema.default('enterprise-si-basic'),
  sources: z.array(ScreenSpecSourceAssetSchema).default([]),
  screens: z.array(ScreenSpecScreenSchema).default([]),
});
export type ScreenSpecDocument = z.infer<typeof ScreenSpecDocumentSchema>;

export type ScreenSpecIssueSeverity = 'fatal' | 'warning';

export interface ScreenSpecIssue {
  severity: ScreenSpecIssueSeverity;
  code:
    | 'duplicate-screen-id'
    | 'duplicate-callout-no'
    | 'relation-missing-callout'
    | 'missing-screen-image';
  message: string;
  screenIndex?: number;
}

/** Cross-field validation beyond the zod shape. */
export function validateScreenSpecDocument(doc: ScreenSpecDocument): ScreenSpecIssue[] {
  const issues: ScreenSpecIssue[] = [];
  const seenScreenIds = new Map<string, number>();

  doc.screens.forEach((screen, index) => {
    const firstIndex = seenScreenIds.get(screen.id);
    if (firstIndex !== undefined) {
      issues.push({
        severity: 'fatal',
        code: 'duplicate-screen-id',
        message: `Duplicate screen id "${screen.id}" (first seen at screens[${firstIndex}]).`,
        screenIndex: index,
      });
    } else {
      seenScreenIds.set(screen.id, index);
    }

    const calloutNos = new Set<number>();
    for (const callout of screen.callouts) {
      if (calloutNos.has(callout.no)) {
        issues.push({
          severity: 'fatal',
          code: 'duplicate-callout-no',
          message: `Screen "${screen.id}" has duplicate callout no ${callout.no}.`,
          screenIndex: index,
        });
      }
      calloutNos.add(callout.no);
    }

    for (const relation of screen.calloutRelations) {
      for (const no of [relation.fromNo, relation.toNo]) {
        if (!calloutNos.has(no)) {
          issues.push({
            severity: 'fatal',
            code: 'relation-missing-callout',
            message: `Screen "${screen.id}" relation ${relation.fromNo}→${relation.toNo} references missing callout no ${no}.`,
            screenIndex: index,
          });
        }
      }
    }

    if (!screen.imageDataUrl && !screen.imageRef) {
      issues.push({
        severity: 'warning',
        code: 'missing-screen-image',
        message: `Screen "${screen.id}" has no image; the PPTX will render a placeholder.`,
        screenIndex: index,
      });
    }
  });

  return issues;
}

/** Parse + validate an untrusted JSON value (typically agent output). */
export function parseScreenSpecDocument(
  value: unknown,
):
  | { ok: true; doc: ScreenSpecDocument; issues: ScreenSpecIssue[] }
  | { ok: false; error: string } {
  const parsed = ScreenSpecDocumentSchema.safeParse(value);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    return { ok: false, error: lines.join('\n') };
  }
  return { ok: true, doc: parsed.data, issues: validateScreenSpecDocument(parsed.data) };
}
