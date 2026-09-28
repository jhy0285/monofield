import path from 'node:path';
import { renderMarkdownToSafeHtml } from '@open-design/contracts';

import type {
  DesktopExportArtifactFormat,
  DesktopExportArtifactImageFormat,
  DesktopExportArtifactInput,
  DesktopExportPdfInput,
} from '@open-design/sidecar-proto';

import { readProjectFile } from './projects.js';

export interface BuildDesktopPdfExportInputOptions {
  daemonUrl: string;
  deck?: boolean;
  fileName: string;
  projectId: string;
  projectsRoot: string;
  title?: string;
}

export async function buildDesktopPdfExportInput(
  options: BuildDesktopPdfExportInputOptions,
): Promise<DesktopExportPdfInput> {
  const file = await readProjectFile(options.projectsRoot, options.projectId, options.fileName);
  const title = displayTitle(options.title, options.fileName);
  return {
    baseHref: rawBaseHref(options.daemonUrl, options.projectId, options.fileName),
    deck: options.deck === true,
    defaultFilename: `${safeFilename(title, 'artifact')}.pdf`,
    html: exportHtml(file.buffer.toString('utf8'), options.fileName),
    title,
  };
}

export interface BuildDesktopArtifactExportInputOptions {
  daemonUrl: string;
  deck?: boolean;
  fileName: string;
  format: DesktopExportArtifactFormat;
  imageFormat?: DesktopExportArtifactImageFormat;
  projectId: string;
  projectsRoot: string;
  title?: string;
  width?: number;
  height?: number;
}

export async function buildDesktopArtifactExportInput(
  options: BuildDesktopArtifactExportInputOptions,
): Promise<DesktopExportArtifactInput> {
  const file = await readProjectFile(options.projectsRoot, options.projectId, options.fileName);
  const title = displayTitle(options.title, options.fileName);
  return {
    baseHref: rawBaseHref(options.daemonUrl, options.projectId, options.fileName),
    deck: options.deck === true,
    format: options.format,
    html: exportHtml(file.buffer.toString('utf8'), options.fileName),
    title,
    ...(options.imageFormat ? { imageFormat: options.imageFormat } : {}),
    ...(options.width ? { width: options.width } : {}),
    ...(options.height ? { height: options.height } : {}),
  };
}

function exportHtml(content: string, fileName: string): string {
  if (!/\.(md|markdown)$/i.test(fileName)) return content;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 18mm; }
    body { font-family: Arial, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; font-size: 14px; line-height: 1.7; color: #171717; margin: 32px; overflow-wrap: anywhere; }
    h1, h2, h3 { line-height: 1.3; break-after: avoid; }
    h1 { font-size: 28px; } h2 { font-size: 21px; margin-top: 28px; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    th, td { border: 1px solid #ccc; padding: 9px 12px; text-align: left; }
    th { background: #f3f3f3; } tr, pre, blockquote { break-inside: avoid; }
    pre { white-space: pre-wrap; padding: 12px; background: #f5f5f5; }
    blockquote { border-left: 3px solid #ccc; padding-left: 16px; margin-left: 0; }
    @media print { body { margin: 0; } }
  </style></head><body>${renderMarkdownToSafeHtml(content)}</body></html>`;
}

function displayTitle(title: string | undefined, fileName: string): string {
  if (typeof title === 'string' && title.trim().length > 0) return title.trim();
  const base = path.posix.basename(fileName);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base || 'artifact';
}

function rawBaseHref(daemonUrl: string, projectId: string, fileName: string): string {
  const dir = path.posix.dirname(fileName.replace(/^\/+/, ''));
  const safeProjectId = encodeURIComponent(projectId);
  const rawBase = `${daemonUrl.replace(/\/+$/, '')}/api/projects/${safeProjectId}/raw/`;
  if (!dir || dir === '.') return rawBase;
  return `${rawBase}${encodePathSegments(dir)}/`;
}

function encodePathSegments(value: string): string {
  return value
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function safeFilename(name: string, fallback: string): string {
  const slug = (name || fallback)
    .replace(/[^\w.\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}
