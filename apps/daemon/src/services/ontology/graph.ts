import path from 'node:path';
import type { CodeOntologyEdge, CodeOntologyIssue, CodeOntologyNode, DocumentGraphResponse, OntologyEvidence } from '@open-design/contracts';
import { edge, ontologyId, type ParsedUnit } from './model.js';

export function assembleOntology(units: ParsedUnit[], changedFiles: string[], aliases: Array<{ prefix: string; target: string }> = []) {
  const nodeMap = new Map<string, CodeOntologyNode>(), edgeMap = new Map<string, CodeOntologyEdge>();
  const issues: CodeOntologyIssue[] = units.flatMap(unit => unit.issues);
  const addNode = (node: CodeOntologyNode) => { if (!nodeMap.has(node.id)) nodeMap.set(node.id, node); };
  const addEdge = (value: CodeOntologyEdge) => { if (!edgeMap.has(value.id)) edgeMap.set(value.id, value); };
  for (const unit of units) { unit.nodes.forEach(addNode); unit.edges.forEach(addEdge); }
  const files = new Map(units.map(unit => [unit.path, unit]));
  const classes = new Map<string, CodeOntologyNode[]>();
  const methods = new Map<string, CodeOntologyNode[]>();
  for (const node of nodeMap.values()) if (node.kind === 'class') classes.set(node.label, [...(classes.get(node.label) ?? []), node]);
  for (const node of nodeMap.values()) if (node.kind === 'function') methods.set(node.label, [...(methods.get(node.label) ?? []), node]);
  function moduleTarget(from: string, source: string): ParsedUnit | null {
    let target: string;
    if (source.startsWith('.')) target = path.posix.normalize(path.posix.join(path.posix.dirname(from), source));
    else {
      const alias = aliases.find(alias => source.startsWith(alias.prefix));
      if (!alias) return null;
      target = path.posix.normalize(alias.target + source.slice(alias.prefix.length));
    }
    if (target === '..' || target.startsWith('../') || path.posix.isAbsolute(target)) return null;
    const candidates = [target, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue'].map(ext => target + ext),
      ...['.ts', '.tsx', '.js', '.vue'].map(ext => `${target}/index${ext}`)];
    if (/\.[cm]?js$/.test(target)) candidates.push(target.replace(/\.[cm]?js$/, '.ts'), target.replace(/\.[cm]?js$/, '.tsx'));
    return candidates.map(name => files.get(name)).find(Boolean) ?? null;
  }
  function javaTarget(unit: ParsedUnit, name: string): CodeOntologyNode | null {
    const explicit = unit.javaImports?.find(value => value.split('.').at(-1) === name);
    const exact = [name, explicit, [unit.javaPackage, name].filter(Boolean).join('.')].filter((value): value is string => !!value);
    for (const candidate of exact) { const matches = classes.get(candidate); if (matches?.length === 1) return matches[0]!; if (matches?.length) return null; }
    const wildcardMatches = (unit.javaImports ?? []).filter(value => value.endsWith('.*')).flatMap(value => classes.get(value.slice(0, -1) + name) ?? []);
    return wildcardMatches.length === 1 ? wildcardMatches[0]! : null;
  }
  function external(source: string, evidence: OntologyEvidence) {
    const id = ontologyId('external', source); addNode({ id, kind: 'external', label: source, evidence }); return id;
  }
  for (const unit of units) for (const ref of unit.references) {
    if (ref.kind === 'module') {
      if (unit.language === 'java') {
        const target = classes.get(ref.name);
        if (target?.length === 1) addEdge(edge(ref.from, target[0]!.id, 'imports', ref.evidence));
        else addEdge(edge(ref.from, external(ref.name, ref.evidence), 'imports', ref.evidence));
      } else {
        const target = moduleTarget(unit.path, ref.name);
        if (target) addEdge(edge(ref.from, ontologyId('file', target.path), 'imports', ref.evidence));
        else if (!ref.name.startsWith('.') && !/^[@~#]\//.test(ref.name) && !aliases.some(alias => ref.name.startsWith(alias.prefix))) addEdge(edge(ref.from, external(ref.name, ref.evidence), 'imports', ref.evidence));
        else issues.push({ path: unit.path, reason: 'unresolved-reference', message: `Module target is unresolved: ${ref.name}` });
      }
    } else if (unit.language === 'java') {
      const [type, method] = ref.name.split('#');
      const target = javaTarget(unit, type!);
      if (!target) { issues.push({ path: unit.path, reason: 'unresolved-reference', message: `Java type/call target is unresolved: ${ref.name}` }); continue; }
      if (method) {
        const functions = methods.get(target.label + '.' + method) ?? [];
        if (functions.length === 1) addEdge(edge(ref.from, functions[0]!.id, 'calls', ref.evidence, 'candidate'));
        else issues.push({ path: unit.path, reason: 'unresolved-reference', message: `Java method is overloaded or unresolved: ${ref.name}` });
      } else addEdge(edge(ref.from, target.id, 'references', ref.evidence));
    } else {
      const targetUnit = ref.importedFrom ? moduleTarget(unit.path, ref.importedFrom) : null;
      const candidates = (targetUnit ?? unit).nodes.filter(node => ['screen', 'function', 'class'].includes(node.kind)
        && node.label.replace(/\.vue$/, '').split('/').at(-1)!.replace(/-/g, '').toLowerCase() === ref.name.replace(/-/g, '').toLowerCase());
      if (candidates.length === 1) addEdge(edge(ref.from, candidates[0]!.id, ref.kind === 'call' ? 'calls' : 'references', ref.evidence, 'candidate'));
      else if (ref.kind === 'component') issues.push({ path: unit.path, reason: 'unresolved-reference', message: `Component binding requires review: ${ref.name}` });
    }
  }
  const apis = [...nodeMap.values()].filter(node => node.kind === 'api' && node.api);
  function routeMatches(route: string, request: string): boolean {
    const pattern = route.split('/'), value = request.split('?')[0]!.split('/');
    return pattern.length === value.length && pattern.every((part, i) => part === value[i] || /^\{[^/]+\}$/.test(part) || /^:[\w]+$/.test(part));
  }
  for (const request of [...nodeMap.values()].filter(node => node.kind === 'request' && node.api)) {
    const candidates = apis.filter(api => (api.api!.method === request.api!.method || api.api!.method === 'ANY') && routeMatches(api.api!.path, request.api!.path));
    if (candidates.length === 1) addEdge(edge(request.id, candidates[0]!.id, 'requests', request.evidence, 'candidate'));
    else issues.push({ path: request.evidence.path, reason: 'unresolved-reference', message: `HTTP consumer has ${candidates.length} possible local route targets: ${request.label}` });
  }
  const nodes = [...nodeMap.values()], edges = [...edgeMap.values()];
  if (nodes.length > 20000 || edges.length > 50000) throw new Error('Ontology exceeds its node/edge analysis limits');
  const graphNodes = nodes.filter(node => ['file', 'api', 'screen'].includes(node.kind)).map(node => ({ id: node.id,
    kind: node.kind === 'file' ? 'code' as const : node.kind === 'api' ? 'api' as const : 'screen' as const,
    label: node.kind === 'file' ? node.evidence.path : node.label, ...(node.kind === 'file' ? {} : { documentFile: node.evidence.path, itemId: node.id }) }));
  const projected = new Set(graphNodes.map(node => node.id));
  const dependencyEdges = new Map<string, DocumentGraphResponse['edges'][number]>();
  function dependency(dependentId: string, sourceId: string, evidence: OntologyEvidence, relation: string) {
    if (dependentId === sourceId || !projected.has(dependentId) || !projected.has(sourceId)) return;
    const id = ontologyId(dependentId, sourceId);
    dependencyEdges.set(id, { dependentId, sourceId, documentFile: evidence.path, evidenceRef: `${relation} at line ${evidence.line}; SHA-256 ${evidence.sha256}` });
  }
  for (const item of edges) {
    const from = nodeMap.get(item.from)!, to = nodeMap.get(item.to)!;
    if (item.relation === 'declares' && from.kind === 'file' && ['api', 'screen'].includes(to.kind)) dependency(to.id, from.id, item.evidence, 'syntax declaration');
    if (['imports', 'references', 'calls'].includes(item.relation) && from.evidence.path !== to.evidence.path && to.kind !== 'external')
      dependency(ontologyId('file', from.evidence.path), ontologyId('file', to.evidence.path), item.evidence, item.relation + ' ' + item.basis);
    if (item.relation === 'requests' && from.kind === 'request' && to.kind === 'api')
      dependency(ontologyId('file', from.evidence.path), to.id, item.evidence, 'HTTP route candidate; runtime origin/context not verified');
  }
  const graphEdges = [...dependencyEdges.values()], changed = new Set(changedFiles);
  const linkedTargets = new Set(graphEdges.map(edge => edge.dependentId));
  const changedNodeIds = graphNodes.filter(node => node.kind === 'code' && changed.has(node.label)).map(node => node.id);
  const graph: DocumentGraphResponse = { ok: true, analyzedAt: new Date().toISOString(), documents: [], nodes: graphNodes, edges: graphEdges,
    changedNodeIds, impacts: [], unlinkedNodeIds: graphNodes.filter(node => node.kind !== 'code' && !linkedTargets.has(node.id)).map(node => node.id),
    warnings: ['Automatic code relationships are static observations; HTTP pairing and call targets require runtime review. ORM mappings do not capture the live database schema.', ...issues.slice(0, 100).map(issue => `${issue.path}: ${issue.message}`)], schemaWatch: null };
  return { nodes, edges, issues, dependencyGraph: graph };
}

export function addBusinessDocuments(graph: ReturnType<typeof assembleOntology>, documents: Array<{ path: string; text: string; sha256: string }>) {
  for (const doc of documents) {
    const docId = ontologyId('business-document', doc.path), evidence = { path: doc.path, sha256: doc.sha256, line: 1 };
    graph.nodes.push({ id: docId, kind: 'business-document', label: doc.path, evidence });
    let count = 0;
    for (const [index, line] of doc.text.split('\n').entries()) {
      if (graph.nodes.length >= 20000 || graph.edges.length >= 50000) throw new Error('Business concepts exceed the ontology graph limits');
      const heading = line.match(/^#{1,6}\s+(.{1,160})$/) ?? line.match(/^\s*[-*]\s+(.{1,100}?)\s*[:：]/);
      if (!heading || count++ >= 64) continue;
      const label = heading[1]!.trim(), id = ontologyId('concept', doc.path, label, String(index));
      const ref = { ...evidence, line: index + 1 };
      graph.nodes.push({ id, kind: 'concept', label, evidence: ref }); graph.edges.push(edge(docId, id, 'documents', ref));
      const alias = label.match(/\(([A-Za-z][A-Za-z0-9_ ]+)\)/)?.[1]?.replace(/\s/g, '').toLowerCase() ?? label.toLowerCase();
      for (const node of graph.nodes.filter(node => node.kind === 'class' || node.kind === 'function'))
        if (node.label.split('.').at(-1)?.toLowerCase() === alias) graph.edges.push(edge(id, node.id, 'associated-with', ref, 'candidate'));
    }
  }
}
