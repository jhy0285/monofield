import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRunChecks, type RunCheckRecord } from '../src/services/run-check.js';

// The check after a run: what the run itself changed (not what the person had changed before it), whether a caller
// of the API would notice, and which APIs, screens, tables and classes it touched.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtures = path.join(repository, 'plugins/_official/interface-spec/fixtures');
const scriptsDir = path.join(repository, 'plugins/_official/interface-spec/scripts');
const ORDER = 'src/main/java/kr/example/legacy/order';

function hasPython(): boolean {
  try { return /Python 3\./.test(execFileSync('python3', ['--version'], { encoding: 'utf8' })); } catch { return false; }
}

describe('check after a run', () => {
  let root: string;
  let records: Map<string, RunCheckRecord>;
  let checks: ReturnType<typeof createRunChecks>;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'monofield-run-check-'));
    await cp(path.join(fixtures, 'spring'), root, { recursive: true });
    git('init', '--quiet');
    git('add', '-A');
    git('commit', '--quiet', '--no-verify', '-m', 'baseline');
    records = new Map();
    checks = createRunChecks({ record: (runId, record) => records.set(runId, record), scriptsDir: async () => scriptsDir });
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  function git(...args: string[]) {
    return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: root, encoding: 'utf8' }).trim();
  }
  async function edit(file: string, change: (text: string) => string) {
    const target = path.join(root, file);
    await writeFile(target, change(await readFile(target, 'utf8')));
  }
  async function run(runId: string, work: () => Promise<void>, options: { development?: boolean; folder?: string } = {}) {
    await checks.start({ runId, root: options.folder ?? root, development: options.development ?? true });
    expect(records.get(runId)?.summary.state ?? 'none').not.toBe('done');
    await work();
    await checks.finish(runId);
    return records.get(runId);
  }

  it.skipIf(!hasPython())('finds a new endpoint as additive and names only the handler the run wrote', async () => {
    const record = await run('r1', () => cp(path.join(fixtures, 'spring-change'), root, { recursive: true }));
    expect(record?.summary).toMatchObject({ state: 'done', shared: false, files: 5, touched: { api: 1 } });
    expect(record?.files.map((file) => `${file.status} ${file.path}`).sort()).toEqual([
      'added README.md',
      `added ${ORDER}/dto/OrderCancelRequest.java`,
      `modified ${ORDER}/OrderController.java`,
      `modified ${ORDER}/OrderService.java`,
      `modified ${ORDER}/dto/OrderCreateRequest.java`,
    ]);
    expect(record?.summary.api).toEqual({ checked: true, level: 'info', counts: { breaking: 0, warning: 0, info: 2 }, endpoints: { before: 5, after: 6 } });
    expect(record?.apiChanges.map((change) => change.code).sort()).toEqual(['endpoint-added', 'request-field-added-optional']);
    // the handler above the new one only got a closing brace re-aligned by the diff: it is not touched
    expect(record?.touched.filter((item) => item.kind === 'api')).toEqual([
      { kind: 'api', label: 'POST /api/v1/orders/{orderId}/cancel', path: `${ORDER}/OrderController.java`, change: 'added' },
    ]);
    expect(record?.touched.filter((item) => item.kind === 'class').map((item) => `${item.change} ${item.label}`)).toEqual(
      ['added kr.example.legacy.order.dto.OrderCancelRequest', 'changed kr.example.legacy.order.dto.OrderCreateRequest',
        'changed kr.example.legacy.order.OrderController', 'changed kr.example.legacy.order.OrderService']);
  });

  it.skipIf(!hasPython())('charges a breaking change to the run and leaves out what the person had changed before it', async () => {
    // the person's own uncommitted work, before the run
    await edit(`${ORDER}/OrderController.java`, (text) => text.replace('/** 주문 목록 조회 */', '/** 주문 목록 조회 (검색 조건 포함) */'));
    await writeFile(path.join(root, 'NOTES.md'), 'my notes\n');

    const record = await run('r1', () => edit(`${ORDER}/dto/OrderResponse.java`, (text) => text.replace(/\s*\/\*\* 주문 금액 \*\/\s*private Long totalAmount;/, '')));
    expect(record?.files).toEqual([{ path: `${ORDER}/dto/OrderResponse.java`, status: 'modified' }]);
    expect(record?.summary.api).toMatchObject({ checked: true, level: 'breaking', counts: { breaking: 3 } });
    expect(record?.apiChanges.filter((change) => change.level === 'breaking').map((change) => change.field)).toEqual(['totalAmount', 'totalAmount', 'totalAmount']);
    expect(record?.touched).toEqual([{ kind: 'class', label: 'kr.example.legacy.order.dto.OrderResponse', path: `${ORDER}/dto/OrderResponse.java`, change: 'changed' }]);
    // the person's index and files are as they left them
    // (the helper trims the output, so the first line's leading space is gone)
    expect(git('status', '--porcelain')).toBe([` M ${ORDER}/OrderController.java`, ` M ${ORDER}/dto/OrderResponse.java`, '?? NOTES.md'].join('\n').trim());
    expect(git('diff', '--cached', '--name-only')).toBe('');
  });

  it('marks an edited handler, a renamed screen file and a React component', async () => {
    await mkdir(path.join(root, 'web/src'), { recursive: true });
    await writeFile(path.join(root, 'web/src/OrderList.vue'), '<template><div>orders</div></template>\n<script setup>\nconst a = 1\n</script>\n');
    await writeFile(path.join(root, 'web/src/Cart.tsx'), 'export function Cart() {\n  return <div>cart</div>;\n}\n');
    git('add', '-A');
    git('commit', '--quiet', '--no-verify', '-m', 'web');

    const record = await run('r1', async () => {
      await edit(`${ORDER}/OrderController.java`, (text) => text.replace('return ResponseEntity.ok(orderService.find(orderId));', 'return ResponseEntity.ok(orderService.find(orderId > 0 ? orderId : 0));'));
      git('mv', 'web/src/OrderList.vue', 'web/src/OrderTable.vue');
      await edit('web/src/Cart.tsx', (text) => text.replace('cart', 'cart items'));
    });
    expect(record?.files.map((file) => `${file.status} ${file.path}${file.from ? ` <- ${file.from}` : ''}`).sort()).toEqual([
      `modified ${ORDER}/OrderController.java`,
      'modified web/src/Cart.tsx',
      'renamed web/src/OrderTable.vue <- web/src/OrderList.vue',
    ]);
    // only the handler whose body changed
    expect(record?.touched.filter((item) => item.kind === 'api')).toEqual([
      { kind: 'api', label: 'GET /api/v1/orders/{orderId}', path: `${ORDER}/OrderController.java`, change: 'changed' },
    ]);
    expect(record?.touched.filter((item) => item.kind === 'screen').map((item) => `${item.change} ${item.label}`).sort())
      .toEqual(['added OrderTable.vue', 'changed Cart', 'removed OrderList.vue']);
    // no Java API surface changed on the caller's side
    if (hasPython()) expect(record?.summary.api).toMatchObject({ checked: true, level: 'none' });
  });

  it('says why it could not check, and stays quiet where there was nothing to check', async () => {
    const plain = await mkdtemp(path.join(os.tmpdir(), 'monofield-run-check-plain-'));
    try {
      expect(await run('dev', async () => { await writeFile(path.join(plain, 'a.md'), 'x'); }, { folder: plain, development: true }))
        .toMatchObject({ summary: { state: 'skipped', reason: 'not-git' } });
      expect(await run('docs', async () => { await writeFile(path.join(plain, 'b.md'), 'x'); }, { folder: plain, development: false })).toBeUndefined();
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
    // a run that changed nothing is checked and clean
    expect(await run('idle', async () => {})).toMatchObject({ summary: { state: 'done', files: 0, api: null, touched: { api: 0, screen: 0, table: 0, class: 0 } } });
  });

  it('leaves out what MonoField itself writes into the folder for a run', async () => {
    const record = await run('r1', async () => {
      await mkdir(path.join(root, '.od-skills/web-prototype/references'), { recursive: true });
      await writeFile(path.join(root, '.od-skills/web-prototype/SKILL.md'), '# skill');
      await writeFile(path.join(root, '.mcp.json'), '{}');
      await mkdir(path.join(root, '.pi/sessions'), { recursive: true });
      await writeFile(path.join(root, '.pi/sessions/s.jsonl'), '{}');
      await writeFile(path.join(root, 'docs-note.md'), 'the agent wrote this');
    });
    expect(record?.files).toEqual([{ path: 'docs-note.md', status: 'added' }]);
  });

  it('flags runs that worked in the same repository at the same time', async () => {
    await checks.start({ runId: 'a', root, development: true });
    await checks.start({ runId: 'b', root: path.join(root, 'src'), development: true });
    await writeFile(path.join(root, 'a.txt'), 'a');
    await checks.finish('a');
    await checks.finish('b');
    expect(records.get('a')?.summary.shared).toBe(true);
    expect(records.get('b')?.summary).toMatchObject({ shared: true, files: 0 });
  });

  it('reports a missing scanner instead of failing the check', async () => {
    checks = createRunChecks({ record: (runId, record) => records.set(runId, record), scriptsDir: async () => null });
    const record = await run('r1', () => edit(`${ORDER}/dto/OrderResponse.java`, (text) => text.replace('주문 금액', '주문 총액')));
    expect(record?.summary).toMatchObject({ state: 'done', files: 1, api: { checked: false, reason: 'no-scanner' } });
  });
});
