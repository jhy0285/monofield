import { parse, type CstNode, type IToken } from 'java-parser';
import type { OntologyEvidence } from '@open-design/contracts';
import { edge, ontologyId, unit, type ParsedUnit } from './model.js';

function children(node: CstNode): CstNode[] {
  return Object.values(node.children).flat().filter(item => 'children' in item) as CstNode[];
}
function descendants(node: CstNode, name: string, stopAtClass = false): CstNode[] {
  const result: CstNode[] = [], queue = [...children(node)];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    if (current.name === name) result.push(current);
    if (!stopAtClass || !['classDeclaration', 'interfaceDeclaration'].includes(current.name)) queue.push(...children(current));
  }
  return result;
}
function tokens(node: CstNode): IToken[] {
  const result: IToken[] = [], queue = [node];
  for (let i = 0; i < queue.length; i++) for (const item of Object.values(queue[i]!.children).flat())
    if ('children' in item) queue.push(item as CstNode); else result.push(item as IToken);
  return result.sort((a, b) => a.startOffset - b.startOffset);
}
const identifiers = (node: CstNode) => tokens(node).filter(token => token.tokenType.name === 'Identifier').map(token => token.image);
const direct = (node: CstNode, key: string): CstNode | null => ((node.children[key] ?? []).find(item => 'children' in item) as CstNode | undefined) ?? null;
function textName(node: CstNode): string { return identifiers(node).join('.'); }
function annotationName(node: CstNode): string { const name = direct(node, 'typeName'); return name ? textName(name) : ''; }
function values(node: CstNode, key = 'value'): string[] | null {
  const pairs = descendants(node, 'elementValuePair');
  const pair = pairs.find(pair => (pair.children.Identifier?.[0] as IToken | undefined)?.image === key);
  const value = pair ? direct(pair, 'elementValue') : !pairs.length && key === 'value' ? direct(node, 'elementValue') : null;
  if (!value) return [];
  const parts = tokens(value);
  if (parts.some(token => !['StringLiteral', 'LCurly', 'RCurly', 'Comma'].includes(token.tokenType.name))) return null;
  try { return parts.filter(token => token.tokenType.name === 'StringLiteral').map(token => JSON.parse(token.image) as string); } catch { return null; }
}
const firstValue = (annotation: CstNode, key: string) => values(annotation, key)?.[0] ?? null;

