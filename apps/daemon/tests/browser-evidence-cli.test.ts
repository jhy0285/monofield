import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer, type StartServerResult } from '../src/server.js';
import { repeatedFlag } from '../src/services/rea-cli.js';

const execute = promisify(execFile);
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'rea');
const CAPTURE_TEXT = readFileSync(path.join(FIXTURES, 'browser-scenario-capture.json'), 'utf8');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

type Json = Record<string, any>;

/** The settlement demo's spec with a removed field, a renamed one and a removed endpoint. */
function driftedSpecText(): string {
  const spec = JSON.parse(readFileSync(path.join(FIXTURES, 'interface-spec.json'), 'utf8')) as Json;
  const settle = spec.endpoints.find((endpoint: Json) => endpoint.path === '/api/orders/{id}/settle');
  settle.responseFields = settle.responseFields.filter((field: Json) => field.nameEn !== 'fee_amount');
  settle.responseFields.find((field: Json) => field.nameEn === 'net_amount').nameEn = 'netAmount';
  spec.endpoints = spec.endpoints.filter((endpoint: Json) => endpoint.path !== '/api/settlements');
  return JSON.stringify(spec, null, 2);
}

describe('monofield rea evidence / cross-check / apply', () => {
  let server: StartServerResult;
  let projectId: string;
  const url = (suffix: string) => `${server.url}/api/projects/${projectId}${suffix}`;
  const upload = async (name: string, content: string) => {
    const response = await fetch(url('/files'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, content }) });
    expect(response.ok).toBe(true);
  };
  const read = async (name: string) => (await fetch(url(`/files/${name}`))).text();
  const cli = (...args: string[]) => execute(process.execPath, [path.resolve('dist/cli.js'), 'rea', ...args, '--daemon-url', server.url]);
  const json = async (...args: string[]) => JSON.parse((await cli(...args, '--json')).stdout) as Json;
  const base = () => ['--project', projectId];

  beforeAll(async () => {
    server = await startServer({ port: 0, returnServer: true }) as StartServerResult;
    projectId = randomUUID();
    const created = await fetch(`${server.url}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: projectId, name: 'rea-cli' }) });
    expect(created.ok).toBe(true);
    await upload('evidence/capture.json', CAPTURE_TEXT);
    await upload('evidence/capture-again.json', CAPTURE_TEXT);
    await upload('package.json', '{"name":"demo"}');
    for (const name of ['read-only', 'selected', 'in-place', 'pinned', 'twice']) await upload(`docs/${name}.interface-spec.json`, driftedSpecText());
  }, 60_000);
  afterAll(async () => { await server?.shutdown(); server?.server.closeAllConnections?.(); });

  it('collects a repeated flag in both spellings and stops at --', () => {
    expect(repeatedFlag(['x', '--evidence', 'a.json', '--json', '--evidence=b.json', '--', '--evidence', 'c.json'], 'evidence')).toEqual(['a.json', 'b.json']);
    expect(repeatedFlag(['--finding', 'one'], 'evidence')).toEqual([]);
    expect(() => repeatedFlag(['--evidence'], 'evidence')).toThrow(/requires a value/);
  });

  it('keeps the MCP commands working', async () => {
    const status = await json('status');
    expect(status).toMatchObject({ availability: 'not-probed' });
    expect(typeof status.configured).toBe('boolean');
    await expect(cli('nonsense')).rejects.toMatchObject({ stderr: expect.stringContaining('Use monofield rea') });
    expect((await cli('--help')).stdout).toContain('monofield rea cross-check');
  });

  it('lists the capture files of a project', async () => {
    const result = await json('evidence', ...base());
    expect(result.files.map((file: Json) => file.file).sort()).toEqual(['evidence/capture-again.json', 'evidence/capture.json']);
    const text = (await cli('evidence', ...base())).stdout;
    expect(text).toContain('evidence/capture.json');
    expect(text).toMatch(/KB/);
  });

  it('compares a capture with a spec and prints findings with the IDs apply takes', async () => {
    const input = 'docs/read-only.interface-spec.json';
    const result = await json('cross-check', ...base(), '--input', input, '--evidence', 'evidence/capture.json');
    expect(result.findings.map((finding: Json) => finding.kind)).toEqual(['undocumented-endpoint', 'undocumented-field', 'name-mismatch', 'undocumented-error']);
    expect(result.contentSha256).toBe(sha256(await read(input)));
    const text = (await cli('cross-check', ...base(), '--input', input, '--evidence', 'evidence/capture.json')).stdout;
    expect(text).toContain('3 warning');
    expect(text).toContain('undocumented-endpoint');
    expect(text).toContain('GET /api/settlements');
    expect(text).toContain('net_amount ≠ netAmount');
    expect(text).toContain('id: undocumented-field|POST|/api/orders/{id}/settle|response|fee_amount');
    expect(text).toContain(`content sha256: ${result.contentSha256}`);
  });

  it('adds up several --evidence files', async () => {
    const one = await json('cross-check', ...base(), '--evidence', 'evidence/capture.json');
    const two = await json('cross-check', ...base(), '--evidence', 'evidence/capture.json', '--evidence', 'evidence/capture-again.json');
    expect(one.summary.observedApiCalls).toBe(6);
    expect(two.summary.observedApiCalls).toBe(12);
    expect(two.sources).toHaveLength(2);
  });

  it('only prints the result of apply unless --write is given', async () => {
    const input = 'docs/read-only.interface-spec.json';
    const before = await read(input);
    const result = await json('apply', ...base(), '--input', input, '--evidence', 'evidence/capture.json');
    expect(result.changes).toMatchObject({ endpointsAdded: 1, fieldsAdded: 7, fieldsRenamed: 1 });
    expect(result.written).toBeUndefined();
    expect(await read(input)).toBe(before);
    expect((await cli('apply', ...base(), '--input', input, '--evidence', 'evidence/capture.json')).stdout).toContain('Nothing was written');
  });

  it('applies only the findings it is given, once or several times', async () => {
    const input = 'docs/selected.interface-spec.json';
    const found = (await json('cross-check', ...base(), '--input', input, '--evidence', 'evidence/capture.json')).findings as Json[];
    const id = (kind: string) => found.find((finding) => finding.kind === kind)!.id as string;
    const rename = await json('apply', ...base(), '--input', input, '--evidence', 'evidence/capture.json', '--finding', id('name-mismatch'), '--no-attach-evidence');
    expect(rename.changes).toMatchObject({ endpointsAdded: 0, fieldsAdded: 0, fieldsRenamed: 1, evidenceAttached: 0 });
    const two = await json('apply', ...base(), '--input', input, '--evidence', 'evidence/capture.json',
      '--finding', id('name-mismatch'), `--finding=${id('undocumented-field')}`, '--no-attach-evidence');
    expect(two.changes).toMatchObject({ endpointsAdded: 0, fieldsAdded: 1, fieldsRenamed: 1 });
  });

  it('writes in place with the hash it just compared, and the second comparison is clean', async () => {
    const input = 'docs/in-place.interface-spec.json';
    const written = await json('apply', ...base(), '--input', input, '--evidence', 'evidence/capture.json', '--write', '--note-lang', 'en');
    expect(written.written).toEqual({ file: input, contentSha256: sha256(await read(input)) });
    const saved = JSON.parse(await read(input)) as Json;
    expect(saved.endpoints.map((endpoint: Json) => endpoint.path)).toContain('/api/settlements');
    expect(saved.endpoints.find((endpoint: Json) => endpoint.path === '/api/settlements').note).toMatch(/^Added from a recorded browser scenario/);
    const again = await json('cross-check', ...base(), '--input', input, '--evidence', 'evidence/capture.json');
    expect(again.summary).toMatchObject({ warnings: 0, errors: 0, undocumentedEndpoints: 0 });
    const text = (await cli('apply', ...base(), '--input', input, '--evidence', 'evidence/capture.json', '--write')).stdout;
    expect(text).toContain('0 endpoints added');
    expect(text).toContain(`written: ${input}`);
    expect(text).not.toContain('judge check');
  });

  it('suggests the judgment check when a write added rows with empty Korean labels', async () => {
    const input = 'docs/twice.interface-spec.json';
    const text = (await cli('apply', ...base(), '--input', input, '--evidence', 'evidence/capture.json', '--write')).stdout;
    expect(text).toContain(`monofield judge check --project ${projectId} --input ${input}`);
  });

  it('refuses a write pinned to a hash the file no longer has', async () => {
    const input = 'docs/pinned.interface-spec.json';
    const before = await read(input);
    await expect(cli('apply', ...base(), '--input', input, '--evidence', 'evidence/capture.json', '--write', '--base-sha256', sha256('an earlier version')))
      .rejects.toMatchObject({ stderr: expect.stringContaining('changed since it was compared') });
    expect(await read(input)).toBe(before);
    const pinned = await json('apply', ...base(), '--input', input, '--evidence', 'evidence/capture.json', '--write', '--base-sha256', sha256(before));
    expect(pinned.written.file).toBe(input);
  });

  it('drafts a specification from a capture into --out, and does not replace an existing file', async () => {
    const out = 'docs/observed.interface-spec.json';
    const drafted = await json('apply', ...base(), '--evidence', 'evidence/capture.json', '--write', '--out', out);
    expect(drafted.written.file).toBe(out);
    expect(JSON.parse(await read(out))).toMatchObject({ kind: 'interface-spec', source: { collector: 'rea-browser' } });
    expect(drafted.doc.endpoints).toHaveLength(3);
    await expect(cli('apply', ...base(), '--evidence', 'evidence/capture.json', '--write', '--out', out)).rejects.toMatchObject({ stderr: expect.stringContaining('already exists') });
  });

  it('rejects incomplete or contradictory options before calling the daemon', async () => {
    const fails = (message: string, ...args: string[]) => expect(cli(...args)).rejects.toMatchObject({ stderr: expect.stringContaining(message) });
    await fails('requires --project', 'cross-check', '--evidence', 'evidence/capture.json');
    await fails('at least one --evidence', 'cross-check', ...base());
    await fails('add --write', 'apply', ...base(), '--evidence', 'evidence/capture.json', '--out', 'docs/x.interface-spec.json');
    await fails('needs --out', 'apply', ...base(), '--evidence', 'evidence/capture.json', '--write');
    await fails('only applies with --write', 'apply', ...base(), '--evidence', 'evidence/capture.json', '--base-sha256', 'abc');
    await fails('--note-lang must be ko or en', 'apply', ...base(), '--evidence', 'evidence/capture.json', '--note-lang', 'fr');
    await fails('unknown flag', 'apply', ...base(), '--evidence', 'evidence/capture.json', '--overwrite');
    await fails('does not exist', 'cross-check', ...base(), '--evidence', 'evidence/missing.json');
  });
});
