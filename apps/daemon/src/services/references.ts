import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  REFERENCE_BOARD_FILE,
  REFERENCE_BOARD_FOLDER,
  REFERENCE_LIMITS,
  normalizeReferenceOutline,
  normalizeReferenceTakes,
  referenceApplyBlock,
  sanitizeReferenceUrl,
  type ReferenceApplyResponse,
  type ReferenceBoardFile,
  type ReferenceItem,
  type ReferenceListResponse,
  type ReferenceScreenshotState,
} from '@open-design/contracts';

/**
 * The reference board of one project: `references/board.json` and the screenshots next to it, inside the project so
 * the agent can open them. The folder carries a `.gitignore` of its own, so in a code repository the board stays out of
 * the change list unless the person removes that file.
 */
export interface ReferenceFileAccess {
  /** The project's root folder, used only to place the folder's `.gitignore` (project file writes cannot name dotfiles). */
  root(): Promise<string>;
  read(name: string): Promise<Buffer | null>;
  write(name: string, body: Buffer | string): Promise<void>;
  remove(name: string): Promise<void>;
}

export class ReferenceBoardError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'REFERENCE_INVALID') { super(message); }
}

export function classifyReferenceError(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof ReferenceBoardError) return { status: error.status, code: error.code, message: error.message };
  const status = Number((error as { status?: number })?.status) || 400;
  const message = error instanceof Error ? error.message : String(error);
  return { status, code: status === 404 ? 'PROJECT_NOT_FOUND' : 'REFERENCE_FAILED', message };
}

const GITIGNORE = '# MonoField reference board: screenshots and notes kept while browsing.\n# Delete this file to commit the board with the project.\n*\n';
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

// One board write at a time per project; a read-modify-write would otherwise lose a concurrent add.
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  queues.set(key, next);
  void next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => undefined);
  return next;
}

export async function readReferenceBoard(files: ReferenceFileAccess): Promise<ReferenceBoardFile> {
  const buffer = await files.read(REFERENCE_BOARD_FILE);
  if (!buffer) return { schemaVersion: 1, kind: 'reference-board', items: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(buffer.toString('utf8')); } catch {
    throw new ReferenceBoardError(`${REFERENCE_BOARD_FILE} is not valid JSON; fix or remove it.`, 409, 'REFERENCE_BOARD_INVALID');
  }
  const board = parsed as Partial<ReferenceBoardFile>;
  if (!board || board.kind !== 'reference-board' || !Array.isArray(board.items)) {
    throw new ReferenceBoardError(`${REFERENCE_BOARD_FILE} is not a reference board.`, 409, 'REFERENCE_BOARD_INVALID');
  }
  return { schemaVersion: 1, kind: 'reference-board', items: board.items.filter((item): item is ReferenceItem => Boolean(item && typeof item.id === 'string' && typeof item.url === 'string')) };
}

