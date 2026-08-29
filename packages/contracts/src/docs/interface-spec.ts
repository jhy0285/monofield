import { z } from 'zod';

/**
 * interface-spec document contract (v1).
 *
 * The JSON document described here is the single source of truth for a
 * Korean SI-style API interface specification ("인터페이스 명세서").
 *
 * Collectors WRITE this document:
 *   - an agent reading an arbitrary codebase (any language/framework), or
 *   - a static scanner (e.g. the legacy Spring Boot collector), or
 *   - a human editing through the structured editor.
 *
 * The deterministic XLSX renderer READS it. Neither humans nor agents edit
 * the rendered workbook directly — all edits happen on this document, so
 * human review and agent revisions never overwrite each other.
 */

export const INTERFACE_SPEC_SCHEMA_VERSION = 1 as const;

/** Whether a field is mandatory. TBD keeps an unresolved manual-design choice visible. */
export const InterfaceRequiredFlagSchema = z.enum(['Y', 'N', 'TBD']);
export type InterfaceRequiredFlag = z.infer<typeof InterfaceRequiredFlagSchema>;

/**
 * One request or response field row in a detail sheet.
 * Nested DTO expansion is represented by `path`/`parentPath`/`depth`
 * (e.g. `result.items.id` with parent `result.items`, depth 2).
 */
export const InterfaceFieldSpecSchema = z.object({
  /** Field name as it appears in code (English). */
  nameEn: z.string().min(1),
  /** Korean field label. Renderers fall back to `nameEn` when blank. */
  nameKo: z.string().default(''),
  dataType: z.string().default('String'),
  required: InterfaceRequiredFlagSchema.default('N'),
  /** Min/max size columns of the 8-column detail layout. Blank when unknown. */
  minSize: z.string().default(''),
  maxSize: z.string().default(''),
  note: z.string().default(''),
  /** Dot path for nested DTO expansion. Omit for flat fields. */
  path: z.string().optional(),
  parentPath: z.string().optional(),
  depth: z.number().int().min(0).default(0),
});
export type InterfaceFieldSpec = z.infer<typeof InterfaceFieldSpecSchema>;

/**
 * How a client authenticates to an endpoint. Stack-neutral so it covers
 * bearer tokens, API keys, and session cookies alike — the renderer used to
 * hardcode `Authorization: Bearer {accessToken}` for every auth-required
 * endpoint, which was simply wrong for session/cookie backends (e.g. a `sid`
 * cookie). Collectors detect the real scheme and record it here.
 */
export const InterfaceAuthTypeSchema = z.enum([
  'undecided',
  'none',
  'bearer',
  'api-key',
  'session-cookie',
  'custom',
]);
export type InterfaceAuthType = z.infer<typeof InterfaceAuthTypeSchema>;

export const InterfaceAuthLocationSchema = z.enum(['header', 'cookie', 'query']);
export type InterfaceAuthLocation = z.infer<typeof InterfaceAuthLocationSchema>;

/** How the request/response examples were obtained. */
// `live-probe` remains readable for previously generated documents, but the
// current interface-spec workflow emits static-analysis examples only.
export const InterfaceExampleSourceSchema = z.enum(['static-analysis', 'live-probe']);
export type InterfaceExampleSource = z.infer<typeof InterfaceExampleSourceSchema>;

export const InterfaceAuthSchemeSchema = z.object({
  type: InterfaceAuthTypeSchema,
  /** Where the credential travels. Defaults per type: bearer/api-key → header, session-cookie → cookie. */
  location: InterfaceAuthLocationSchema.optional(),
  /** Header/cookie/query name carrying the credential (e.g. 'Authorization', 'X-API-Key', 'sid'). */
  name: z.string().optional(),
  /** Value format shown in the 비고 column (e.g. 'Bearer {accessToken}', '{sessionId}'). */
  valueFormat: z.string().optional(),
  /** Korean label/note for the auth row (e.g. '세션 쿠키'). */
  description: z.string().optional(),
});
export type InterfaceAuthScheme = z.infer<typeof InterfaceAuthSchemeSchema>;

