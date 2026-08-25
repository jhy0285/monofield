import nodePath from 'node:path';

import type { Express, Response } from 'express';
import {
  parseInterfaceSpecDocument,
  parseScreenSpecDocument,
  type ScreenSpecDocument,
  type StructuredDocumentRenderAction,
  type StructuredDocumentRenderErrorResponse,
  type StructuredDocumentRenderRequest,
  type StructuredDocumentRenderResponse,
} from '@open-design/contracts';
import { getProject } from '../db.js';
import { renderInterfaceSpecHtml } from '../doc-renderers/interface-spec/render-html.js';
import { renderInterfaceSpecXlsx } from '../doc-renderers/interface-spec/render-xlsx.js';
import { renderScreenSpecHtml } from '../doc-renderers/screen-spec/render-html.js';
import { renderScreenSpecPptx } from '../doc-renderers/screen-spec/render-pptx.js';
import type { RouteDeps } from '../server-context.js';

export interface RegisterDocumentRenderRoutesDeps
  extends RouteDeps<'db' | 'http' | 'paths' | 'projectFiles'> {}

type ProjectRecord = { id: string; metadata?: Record<string, unknown> | null };

function sendDocumentError(
  res: Response,
  status: number,
  body: StructuredDocumentRenderErrorResponse,
): void {
  res.status(status).json(body);
}