async function ensureGitignore(files: ReferenceFileAccess): Promise<void> {
  const root = await realpath(await files.root());
  const folder = path.join(root, REFERENCE_BOARD_FOLDER);
  await mkdir(folder, { recursive: true });
  // The folder must be a real folder inside the project, not a link out of it.
  const info = await lstat(folder);
  const real = await realpath(folder);
  if (!info.isDirectory() || path.relative(root, real) !== REFERENCE_BOARD_FOLDER) {
    throw new ReferenceBoardError(`${REFERENCE_BOARD_FOLDER}/ must be a folder inside the project.`, 409, 'REFERENCE_FOLDER_INVALID');
  }
  await writeFile(path.join(folder, '.gitignore'), GITIGNORE, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
}

async function writeBoard(files: ReferenceFileAccess, board: ReferenceBoardFile): Promise<void> {
  await files.write(REFERENCE_BOARD_FILE, `${JSON.stringify(board, null, 2)}\n`);
}

function imageType(bytes: Buffer): 'image/png' | 'image/jpeg' | null {
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

const cleanText = (value: unknown, limit: number) => (typeof value === 'string' ? value.trim().slice(0, limit) : '');
const newId = () => `ref-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;

export async function listReferences(files: ReferenceFileAccess): Promise<ReferenceListResponse> {
  return { folder: REFERENCE_BOARD_FOLDER, items: (await readReferenceBoard(files)).items };
}

export async function addReference(files: ReferenceFileAccess, key: string, body: Record<string, unknown>): Promise<ReferenceItem> {
  const url = typeof body.url === 'string' ? sanitizeReferenceUrl(body.url) : null;
  if (!url) throw new ReferenceBoardError('url must be an http(s) address.');
  let screenshot: { bytes: Buffer; mediaType: 'image/png' | 'image/jpeg' } | null = null;
  if (body.screenshotBase64 !== undefined && body.screenshotBase64 !== null && body.screenshotBase64 !== '') {
    if (typeof body.screenshotBase64 !== 'string') throw new ReferenceBoardError('screenshotBase64 must be a base64 string.');
    const bytes = Buffer.from(body.screenshotBase64.replace(/^data:image\/[a-z]+;base64,/i, ''), 'base64');
    const mediaType = imageType(bytes);
    if (!mediaType) throw new ReferenceBoardError('The screenshot must be a PNG or JPEG image.');
    if (bytes.length > REFERENCE_LIMITS.screenshotBytes) throw new ReferenceBoardError('The screenshot exceeds the 16 MB limit.');
    screenshot = { bytes, mediaType };
  }
  return serialized(key, async () => {
    const board = await readReferenceBoard(files);
    if (board.items.length >= REFERENCE_LIMITS.items) throw new ReferenceBoardError(`The board holds at most ${REFERENCE_LIMITS.items} references; remove some first.`, 409, 'REFERENCE_BOARD_FULL');
    await ensureGitignore(files);
    const id = newId();
    const item: ReferenceItem = {
      id,
      url,
      title: cleanText(body.title, REFERENCE_LIMITS.title) || new URL(url).host,
      note: cleanText(body.note, REFERENCE_LIMITS.note),
      takes: normalizeReferenceTakes(body.takes),
      screenshot: null,
      outline: normalizeReferenceOutline(body.outline),
      capturedAt: new Date().toISOString(),
      source: body.source === 'cli' ? 'cli' : 'browser',
    };
    if (screenshot) {
      const file = `${REFERENCE_BOARD_FOLDER}/${id}.${screenshot.mediaType === 'image/png' ? 'png' : 'jpg'}`;
      await files.write(file, screenshot.bytes);
      item.screenshot = { file, sha256: sha256(screenshot.bytes), bytes: screenshot.bytes.length, mediaType: screenshot.mediaType };
    }
    await writeBoard(files, { ...board, items: [item, ...board.items] });
    return item;
  });
}

export async function updateReference(files: ReferenceFileAccess, key: string, id: string, body: Record<string, unknown>): Promise<ReferenceItem> {
  return serialized(key, async () => {
    const board = await readReferenceBoard(files);
    const item = board.items.find((entry) => entry.id === id);
    if (!item) throw new ReferenceBoardError(`No reference ${id} on this board.`, 404, 'REFERENCE_NOT_FOUND');
    if (body.title !== undefined) item.title = cleanText(body.title, REFERENCE_LIMITS.title) || item.title;
    if (body.note !== undefined) item.note = cleanText(body.note, REFERENCE_LIMITS.note);
    if (body.takes !== undefined) item.takes = normalizeReferenceTakes(body.takes);
    await writeBoard(files, board);
    return item;
  });
}

/** Changes one item under the board's write queue; the item is read again, so a concurrent edit is not lost. */
export async function updateReferenceItem(files: ReferenceFileAccess, key: string, id: string, mutate: (item: ReferenceItem) => void): Promise<ReferenceItem> {
  return serialized(key, async () => {
    const board = await readReferenceBoard(files);
    const item = board.items.find((entry) => entry.id === id);
    if (!item) throw new ReferenceBoardError(`No reference ${id} on this board.`, 404, 'REFERENCE_NOT_FOUND');
    mutate(item);
    await writeBoard(files, board);
    return item;
  });
}

export async function removeReference(files: ReferenceFileAccess, key: string, id: string): Promise<{ removed: string; files: string[] }> {
  return serialized(key, async () => {
    const board = await readReferenceBoard(files);
    const item = board.items.find((entry) => entry.id === id);
    if (!item) throw new ReferenceBoardError(`No reference ${id} on this board.`, 404, 'REFERENCE_NOT_FOUND');
    await writeBoard(files, { ...board, items: board.items.filter((entry) => entry.id !== id) });
    const removed: string[] = [];
    // Only the board's own files for this item, never a path the board file was edited to point at.
    const own = [item.screenshot?.file, item.flow?.file, item.flow?.screenshot, item.remake?.flow.file, item.remake?.flow.screenshot].filter((file): file is string => typeof file === 'string' && file.startsWith(`${REFERENCE_BOARD_FOLDER}/${id}.`));
    for (const file of own) {
      try { await files.remove(file); removed.push(file); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return { removed: id, files: removed };
  });
}

export async function applyReferences(files: ReferenceFileAccess, body: Record<string, unknown>): Promise<ReferenceApplyResponse> {
  const ids = Array.isArray(body.referenceIds) ? body.referenceIds.filter((id): id is string => typeof id === 'string') : [];
  if (ids.length === 0) throw new ReferenceBoardError('referenceIds must name at least one reference.');
  if (ids.length > REFERENCE_LIMITS.applyItems) throw new ReferenceBoardError(`At most ${REFERENCE_LIMITS.applyItems} references can be applied at once.`);
  const board = await readReferenceBoard(files);
  const includeScreenshot = body.includeScreenshot !== false;
  const items = await Promise.all([...new Set(ids)].map(async (id) => {
    const item = board.items.find((entry) => entry.id === id);
    if (!item) throw new ReferenceBoardError(`No reference ${id} on this board.`, 404, 'REFERENCE_NOT_FOUND');
    let screenshotState: ReferenceScreenshotState | undefined;
    if (item.screenshot && includeScreenshot) {
      const bytes = await files.read(item.screenshot.file).catch(() => null);
      screenshotState = !bytes ? 'missing' : sha256(bytes) === item.screenshot.sha256 ? 'verified' : 'changed';
    }
    return { ...item, ...(screenshotState ? { screenshotState } : {}) };
  }));
  const block = referenceApplyBlock(items, {
    ...(typeof body.target === 'string' ? { target: body.target } : {}),
    ...(typeof body.request === 'string' ? { request: body.request } : {}),
    ...(body.takes !== undefined ? { takes: normalizeReferenceTakes(body.takes) } : {}),
    includeScreenshot,
  });
  return {
    block,
    references: items.map((item) => item.id),
    screenshots: items.flatMap((item) => (item.screenshot && item.screenshotState ? [{ file: item.screenshot.file, state: item.screenshotState }] : [])),
  };
}
