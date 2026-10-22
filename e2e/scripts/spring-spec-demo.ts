// Spring interface-spec demo: open folder → generate spec → change code →
// review the spec update as a diff. Reproducible without a model call: the
// code change is a fixture overlay and the spec update proposal is derived
// from a rescan, then validated by the same contract the daemon uses.
//
//   pnpm --filter @open-design/daemon build   # once, for the monofield CLI
//   pnpm exec tsx e2e/scripts/spring-spec-demo.ts [--out <dir>] [--json]
//
// Walkthrough: docs/demo/spring-interface-spec-demo.md

import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  applyInterfaceSpecProposal,
  parseInterfaceSpecDocument,
  type InterfaceSpecDocument,
  type InterfaceSpecProposal,
} from '@open-design/contracts';

const run = promisify(execFile);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pluginRoot = path.join(repository, 'plugins/_official/interface-spec');
const fixture = path.join(pluginRoot, 'fixtures/spring');
const overlay = path.join(pluginRoot, 'fixtures/spring-change');
const scanner = path.join(pluginRoot, 'scripts/scan_spring.py');
const cli = path.join(repository, 'apps/daemon/bin/monofield.mjs');

const argv = process.argv.slice(2);
const outFlag = argv.indexOf('--out');
const output = path.resolve(
  outFlag >= 0 && argv[outFlag + 1]
    ? argv[outFlag + 1]!
    : path.join(repository, '.tmp/spring-spec-demo', randomUUID().slice(0, 8)),
);
const jsonOnly = argv.includes('--json');
const workspace = path.join(output, 'legacy-order');
const specRel = 'docs/orders.interface-spec.json';
const specPath = path.join(workspace, specRel);
const proposalPath = path.join(workspace, 'docs/orders.interface-spec.proposed.json');
const python = process.env.PYTHON || 'python3';

// Values a reviewer (or the agent, under review) confirms on top of the static
// scan: interface IDs and business names are not recoverable from code alone.
const REVIEW: Record<string, { interfaceId: string; interfaceName: string }> = {
  'POST /api/v1/members/join': { interfaceId: 'IF-MBR-001', interfaceName: '회원 가입' },
  'GET /api/v1/members/{memberId}': { interfaceId: 'IF-MBR-002', interfaceName: '회원 조회' },
  'POST /api/v1/orders': { interfaceId: 'IF-ORD-001', interfaceName: '주문 등록' },
  'GET /api/v1/orders/{orderId}': { interfaceId: 'IF-ORD-002', interfaceName: '주문 단건 조회' },
  'GET /api/v1/orders': { interfaceId: 'IF-ORD-003', interfaceName: '주문 목록 조회' },
  'POST /api/v1/orders/{orderId}/cancel': { interfaceId: 'IF-ORD-004', interfaceName: '주문 취소' },
};

type Endpoint = InterfaceSpecDocument['endpoints'][number];
const keyOf = (endpoint: Pick<Endpoint, 'method' | 'path'>) => `${endpoint.method} ${endpoint.path}`;
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const steps: Array<{ step: string; detail: string }> = [];
const log = (step: string, detail: string) => {
  steps.push({ step, detail });
  if (!jsonOnly) process.stdout.write(`▸ ${step}\n  ${detail}\n`);
};

async function git(...args: string[]) {
  const { stdout } = await run('git', ['-c', 'user.name=MonoField demo', '-c', 'user.email=demo@example.invalid', ...args], { cwd: workspace });
  return stdout.trim();
}

async function scan(outFile: string) {
  await run(python, [
    scanner,
    '--codebase-path', workspace,
    '--codebase-name', 'legacy-order',
    '--name-dict', path.join(workspace, 'docs/term-dictionary.csv'),
    '--out', outFile,
  ]);
  const parsed = parseInterfaceSpecDocument(JSON.parse(await readFile(outFile, 'utf8')));
  if (!parsed.ok) throw new Error(`Scanner output is not a valid interface spec: ${parsed.error}`);
  return parsed.doc;
}