/**
 * One API endpoint. Framework-agnostic: `moduleName`/`handlerName` replace
 * Spring-specific package/controller-method naming so agent collectors can
 * map any stack (NestJS module/handler, Django app/view, Express router/
 * handler, ...) onto the same shape.
 */
export const InterfaceEndpointSchema = z.object({
  /** HTTP method or channel-specific verb, uppercase (GET, POST, PUBLISH, ...). */
  method: z.string().min(1),
  /** URL path or logical address. `method + path` must be unique per document. */
  path: z.string().min(1),
  /** Stable workbook identifier (e.g. "IF-APS-001"). Renderer assigns when blank. */
  interfaceId: z.string().default(''),
  /** Human-readable Korean interface name (e.g. "사용자 조회"). */
  interfaceName: z.string().default(''),
  /** Business purpose / processing rules supplied for a manually designed endpoint. */
  businessPurpose: z.string().optional(),
  businessCode: z.string().default(''),
  channel: z.string().default(''),
  owner: z.string().default(''),
  note: z.string().default(''),
  /** Module / package / namespace containing the handler. */
  moduleName: z.string().default(''),
  serviceName: z.string().default(''),
  /** Handler function or controller method name. */
  handlerName: z.string().default(''),
  /** Source location for traceability back into the codebase. */
  sourceFile: z.string().default(''),
  sourceLine: z.number().int().positive().optional(),
  authRequired: z.boolean().default(false),
  /** Per-endpoint auth override. Falls back to the document-level `auth` scheme. */
  auth: InterfaceAuthSchemeSchema.optional(),
  /** Original type names from code, for reference and re-collection. */
  requestBodyType: z.string().optional(),
  queryDtoType: z.string().optional(),
  responseType: z.string().optional(),
  requestFields: z.array(InterfaceFieldSpecSchema).default([]),
  responseFields: z.array(InterfaceFieldSpecSchema).default([]),
  /** A captured or static-analysis-derived request example. */
  requestExample: z.unknown().optional(),
  /** A captured or static-analysis-derived response example. */
  responseExample: z.unknown().optional(),
  /**
   * `static-analysis` examples are synthesized from code and optional approved
   * database samples; they must never be presented as a runtime result.
   */
  exampleSource: InterfaceExampleSourceSchema.optional(),
});
export type InterfaceEndpoint = z.infer<typeof InterfaceEndpointSchema>;

/** Cover sheet ("문서표지") values. All optional; renderer keeps defaults. */
export const InterfaceSpecCoverSchema = z.object({
  /** Organization / program name shown on the cover (e.g. "스마트 인프라 구축사업"). */
  brand: z.string().default(''),
  /** Document name (e.g. "SWD-PP12-APS"). */
  docName: z.string().default(''),
  version: z.string().default(''),
  /** Owning department (e.g. "스마트교통2팀"). */
  department: z.string().default(''),
});
export type InterfaceSpecCover = z.infer<typeof InterfaceSpecCoverSchema>;

export const InterfaceSpecCollectorSchema = z.enum([
  'agent',
  'static-spring',
  'static-fastapi',
  'static-nestjs',
  'static-express',
  'static-django',
  'static-go',
  'manual',
]);
export type InterfaceSpecCollector = z.infer<typeof InterfaceSpecCollectorSchema>;

export const InterfaceSpecSourceModeSchema = z.enum(['codebase', 'manual']);
export type InterfaceSpecSourceMode = z.infer<typeof InterfaceSpecSourceModeSchema>;

/** Built-in workbook layouts available in the manual-design confirmation UI. */
export const InterfaceSpecTemplatePresetSchema = z.enum([
  'si-standard',
  'compact',
  'review',
]);
export type InterfaceSpecTemplatePreset = z.infer<typeof InterfaceSpecTemplatePresetSchema>;

/** Provenance of the collected endpoints. */
export const InterfaceSpecSourceSchema = z.object({
  codebaseName: z.string().min(1),
  codebasePath: z.string().default(''),
  language: z.string().default(''),
  framework: z.string().default(''),
  collector: InterfaceSpecCollectorSchema.default('agent'),
  /** Manual documents intentionally have no codebase path. */
  mode: InterfaceSpecSourceModeSchema.default('codebase'),
  /** ISO-8601 timestamp of the collection run. */
  collectedAt: z.string().default(''),
});
export type InterfaceSpecSource = z.infer<typeof InterfaceSpecSourceSchema>;

