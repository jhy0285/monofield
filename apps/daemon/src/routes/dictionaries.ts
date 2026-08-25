import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import ExcelJS from 'exceljs';
import type { Express, Request, Response } from 'express';
import type { DictionaryPreview } from '@open-design/contracts';
import type { RouteDeps } from '../server-context.js';
import { decodeMultipartFilename, sanitizeName } from '../projects.js';
import {
  addDictionaryVersion,
  createDictionaryLibrary,
  deleteDictionaryLibrary,
  getDictionaryLibrary,
  getDictionaryProjectSnapshot,
  getDictionaryVersion,
  insertDictionaryProjectSnapshot,
  listDictionaryLibraries,
  listDictionaryProjectSnapshots,
  renameDictionaryLibrary,
} from '../dictionaries/store.js';

export interface RegisterDictionaryRoutesDeps extends RouteDeps<
  'db' | 'http' | 'paths' | 'projectStore' | 'projectFiles'
> {}

const MAX_DICTIONARY_BYTES = 20 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(['csv', 'json', 'xlsx', 'xlsm']);
const dictionaryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DICTIONARY_BYTES },
});

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

function normalizedName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('dictionary name is required');
  const name = value.trim();
  if (name.length > 120) throw new Error('dictionary name must be 120 characters or less');
  return name;
}

function formatForFile(fileName: string): 'csv' | 'json' | 'xlsx' | 'xlsm' {
  const format = path.extname(fileName).slice(1).toLowerCase();
  if (!ALLOWED_FORMATS.has(format)) {
    throw new Error('dictionary files must be CSV, JSON, XLSX, or XLSM');
  }
  return format as 'csv' | 'json' | 'xlsx' | 'xlsm';
}

function previewFromRows(rows: unknown[][]): DictionaryPreview {
  const normalized = rows
    .filter((row) => row.some((cell) => String(cell ?? '').trim().length > 0))
    .slice(0, 9)
    .map((row) => row.slice(0, 12).map((cell) => String(cell ?? '')));
  const [header = [], ...body] = normalized;
  return { columns: header, rows: body.slice(0, 8) };
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function printableCell(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const record = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: unknown }> };
    if (typeof record.text === 'string') return record.text;
    if (Array.isArray(record.richText)) return record.richText.map((item) => String(item.text ?? '')).join('');
    if (record.result != null) return String(record.result);
  }
  return String(value);
}

async function previewDictionary(bytes: Buffer, format: ReturnType<typeof formatForFile>): Promise<DictionaryPreview> {
  if (format === 'csv') {
    const lines = bytes.toString('utf8').split(/\r?\n/).filter((line) => line.trim()).slice(0, 9);
    const first = lines[0] ?? '';
    const delimiter = first.includes('\t') ? '\t' : first.includes(';') && !first.includes(',') ? ';' : ',';
    return previewFromRows(lines.map((line) => splitDelimitedLine(line, delimiter)));
  }
  if (format === 'json') {
    try {
      const value = JSON.parse(bytes.toString('utf8')) as unknown;
      const entries = Array.isArray(value) ? value : Array.isArray((value as { data?: unknown[] })?.data)
        ? (value as { data: unknown[] }).data
        : [];
      if (entries.length === 0) return { columns: [], rows: [] };
      if (Array.isArray(entries[0])) return previewFromRows(entries as unknown[][]);
      const records = entries.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry));
      const columns = [...new Set(records.flatMap((record) => Object.keys(record)))].slice(0, 12);
      return { columns, rows: records.slice(0, 8).map((record) => columns.map((column) => printableCell(record[column]))) };
    } catch {
      return { columns: [], rows: [] };
    }
  }
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return { columns: [], rows: [] };
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length >= 9) return;
      rows.push(Array.from({ length: Math.min(row.cellCount, 12) }, (_unused, index) => printableCell(row.getCell(index + 1).value)));
    });
    return previewFromRows(rows);
  } catch {
    return { columns: [], rows: [] };
  }
}

function dictionaryDirectory(root: string, dictionaryId: string): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, dictionaryId);
  if (path.relative(resolvedRoot, target).startsWith('..') || path.isAbsolute(path.relative(resolvedRoot, target))) {
    throw new Error('invalid dictionary path');
  }
  return target;
}

function storageFilePath(root: string, dictionaryId: string, version: number, format: string): string {
  return path.join(dictionaryDirectory(root, dictionaryId), `v${version}.${format}`);
}

async function saveUpload(
  req: Request,
  dictionaryRoot: string,
  dictionaryId: string,
  version: number,
): Promise<{ fileName: string; format: ReturnType<typeof formatForFile>; filePath: string; size: number; preview: DictionaryPreview }> {
  if (!req.file?.buffer) throw new Error('dictionary file is required');
  const fileName = decodeMultipartFilename(req.file.originalname || 'dictionary');
  const format = formatForFile(fileName);
  const filePath = storageFilePath(dictionaryRoot, dictionaryId, version, format);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, req.file.buffer);
  return {
    fileName,
    format,
    filePath,
    size: req.file.size,
    preview: await previewDictionary(req.file.buffer, format),
  };
}

