import type {
  InterfaceAuthScheme,
  InterfaceEndpoint,
  InterfaceFieldSpec,
  InterfaceSpecDocument,
} from './interface-spec.js';

/**
 * Export an interface spec as an OpenAPI 3.1 document so the reviewed SI
 * deliverable can feed API gateways, mock servers, client generators and
 * contract tests. The interface spec stays the source of truth; this is a
 * deterministic, lossy projection (layout, evidence and review state are not
 * part of OpenAPI).
 */
export interface InterfaceSpecOpenApiExport {
  document: Record<string, unknown>;
  /** Endpoints or values that could not be represented exactly. */
  warnings: string[];
}

type JsonSchema = Record<string, unknown>;

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
const BODYLESS_METHODS = new Set(['get', 'delete', 'head', 'options', 'trace']);

const SCALAR_TYPES: Record<string, JsonSchema> = {
  string: { type: 'string' },
  char: { type: 'string' },
  character: { type: 'string' },
  uuid: { type: 'string', format: 'uuid' },
  long: { type: 'integer', format: 'int64' },
  biginteger: { type: 'integer' },
  integer: { type: 'integer', format: 'int32' },
  int: { type: 'integer', format: 'int32' },
  short: { type: 'integer', format: 'int32' },
  byte: { type: 'integer', format: 'int32' },
  number: { type: 'number' },
  bigdecimal: { type: 'number' },
  double: { type: 'number', format: 'double' },
  float: { type: 'number', format: 'float' },
  boolean: { type: 'boolean' },
  bool: { type: 'boolean' },
  localdate: { type: 'string', format: 'date' },
  localdatetime: { type: 'string', format: 'date-time' },
  offsetdatetime: { type: 'string', format: 'date-time' },
  zoneddatetime: { type: 'string', format: 'date-time' },
  instant: { type: 'string', format: 'date-time' },
  date: { type: 'string', format: 'date-time' },
  localtime: { type: 'string', format: 'time' },
  multipartfile: { type: 'string', format: 'binary' },
};

/** `List<OrderItem>`, `OrderItem[]`, `Set<String>` → element type. */
function arrayElement(dataType: string): string | null {
  const compact = dataType.replace(/\s+/g, '');
  const generic = /^(?:java\.util\.)?(?:List|Set|Collection|Iterable|ArrayList|LinkedList|HashSet)<(.+)>$/i.exec(compact);
  if (generic) return generic[1]!;
  if (compact.endsWith('[]')) return compact.slice(0, -2);
  if (/^array$/i.test(compact)) return '';
  return null;
}

function scalarSchema(dataType: string): JsonSchema | null {
  const key = dataType.replace(/\s+/g, '').replace(/^java\.(?:lang|math|time|util)\./, '').toLowerCase();
  return SCALAR_TYPES[key] ? { ...SCALAR_TYPES[key] } : null;
}

function fieldKey(field: InterfaceFieldSpec): string {
  return (field.path ?? field.nameEn).trim();
}

function parentKey(field: InterfaceFieldSpec): string | null {
  if (field.parentPath) return field.parentPath;
  const key = fieldKey(field);
  const dot = key.lastIndexOf('.');
  return dot > 0 ? key.slice(0, dot) : null;
}

function describe(field: InterfaceFieldSpec, schema: JsonSchema): JsonSchema {
  if (field.nameKo.trim()) schema.title = field.nameKo.trim();
  if (field.note.trim()) schema.description = field.note.trim();
  const min = /^\d+$/.test(field.minSize.trim()) ? Number(field.minSize) : null;
  const max = /^\d+$/.test(field.maxSize.trim()) ? Number(field.maxSize) : null;
  if (schema.type === 'string') {
    if (min !== null) schema.minLength = min;
    if (max !== null) schema.maxLength = max;
  }
  if (field.required === 'TBD') schema['x-required'] = 'TBD';
  if (field.enumValues?.length) {
    // An enum travels as one of its string values, whatever its Java type name looked like.
    if (schema.type === 'array') schema.items = { type: 'string', enum: [...field.enumValues] };
    else {
      for (const key of Object.keys(schema)) if (key !== 'title' && key !== 'description' && key !== 'x-required') delete schema[key];
      schema.type = 'string';
      schema.enum = [...field.enumValues];
    }
  }
  if (field.defaultValue !== undefined) schema.default = typedDefault(field.defaultValue, schema.type);
  return schema;
}