function applyReview(doc: InterfaceSpecDocument): InterfaceSpecDocument {
  return {
    ...doc,
    // Keep the document portable: the absolute scan path is machine-specific.
    source: { ...doc.source, codebasePath: '.' },
    cover: { ...doc.cover, docName: '주문 시스템 인터페이스 명세서', version: '1.0', department: '주문서비스팀' },
    endpoints: doc.endpoints.map((endpoint) => ({ ...endpoint, ...REVIEW[keyOf(endpoint)] })),
  };
}

async function render(input: string, out: string) {
  await run(process.execPath, [cli, 'docs', 'render-interface-spec', '--input', input, '--out', out]);
  return (await stat(out)).size;
}

// The proposal an agent writes after `monofield docs impact`: only the
// interfaces whose code changed, guarded by `test` ops on the original IDs.
function buildProposal(base: InterfaceSpecDocument, baseSha: string, rescanned: InterfaceSpecDocument): InterfaceSpecProposal {
  const changes: InterfaceSpecProposal['changes'] = [];
  const next = new Map(rescanned.endpoints.map((endpoint) => [keyOf(endpoint), endpoint]));
  base.endpoints.forEach((endpoint, index) => {
    const after = next.get(keyOf(endpoint));
    if (!after) return;
    for (const field of ['requestFields', 'responseFields'] as const) {
      const was = endpoint[field];
      const now = after[field];
      if (JSON.stringify(was) === JSON.stringify(now)) continue;
      changes.push({ op: 'test', path: `/endpoints/${index}/interfaceId`, value: endpoint.interfaceId });
      // Appended fields stay small `add` ops; anything else replaces the list.
      const appended = now.length > was.length && was.every((item, i) => JSON.stringify(item) === JSON.stringify(now[i]));
      if (appended) {
        for (const item of now.slice(was.length)) {
          changes.push({ op: 'add', path: `/endpoints/${index}/${field}/-`, value: { ...item, reviewStatus: 'unreviewed' } });
        }
      } else {
        changes.push({ op: 'replace', path: `/endpoints/${index}/${field}`, value: now });
      }
    }
  });
  const known = new Set(base.endpoints.map(keyOf));
  for (const endpoint of rescanned.endpoints) {
    if (known.has(keyOf(endpoint))) continue;
    changes.push({ op: 'add', path: '/endpoints/-', value: { ...endpoint, ...REVIEW[keyOf(endpoint)] } });
  }
  const remaining = new Set(rescanned.endpoints.map(keyOf));
  base.endpoints
    .map((endpoint, index) => ({ endpoint, index }))
    .filter(({ endpoint }) => !remaining.has(keyOf(endpoint)))
    .reverse()
    .forEach(({ endpoint, index }) => {
      changes.push({ op: 'test', path: `/endpoints/${index}/interfaceId`, value: endpoint.interfaceId });
      changes.push({ op: 'remove', path: `/endpoints/${index}` });
    });
  return { schemaVersion: 1, kind: 'interface-spec-proposal', baseContentSha256: baseSha, changes };
}

function fieldDiff(base: InterfaceSpecDocument, merged: InterfaceSpecDocument) {
  const before = new Map(base.endpoints.map((endpoint) => [keyOf(endpoint), endpoint]));
  return merged.endpoints.flatMap((endpoint) => {
    const old = before.get(keyOf(endpoint));
    if (!old) {
      return [{ interfaceId: endpoint.interfaceId, route: keyOf(endpoint), change: 'added interface', fields: endpoint.requestFields.map((field) => field.path ?? field.nameEn) }];
    }
    const oldPaths = new Set(old.requestFields.map((field) => field.path ?? field.nameEn));
    const added = endpoint.requestFields.map((field) => field.path ?? field.nameEn).filter((p) => !oldPaths.has(p));
    return added.length ? [{ interfaceId: endpoint.interfaceId, route: keyOf(endpoint), change: 'added request fields', fields: added }] : [];
  });
}

