import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseInterfaceSpecDocument, type InterfaceSpecDocument } from '@open-design/contracts';
import { analyzeDocumentImpact } from '../src/services/document-impact.js';
import { touchesScannedSources } from '../src/services/document-rescan.js';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const plugin = path.join(repository, 'plugins/_official/interface-spec');
const scriptsDir = path.join(plugin, 'scripts');

function hasPython(): boolean {
  try {
    return /Python 3\./.test(execFileSync('python3', ['--version'], { encoding: 'utf8' }));
  } catch {
    return false;
  }
}

// The Spring demo: a baseline commit, then the fixture overlay adds `deliveryMemo` to order creation and a cancel API.
describe.skipIf(!hasPython())('document impact by re-scanning the code', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'monofield-rescan-'));
    await cp(path.join(plugin, 'fixtures/spring'), root, { recursive: true });
    git('init', '--quiet');
    git('add', '-A');
    git('commit', '--quiet', '--no-verify', '-m', 'baseline');
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  function git(...args: string[]) {
    return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: root, encoding: 'utf8' }).trim();
  }

  async function scannedDocument(): Promise<InterfaceSpecDocument> {
    const out = path.join(root, 'docs/orders.interface-spec.json');
    execFileSync('python3', [path.join(scriptsDir, 'scan_spring.py'), '--codebase-path', root, '--out', out], { encoding: 'utf8' });
    const parsed = parseInterfaceSpecDocument(JSON.parse(await readFile(out, 'utf8')));
    if (!parsed.ok) throw new Error(parsed.error);
    // the document is committed, so the change analysis compares the code with that commit
    git('add', '-A');
    git('commit', '--quiet', '--no-verify', '-m', 'spec');
    return { ...parsed.doc, source: { ...parsed.doc.source, codebasePath: '.' } };
  }

  async function analyze(doc: InterfaceSpecDocument, rescan?: { scriptsDir: string }) {
    return analyzeDocumentImpact({
      projectRoot: root, inputFile: 'docs/orders.interface-spec.json', content: Buffer.from(JSON.stringify(doc)), doc,
      ...(rescan ? { rescan } : {}),
    });
  }

  it('lists only the interfaces whose contract changed, the new route and the exact differences', async () => {
    const doc = await scannedDocument();
    await cp(path.join(plugin, 'fixtures/spring-change'), root, { recursive: true });
    const files = await analyze(doc);
    const rescanned = await analyze(doc, { scriptsDir });

    // the controller changed, so the file rule flags every endpoint it serves
    expect(files.affected.length).toBeGreaterThan(1);
    expect(rescanned.analysis).toBe('rescan');
    expect(rescanned.affected.map((item) => `${doc.endpoints[item.endpointIndex]!.method} ${doc.endpoints[item.endpointIndex]!.path}`))
      .toEqual(['POST /api/v1/orders']);
    expect(rescanned.newRoutes).toEqual(['POST /api/v1/orders/{orderId}/cancel']);
    expect(rescanned.rescan?.changes.map((change) => `${change.code} ${change.field ?? ''}`.trim()).sort())
      .toEqual(['endpoint-added', 'request-field-added-optional deliveryMemo']);
    expect(rescanned.updatePrompt).toContain('re-scanning the code');
    // the user's checkout is untouched
    expect(git('status', '--porcelain')).toContain('OrderController.java');
    expect(git('status', '--porcelain')).not.toContain('index');
  });

  it('still compares with the scanned commit after the change is committed', async () => {
    const doc = await scannedDocument();
    expect(doc.source.revision).toBe(git('rev-parse', 'HEAD~1'));
    await cp(path.join(plugin, 'fixtures/spring-change'), root, { recursive: true });
    git('add', '-A');
    git('commit', '--quiet', '--no-verify', '-m', 'feature');
    const report = await analyze(doc, { scriptsDir });
    expect(report.analysis).toBe('rescan');
    expect(report.affected.map((item) => doc.endpoints[item.endpointIndex]!.path)).toEqual(['/api/v1/orders']);
    expect(report.newRoutes).toEqual(['POST /api/v1/orders/{orderId}/cancel']);
  });

  // eGovFrame-style: a method-less `@RequestMapping` (GET/POST) in place of `@GetMapping` is the same API, not a new one.
  it('reports a changed method list on the documented API instead of a removal plus a new API', async () => {
    const doc = await scannedDocument();
    const controller = path.join(root, 'src/main/java/kr/example/legacy/member/MemberController.java');
    await writeFile(controller, (await readFile(controller, 'utf8')).replace('@GetMapping("/{memberId}")', '@RequestMapping("/{memberId}")'));
    const report = await analyze(doc, { scriptsDir });
    expect(report.analysis).toBe('rescan');
    expect(report.affected.map((item) => `${doc.endpoints[item.endpointIndex]!.method} ${doc.endpoints[item.endpointIndex]!.path}`))
      .toEqual(['GET /api/v1/members/{memberId}']);
    expect(report.newRoutes).toEqual([]);
    expect(report.rescan?.changes).toEqual([expect.objectContaining({
      code: 'endpoint-methods-widened', level: 'info', route: 'GET /api/v1/members/{memberId}', before: 'GET', after: 'GET/POST',
    })]);
  });

  it('sees nothing to re-scan when only files the scanner does not read changed', async () => {
    const doc = await scannedDocument();
    execFileSync('bash', ['-c', 'echo "# notes" >> README.md'], { cwd: root });
    const report = await analyze(doc, { scriptsDir });
    expect(report.analysis).toBe('rescan');
    expect(report.affected).toEqual([]);
    expect(report.rescan?.level).toBe('none');
  });

  it('falls back to matching files, and says why, when the scanner cannot run', async () => {
    const doc = await scannedDocument();
    await cp(path.join(plugin, 'fixtures/spring-change'), root, { recursive: true });
    const report = await analyze(doc, { scriptsDir: path.join(root, 'missing') });
    expect(report.analysis).toBe('files');
    expect(report.analysisNote).toMatch(/scanner is not installed/);
    expect(report.affected.length).toBeGreaterThan(1);
  });

  it('does not re-scan a document the scanner did not make', async () => {
    const doc = await scannedDocument();
    await cp(path.join(plugin, 'fixtures/spring-change'), root, { recursive: true });
    const report = await analyze({ ...doc, source: { ...doc.source, collector: 'manual' } }, { scriptsDir });
    expect(report.analysis).toBe('files');
    expect(report.analysisNote).toMatch(/not made by a scanner/);
  });
});