/** A default as the JSON value of its schema type: `20` for an integer, `false` for a boolean, text otherwise. */
function typedDefault(value: string, type: unknown): unknown {
  if ((type === 'integer' || type === 'number') && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return Number(value);
  if (type === 'boolean' && (value === 'true' || value === 'false')) return value === 'true';
  return value;
}

/** Builds an object schema from flat dot-path field rows. */
function objectSchema(fields: InterfaceFieldSpec[], parent: string | null = null): JsonSchema {
  const children = fields.filter((field) => parentKey(field) === parent);
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const field of children) {
    properties[field.nameEn] = describe(field, fieldSchema(fields, field));
    if (field.required === 'Y') required.push(field.nameEn);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

function fieldSchema(fields: InterfaceFieldSpec[], field: InterfaceFieldSpec): JsonSchema {
  const key = fieldKey(field);
  const hasChildren = fields.some((candidate) => parentKey(candidate) === key);
  const element = arrayElement(field.dataType);
  if (element !== null) {
    const items = hasChildren ? objectSchema(fields, key) : scalarSchema(element) ?? { type: 'object' };
    return { type: 'array', items };
  }
  if (hasChildren) return objectSchema(fields, key);
  return scalarSchema(field.dataType) ?? (/^[A-Z]/.test(field.dataType.trim()) && field.dataType.trim() !== 'String'
    ? { type: 'object' }
    : { type: 'string' });
}

type ParamLocation = 'path' | 'query' | 'header' | 'cookie';

function parameterLocation(field: InterfaceFieldSpec): ParamLocation | null {
  const note = field.note.toLowerCase();
  if (note.startsWith('path variable')) return 'path';
  if (note.startsWith('request param')) return 'query';
  if (note.startsWith('request header')) return 'header';
  if (note.startsWith('cookie')) return 'cookie';
  return null;
}

function securitySchemeFor(auth: InterfaceAuthScheme | undefined): [string, JsonSchema] | null {
  if (!auth) return null;
  switch (auth.type) {
    case 'bearer':
      return ['bearerAuth', { type: 'http', scheme: 'bearer', ...(auth.description ? { description: auth.description } : {}) }];
    case 'api-key':
      return ['apiKeyAuth', { type: 'apiKey', in: auth.location ?? 'header', name: auth.name || 'X-API-Key' }];
    case 'session-cookie':
      return ['sessionCookie', { type: 'apiKey', in: 'cookie', name: auth.name || 'SESSION' }];
    default:
      return null;
  }
}

function openApiPath(path: string): string {
  return path.replace(/:([A-Za-z_][\w]*)/g, '{$1}');
}

/**
 * A scanned route may end in the request parameters its handler requires (`/add.do?cmd=Regist`, from Spring
 * `params`). OpenAPI keeps a query out of the path key: the path is the part before `?`, the rest become required
 * query parameters.
 */
function splitRouteCondition(path: string): { path: string; required: Record<string, unknown>[] } {
  const at = path.indexOf('?');
  if (at < 0) return { path, required: [] };
  const required = path.slice(at + 1).split('&').filter(Boolean).map((condition) => {
    const [name = '', value] = condition.split('=');
    return { name, in: 'query', required: true, schema: value === undefined ? { type: 'string' } : { type: 'string', enum: [value] } };
  });
  return { path: path.slice(0, at), required };
}

function operationIdBase(endpoint: InterfaceEndpoint, method: string): string {
  const raw = endpoint.handlerName || endpoint.interfaceId || `${method}${endpoint.path}`;
  return raw.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || method;
}

/** Converts a validated interface spec into an OpenAPI 3.1 document. */
export function interfaceSpecToOpenApi(doc: InterfaceSpecDocument): InterfaceSpecOpenApiExport {
  const warnings: string[] = [];
  const paths: Record<string, Record<string, unknown>> = {};
  const securitySchemes: Record<string, JsonSchema> = {};
  const operationIds = new Set<string>();

  for (const endpoint of doc.endpoints) {
    const methods = endpoint.method.split(/[\s/,|]+/).map((value) => value.trim().toLowerCase()).filter(Boolean);
    const supported = methods.filter((method) => HTTP_METHODS.has(method));
    if (!supported.length) {
      warnings.push(`${endpoint.method} ${endpoint.path}: "${endpoint.method}" is not an HTTP method; skipped.`);
      continue;
    }
    if (supported.length !== methods.length) {
      warnings.push(`${endpoint.method} ${endpoint.path}: kept ${supported.join(', ').toUpperCase()} only.`);
    }
    const route = splitRouteCondition(endpoint.path);
    const path = openApiPath(route.path);
    const scheme = endpoint.authRequired ? securitySchemeFor(endpoint.auth ?? doc.auth) : null;
    // `security: []` declares an operation public, so an auth-required endpoint
    // without an OpenAPI scheme (none detected, `undecided`, `custom`) leaves
    // `security` out and carries `x-auth-undecided`; scan_openapi.py reads that
    // back as authRequired with an undecided scheme.
    const authUndecided = endpoint.authRequired && !scheme;
    if (authUndecided) {
      warnings.push(`${endpoint.method} ${endpoint.path}: authentication is required but the scheme is undecided; exported without a security requirement (x-auth-undecided).`);
    }
    if (scheme) securitySchemes[scheme[0]] = scheme[1];

    const params: Record<string, unknown>[] = [...route.required];
    const bodyFields: InterfaceFieldSpec[] = [];
    const declaredPathParams = new Set<string>();
    for (const field of endpoint.requestFields) {
      const location = parameterLocation(field);
      if (location && parentKey(field) === null) {
        if (location === 'path') declaredPathParams.add(field.nameEn);
        params.push({
          name: field.nameEn,
          in: location,
          required: location === 'path' || field.required === 'Y',
          ...(field.nameKo.trim() ? { description: field.nameKo.trim() } : {}),
          schema: describe({ ...field, note: field.note.replace(/^(?:path variable|request param|request header|cookie);?\s*/i, '') },
            fieldSchema(endpoint.requestFields, field)),
        });
      } else {
        bodyFields.push(field);
      }
    }
    for (const [, name] of path.matchAll(/\{([^}]+)\}/g)) {
      if (name && !declaredPathParams.has(name)) {
        params.push({ name, in: 'path', required: true, schema: { type: 'string' } });
      }
    }

    for (const method of supported) {
      const operation: Record<string, unknown> = {};
      if (endpoint.interfaceName) operation.summary = endpoint.interfaceName;
      const description = [endpoint.businessPurpose, endpoint.note].filter((value) => value && value.trim()).join('\n\n');
      if (description) operation.description = description;
      if (endpoint.moduleName) operation.tags = [endpoint.moduleName];
      let operationId = operationIdBase(endpoint, method);
      if (operationIds.has(operationId)) operationId = `${operationId}_${method}`;
      for (let n = 2; operationIds.has(operationId); n += 1) operationId = `${operationIdBase(endpoint, method)}_${n}`;
      operationIds.add(operationId);
      operation.operationId = operationId;
      if (endpoint.interfaceId) operation['x-interface-id'] = endpoint.interfaceId;
      // Who may call: authorities of which any one is enough, or the rule as written in code.
      if (endpoint.authorities?.length) operation['x-required-authorities'] = [...endpoint.authorities];
      if (endpoint.accessRule) operation['x-access-rule'] = endpoint.accessRule;

      const operationParams = [...params];
      const formAsQuery = BODYLESS_METHODS.has(method) || (!endpoint.requestBodyType && !!endpoint.queryDtoType);
      if (bodyFields.length && formAsQuery) {
        for (const field of bodyFields.filter((candidate) => parentKey(candidate) === null)) {
          operationParams.push({
            name: field.nameEn,
            in: 'query',
            required: field.required === 'Y',
            ...(field.nameKo.trim() ? { description: field.nameKo.trim() } : {}),
            schema: describe({ ...field }, fieldSchema(bodyFields, field)),
          });
        }
      } else if (bodyFields.length) {
        operation.requestBody = {
          required: true,
          content: { 'application/json': { schema: objectSchema(bodyFields) } },
        };
      }
      if (operationParams.length) operation.parameters = operationParams;

      const responseSchema = endpoint.responseFields.length ? objectSchema(endpoint.responseFields) : null;
      const listResponse = endpoint.responseType ? arrayElement(endpoint.responseType) !== null : false;
      operation.responses = {
        '200': {
          description: endpoint.interfaceName || 'OK',
          ...(responseSchema
            ? { content: { 'application/json': { schema: listResponse ? { type: 'array', items: responseSchema } : responseSchema } } }
            : {}),
        },
      };
      if (authUndecided) operation['x-auth-undecided'] = true;
      else operation.security = scheme ? [{ [scheme[0]]: [] }] : [];
      if (paths[path]?.[method]) {
        warnings.push(`${endpoint.method} ${endpoint.path}: OpenAPI holds one operation per path and method; ${method.toUpperCase()} ${path} is already exported, so this variant was left out.`);
        continue;
      }
      paths[path] = { ...(paths[path] ?? {}), [method]: operation };
    }
  }

  const document: Record<string, unknown> = {
    openapi: '3.1.0',
    info: {
      title: doc.cover.docName || doc.source.codebaseName || 'Interface specification',
      version: doc.cover.version || '1.0.0',
      ...(doc.cover.department ? { 'x-department': doc.cover.department } : {}),
    },
    paths,
    ...(Object.keys(securitySchemes).length ? { components: { securitySchemes } } : {}),
    'x-generated-by': 'MonoField interface-spec export',
  };
  return { document, warnings };
}