function uploadSingle(req: Request, res: Response): Promise<boolean> {
  return new Promise((resolve) => {
    dictionaryUpload.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        sendError(res, 400, 'DICTIONARY_UPLOAD_FAILED', err.code === 'LIMIT_FILE_SIZE' ? 'dictionary file is too large' : err.message);
        resolve(false);
        return;
      }
      if (err) {
        sendError(res, 400, 'DICTIONARY_UPLOAD_FAILED', err instanceof Error ? err.message : String(err));
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

export function registerDictionaryRoutes(app: Express, ctx: RegisterDictionaryRoutesDeps): void {
  const { db } = ctx;
  const { RUNTIME_DATA_DIR, PROJECTS_DIR } = ctx.paths;
  const { getProject } = ctx.projectStore;
  const { writeProjectFile } = ctx.projectFiles;
  const dictionaryRoot = path.join(RUNTIME_DATA_DIR, 'dictionary-library');

  app.get('/api/dictionaries', (_req, res) => {
    res.json({ dictionaries: listDictionaryLibraries(db) });
  });

  app.get('/api/dictionaries/:dictionaryId', (req, res) => {
    const dictionary = getDictionaryLibrary(db, req.params.dictionaryId);
    if (!dictionary) return sendError(res, 404, 'DICTIONARY_NOT_FOUND', 'dictionary not found');
    res.json({ dictionary });
  });

  app.post('/api/dictionaries', async (req, res) => {
    if (!await uploadSingle(req, res)) return;
    const dictionaryId = randomUUID();
    try {
      const upload = await saveUpload(req, dictionaryRoot, dictionaryId, 1);
      const dictionary = createDictionaryLibrary(db, {
        id: dictionaryId,
        name: normalizedName(req.body?.name),
        version: upload,
      });
      res.status(201).json({ dictionary });
    } catch (error) {
      await rm(dictionaryDirectory(dictionaryRoot, dictionaryId), { recursive: true, force: true }).catch(() => {});
      sendError(res, 400, 'DICTIONARY_CREATE_FAILED', error instanceof Error ? error.message : String(error));
    }
  });

  app.post('/api/dictionaries/:dictionaryId/versions', async (req, res) => {
    if (!await uploadSingle(req, res)) return;
    const dictionary = getDictionaryLibrary(db, req.params.dictionaryId);
    if (!dictionary) return sendError(res, 404, 'DICTIONARY_NOT_FOUND', 'dictionary not found');
    const version = dictionary.latestVersion.version + 1;
    let upload: Awaited<ReturnType<typeof saveUpload>> | null = null;
    try {
      upload = await saveUpload(req, dictionaryRoot, dictionary.id, version);
      const created = addDictionaryVersion(db, dictionary.id, upload);
      if (!created) throw new Error('dictionary not found');
      res.status(201).json({ version: created });
    } catch (error) {
      if (upload) await rm(upload.filePath, { force: true }).catch(() => {});
      sendError(res, 400, 'DICTIONARY_VERSION_CREATE_FAILED', error instanceof Error ? error.message : String(error));
    }
  });

  app.patch('/api/dictionaries/:dictionaryId', (req, res) => {
    try {
      const dictionary = renameDictionaryLibrary(db, req.params.dictionaryId, normalizedName(req.body?.name));
      if (!dictionary) return sendError(res, 404, 'DICTIONARY_NOT_FOUND', 'dictionary not found');
      res.json({ dictionary });
    } catch (error) {
      sendError(res, 400, 'DICTIONARY_RENAME_FAILED', error instanceof Error ? error.message : String(error));
    }
  });

  app.delete('/api/dictionaries/:dictionaryId', async (req, res) => {
    const dictionary = getDictionaryLibrary(db, req.params.dictionaryId);
    if (!dictionary) return sendError(res, 404, 'DICTIONARY_NOT_FOUND', 'dictionary not found');
    const deleted = deleteDictionaryLibrary(db, dictionary.id);
    if (!deleted) return sendError(res, 404, 'DICTIONARY_NOT_FOUND', 'dictionary not found');
    await rm(dictionaryDirectory(dictionaryRoot, dictionary.id), { recursive: true, force: true }).catch(() => {});
    res.json({ ok: true });
  });

  app.get('/api/projects/:projectId/dictionaries', (req, res) => {
    if (!getProject(db, req.params.projectId)) {
      return sendError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
    }
    res.json({ snapshots: listDictionaryProjectSnapshots(db, req.params.projectId) });
  });

  app.post('/api/projects/:projectId/dictionaries/attach', async (req, res) => {
    const project = getProject(db, req.params.projectId);
    if (!project) return sendError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
    const versionId = typeof req.body?.versionId === 'string' ? req.body.versionId : '';
    const version = getDictionaryVersion(db, versionId);
    if (!version) return sendError(res, 404, 'DICTIONARY_VERSION_NOT_FOUND', 'dictionary version not found');
    const existing = getDictionaryProjectSnapshot(db, project.id, version.id);
    if (existing) return res.json({ snapshot: existing });
    const dictionary = getDictionaryLibrary(db, version.dictionaryId);
    if (!dictionary) return sendError(res, 404, 'DICTIONARY_NOT_FOUND', 'dictionary not found');
    try {
      const bytes = await readFile(version.filePath);
      const extension = path.extname(version.fileName) || `.${version.format}`;
      const snapshotName = `${sanitizeName(dictionary.name)}-v${version.version}-${version.id.slice(0, 8)}${extension}`;
      const projectPath = `_monofield/dictionaries/${snapshotName}`;
      await writeProjectFile(PROJECTS_DIR, project.id, projectPath, bytes, { overwrite: false }, project.metadata);
      const snapshot = insertDictionaryProjectSnapshot(db, {
        projectId: project.id,
        dictionaryId: dictionary.id,
        versionId: version.id,
        dictionaryName: dictionary.name,
        version: version.version,
        path: projectPath,
      });
      res.status(201).json({ snapshot });
    } catch (error) {
      sendError(res, 400, 'DICTIONARY_ATTACH_FAILED', error instanceof Error ? error.message : String(error));
    }
  });
}
