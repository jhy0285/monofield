import path from 'node:path';
import type { DocumentEvidence, DocumentGraphNode, DocumentGraphEdge, DocumentGraphResponse, DatabaseSchemaWatchState, InterfaceSpecDocument, ScreenSpecDocument } from '@open-design/contracts';

export type GraphDocument = { file: string; doc: InterfaceSpecDocument | ScreenSpecDocument };
const nodeId = (kind: string, ...parts: string[]) => JSON.stringify([kind, ...parts]);

/** Follow recorded dependencies, retaining the path from each changed source. */
export function buildDocumentGraph(options: {
  documents: GraphDocument[]; changedFiles?: string[];
  schemaWatch?: DatabaseSchemaWatchState | null; warnings?: string[];
}): DocumentGraphResponse {
  const nodes = new Map<string, DocumentGraphNode>(), edges: DocumentGraphEdge[] = [];
  const warnings = [...(options.warnings ?? [])];
  const documentItems = new Map<string, string[]>();
  const pending: Array<{ dependentId: string; documentFile: string; codeRoot: string; ref: DocumentEvidence }> = [];
  const addNode = (node: DocumentGraphNode) => { if (!nodes.has(node.id)) nodes.set(node.id, node); };
  for (const { file, doc } of options.documents) {
    const items: string[] = [];
    const addItem = (kind: 'api' | 'screen', id: string, label: string, refs: DocumentEvidence[], codeRoot = '.') => {
      const key = nodeId(kind, file, id);
      if (nodes.has(key)) throw new Error(`Duplicate item ID in ${file}: ${id}`);
      addNode({ id: key, kind, label, documentFile: file, itemId: id }); items.push(key);
      for (const ref of refs) pending.push({ dependentId: key, documentFile: file, codeRoot, ref });
    };
    if (doc.kind === 'interface-spec') {
      for (const endpoint of doc.endpoints) {
        const refs = [...(endpoint.evidenceRefs ?? []), ...[...endpoint.requestFields, ...endpoint.responseFields].flatMap((field) => field.evidenceRefs ?? [])];
        if (endpoint.sourceFile) refs.push({ kind: 'code', ref: endpoint.sourceFile });
        addItem('api', endpoint.interfaceId || `${endpoint.method} ${endpoint.path}`, endpoint.interfaceName || `${endpoint.method} ${endpoint.path}`, refs, doc.source.codebasePath || '.');
      }
    } else {
      for (const screen of doc.screens) addItem('screen', screen.id, screen.screenName || screen.pageTitle || screen.id,
        [...(screen.evidenceRefs ?? []), ...screen.callouts.flatMap((callout) => callout.evidenceRefs ?? [])]);
    }
    documentItems.set(file, items);
  }
  const edgeKeys = new Set<string>();
  const addEdge = (dependentId: string, sourceId: string, documentFile: string, evidenceRef: string) => {
    const key = JSON.stringify([dependentId, sourceId, documentFile, evidenceRef]);
    if (!edgeKeys.has(key)) { edges.push({ dependentId, sourceId, documentFile, evidenceRef }); edgeKeys.add(key); }
  };
  for (const { dependentId, documentFile, codeRoot, ref } of pending) {
    if (ref.document) {
      const targetFile = ref.document.path.replace(/\\/g, '/').replace(/^\.\//, '');
      const candidates = documentItems.get(targetFile) ?? [];
      const targets = candidates.filter((id) => !ref.document?.itemId || nodes.get(id)?.itemId === ref.document.itemId);
      if (!targets.length) warnings.push(`Unresolved document dependency in ${documentFile}: ${targetFile}#${ref.document.itemId ?? '*'}`);
      for (const target of targets) addEdge(dependentId, target, documentFile, ref.ref);
    }
    if (ref.kind === 'database') {
      if (!ref.database) { warnings.push(`Database reference lacks a structured target in ${documentFile}: ${ref.ref}`); continue; }
      const db = ref.database;
      const id = nodeId('database', db.connectionId, db.schema, db.table, db.column ?? '');
      addNode({ id, kind: 'database', label: `${db.schema}.${db.table}${db.column ? `.${db.column}` : ''}`, database: db });
      addEdge(dependentId, id, documentFile, ref.ref);
    }
    if (ref.kind === 'code' && !ref.document) {
      const file = path.posix.normalize(path.posix.join(codeRoot.replace(/\\/g, '/'), ref.ref.replace(/\\/g, '/')));
      if (path.posix.isAbsolute(file) || /^[a-z]:/i.test(file) || file === '..' || file.startsWith('../') || /:\/\//.test(file)) {
        warnings.push(`Code dependency outside the project is excluded in ${documentFile}: ${ref.ref}`); continue;
      }
      const id = nodeId('code', file);
      addNode({ id, kind: 'code', label: file }); addEdge(dependentId, id, documentFile, ref.ref);
    }
  }
  if (nodes.size > 10000 || edges.length > 50000) throw new Error('Dependency graph exceeds the analysis limit');
  const changed = new Set<string>(), changedFiles = new Set(options.changedFiles ?? []);
  const watch = options.schemaWatch ?? null;
  if ([...nodes.values()].some((node) => node.kind === 'database') && (!watch || !watch.latest)) warnings.push('Database schema has not been captured; current database coverage is unknown.');
  if (watch?.status === 'disabled') warnings.push('Database monitoring is disabled; schema changes refer to the last capture.');
  if (watch?.status === 'error') warnings.push('Database monitoring failed; current schema coverage is unknown.');
  for (const node of nodes.values()) {
    if (node.kind === 'code' && changedFiles.has(node.label)) changed.add(node.id);
    const target = node.database;
    if (target && watch && watch.status !== 'error' && watch.connectionId === target.connectionId
      && watch.changes.some((change) => change.schema === target.schema && change.table === target.table
        && (!change.column || !target.column || change.column === target.column))) changed.add(node.id);
  }
  const dependents = new Map<string, string[]>();
  for (const edge of edges) dependents.set(edge.sourceId, [...(dependents.get(edge.sourceId) ?? []), edge.dependentId]);
  const impacts: DocumentGraphResponse['impacts'] = [];
  // A single shortest recorded chain for each source/dependent pair prevents
  // combinatorial path enumeration and terminates even with cyclic documents.
  for (const sourceId of changed) {
    const visited = new Set([sourceId]), queue: string[][] = [[sourceId]];
    for (let index = 0; index < queue.length; index++) {
      const chain = queue[index]!;
      for (const dependentId of dependents.get(chain.at(-1)!) ?? []) {
        if (visited.has(dependentId)) continue;
        visited.add(dependentId);
        const next = [...chain, dependentId];
        impacts.push({ nodeId: dependentId, sourceId, path: next }); queue.push(next);
        if (impacts.length > 50000) throw new Error('Dependency impact exceeds the analysis limit');
      }
    }
  }
  const linked = new Set(edges.map((edge) => edge.dependentId));
  return { ok: true, analyzedAt: new Date().toISOString(), documents: options.documents.map((doc) => doc.file),
    nodes: [...nodes.values()], edges, changedNodeIds: [...changed], impacts,
    unlinkedNodeIds: [...nodes.values()].filter((node) => (node.kind === 'api' || node.kind === 'screen') && !linked.has(node.id)).map((node) => node.id),
    warnings: [...new Set(warnings)], schemaWatch: watch };
}
