import { describe, expect, it } from 'vitest';
import type { CodeOntologyResponse, DocumentGraphResponse, InterfaceSpecDocument } from '@open-design/contracts';
import { mergeOntologyDocuments, documentReviews, simulationSourceNodes } from '../src/services/ontology/change-graph.js';
import { buildChangePlan } from '../src/services/change-plan.js';

const ontology: CodeOntologyResponse = {
  schemaVersion: 1, projectPath: '.', analyzedAt: '', snapshotSha256: 'a'.repeat(64), nodes: [{ id: 'source-api', kind: 'api', label: 'GET /signals', api: { method: 'GET', path: '/signals' }, evidence: { path: 'backend/Controller.java', line: 3, sha256: 'b'.repeat(64) } }], edges: [], issues: [],
  coverage: { scannedFiles: 2, parsedFiles: 2, sourceBytes: 100, businessDocuments: 0, unsupportedFiles: 0, languages: [], truncated: false, inventoryComplete: true },
  dependencyGraph: { ok: true, analyzedAt: '', documents: [], nodes: [{ id: 'service', kind: 'code', label: 'backend/Service.java' }, { id: 'controller', kind: 'code', label: 'backend/Controller.java' }, { id: 'source-api', kind: 'api', label: 'GET /signals', documentFile: 'backend/Controller.java' }],
    edges: [{ dependentId: 'controller', sourceId: 'service', documentFile: 'backend/Controller.java', evidenceRef: 'call candidate' }, { dependentId: 'source-api', sourceId: 'controller', documentFile: 'backend/Controller.java', evidenceRef: 'declaration' }], changedNodeIds: ['service'], impacts: [], unlinkedNodeIds: [], warnings: [], schemaWatch: null },
  handoff: '', elapsedMs: 1, cacheHit: false, modelCalls: 0,
};
const docs: DocumentGraphResponse = { ok: true, analyzedAt: '', documents: ['api.json','screen.json'], nodes: [{ id: 'document-api', kind: 'api', label: 'Signal lookup', documentFile: 'api.json', itemId: 'IF-1' }, { id: 'screen', kind: 'screen', label: 'Operator', documentFile: 'screen.json', itemId: 'SC-1' }, { id: 'unlinked', kind: 'screen', label: 'Unknown', documentFile: 'screen.json', itemId: 'SC-2' }],
  edges: [{ dependentId: 'screen', sourceId: 'document-api', documentFile: 'screen.json', evidenceRef: 'IF-1' }], changedNodeIds: [], impacts: [], unlinkedNodeIds: ['unlinked'], warnings: [], schemaWatch: null };
