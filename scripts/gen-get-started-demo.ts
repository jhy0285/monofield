/**
 * Regenerates apps/monofield-site/get-started-demo.json: the output the real
 * `monofield` CLI prints for each way the demo spec can drift from the REA
 * recording. The get-started page replays these outputs; nothing on the page
 * is computed in the browser.
 *
 *   OD_DATA_DIR=<scratch dir> pnpm tools-dev start daemon --daemon-port 17456 --namespace demo
 *   pnpm --filter @open-design/daemon build
 *   node --import tsx scripts/gen-get-started-demo.ts http://127.0.0.1:17456
 *
 * The inputs are the synthetic REA recording and spec in
 * apps/daemon/tests/fixtures/rea/. After regenerating, update the default
 * output printed in get-started.html (scenario 111, "compare") to match; the
 * site test checks that they agree.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const fixtures = path.join(root, 'apps/daemon/tests/fixtures/rea');
const cli = path.join(root, 'apps/daemon/dist/cli.js');
const base = (process.argv[2] ?? 'http://127.0.0.1:17456').replace(/\/$/, '');

type Json = Record<string, any>;
const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

async function post(route: string, body: unknown) {
  const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status} ${await response.text()}`);
  return response.json() as Promise<Json>;
}

/**
 * The CLI's stdout; a non-zero exit (a judge run with no model is one) still has output worth keeping.
 * `docs render-*` works on files and takes no daemon address.
 */
async function monofield(...args: string[]): Promise<string> {
  const standalone = args[0] === 'docs' && args[1]?.startsWith('render');
  try {
    return (await run(process.execPath, [cli, ...args, ...(standalone ? [] : ['--daemon-url', base])], { maxBuffer: 16 * 1024 * 1024 })).stdout;
  } catch (error) {
    const failed = error as { stdout?: string };
    if (failed.stdout) return failed.stdout;
    throw error;
  }
}

const tidy = (key: string, text: string) => text.replaceAll(`docs/orders-${key}.interface-spec.json`, 'docs/orders.interface-spec.json').replace(uuidPattern, '<project-id>').trimEnd();

/** Flagged rows first, then a few of the rest: the full list adds nothing. */
function judgeHead(text: string): string {
  const [head = '', ...rest] = text.trimEnd().split('\n');
  const flagged = rest.filter((line) => line.trimStart().startsWith('flag'));
  const others = rest.filter((line) => !line.trimStart().startsWith('flag')).slice(0, 4);
  const more = rest.length - flagged.length - others.length;
  return [head, ...flagged, ...others, ...(more > 0 ? [`  … ${more} more review items`] : [])].join('\n');
}

const capture = await readFile(path.join(fixtures, 'browser-scenario-capture.json'), 'utf8');
const spec = JSON.parse(await readFile(path.join(fixtures, 'interface-spec.json'), 'utf8')) as Json;
const projectId = randomUUID();
await post('/api/projects', { id: projectId, name: 'get-started-demo' });
await post(`/api/projects/${projectId}/files`, { name: 'evidence/capture.json', content: capture });

const drifted = (removeField: boolean, renameField: boolean, removeEndpoint: boolean): Json => {
  const copy = JSON.parse(JSON.stringify(spec)) as Json;
  const settle = copy.endpoints.find((endpoint: Json) => endpoint.path === '/api/orders/{id}/settle');
  if (removeField) settle.responseFields = settle.responseFields.filter((field: Json) => field.nameEn !== 'fee_amount');
  if (renameField) settle.responseFields.find((field: Json) => field.nameEn === 'net_amount').nameEn = 'netAmount';
  if (removeEndpoint) copy.endpoints = copy.endpoints.filter((endpoint: Json) => endpoint.path !== '/api/settlements');
  return copy;
};

const scenarios: Json = {};
for (const flags of [0, 1, 2, 3, 4, 5, 6, 7]) {
  const [removeField, renameField, removeEndpoint] = [flags & 4, flags & 2, flags & 1].map(Boolean) as [boolean, boolean, boolean];
  const key = `${+removeField}${+renameField}${+removeEndpoint}`;
  const input = `docs/orders-${key}.interface-spec.json`;
  await post(`/api/projects/${projectId}/files`, { name: input, content: JSON.stringify(drifted(removeField, renameField, removeEndpoint), null, 2) });
  const common = ['--project', projectId, '--input', input, '--evidence', 'evidence/capture.json'];
  const compare = await monofield('rea', 'cross-check', ...common);
  const summary = (JSON.parse(await monofield('rea', 'cross-check', ...common, '--json')) as Json).summary;
  const apply = await monofield('rea', 'apply', ...common, '--write');
  const recheck = await monofield('rea', 'cross-check', ...common);
  const judge = await monofield('judge', 'check', '--project', projectId, '--input', input);
  scenarios[key] = { flags: { removeField, renameField, removeEndpoint }, summary,
    compare: tidy(key, compare), apply: tidy(key, apply), recheck: tidy(key, recheck), judge: tidy(key, judgeHead(judge)) };
  console.log(key, `${summary.warnings} warning(s)`);
}

const scratch = await mkdtemp(path.join(tmpdir(), 'get-started-demo-'));
try {
  const input = path.join(scratch, 'orders.interface-spec.json');
  const output = path.join(scratch, 'orders.xlsx');
  await writeFile(input, JSON.stringify(spec, null, 2));
  const rendered = JSON.parse(await monofield('docs', 'render-interface-spec', '--input', input, '--out', output)) as Json;
  // The listing prints the file's modification time; fix it so the output (and the page that quotes it) is reproducible.
  const evidence = (await monofield('rea', 'evidence', '--project', projectId)).trimEnd().replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/, '2026-11-02T00:00:00.000Z');
  const out = {
    about: 'Output of the monofield CLI run on the synthetic settlement demo; the REA recording is apps/daemon/tests/fixtures/rea/browser-scenario-capture.json. Paths shortened, project IDs removed, the file time fixed, long lists trimmed. Regenerate with scripts/gen-get-started-demo.ts.',
    versions: { monofield: JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version, rea: '6.7.0' },
    evidence: {
      file: 'evidence/capture.json',
      listing: evidence,
      calls: [['GET', '/api/orders', 200], ['POST', '/api/orders/1001/settle', 201], ['POST', '/api/orders/1001/settle', 409],
        ['POST', '/api/orders/1002/settle', 409], ['POST', '/api/orders/1003/settle', 409], ['GET', '/api/settlements', 200]]
        .map(([method, route, status]) => ({ method, path: route, status })),
    },
    endpoints: spec.endpoints.map((endpoint: Json) => ({ method: endpoint.method, path: endpoint.path, interfaceId: endpoint.interfaceId,
      name: endpoint.interfaceName, fields: (endpoint.responseFields ?? []).map((field: Json) => field.nameEn) })),
    render: { endpointCount: rendered.endpointCount, sheetTitles: rendered.sheetTitles, warningCount: rendered.warnings.length,
      sampleWarnings: rendered.warnings.slice(0, 2), bytes: (await stat(output)).size },
    scenarios,
  };
  await writeFile(path.join(root, 'apps/monofield-site/get-started-demo.json'), `${JSON.stringify(out, null, 1)}\n`);
  console.log('wrote apps/monofield-site/get-started-demo.json');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