export function parseJava(path: string, text: string, sha256: string): ParsedUnit {
  const root = parse(text), result = unit(path, 'java', sha256), fileId = result.nodes[0]!.id;
  const evidence = (node: CstNode): OntologyEvidence => ({ path, sha256, line: node.location.startLine });
  const packages = descendants(root, 'packageDeclaration');
  result.javaPackage = packages[0] ? textName(packages[0]) : '';
  result.javaImports = descendants(root, 'importDeclaration').map(node => {
    const base = textName(node); return node.children.Star ? base + '.*' : base;
  });
  for (const node of descendants(root, 'importDeclaration')) result.references.push({ from: fileId, kind: 'module', name: textName(node) + (node.children.Star ? '.*' : ''), evidence: evidence(node) });
  const qualified = (name: string, prefix: string): boolean => {
    if (name.startsWith(prefix)) return true;
    const simple = name.split('.').at(-1)!;
    const explicit = result.javaImports!.find(value => !value.endsWith('.*') && value.split('.').at(-1) === simple);
    return explicit ? explicit === prefix + simple : result.javaImports!.includes(prefix + '*');
  };
  const annotations = (node: CstNode, modifiers: string) => (node.children[modifiers] ?? []).flatMap(item => 'children' in item ? descendants(item as CstNode, 'annotation') : []);
  const classNodes = [...descendants(root, 'classDeclaration'), ...descendants(root, 'interfaceDeclaration')];
  for (const cls of classNodes) {
    const normal = ['normalClassDeclaration', 'recordDeclaration', 'enumDeclaration', 'normalInterfaceDeclaration'].map(key => direct(cls, key)).find(Boolean);
    if (!normal) continue;
    const type = direct(normal, 'typeIdentifier');
    const shortName = type ? identifiers(type)[0] : null;
    if (!shortName) continue;
    const label = [result.javaPackage, shortName].filter(Boolean).join('.');
    const classId = ontologyId('class', path, label, String(cls.location.startOffset));
    result.nodes.push({ id: classId, kind: 'class', label, evidence: evidence(cls) }); result.edges.push(edge(fileId, classId, 'declares', evidence(cls)));
    const classAnnotations = annotations(cls, cls.name === 'interfaceDeclaration' ? 'interfaceModifier' : 'classModifier');
    const spring = classAnnotations.some(annotation => ['RestController', 'Controller'].includes(annotationName(annotation).split('.').at(-1)!)
      && qualified(annotationName(annotation), annotationName(annotation).endsWith('RestController') ? 'org.springframework.web.bind.annotation.' : 'org.springframework.stereotype.'));
    const classMapping = classAnnotations.find(annotation => annotationName(annotation).endsWith('RequestMapping') && qualified(annotationName(annotation), 'org.springframework.web.bind.annotation.'));
    const prefixValues = classMapping ? (values(classMapping, 'path')?.length ? values(classMapping, 'path') : values(classMapping)) : [''];
    if (spring && prefixValues === null) result.issues.push({ path, reason: 'dynamic-expression', message: `Spring class path at line ${evidence(cls).line} requires constant resolution` });
    const prefixes = prefixValues?.length ? prefixValues : [''];
    const fieldTypes = new Map<string, string>();
    for (const field of descendants(normal, 'fieldDeclaration', true)) {
      const type = direct(field, 'unannType');
      const names = type ? identifiers(type) : [];
      const vars = descendants(field, 'variableDeclaratorId').flatMap(node => identifiers(node));
      for (const fieldName of vars) {
        if (names[0]) fieldTypes.set(fieldName, names[0]);
        const id = ontologyId('field', path, label, fieldName, String(field.location.startOffset));
        result.nodes.push({ id, kind: 'field', label: `${label}.${fieldName}`, evidence: evidence(field) }); result.edges.push(edge(classId, id, 'declares', evidence(field)));
      }
      for (const typeName of names) result.references.push({ from: classId, kind: 'java-type', name: typeName, evidence: evidence(field) });
    }
    const table = classAnnotations.find(annotation => annotationName(annotation).endsWith('Table') && (qualified(annotationName(annotation), 'jakarta.persistence.') || qualified(annotationName(annotation), 'javax.persistence.')));
    const tableName = table ? firstValue(table, 'name') : null;
    if (table && tableName) {
      const schema = firstValue(table, 'schema'), tableLabel = schema ? `${schema}.${tableName}` : tableName;
      const tableId = ontologyId('table', tableLabel);
      result.nodes.push({ id: tableId, kind: 'table', label: tableLabel, evidence: evidence(table) }); result.edges.push(edge(classId, tableId, 'maps-table', evidence(table)));
    }
    for (const method of [...descendants(normal, 'methodDeclaration', true), ...descendants(normal, 'interfaceMethodDeclaration', true)]) {
      const declarator = descendants(method, 'methodDeclarator')[0];
      const methodName = (declarator?.children.Identifier?.[0] as IToken | undefined)?.image;
      if (!methodName) continue;
      const methodId = ontologyId('function', path, `${label}.${methodName}`, String(method.location.startOffset));
      result.nodes.push({ id: methodId, kind: 'function', label: `${label}.${methodName}`, evidence: evidence(method) }); result.edges.push(edge(classId, methodId, 'declares', evidence(method)));
      if (spring && prefixValues !== null) for (const annotation of annotations(method, 'methodModifier')) {
        const mapping = annotationName(annotation), short = mapping.split('.').at(-1)!;
        if (!['GetMapping', 'PostMapping', 'PutMapping', 'PatchMapping', 'DeleteMapping', 'RequestMapping'].includes(short) || !qualified(mapping, 'org.springframework.web.bind.annotation.')) continue;
        const paths = values(annotation, 'path')?.length ? values(annotation, 'path') : values(annotation);
        if (paths === null) { result.issues.push({ path, reason: 'dynamic-expression', message: `Spring method path at line ${evidence(annotation).line} requires constant resolution` }); continue; }
        let httpMethod = short === 'RequestMapping' ? 'ANY' : short.replace('Mapping', '').toUpperCase();
        if (short === 'RequestMapping') {
          const methodPair = descendants(annotation, 'elementValuePair').find(pair => (pair.children.Identifier?.[0] as IToken | undefined)?.image === 'method');
          const methods = methodPair ? identifiers(methodPair).filter(value => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(value)) : [];
          if (methods.length === 1) httpMethod = methods[0]!;
          else if (methodPair) { result.issues.push({ path, reason: 'dynamic-expression', message: 'Multiple or unresolved Spring request methods require review' }); continue; }
        }
        for (const prefix of prefixes!.slice(0, 8)) for (const suffix of (paths?.length ? paths : ['']).slice(0, 8)) {
          if (prefix.includes('${') || suffix.includes('${') || prefix.includes('#{') || suffix.includes('#{')) { result.issues.push({ path, reason: 'dynamic-expression', message: 'Spring expression paths were not resolved' }); continue; }
          const apiPath = ('/' + [prefix.replace(/^\/+|\/+$/g, ''), suffix.replace(/^\/+|\/+$/g, '')].filter(Boolean).join('/'));
          const id = ontologyId('api', path, httpMethod, apiPath, String(method.location.startOffset));
          result.nodes.push({ id, kind: 'api', label: `${httpMethod} ${apiPath}`, api: { method: httpMethod, path: apiPath }, evidence: evidence(annotation) });
          result.edges.push(edge(methodId, id, 'serves', evidence(annotation))); result.edges.push(edge(fileId, id, 'declares', evidence(annotation)));
        }
      }
      const body = direct(method, 'methodBody');
      if (!body) continue;
      for (const primary of descendants(body, 'primary')) {
        const suffixes = (primary.children.primarySuffix?.filter(item => 'children' in item) ?? []) as CstNode[];
        const invocation = suffixes.flatMap(suffix => descendants(suffix, 'methodInvocationSuffix'))[0];
        if (!invocation) continue;
        const prefix = direct(primary, 'primaryPrefix');
        if (!prefix) continue;
        const names = [...tokens(prefix), ...suffixes.flatMap(suffix => tokens(suffix))].filter(token => token.startOffset < invocation.location.startOffset && token.tokenType.name === 'Identifier').map(token => token.image);
        const calledMethod = names.at(-1);
        if (!calledMethod) continue;
        const receiver = names.length > 1 ? names[0]! : shortName;
        const receiverType = fieldTypes.get(receiver) ?? receiver;
        result.references.push({ from: methodId, kind: 'call', name: `${receiverType}#${calledMethod}`, evidence: evidence(primary) });
      }
    }
  }
  return result;
}