/** Root document. This is the artifact entry file for `kind: "interface-spec"`. */
export const InterfaceSpecDocumentSchema = z.object({
  schemaVersion: z.literal(INTERFACE_SPEC_SCHEMA_VERSION),
  kind: z.literal('interface-spec'),
  cover: InterfaceSpecCoverSchema.default({}),
  source: InterfaceSpecSourceSchema,
  /** Deterministic built-in XLSX/HTML presentation preset. */
  templatePreset: InterfaceSpecTemplatePresetSchema.default('si-standard'),
  /**
   * Document-level default auth scheme. Endpoints inherit this unless they
   * set their own `auth`. Collectors set it once after detecting how the API
   * authenticates (e.g. session-cookie `sid`), so every auth-required
   * endpoint renders the correct scheme instead of a hardcoded Bearer row.
   */
  auth: InterfaceAuthSchemeSchema.optional(),
  endpoints: z.array(InterfaceEndpointSchema).default([]),
});
export type InterfaceSpecDocument = z.infer<typeof InterfaceSpecDocumentSchema>;

/** Editable no-codebase draft accepted by the deterministic docs CLI. */
export const InterfaceSpecManualAssistModeSchema = z.enum(['ai', 'manual']);
export const InterfaceSpecManualReviewStageSchema = z.enum(['intake', 'review']);
export const InterfaceSpecManualFieldModeSchema = z.enum(['ai', 'manual', 'none']);
export const InterfaceSpecManualReferenceRoleSchema = z.enum([
  'requirements',
  'output-template',
  'dictionary',
  'sample',
  'api-standard',
  'other',
]);

export const InterfaceSpecManualReferenceFileSchema = z.object({
  id: z.string().default(''),
  name: z.string().trim().min(1),
  path: z.string().trim().min(1),
  role: InterfaceSpecManualReferenceRoleSchema.default('other'),
});

export const InterfaceSpecManualFieldDraftSchema = z.object({
  id: z.string().default(''),
  nameEn: z.string().trim().min(1),
  nameKo: z.string().default(''),
  dataType: z.string().default(''),
  minSize: z.string().default(''),
  maxSize: z.string().default(''),
  required: InterfaceRequiredFlagSchema.default('TBD'),
  note: z.string().default(''),
  suggested: z.boolean().optional(),
  evidence: z.string().default(''),
});

export const InterfaceSpecManualEndpointDraftSchema = z.object({
  id: z.string().default(''),
  interfaceName: z.string().trim().min(1),
  interfaceId: z.string().default(''),
  method: z.string().trim().min(1),
  path: z.string().trim().min(1),
  auth: InterfaceAuthTypeSchema.default('undecided'),
  businessPurpose: z.string().default(''),
  requestMode: InterfaceSpecManualFieldModeSchema.default('manual'),
  responseMode: InterfaceSpecManualFieldModeSchema.default('manual'),
  requestFields: z.array(InterfaceSpecManualFieldDraftSchema).default([]),
  responseFields: z.array(InterfaceSpecManualFieldDraftSchema).default([]),
});

export const InterfaceSpecManualDraftSchema = z.object({
  documentName: z.string().trim().min(1),
  version: z.string().default('1.0'),
  department: z.string().default(''),
  assistMode: InterfaceSpecManualAssistModeSchema.default('manual'),
  reviewStage: InterfaceSpecManualReviewStageSchema.default('review'),
  businessContext: z.string().default(''),
  referenceFiles: z.array(InterfaceSpecManualReferenceFileSchema).default([]),
  templatePreset: InterfaceSpecTemplatePresetSchema.default('si-standard'),
  endpoints: z.array(InterfaceSpecManualEndpointDraftSchema).min(1),
});
export type InterfaceSpecManualDocumentDraft = z.infer<typeof InterfaceSpecManualDraftSchema>;

/**
 * Convert a reviewed UI draft into the canonical v1 document. No model or
 * codebase inference participates in this step.
 */
