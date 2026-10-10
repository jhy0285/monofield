import { describe, expect, it } from 'vitest';
import { InterfaceSpecDocumentSchema, ScreenSpecDocumentSchema, type VerificationCheck, type VerificationRun } from '@open-design/contracts';
import { buildDocumentGraph } from '../../src/services/document-graph.js';
import { buildChangePlan } from '../../src/services/change-plan.js';
import { matchesChangeSelector, parseChangePolicy } from '../../src/services/change-policy.js';

const check: VerificationCheck = { id: 'node:test', label: 'test', kind: 'test', command: 'npm', args: ['run', 'test'], script: 'node --test', source: 'package.json', recommended: true };
const types: VerificationCheck = { ...check, id: 'node:typecheck', label: 'typecheck', kind: 'types', script: 'tsc --noEmit' };
function fixture() {
  const api = InterfaceSpecDocumentSchema.parse({ schemaVersion: 1, kind: 'interface-spec', source: { codebaseName: 'Store' }, endpoints: [
    { method: 'GET', path: '/prices', interfaceId: 'PRICE', interfaceName: 'Prices', sourceFile: 'src/prices.ts', responseFields: [{ nameEn: 'price', evidenceRefs: [{ kind: 'database', ref: 'Price column', database: { connectionId: 'db', schema: 'public', table: 'products', column: 'price' } }] }] },
    { method: 'GET', path: '/help', interfaceId: 'HELP', sourceFile: 'src/help.ts' },
  ] });
  const screen = ScreenSpecDocumentSchema.parse({ schemaVersion: 1, kind: 'screen-spec', name: 'Store', screens: [
    { id: 'SHOP', screenName: 'Storefront', evidenceRefs: [{ kind: 'requirement', ref: 'Price API', document: { path: 'api.json', itemId: 'PRICE' } }] },
  ] });
  return buildDocumentGraph({ documents: [{ file: 'api.json', doc: api }, { file: 'screens.json', doc: screen }], changedFiles: ['src/prices.ts'] });
}
function inputs() {
  return { graph: fixture(), checks: [check, types], changedFiles: ['src/prices.ts'], source: { scope: 'git-visible-worktree' as const, head: 'head', digest: 'a'.repeat(64), fileCount: 5, reason: null }, receipt: null as VerificationRun | null };
}
function receipt(): VerificationRun {
  const source = inputs().source;
  return { schemaVersion: 1, id: 'real-receipt', projectId: 'p', projectPath: '.', state: 'passed', startedAt: '', endedAt: '', timeoutMs: 1000,
    sourceBefore: source, sourceAfter: source, stableSource: true, error: null,
    steps: [check, types].map(check => ({ check, state: 'passed', startedAt: '', endedAt: '', exitCode: 0, output: '', outputTruncated: false })),
  };
}
describe('ontology-driven change planning', () => {
  it('traces code → API → screen and emits explicit if conditions and manual design obligations', () => {
    const plan = buildChangePlan(inputs());
    expect(plan.affectedNodeIds.map(id => plan.graph.nodes.find(n => n.id === id)?.label)).toEqual(['src/prices.ts', 'Prices', 'Storefront']);
    expect(plan.obligations.some(item => item.review === 'keyboard' && item.path.length === 3)).toBe(true);
    expect(plan.obligations.some(item => item.ruleId === 'builtin:types' && item.checkId === types.id)).toBe(true);
    expect(plan.summary.coverageGaps).toBe(3); expect(plan.modelCalls).toBe(0);
    expect(plan.affectedNodeIds.some(id => plan.graph.nodes.find(n => n.id === id)?.itemId === 'HELP')).toBe(false);
  });
  it('keeps unknown assertion coverage and manual reviews after a current project-wide pass', () => {
    const plan = buildChangePlan({ ...inputs(), receipt: receipt() });
    expect(plan.summary.passed).toBe(3);
    expect(plan.obligations.filter(item => item.state === 'coverage-gap')).toHaveLength(3);
    expect(plan.obligations.filter(item => item.state === 'manual-review')).toHaveLength(3);
  });
  it('never credits changed source, unavailable source, failed groups or changed commands', () => {
    for (const variant of [
      { ...inputs(), receipt: receipt(), source: { ...inputs().source, digest: 'b'.repeat(64) } },
      { ...inputs(), receipt: receipt(), source: { ...inputs().source, digest: null } },
      { ...inputs(), receipt: { ...receipt(), state: 'failed' as const } },
      { ...inputs(), receipt: receipt(), checks: [ { ...check, script: 'different script' }, { ...types, script: 'different types' } ] },
    ]) expect(buildChangePlan(variant).summary.passed).toBe(0);
  });
  it('simulates DB → API → screen without retaining observed code changes or reusing receipts', () => {
    const options = inputs();
    const db = options.graph.nodes.find(node => node.kind === 'database')!;
    const original = JSON.stringify(options);
    const plan = buildChangePlan({ ...options, receipt: receipt(), simulateNodeIds: [db.id] });
    expect(plan.mode).toBe('simulation'); expect(plan.summary.affected).toBe(3); expect(plan.summary.passed).toBe(0);
    expect(plan.obligations.some(item => item.review === 'schema')).toBe(true);
    expect(plan.affectedNodeIds.includes(options.graph.changedNodeIds[0]!)).toBe(false);
    expect(JSON.stringify(options)).toBe(original);
    expect(() => buildChangePlan({ ...options, simulateNodeIds: ['invented'] })).toThrow('existing graph');
  });
  it('adds project ontology bindings and conjunction rules, and exposes unavailable checks', () => {
    const policy = parseChangePolicy({ schemaVersion: 1,
      bindings: [{ target: { kind: 'api', documentFile: 'api.json', itemId: 'PRICE' }, checkIds: ['node:test'] }],
      rules: [{ id: 'brand-contrast', when: { kind: 'screen', itemId: 'SHOP' }, require: { checkIds: ['nonexistent'], reviews: ['contrast'] } }],
    });
    const plan = buildChangePlan({ ...inputs(), policy });
    expect(plan.ontology.edges.filter(edge => edge.relation === 'verified-by')).toHaveLength(1);
    expect(plan.obligations.some(item => item.ruleId === 'project:brand-contrast' && item.state === 'missing-check')).toBe(true);
    expect(plan.obligations.some(item => item.review === 'contrast')).toBe(true);
    expect(plan.obligations.some(item => item.ruleId === 'builtin:coverage' && item.nodeId.includes('PRICE'))).toBe(false);
    expect(matchesChangeSelector({ id: 'x', kind: 'code', label: 'src/payments-old/x.ts' }, { kind: 'code', pathPrefix: 'src/payments' })).toBe(false);
  });
  it('rejects executable hooks, traversal, unknown reviews, duplicate IDs and unbounded policies', () => {
    for (const value of [
      { schemaVersion: 1, bindings: [], rules: [], expression: 'process.exit()' },
      { schemaVersion: 1, bindings: [{ target: { kind: 'code', pathPrefix: '../keys' }, checkIds: [check.id] }], rules: [] },
      { schemaVersion: 1, bindings: [], rules: [{ id: 'x', when: { kind: 'screen' }, require: { checkIds: [], reviews: ['execute'] } }] },
      { schemaVersion: 1, bindings: [], rules: Array.from({ length: 65 }, () => ({ id: 'x' })) },
    ]) expect(() => parseChangePolicy(value)).toThrow();
    expect(() => parseChangePolicy({ schemaVersion: 1, bindings: [], rules: [1, 2].map(() => ({ id: 'duplicate', when: { kind: 'screen' }, require: { checkIds: [check.id], reviews: [] } })) })).toThrow('unique');
  });
  it('merges the same required check while retaining every fired rule and binding reason', () => {
    const policy = parseChangePolicy({ schemaVersion: 1, bindings: [1, 2].map(() => ({ target: { kind: 'api', itemId: 'PRICE' }, checkIds: [check.id] })),
      rules: [{ id: 'pricing-tests', when: { kind: 'api', itemId: 'PRICE' }, require: { checkIds: [check.id], reviews: [] } }] });
    const plan = buildChangePlan({ ...inputs(), policy });
    const requirements = plan.obligations.filter(item => item.nodeId.includes('PRICE') && item.checkId === check.id);
    expect(requirements).toHaveLength(1); expect(requirements[0]?.triggers.map(trigger => trigger.ruleId)).toEqual(['builtin:test', 'project:binding', 'project:pricing-tests']);
    expect(plan.ontology.edges.filter(edge => edge.relation === 'verified-by')).toHaveLength(1);
    expect(plan.warnings.some(warning => warning.includes('Bound check is unavailable'))).toBe(false);
  });
  it('adds migration review only for potentially breaking changes from the same database connection', () => {
    const options = inputs(); const db = options.graph.nodes.find(node => node.kind === 'database')!;
    options.graph.schemaWatch = { projectId: 'p', workspacePath: '.', connectionId: 'db', enabled: true, intervalSeconds: 60,
      status: 'changed', checkedAt: null, baselineSha256: null, latestSha256: null, baseline: null, latest: null, error: null,
      changes: [{ schema: 'public', table: 'products', column: 'price', kind: 'column-removed' }] };
    expect(buildChangePlan({ ...options, simulateNodeIds: [db.id] }).obligations.some(item => item.review === 'migration')).toBe(true);
    options.graph.schemaWatch.connectionId = 'other-db';
    expect(buildChangePlan({ ...options, simulateNodeIds: [db.id] }).obligations.some(item => item.review === 'migration')).toBe(false);
  });
  it('reports unknown change impact, missing checks and bounded handoffs without scripts or logs', () => {
    const plan = buildChangePlan({ ...inputs(), checks: [], changedFiles: ['src/prices.ts', 'new-unlinked.ts'], request: 'Improve storefront' });
    expect(plan.unmatchedChangedFiles).toEqual(['new-unlinked.ts']); expect(plan.obligations.some(item => item.state === 'missing-check')).toBe(true);
    expect(plan.handoff).toContain('Improve storefront'); expect(plan.handoff).not.toContain('node --test'); expect(plan.handoff.length).toBeLessThan(6000);
  });
  it('terminates cyclic relations and does not require work for unaffected items', () => {
    const options = inputs(); const screen = options.graph.nodes.find(node => node.kind === 'screen')!;
    options.graph.edges.push({ sourceId: screen.id, dependentId: options.graph.changedNodeIds[0]!, documentFile: 'api.json', evidenceRef: 'cycle' });
    expect(buildChangePlan(options).summary.affected).toBe(3);
    expect(buildChangePlan({ ...inputs(), changedFiles: [], graph: { ...fixture(), changedNodeIds: [], impacts: [] } }).obligations).toEqual([]);
  });
});
