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

/** Whether a field is mandatory, using the workbook's Y/N convention. */
export const InterfaceRequiredFlagSchema = z.enum(['Y', 'N']);
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
  'none',
  'bearer',
  'api-key',
  'session-cookie',
  'custom',
]);
export type InterfaceAuthType = z.infer<typeof InterfaceAuthTypeSchema>;

export const InterfaceAuthLocationSchema = z.enum(['header', 'cookie', 'query']);
export type InterfaceAuthLocation = z.infer<typeof InterfaceAuthLocationSchema>;

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
  /**
   * Verbatim request example (e.g. captured from a live probe). When present,
   * the renderer prints it as-is instead of deriving a type-based sample.
   */
  requestExample: z.unknown().optional(),
  /**
   * Verbatim response example, including the full response envelope, captured
   * from a real call. When present, the renderer prints it as-is instead of
   * deriving a type-based sample.
   */
  responseExample: z.unknown().optional(),
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

/** Provenance of the collected endpoints. */
export const InterfaceSpecSourceSchema = z.object({
  codebaseName: z.string().min(1),
  codebasePath: z.string().default(''),
  language: z.string().default(''),
  framework: z.string().default(''),
  collector: InterfaceSpecCollectorSchema.default('agent'),
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

export type InterfaceSpecIssueSeverity = 'fatal' | 'warning';

export interface InterfaceSpecIssue {
  severity: InterfaceSpecIssueSeverity;
  code:
    | 'duplicate-endpoint-key'
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

    if (endpoint.requestFields.length === 0 && endpoint.responseFields.length === 0) {
      issues.push({
        severity: 'warning',
        code: 'empty-endpoint-fields',
        message: `Endpoint "${key}" has no request or response fields.`,
        endpointIndex: index,
      });
    }

    for (const fields of [endpoint.requestFields, endpoint.responseFields]) {
      const paths = new Set(fields.map((f) => f.path).filter((p): p is string => Boolean(p)));
      for (const field of fields) {
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