export function createInterfaceSpecDocumentFromManualDraft(
  value: unknown,
): { ok: true; doc: InterfaceSpecDocument; issues: InterfaceSpecIssue[] } | { ok: false; error: string } {
  const parsed = InterfaceSpecManualDraftSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n'),
    };
  }

  const submittedReviewStage =
    value && typeof value === 'object' && 'reviewStage' in value
      ? (value as { reviewStage?: unknown }).reviewStage
      : undefined;
  if (
    parsed.data.reviewStage !== 'review' ||
    (parsed.data.assistMode === 'ai' && submittedReviewStage !== 'review')
  ) {
    return {
      ok: false,
      error: 'Manual interface-spec draft must be reviewed before conversion.',
    };
  }

  const unacceptedSuggestion = parsed.data.endpoints.find((endpoint) =>
    (endpoint.requestMode !== 'none' && endpoint.requestFields.some((field) => field.suggested === true)) ||
    (endpoint.responseMode !== 'none' && endpoint.responseFields.some((field) => field.suggested === true)),
  );
  if (unacceptedSuggestion) {
    return {
      ok: false,
      error: 'Manual interface-spec draft contains unaccepted AI suggestions.',
    };
  }

  const doc = InterfaceSpecDocumentSchema.parse({
    schemaVersion: INTERFACE_SPEC_SCHEMA_VERSION,
    kind: 'interface-spec',
    cover: {
      docName: parsed.data.documentName,
      version: parsed.data.version,
      department: parsed.data.department,
    },
    source: {
      codebaseName: parsed.data.documentName,
      codebasePath: '',
      language: '',
      framework: '',
      collector: 'manual',
      mode: 'manual',
      collectedAt: '',
    },
    templatePreset: parsed.data.templatePreset,
    endpoints: parsed.data.endpoints.map((endpoint) => ({
      method: endpoint.method.toUpperCase(),
      path: endpoint.path,
      interfaceId: endpoint.interfaceId.trim().toUpperCase(),
      interfaceName: endpoint.interfaceName,
      businessPurpose: endpoint.businessPurpose,
      authRequired: endpoint.auth !== 'none',
      ...(endpoint.auth === 'none' ? {} : { auth: { type: endpoint.auth } }),
      requestFields: (endpoint.requestMode === 'none' ? [] : endpoint.requestFields).map((field) => ({
        nameEn: field.nameEn,
        nameKo: field.nameKo,
        dataType: field.dataType,
        minSize: field.minSize,
        maxSize: field.maxSize,
        required: field.required,
        note: field.note,
      })),
      responseFields: (endpoint.responseMode === 'none' ? [] : endpoint.responseFields).map((field) => ({
        nameEn: field.nameEn,
        nameKo: field.nameKo,
        dataType: field.dataType,
        minSize: field.minSize,
        maxSize: field.maxSize,
        required: field.required,
        note: field.note,
      })),
    })),
  });
  const issues = validateInterfaceSpecDocument(doc);
  const fatal = issues.filter((issue) => issue.severity === 'fatal');
  if (fatal.length > 0) return { ok: false, error: fatal.map((issue) => issue.message).join('\n') };
  return { ok: true, doc, issues };
}

export type InterfaceSpecIssueSeverity = 'fatal' | 'warning';

export interface InterfaceSpecIssue {
  severity: InterfaceSpecIssueSeverity;
  code:
    | 'duplicate-endpoint-key'
    | 'duplicate-interface-id'
    | 'missing-endpoint'
    | 'missing-interface-id'
    | 'duplicate-field-name'
    | 'unresolved-field-definition'
    | 'orphan-parent-path'
    | 'empty-endpoint-fields';
  message: string;
  /** Index into `endpoints` when the issue is endpoint-scoped. */
  endpointIndex?: number;
}

/**
 * Cross-field validation beyond the zod shape, mirroring the legacy
 * generator's conventions: duplicate METHOD+URL keys are fatal; renderers
 * must refuse to export a document with fatal issues (but should still
 * report them so the collecting agent can self-correct).
 */
