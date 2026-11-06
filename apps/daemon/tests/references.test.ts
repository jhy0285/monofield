import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addReference, applyReferences, listReferences, removeReference, updateReference, type ReferenceFileAccess } from '../src/services/references.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function folderAccess(root: string): ReferenceFileAccess {
  return {
    root: async () => root,
    read: async (name) => readFile(path.join(root, name)).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; }),
    write: async (name, body) => { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), body); },
    remove: async (name) => rm(path.join(root, name)),
  };
}

describe('reference board service', () => {
  let root: string;
  let files: ReferenceFileAccess;
  beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'refs-')); files = folderAccess(root); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('keeps a reference with its screenshot and a sanitized outline, newest first, and ignores the folder in git', async () => {
    const first = await addReference(files, 'p', { url: 'https://a.example/x?token=s3cret#frag', note: '  좋은 목록 ', takes: ['fields'] });
    const second = await addReference(files, 'p', {
      url: 'https://b.example/join', title: 'Join', screenshotBase64: `data:image/png;base64,${PNG}`,
      outline: { regions: ['header', 'main'], forms: [{ fields: [{ type: 'email', label: '이메일', required: true }], buttons: 1 }], bodyText: 'dropped' },
    });
    expect(first).toMatchObject({ url: 'https://a.example/x?token=%5Bredacted%5D', title: 'a.example', note: '좋은 목록', takes: ['fields'], screenshot: null, outline: null, source: 'browser' });
    expect(second.screenshot).toMatchObject({ file: `references/${second.id}.png`, mediaType: 'image/png', bytes: Buffer.from(PNG, 'base64').length });
    expect(second.outline).toMatchObject({ regions: ['header', 'main'], forms: [{ fields: [{ type: 'email', label: '이메일', required: true }], buttons: 1 }] });
    expect(JSON.stringify(second.outline)).not.toContain('dropped');
    expect((await readFile(path.join(root, second.screenshot!.file))).equals(Buffer.from(PNG, 'base64'))).toBe(true);
    expect(await readFile(path.join(root, 'references/.gitignore'), 'utf8')).toMatch(/^\*$/m);
    const board = await listReferences(files);
    expect(board.items.map((item) => item.id)).toEqual([second.id, first.id]);
    expect(JSON.parse(await readFile(path.join(root, 'references/board.json'), 'utf8'))).toMatchObject({ schemaVersion: 1, kind: 'reference-board' });
  });

  it('refuses non-http URLs, non-image screenshots and a folder that links out of the project', async () => {
    await expect(addReference(files, 'p', { url: 'file:///etc/passwd' })).rejects.toThrow('http(s)');
    await expect(addReference(files, 'p', { url: 'https://a.example', screenshotBase64: Buffer.from('<svg/>').toString('base64') })).rejects.toThrow('PNG or JPEG');
    const outside = await mkdtemp(path.join(tmpdir(), 'refs-outside-'));
    try {
      await symlink(outside, path.join(root, 'references'));
      await expect(addReference(files, 'p', { url: 'https://a.example' })).rejects.toThrow('inside the project');
    } finally { await rm(outside, { recursive: true, force: true }); }
  });

  it('serializes concurrent adds so none is lost', async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) => addReference(files, 'p', { url: `https://a.example/${i}` })));
    expect((await listReferences(files)).items).toHaveLength(8);
  });

  it('edits the note and takes, removes a reference with its own screenshot only', async () => {
    const item = await addReference(files, 'p', { url: 'https://a.example', screenshotBase64: PNG });
    expect(await updateReference(files, 'p', item.id, { note: '버튼 배치', takes: 'flow,interaction' })).toMatchObject({ note: '버튼 배치', takes: ['flow', 'interaction'] });
    await expect(updateReference(files, 'p', 'ref-missing', { note: 'x' })).rejects.toMatchObject({ status: 404 });
    // A board edited by hand to point a screenshot elsewhere must not make remove delete that file.
    await writeFile(path.join(root, 'keep.txt'), 'keep');
    const other = await addReference(files, 'p', { url: 'https://b.example' });
    const board = JSON.parse(await readFile(path.join(root, 'references/board.json'), 'utf8'));
    board.items.find((entry: { id: string }) => entry.id === other.id).screenshot = { file: 'keep.txt', sha256: 'x', bytes: 4, mediaType: 'image/png' };
    await writeFile(path.join(root, 'references/board.json'), JSON.stringify(board));
    expect(await removeReference(files, 'p', other.id)).toEqual({ removed: other.id, files: [] });
    expect(await readFile(path.join(root, 'keep.txt'), 'utf8')).toBe('keep');
    expect(await removeReference(files, 'p', item.id)).toEqual({ removed: item.id, files: [item.screenshot!.file] });
    expect((await listReferences(files)).items).toEqual([]);
  });

  it('builds the apply block and reports whether each screenshot still matches', async () => {
    const shot = await addReference(files, 'p', { url: 'https://a.example/list', screenshotBase64: PNG, takes: ['structure'] });
    const plain = await addReference(files, 'p', { url: 'https://b.example/form', note: '입력 순서' });
    const applied = await applyReferences(files, { referenceIds: [shot.id, plain.id], target: 'src/OrderList.vue', request: '목록 화면에 적용' });
    expect(applied.references).toEqual([shot.id, plain.id]);
    expect(applied.screenshots).toEqual([{ file: shot.screenshot!.file, state: 'verified' }]);
    expect(applied.block).toContain('target: src/OrderList.vue');
    expect(applied.block).toContain(`screenshot: ${shot.screenshot!.file} (sha256 verified)`);
    expect(applied.block).toContain('note: 입력 순서');
    await writeFile(path.join(root, shot.screenshot!.file), 'tampered');
    expect((await applyReferences(files, { referenceIds: [shot.id] })).screenshots).toEqual([{ file: shot.screenshot!.file, state: 'changed' }]);
    await rm(path.join(root, shot.screenshot!.file));
    expect((await applyReferences(files, { referenceIds: [shot.id] })).screenshots[0]!.state).toBe('missing');
    expect((await applyReferences(files, { referenceIds: [shot.id], includeScreenshot: false })).block).not.toContain('screenshot:');
    await expect(applyReferences(files, { referenceIds: [] })).rejects.toThrow('at least one');
    await expect(applyReferences(files, { referenceIds: ['ref-missing'] })).rejects.toMatchObject({ status: 404 });
  });

  it('reports a damaged board file instead of overwriting it', async () => {
    await mkdir(path.join(root, 'references'), { recursive: true });
    await writeFile(path.join(root, 'references/board.json'), '{not json');
    await expect(listReferences(files)).rejects.toMatchObject({ status: 409, code: 'REFERENCE_BOARD_INVALID' });
    await expect(addReference(files, 'p', { url: 'https://a.example' })).rejects.toMatchObject({ status: 409 });
    expect(await readFile(path.join(root, 'references/board.json'), 'utf8')).toBe('{not json');
  });
});