function outputStem(value: string, fallback: string): string {
  const normalized = value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/[._-]+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function projectRawUrl(projectId: string, filePath: string): string {
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  return `/api/projects/${encodeURIComponent(projectId)}/raw/${encodedPath}`;
}

function normalizedProjectPath(value: string): string | null {
  const normalized = value.replace(/\\/g, '/');
  if (!normalized || nodePath.posix.isAbsolute(normalized)) return null;
  const resolved = nodePath.posix.normalize(normalized);
  if (resolved === '..' || resolved.startsWith('../')) return null;
  return resolved;
}

async function inlineScreenImages(
  doc: ScreenSpecDocument,
  inputFile: string,
  project: ProjectRecord,
  deps: RegisterDocumentRenderRoutesDeps,
): Promise<ScreenSpecDocument> {
  const inputDir = nodePath.posix.dirname(inputFile.replace(/\\/g, '/'));
  const screens = await Promise.all(doc.screens.map(async (screen) => {
    if (screen.imageDataUrl || !screen.imageRef) return screen;
    const relative = normalizedProjectPath(nodePath.posix.join(inputDir, screen.imageRef));
    if (!relative) return screen;
    try {
      const file = await deps.projectFiles.readProjectFile(
        deps.paths.PROJECTS_DIR,
        project.id,
        relative,
        project.metadata ?? undefined,
      );
      const extension = nodePath.posix.extname(relative).toLowerCase();
      const mime = extension === '.jpg' || extension === '.jpeg'
        ? 'image/jpeg'
        : extension === '.webp'
          ? 'image/webp'
          : 'image/png';
      return { ...screen, imageDataUrl: `data:${mime};base64,${file.buffer.toString('base64')}` };
    } catch {
      return screen;
    }
  }));
  return { ...doc, screens };
}

async function writeOutput(
  deps: RegisterDocumentRenderRoutesDeps,
  project: ProjectRecord,
  outputFile: string,
  content: Buffer | string,
  artifactManifest?: Record<string, unknown>,
): Promise<void> {
  await deps.projectFiles.writeProjectFile(
    deps.paths.PROJECTS_DIR,
    project.id,
    outputFile,
    Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
    { overwrite: true, artifactManifest: artifactManifest ?? null },
    project.metadata ?? undefined,
  );
}

export function registerDocumentRenderRoutes(
  app: Express,
  deps: RegisterDocumentRenderRoutesDeps,
): void {
  app.post(
    '/api/projects/:id/documents/render',
    deps.http.requireLocalDaemonRequest,
    async (req, res) => {
      const project = getProject(deps.db, req.params.id) as ProjectRecord | null;
      if (!project) {
        sendDocumentError(res, 404, {
          ok: false,
          code: 'PROJECT_NOT_FOUND',
          message: 'Project not found.',
        });
        return;
      }

      const body = (req.body ?? {}) as Partial<StructuredDocumentRenderRequest>;
      const inputFile = typeof body.inputFile === 'string'
        ? normalizedProjectPath(body.inputFile)
        : null;
      const action: StructuredDocumentRenderAction | null =
        body.action === 'preview' || body.action === 'export' ? body.action : null;
      if (!inputFile || !action) {
        sendDocumentError(res, 400, {
          ok: false,
          code: 'INVALID_DOCUMENT',
          message: 'inputFile and action are required.',
        });
        return;
      }

      let raw: string;
      try {
        const file = await deps.projectFiles.readProjectFile(
          deps.paths.PROJECTS_DIR,
          project.id,
          inputFile,
          project.metadata ?? undefined,
        );
        raw = file.buffer.toString('utf8');
      } catch (error) {
        sendDocumentError(res, 404, {
          ok: false,
          code: 'DOCUMENT_NOT_FOUND',
          message: error instanceof Error ? error.message : 'Document not found.',
        });
        return;
      }

      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch (error) {
        sendDocumentError(res, 422, {
          ok: false,
          code: 'INVALID_DOCUMENT',
          message: error instanceof Error ? error.message : 'The document is not valid JSON.',
        });
        return;
      }

      try {
        const kind = (json as { kind?: unknown } | null)?.kind;
        if (kind === 'interface-spec') {
          const parsed = parseInterfaceSpecDocument(json);
          if (!parsed.ok) {
            sendDocumentError(res, 422, { ok: false, code: 'INVALID_DOCUMENT', message: parsed.error });
            return;
          }
          const fatal = parsed.issues.filter((issue) => issue.severity === 'fatal');
          if (action === 'export' && fatal.length > 0) {
            sendDocumentError(res, 422, {
              ok: false,
              code: 'DOCUMENT_VALIDATION_FAILED',
              message: 'Resolve fatal validation issues before exporting.',
              issues: parsed.issues,
            });
            return;
          }
          const stem = outputStem(parsed.doc.cover.docName || parsed.doc.source.codebaseName, 'interface-spec');
          const outputFile = action === 'preview'
            ? `${stem}_interface_spec_preview.html`
            : `${stem}_interface_spec.xlsx`;
          if (action === 'preview') {
            await writeOutput(deps, project, outputFile, renderInterfaceSpecHtml(parsed.doc), {
              version: 1,
              kind: 'html',
              title: `${stem} interface specification preview`,
              entry: outputFile,
              renderer: 'html',
              status: 'complete',
              exports: ['html', 'pdf', 'zip'],
              primary: true,
              supportingFiles: [inputFile],
              metadata: { documentKind: 'interface-spec', sourceFile: inputFile },
            });
          } else {
            const rendered = await renderInterfaceSpecXlsx(parsed.doc);
            await writeOutput(deps, project, outputFile, rendered.buffer);
          }
          const response: StructuredDocumentRenderResponse = {
            ok: true,
            kind: 'interface-spec',
            action,
            inputFile,
            outputFile,
            outputUrl: projectRawUrl(project.id, outputFile),
            itemCount: parsed.doc.endpoints.length,
            issues: parsed.issues,
          };
          res.json(response);
          return;
        }

        if (kind === 'screen-spec') {
          const parsed = parseScreenSpecDocument(json);
          if (!parsed.ok) {
            sendDocumentError(res, 422, { ok: false, code: 'INVALID_DOCUMENT', message: parsed.error });
            return;
          }
          const fatal = parsed.issues.filter((issue) => issue.severity === 'fatal');
          if (action === 'export' && fatal.length > 0) {
            sendDocumentError(res, 422, {
              ok: false,
              code: 'DOCUMENT_VALIDATION_FAILED',
              message: 'Resolve fatal validation issues before exporting.',
              issues: parsed.issues,
            });
            return;
          }
          const renderable = await inlineScreenImages(parsed.doc, inputFile, project, deps);
          const stem = outputStem(parsed.doc.name, 'screen-spec');
          const outputFile = action === 'preview'
            ? `${stem}_screen_spec_preview.html`
            : `${stem}_screen_spec.pptx`;
          if (action === 'preview') {
            await writeOutput(deps, project, outputFile, renderScreenSpecHtml(renderable), {
              version: 1,
              kind: 'html',
              title: `${stem} screen specification preview`,
              entry: outputFile,
              renderer: 'html',
              status: 'complete',
              exports: ['html', 'pdf', 'zip'],
              primary: true,
              supportingFiles: [inputFile],
              metadata: { documentKind: 'screen-spec', sourceFile: inputFile },
            });
          } else {
            const rendered = await renderScreenSpecPptx(renderable);
            await writeOutput(deps, project, outputFile, rendered.buffer);
          }
          const response: StructuredDocumentRenderResponse = {
            ok: true,
            kind: 'screen-spec',
            action,
            inputFile,
            outputFile,
            outputUrl: projectRawUrl(project.id, outputFile),
            itemCount: parsed.doc.screens.length,
            issues: parsed.issues,
          };
          res.json(response);
          return;
        }

        sendDocumentError(res, 422, {
          ok: false,
          code: 'INVALID_DOCUMENT',
          message: 'Only interface-spec and screen-spec documents can be rendered.',
        });
      } catch (error) {
        sendDocumentError(res, 500, {
          ok: false,
          code: 'DOCUMENT_RENDER_FAILED',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );
}