export function validateInterfaceSpecDocument(doc: InterfaceSpecDocument): InterfaceSpecIssue[] {
  const issues: InterfaceSpecIssue[] = [];
  const seenKeys = new Map<string, number>();
  const seenInterfaceIds = new Map<string, number>();

  if (doc.endpoints.length === 0) {
    issues.push({
      severity: 'fatal',
      code: 'missing-endpoint',
      message: 'The interface specification must contain at least one endpoint.',
    });
  }

  doc.endpoints.forEach((endpoint, index) => {
    const key = `${endpoint.method.toUpperCase()} ${endpoint.path}`;
    const firstIndex = seenKeys.get(key);
    if (firstIndex !== undefined) {
      issues.push({
        severity: 'fatal',
        code: 'duplicate-endpoint-key',
        message: `Duplicate endpoint key "${key}" (first seen at endpoints[${firstIndex}]).`,
        endpointIndex: index,
      });
    } else {
      seenKeys.set(key, index);
    }

    const interfaceId = endpoint.interfaceId.trim().toUpperCase();
    if (!interfaceId) {
      issues.push({
        severity: 'warning',
        code: 'missing-interface-id',
        message: `Endpoint "${key}" has no interface ID; the renderer will assign one.`,
        endpointIndex: index,
      });
    } else {
      const firstInterfaceIdIndex = seenInterfaceIds.get(interfaceId);
      if (firstInterfaceIdIndex !== undefined) {
        issues.push({
          severity: 'fatal',
          code: 'duplicate-interface-id',
          message: `Duplicate interface ID "${interfaceId}" (first seen at endpoints[${firstInterfaceIdIndex}]).`,
          endpointIndex: index,
        });
      } else {
        seenInterfaceIds.set(interfaceId, index);
      }
    }

    if (endpoint.requestFields.length === 0 && endpoint.responseFields.length === 0) {
      issues.push({
        severity: 'warning',
        code: 'empty-endpoint-fields',
        message: `Endpoint "${key}" has no request or response fields.`,
        endpointIndex: index,
      });
    }

    for (const [fieldKind, fields] of [
      ['request', endpoint.requestFields],
      ['response', endpoint.responseFields],
    ] as const) {
      const paths = new Set(fields.map((f) => f.path).filter((p): p is string => Boolean(p)));
      const fieldPaths = new Set<string>();
      for (const field of fields) {
        // A nested payload may legitimately reuse a leaf name at multiple
        // levels (`id` and `items.id`, for example).  Treat the full JSON
        // path as the field identity and fall back to nameEn for older flat
        // documents that predate explicit paths.
        const rawFieldPath = field.path?.trim() || field.nameEn.trim();
        const canonicalFieldPath = rawFieldPath.toLowerCase();
        if (fieldPaths.has(canonicalFieldPath)) {
          issues.push({
            severity: 'warning',
            code: 'duplicate-field-name',
            message: `Endpoint "${key}" has duplicate ${fieldKind} field path "${rawFieldPath}".`,
            endpointIndex: index,
          });
        }
        fieldPaths.add(canonicalFieldPath);
        if (!field.dataType.trim() || field.required === 'TBD') {
          issues.push({
            severity: 'warning',
            code: 'unresolved-field-definition',
            message: `Endpoint "${key}" ${fieldKind} field "${field.nameEn}" still has an unresolved type or required flag.`,
            endpointIndex: index,
          });
        }
        if (field.parentPath && !paths.has(field.parentPath)) {
          issues.push({
            severity: 'warning',
            code: 'orphan-parent-path',
            message: `Field "${field.nameEn}" in "${key}" references missing parentPath "${field.parentPath}".`,
            endpointIndex: index,
          });
        }
      }
    }
  });

  return issues;
}

/**
 * Parse + validate an untrusted JSON value (typically agent output).
 * Returns either a usable document with non-shape issues attached, or the
 * zod error formatted for feeding back to the collecting agent.
 */
export function parseInterfaceSpecDocument(
  value: unknown,
):
  | { ok: true; doc: InterfaceSpecDocument; issues: InterfaceSpecIssue[] }
  | { ok: false; error: string } {
  const parsed = InterfaceSpecDocumentSchema.safeParse(value);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    return { ok: false, error: lines.join('\n') };
  }
  return { ok: true, doc: parsed.data, issues: validateInterfaceSpecDocument(parsed.data) };
}
