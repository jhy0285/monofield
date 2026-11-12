import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseInterfaceSpecDocument } from '@open-design/contracts';
import { runDocsCli } from '../src/docs-cli.js';

// `monofield docs scan` and `monofield docs check` are the paths that need neither an AI tool nor the running app:
// one makes the specification from code, the other is the pull-request gate ("does this change break a caller?").
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtures = path.join(repository, 'plugins/_official/interface-spec/fixtures');

function hasPython(): boolean {
  try {
    return /Python 3\./.test(execFileSync('python3', ['--version'], { encoding: 'utf8' }));
  } catch {
    return false;
  }
}

describe.skipIf(!hasPython())('docs CLI without an AI tool or the daemon', () => {
  let root: string;
  let out: string[];
  let err: string[];

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'monofield-docs-cli-'));
    await cp(path.join(fixtures, 'spring'), root, { recursive: true });
    out = [];
    err = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { out.push(args.join(' ')); });
    vi.spyOn(console, 'error').mockImplementation((...args) => { err.push(args.join(' ')); });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  function git(...args: string[]) {
    return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: root, encoding: 'utf8' }).trim();
  }
  function baseline() {
    git('init', '--quiet');
    git('add', '-A');
    git('commit', '--quiet', '--no-verify', '-m', 'baseline');
  }
  async function removeResponseField() {
    const dto = path.join(root, 'src/main/java/kr/example/legacy/order/dto/OrderResponse.java');
    await writeFile(dto, (await readFile(dto, 'utf8')).replace(/\s*\/\*\* 주문 금액 \*\/\s*private Long totalAmount;/, ''));
  }

  it('scan writes the specification and the Excel workbook from code', async () => {
    const xlsx = path.join(root, 'docs/orders.xlsx');
    const result = await runDocsCli(['scan', '--codebase', root, '--name-dict', path.join(root, 'docs/term-dictionary.csv'), '--xlsx', xlsx]);
    expect(err).toEqual([]);
    expect(result.exitCode).toBe(0);
    const summary = JSON.parse(out.join('\n'));
    expect(summary).toMatchObject({ endpointCount: 5, output: path.join(root, 'docs/api.interface-spec.json'), xlsx });
    const parsed = parseInterfaceSpecDocument(JSON.parse(await readFile(summary.output, 'utf8')));
    expect(parsed.ok && parsed.doc.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`)).toContain('POST /api/v1/orders');
    expect(parsed.ok && parsed.doc.source.collector).toBe('static-spring');
    // an .xlsx file is a zip
    expect((await readFile(xlsx)).subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('scan says what is wrong instead of writing an empty specification', async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), 'monofield-docs-cli-empty-'));
    try {
      expect((await runDocsCli(['scan', '--codebase', empty])).exitCode).toBe(2);
      expect(err.join('\n')).toMatch(/no Spring controllers/i);
      expect((await runDocsCli(['scan', '--codebase', path.join(empty, 'missing')])).exitCode).toBe(2);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('check passes additive changes and reports them', async () => {
    baseline();
    await cp(path.join(fixtures, 'spring-change'), root, { recursive: true });
    const result = await runDocsCli(['check', '--codebase', root, '--base', 'HEAD', '--format', 'json']);
    expect(err).toEqual([]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(out.join('\n'));
    expect(report).toMatchObject({ passed: true, level: 'info', counts: { breaking: 0, warning: 0, info: 2 }, endpoints: { before: 5, after: 6 } });
    expect(report.base).toMatch(/^[0-9a-f]{40}$/);
    expect(report.changes.map((change: { code: string }) => change.code).sort()).toEqual(['endpoint-added', 'request-field-added-optional']);
  });

  it('check fails a breaking change, as text for people and Markdown for a pull-request comment', async () => {
    baseline();
    await removeResponseField();

    expect((await runDocsCli(['check', '--codebase', root, '--base', 'HEAD'])).exitCode).toBe(1);
    expect(out.join('\n')).toContain('호환성 깨짐 3');
    expect(out.join('\n')).toMatch(/\[호환성 깨짐\] GET \/api\/v1\/orders\/\{orderId\} · 응답 필드 삭제 · totalAmount/);

    out.length = 0;
    const reportFile = path.join(root, 'api-check.md');
    expect((await runDocsCli(['check', '--codebase', root, '--base', 'HEAD', '--format', 'markdown', '--lang', 'en', '--out', reportFile])).exitCode).toBe(1);
    const markdown = await readFile(reportFile, 'utf8');
    expect(markdown).toContain('## API change check');
    expect(markdown).toContain('| Breaking | `GET /api/v1/orders/{orderId}` | Response field removed | `totalAmount` |');
    // the report file is the output; stdout stays a one-line result
    expect(out.join('\n')).toMatch(/3 breaking/);

    // a team can start by watching without failing the pipeline
    expect((await runDocsCli(['check', '--codebase', root, '--base', 'HEAD', '--fail-on', 'never'])).exitCode).toBe(0);
  });

  it('check reports nothing to do when the contract did not change', async () => {
    baseline();
    await writeFile(path.join(root, 'README.md'), '# notes\n');
    expect((await runDocsCli(['check', '--codebase', root, '--base', 'HEAD'])).exitCode).toBe(0);
    expect(out.join('\n')).toContain('API 계약 변경 없음');
  });

  it('check cannot run without a Git baseline and says so', async () => {
    expect((await runDocsCli(['check', '--codebase', root, '--base', 'HEAD'])).exitCode).toBe(2);
    expect(err.join('\n')).toMatch(/not a Git repository/i);
    baseline();
    err.length = 0;
    expect((await runDocsCli(['check', '--codebase', root, '--base', 'no-such-branch'])).exitCode).toBe(2);
    expect(err.join('\n')).toMatch(/no-such-branch/);
    expect((await runDocsCli(['check', '--codebase', root])).exitCode).toBe(2);
  });
});