// The same sample written in Kotlin: removing a response field from a data class is found by re-reading the code.
describe.skipIf(!hasPython())('document impact by re-scanning Kotlin code', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'monofield-rescan-kt-'));
    await cp(path.join(plugin, 'fixtures/spring-kotlin'), root, { recursive: true });
    git('init', '--quiet');
    git('add', '-A');
    git('commit', '--quiet', '--no-verify', '-m', 'baseline');
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  function git(...args: string[]) {
    return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: root, encoding: 'utf8' }).trim();
  }

  it('flags exactly the APIs that return the changed data class', async () => {
    const out = path.join(root, 'docs/orders.interface-spec.json');
    execFileSync('python3', [path.join(scriptsDir, 'scan_spring.py'), '--codebase-path', root, '--out', out], { encoding: 'utf8' });
    const parsed = parseInterfaceSpecDocument(JSON.parse(await readFile(out, 'utf8')));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.doc.source.language).toBe('kotlin');
    expect(parsed.doc.source.revision).toMatch(/^[0-9a-f]{40}$/);
    git('add', '-A');
    git('commit', '--quiet', '--no-verify', '-m', 'spec');
    const doc = { ...parsed.doc, source: { ...parsed.doc.source, codebasePath: '.' } };

    const dto = path.join(root, 'src/main/kotlin/kr/example/legacy/order/dto/OrderResponse.kt');
    await writeFile(dto, (await readFile(dto, 'utf8')).replace(/\s*\/\*\* 주문 금액 \*\/\s*val totalAmount: Long\?,/, ''));
    const report = await analyzeDocumentImpact({
      projectRoot: root, inputFile: 'docs/orders.interface-spec.json', content: Buffer.from(JSON.stringify(doc)), doc,
      rescan: { scriptsDir },
    });
    expect(report.analysis).toBe('rescan');
    expect(report.affected.map((item) => `${doc.endpoints[item.endpointIndex]!.method} ${doc.endpoints[item.endpointIndex]!.path}`).sort())
      .toEqual(['GET /api/v1/orders', 'GET /api/v1/orders/{orderId}', 'POST /api/v1/orders']);
    expect(new Set(report.rescan?.changes.map((change) => `${change.level} ${change.code} ${change.field}`)))
      .toEqual(new Set(['breaking response-field-removed totalAmount']));
  });
});

// Kotlin controllers and DTOs are read by the same scanner, so a change to a `.kt` file must trigger a re-scan.
describe('sources the re-scan reads', () => {
  it('include Kotlin as well as Java and XML, and nothing else', () => {
    expect(touchesScannedSources(['src/main/kotlin/demo/api/ArticleController.kt'])).toBe(true);
    expect(touchesScannedSources(['src/main/java/demo/OrderController.java', 'README.md'])).toBe(true);
    expect(touchesScannedSources(['build.gradle.kts', 'README.md', 'src/main/resources/static/app.js'])).toBe(false);
  });
});
