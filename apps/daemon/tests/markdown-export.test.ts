import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { buildDesktopArtifactExportInput, buildDesktopPdfExportInput } from '../src/pdf-export.js';

let root = '';
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

it('renders Markdown headings and tables for PDF and image exports and escapes raw HTML', async () => {
  root = await mkdtemp(path.join(tmpdir(), 'markdown-export-'));
  await mkdir(path.join(root, 'project'));
  await writeFile(path.join(root, 'project', 'report.md'), '# 주간 보고\n\n| 작업 | 상태 |\n| --- | --- |\n| 검토 | 완료 |\n\n<script>alert(1)</script>');
  const options = { projectsRoot: root, projectId: 'project', fileName: 'report.md', daemonUrl: 'http://localhost:17456' };
  for (const input of [await buildDesktopPdfExportInput(options), await buildDesktopArtifactExportInput({ ...options, format: 'image' })]) {
    expect(input.html).toContain('<h1>주간 보고</h1>');
    expect(input.html).toContain('<th>작업</th>');
    expect(input.html).toContain('<td>완료</td>');
    expect(input.html).not.toContain('<script>');
    expect(input.html).toContain('&lt;script&gt;');
  }
});