const spec = { file: 'api.json', doc: { kind: 'interface-spec', endpoints: [{ interfaceId: 'IF-1', method: 'GET', path: '/signals' }] } as InterfaceSpecDocument };
const source = { scope: 'git-visible-worktree' as const, head: 'c'.repeat(40), digest: 'd'.repeat(64), fileCount: 3, reason: null };
const checks = [{ id: 'backend::java:maven-test', projectPath: 'backend', label: 'Maven test', kind: 'test' as const, command: 'mvn', args: ['test'], source: 'backend/pom.xml', script: null, recommended: true }, { id: 'frontend::node:test', projectPath: 'frontend', label: 'Vue test', kind: 'test' as const, command: 'npm', args: ['test'], source: 'frontend/package.json', script: null, recommended: true }];
describe('code relationship and specification change planning', () => {
  it('simulates selected source files before editing and ignores unrelated Git changes and passing receipts', () => {
    const graph = mergeOntologyDocuments(ontology, docs, [spec]);
    const selected = simulationSourceNodes(ontology, graph, ['backend/Service.java']);
    expect(selected).toEqual({ sourceFiles: ['backend/Service.java'], nodeIds: ['service'], granularity: 'file' });
    const plan = buildChangePlan({ graph: { ...graph, changedNodeIds: ['unlinked'] }, checks, source, receipt: null,
      changedFiles: ['unrelated.java'], simulateNodeIds: selected!.nodeIds });
    expect(plan.mode).toBe('simulation'); expect(plan.summary.passed).toBe(0);
    expect(plan.affectedNodeIds).toEqual(expect.arrayContaining(['service','controller','source-api','document-api','screen']));
    expect(plan.affectedNodeIds).not.toContain('unlinked');
    expect(simulationSourceNodes(ontology, graph, undefined)).toBeNull();
    for (const invalid of [[], ['../secret'], ['screen.json'], ['backend/Missing.java'], 'backend/Service.java', Array(33).fill('backend/Service.java')])
      expect(() => simulationSourceNodes(ontology, graph, invalid)).toThrow();
    const module = { ...ontology, projectPath: 'backend', dependencyGraph: { ...ontology.dependencyGraph,
      nodes: ontology.dependencyGraph.nodes.map(n => n.kind === 'code' ? { ...n, label: n.label.replace('backend/', '') } : n) } };
    expect(simulationSourceNodes(module, graph, ['backend/Service.java'])?.nodeIds).toEqual(['service']);
  });
  it('follows service → controller → API → API document → screen, without claiming a test pass', () => {
    const graph = mergeOntologyDocuments(ontology, docs, [spec]);
    const plan = buildChangePlan({ graph, checks, source, receipt: null, changedFiles: ['backend/Service.java'] });
    expect(plan.affectedNodeIds).toEqual(expect.arrayContaining(['service','controller','source-api','document-api','screen']));
    expect(plan.affectedNodeIds).not.toContain('unlinked');
    const review = documentReviews(plan,ontology);
    expect(review.find(item => item.itemId === 'IF-1')).toMatchObject({ state: 'review-required', impactPath: ['backend/Service.java','backend/Controller.java','GET /signals','Signal lookup'] });
    expect(review.find(item => item.itemId === 'SC-2')?.state).toBe('coverage-unknown');
    expect(plan.obligations.some(item => item.checkId === 'backend::java:maven-test' && item.state === 'needs-run')).toBe(true);
    expect(plan.obligations.some(item => item.checkId === 'frontend::node:test')).toBe(false);
    expect(plan.modelCalls).toBe(0);
  });
  it('does not pair duplicate or merely similar API routes', () => {
    const duplicate = { ...ontology, nodes: [...ontology.nodes, { ...ontology.nodes[0]!, id: 'duplicate' }] };
    const graph = mergeOntologyDocuments(duplicate, docs, [spec]);
    expect(graph.edges.some(edge => edge.dependentId === 'document-api' && edge.sourceId === 'source-api')).toBe(false);
    expect(graph.warnings.some(message => message.includes('2 exact source contracts'))).toBe(true);
    const similar = { ...spec, doc: { ...spec.doc, endpoints: [{ ...spec.doc.endpoints[0]!, path: '/signals-old' }] } };
    expect(mergeOntologyDocuments(ontology, docs, [similar]).edges.some(edge => edge.dependentId === 'document-api' && edge.sourceId === 'source-api')).toBe(false);
  });
  it('unifies explicit code references by path and keeps absent Git coverage unknown', () => {
    const graph = mergeOntologyDocuments({ ...ontology, dependencyGraph: { ...ontology.dependencyGraph, changedNodeIds: [] } }, { ...docs, nodes: [...docs.nodes, { id: 'declared-file', kind: 'code', label: 'backend/Service.java' }], edges: [...docs.edges, { dependentId: 'document-api', sourceId: 'declared-file', documentFile: 'api.json', evidenceRef: 'declared source' }] }, [spec]);
    expect(graph.nodes.filter(node => node.kind === 'code' && node.label === 'backend/Service.java')).toHaveLength(1);
    const plan = buildChangePlan({ graph, checks, source: { ...source, digest: null }, receipt: null, changedFiles: [] });
    expect(documentReviews(plan,ontology).every(item => item.state === 'coverage-unknown')).toBe(true);
  });
  it('does not turn a missing or unparsed declared source into proof of no impact',()=>{
    const incomplete={...ontology,issues:[{path:'backend/Service.java',reason:'parse-error' as const,message:'Could not parse'}],dependencyGraph:{...ontology.dependencyGraph,changedNodeIds:[]}};
    const declared={...docs,nodes:[...docs.nodes,{id:'missing',kind:'code' as const,label:'backend/Missing.java'}],edges:[{dependentId:'document-api',sourceId:'missing',documentFile:'api.json',evidenceRef:'declared but absent'}]};
    const graph=mergeOntologyDocuments(incomplete,declared,[]);
    const plan=buildChangePlan({graph,checks,source,receipt:null,changedFiles:[]});
    expect(documentReviews(plan,incomplete).find(item=>item.itemId==='IF-1')?.state).toBe('coverage-unknown');
    const completeGraph=mergeOntologyDocuments({...ontology,dependencyGraph:{...ontology.dependencyGraph,changedNodeIds:[]}},docs,[spec]);
    const completePlan=buildChangePlan({graph:completeGraph,checks,source,receipt:null,changedFiles:[]});
    expect(documentReviews(completePlan,ontology).find(item=>item.itemId==='IF-1')?.state).toBe('no-recorded-impact');
    expect(documentReviews(completePlan,{...ontology,coverage:{...ontology.coverage,truncated:true}}).find(item=>item.itemId==='IF-1')?.state).toBe('coverage-unknown');
  });
});