await mkdir(output, { recursive: true });

// 1. Open the project folder (a synthetic legacy Spring order system).
await cp(fixture, workspace, { recursive: true });
await git('init', '-q');
await git('add', '-A');
await git('commit', '-qm', 'baseline: legacy order system');
const baselineCommit = await git('rev-parse', '--short', 'HEAD');
log('1. 프로젝트 폴더 열기', `${workspace} (commit ${baselineCommit})`);

// 2. Generate the interface spec from code evidence and render the workbook.
const scanned = applyReview(await scan(path.join(output, 'scan-baseline.json')));
await writeFile(specPath, JSON.stringify(scanned, null, 2) + '\n');
const baseBytes = await readFile(specPath);
const baseSha = sha256(baseBytes);
const baseXlsx = path.join(workspace, 'docs/orders-interface-spec-v1.0.xlsx');
const baseXlsxSize = await render(specPath, baseXlsx);
await git('add', '-A');
await git('commit', '-qm', 'docs: interface spec v1.0');
log('2. 명세서 생성', `${scanned.endpoints.length} interfaces → ${path.relative(output, baseXlsx)} (${baseXlsxSize} bytes)`);

// 3. Change the code (in a real session: Codex or Claude Code).
await cp(overlay, workspace, { recursive: true, filter: (source) => path.basename(source) !== 'README.md' });
await git('add', '-A');
const changedFiles = (await git('diff', '--cached', '--name-only')).split('\n').filter(Boolean);
await git('commit', '-qm', 'feat(order): delivery memo and cancel API');
log('3. 코드 변경', changedFiles.join(', '));

// 4. Propose only the changed interfaces, validate, review, and re-export.
const rescanned = await scan(path.join(output, 'scan-after-change.json'));
const proposal = buildProposal(scanned, baseSha, rescanned);
const proposalText = JSON.stringify(proposal, null, 2) + '\n';
await writeFile(proposalPath, proposalText);
const applied = applyInterfaceSpecProposal(scanned, baseSha, proposal);
if (!applied.ok) throw new Error(`Proposal rejected by the contract validator: ${applied.error}`);
const stale = applyInterfaceSpecProposal(scanned, sha256(baseBytes.toString('utf8') + ' '), proposal);
if (stale.ok) throw new Error('A proposal for a different revision must be rejected.');
const diff = fieldDiff(scanned, applied.doc);
const merged = { ...applied.doc, cover: { ...applied.doc.cover, version: '1.1' } };
await writeFile(specPath, JSON.stringify(merged, null, 2) + '\n');
const nextXlsx = path.join(workspace, 'docs/orders-interface-spec-v1.1.xlsx');
const nextXlsxSize = await render(specPath, nextXlsx);
log(
  '4. 명세서 갱신 diff 검토',
  `${applied.changesApplied} changes (${proposalText.length} chars vs ${JSON.stringify(merged).length} chars full doc) → ${path.relative(output, nextXlsx)}`,
);

const report = {
  status: 'ok',
  output,
  workspace,
  baselineCommit,
  interfaces: { before: scanned.endpoints.length, after: merged.endpoints.length },
  proposal: { path: proposalPath, changesApplied: applied.changesApplied, characters: proposalText.length, staleRevisionRejected: true },
  reviewed: diff,
  workbooks: [baseXlsx, nextXlsx],
  steps,
};
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
if (jsonOnly) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
else {
  process.stdout.write('\n검토 대상 변경:\n');
  for (const item of diff) process.stdout.write(`  ${item.interfaceId} ${item.route} — ${item.change}: ${item.fields.join(', ')}\n`);
  process.stdout.write(`\nreport: ${path.join(output, 'report.json')}\n`);
}
