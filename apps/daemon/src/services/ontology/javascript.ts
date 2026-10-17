import { parse, type ParserPlugin } from '@babel/parser';
import type { CodeOntologyNode, OntologyEvidence } from '@open-design/contracts';
import { edge, ontologyId, unit, type ParsedUnit } from './model.js';

// Structural AST boundary avoids another traversal dependency and never evaluates source.
type Ast = { type: string; [key: string]: unknown };
const ast = (value: unknown): value is Ast => !!value && typeof value === 'object' && typeof (value as Ast).type === 'string';
const name = (value: unknown): string | null => ast(value) && value.type === 'Identifier' && typeof value.name === 'string' ? value.name : null;
function literal(value: unknown): string | null {
  if (!ast(value)) return null;
  if (value.type === 'StringLiteral' && typeof value.value === 'string') return value.value;
  if (value.type === 'TemplateLiteral' && Array.isArray(value.expressions) && !value.expressions.length && Array.isArray(value.quasis))
    return value.quasis.map(item => String((item as { value: { cooked: string } }).value.cooked)).join('');
  return null;
}
function member(value: unknown): { object: string; property: string } | null {
  if (!ast(value) || !['MemberExpression', 'OptionalMemberExpression'].includes(value.type) || value.computed) return null;
  const object = name(value.object), property = name(value.property);
  return object && property ? { object, property } : null;
}
function requestPath(value: unknown): string | null {
  const exact = literal(value); if (exact !== null) return exact;
  if (ast(value) && value.type === 'TemplateLiteral' && Array.isArray(value.quasis)) {
    const quasis = value.quasis as Array<{ value: { cooked: string | null } }>;
    if (quasis.some(item => typeof item.value.cooked !== 'string')) return null;
    return quasis.map((item, index) => item.value.cooked + (index < quasis.length - 1 ? '{dynamic}' : '')).join('');
  }
  return null;
}
export function parseJavascript(path: string, text: string, sha256: string, options: { lineOffset?: number; screen?: boolean; typescript?: boolean; jsx?: boolean } = {}): ParsedUnit {
  const result = unit(path, options.screen ? 'vue' : /\.[cm]?tsx?$/.test(path) ? 'typescript' : 'javascript', sha256);
  const fileId = result.nodes[0]!.id;
  const plugins: ParserPlugin[] = ['decorators-legacy'];
  if (options.jsx ?? /\.[jt]sx$/i.test(path)) plugins.push('jsx');
  if (options.typescript ?? /\.[cm]?tsx?$/.test(path)) plugins.push('typescript');
  const tree = parse(text, { sourceType: 'unambiguous', plugins, attachComment: false, errorRecovery: false });
  const bindings = new Map<string, string>();
  const origins = new Map<string, string>();
  const importedSymbols = new Map<string, string>();
  const routers = new Set<string>();
  const axiosNames = new Set<string>();
  const axiosBases = new Map<string, string>();
  const unknownOrigins = new Set<string>();
  const jsxOwners = new Set<string>();
  const evidence = (node: Ast): OntologyEvidence => ({ path, sha256, line: Math.max(1, Number((node.loc as { start?: { line?: number } } | undefined)?.start?.line ?? 1) + (options.lineOffset ?? 0)) });
  const screenId = ontologyId('screen', path);
  if (options.screen) {
    result.nodes.push({ id: screenId, kind: 'screen', label: path.split('/').at(-1)!, evidence: { path, sha256, line: 1 } });
    result.edges.push(edge(fileId, screenId, 'declares', result.nodes[0]!.evidence));
  }
  function declare(node: Ast, label: string, kind: CodeOntologyNode['kind'], owner = fileId) {
    const id = ontologyId(kind, path, label, String(node.start) + ':' + evidence(node).line);
    result.nodes.push({ id, kind, label, evidence: evidence(node) }); result.edges.push(edge(owner, id, 'declares', evidence(node)));
    if (kind === 'function' || kind === 'class') bindings.set(label, id);
    return id;
  }
  function walk(node: Ast, owner = options.screen ? screenId : fileId) {
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type) && Array.isArray(node.params)) {
      for (const parameter of node.params.filter(ast)) {
        const label = name(parameter), annotation = ast(parameter.typeAnnotation) ? parameter.typeAnnotation : null;
        const reference = annotation && ast(annotation.typeAnnotation) ? annotation.typeAnnotation : null;
        const type = reference ? name(reference.typeName) : null;
        if (label && type && origins.get(type) === 'express' && ['Express', 'Router', 'Application'].includes(importedSymbols.get(type) ?? type)) routers.add(label);
      }
    }
    if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration' || node.type === 'ExportNamedDeclaration') {
      const source = literal(node.source);
      if (source) {
        result.references.push({ from: fileId, kind: 'module', name: source, evidence: evidence(node) });
        if (Array.isArray(node.specifiers)) for (const specifier of node.specifiers.filter(ast)) {
          const local = name(specifier.local); if (local) {
            origins.set(local, source);
            importedSymbols.set(local, name(specifier.imported) ?? (specifier.type === 'ImportDefaultSpecifier' ? 'default' : '*'));
            if (source === 'axios' && importedSymbols.get(local) === 'default') axiosNames.add(local);
          }
        }
      }
    }
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration' || node.type === 'TSInterfaceDeclaration') {
      const label = name(node.id);
      if (label) owner = declare(node, label, node.type === 'FunctionDeclaration' ? 'function' : 'class', owner);
    }
    if (node.type === 'VariableDeclarator') {
      const label = name(node.id), init = ast(node.init) ? node.init : null;
      if (label && init && ['ArrowFunctionExpression', 'FunctionExpression'].includes(init.type)) owner = declare(node, label, 'function', owner);
      if (label && init?.type === 'CallExpression') {
        const called = member(init.callee);
        const bare = name(init.callee);
        if ((called?.property === 'Router' && origins.get(called.object) === 'express') || (bare && importedSymbols.get(bare) === 'Router' && origins.get(bare) === 'express')) routers.add(label);
        if (bare && origins.get(bare) === 'express' && importedSymbols.get(bare) === 'default') routers.add(label);
        if (called?.property === 'create' && axiosNames.has(called.object)) {
          axiosNames.add(label);
          const argument = Array.isArray(init.arguments) ? init.arguments[0] : null;
          if (ast(argument) && argument.type === 'ObjectExpression') for (const property of (Array.isArray(argument.properties) ? argument.properties : []).filter(ast)) {
            if (name(property.key) !== 'baseURL') continue;
            const base = literal(property.value);
            if (base !== null && (!base || (base.startsWith('/') && !base.startsWith('//')))) axiosBases.set(label, base.replace(/\/$/, ''));
            else unknownOrigins.add(label);
          }
        }
      }
    }
    if (node.type === 'JSXOpeningElement') {
      jsxOwners.add(owner);
      const tag = ast(node.name) && node.name.type === 'JSXIdentifier' ? String(node.name.name) : '';
      if (tag && /^[A-Z]/.test(tag)) {
        const importedFrom = origins.get(tag);
        result.references.push({ from: owner, kind: 'component', name: tag, evidence: evidence(node), ...(importedFrom ? { importedFrom } : {}) });
      }
    }
    if (node.type === 'ImportExpression') {
      const source = literal(node.source);
      if (source) result.references.push({ from: owner, kind: 'module', name: source, evidence: evidence(node) });
      else result.issues.push({ path, reason: 'dynamic-expression', message: `Dynamic import at line ${evidence(node).line} was not resolved` });
    }
    if (['CallExpression', 'OptionalCallExpression'].includes(node.type)) {
      const called = member(node.callee), bare = name(node.callee);
      const args = Array.isArray(node.arguments) ? node.arguments : [];
      const target = literal(args[0]);
      const http = called && ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(called.property.toLowerCase());
      const registration = !!http && routers.has(called!.object);
      const request = bare === 'fetch' || (!!http && axiosNames.has(called!.object));
      if (registration || request) {
        const requestedPath = request ? requestPath(args[0]) : target;
        const fullPath = requestedPath ? (called && axiosBases.get(called.object) ? axiosBases.get(called.object)! + '/' + requestedPath.replace(/^\//, '') : requestedPath) : null;
        if (fullPath && fullPath.startsWith('/') && !fullPath.startsWith('//') && !(called && unknownOrigins.has(called.object))) {
          if (request && requestedPath !== target) result.issues.push({ path, reason: 'dynamic-expression', message: `HTTP template parameters at line ${evidence(node).line} are route candidates, not observed runtime values` });
          let method = called?.property.toUpperCase() ?? 'GET';
          if (bare === 'fetch' && args[1] !== undefined && !(ast(args[1]) && args[1].type === 'ObjectExpression')) {
            method = 'UNKNOWN'; result.issues.push({ path, reason: 'dynamic-expression', message: `Fetch options at line ${evidence(node).line} require method resolution` });
          }
          if (bare === 'fetch' && ast(args[1]) && args[1].type === 'ObjectExpression') {
            for (const item of (Array.isArray(args[1].properties) ? args[1].properties : []).filter(ast))
              if (name(item.key) === 'method') method = literal(item.value)?.toUpperCase() ?? 'UNKNOWN';
          }
          const kind = registration ? 'api' : 'request';
          const id = ontologyId(kind, path, method, fullPath, String(node.start) + ':' + evidence(node).line);
          result.nodes.push({ id, kind, label: `${method} ${fullPath}`, api: { method, path: fullPath }, evidence: evidence(node) });
          result.edges.push(edge(owner, id, registration ? 'serves' : 'requests', evidence(node), request && requestedPath !== target ? 'candidate' : 'syntax'));
          result.edges.push(edge(fileId, id, 'declares', evidence(node)));
        } else result.issues.push({ path, reason: 'dynamic-expression', message: `HTTP path at line ${evidence(node).line} is dynamic or has an unknown origin` });
      } else if (bare && bindings.has(bare)) result.edges.push(edge(owner, bindings.get(bare)!, 'calls', evidence(node), 'candidate'));
      else if (bare && origins.has(bare)) result.references.push({ from: owner, name: bare, kind: 'call', evidence: evidence(node), importedFrom: origins.get(bare)! });
      if (bare === 'require' && target) result.references.push({ from: owner, name: target, kind: 'module', evidence: evidence(node) });
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'comments', 'leadingComments', 'trailingComments', 'innerComments', 'tokens', 'extra'].includes(key)) continue;
      if (Array.isArray(value)) { for (const child of value) if (ast(child)) walk(child, owner); }
      else if (ast(value)) walk(value, owner);
    }
  }
  walk(tree as unknown as Ast);
  // React component naming is a candidate, not a business ontology assertion.
  for (const node of result.nodes.filter(node => node.kind === 'function' && /^[A-Z]/.test(node.label) && jsxOwners.has(node.id))) {
    const id = ontologyId('screen', path, node.label);
    result.nodes.push({ id, kind: 'screen', label: node.label, evidence: node.evidence }); result.edges.push(edge(id, node.id, 'references', node.evidence, 'candidate'));
  }
  return result;
}
