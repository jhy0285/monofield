import { readFile, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import {
  createInterfaceSpecDocumentFromManualDraft,
  parseInterfaceSpecDocument,
  parseScreenSpecDocument,
} from '@open-design/contracts';
import { renderInterfaceSpecXlsx } from './doc-renderers/interface-spec/render-xlsx.js';
import { renderInterfaceSpecHtml } from './doc-renderers/interface-spec/render-html.js';
import { renderScreenSpecPptx } from './doc-renderers/screen-spec/render-pptx.js';
import { renderScreenSpecHtml } from './doc-renderers/screen-spec/render-html.js';

const USAGE = `Usage:
  od docs create-manual-interface-spec --input <manual-draft.json> [--out <interface-spec.json>]
  od docs render-interface-spec  --input <interface-spec.json> [--out <workbook.xlsx>] [--style <style.json>]
  od docs preview-interface-spec --input <interface-spec.json> [--out <preview.html>]
  od docs render-screen-spec     --input <screen-spec.json>    [--out <deck.pptx>]
  od docs preview-screen-spec    --input <screen-spec.json>    [--out <preview.html>]

Renders a document JSON into its Korean SI-style deliverable (interface-spec
→ XLSX workbook, screen-spec → PPTX deck). Prints a JSON result on stdout.
Schema errors are printed as "<path>: <message>" lines on stderr so a
collecting agent can self-correct. screen-spec screens may reference images
by project-relative path via "imageRef"; they are inlined before rendering.`;

interface DocsCliResult {
  exitCode: number;
}

export async function runDocsCli(args: string[]): Promise<DocsCliResult> {
  const [command, ...rest] = args;
  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return { exitCode: command ? 0 : 1 };
  }
  if (
    command !== 'create-manual-interface-spec' &&
    command !== 'render-interface-spec' &&
    command !== 'preview-interface-spec' &&
    command !== 'render-screen-spec' &&
    command !== 'preview-screen-spec'
  ) {
    console.error(`Unknown docs command: ${command}`);
    console.log(USAGE);
    return { exitCode: 1 };
  }

  let inputPath: string | undefined;
  let outPath: string | undefined;
  let stylePath: string | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag === '--input') inputPath = rest[++i];
    else if (flag === '--out') outPath = rest[++i];
    else if (flag === '--style') stylePath = rest[++i];
    else {
      console.error(`Unknown flag: ${flag}`);
      return { exitCode: 1 };
    }
  }
  if (!inputPath) {
    console.error(
      command === 'create-manual-interface-spec'
        ? 'Missing required --input <manual-draft.json>'
        : 'Missing required --input <interface-spec.json>',
    );
    return { exitCode: 1 };
  }

  let raw: string;
  try {
    raw = await readFile(inputPath, 'utf8');
  } catch (err) {
    console.error(`Cannot read ${inputPath}: ${(err as Error).message}`);
    return { exitCode: 1 };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    console.error(`Invalid JSON in ${inputPath}: ${(err as Error).message}`);
    return { exitCode: 1 };
  }

  const inputDir = nodePath.dirname(nodePath.resolve(inputPath));

  if (command === 'create-manual-interface-spec') {
    const created = createInterfaceSpecDocumentFromManualDraft(json);
    if (!created.ok) {
      console.error(created.error);
      return { exitCode: 1 };
    }
    const target = outPath ?? nodePath.join(inputDir, 'interface-spec.json');
    await writeFile(target, `${JSON.stringify(created.doc, null, 2)}\n`, 'utf8');
    console.log(
      JSON.stringify(
        {
          output: nodePath.resolve(target),
          endpointCount: created.doc.endpoints.length,
          warnings: created.issues.map((issue) => issue.message),
        },
        null,
        2,
      ),
    );
    return { exitCode: 0 };
  }

  if (command === 'render-screen-spec' || command === 'preview-screen-spec') {
    const isPreview = command === 'preview-screen-spec';
    const parsed = parseScreenSpecDocument(json);
    if (!parsed.ok) {
      console.error(parsed.error);
      return { exitCode: 1 };
    }
    const fatal = parsed.issues.filter((issue) => issue.severity === 'fatal');
    for (const issue of parsed.issues) {
      console.error(`${issue.severity}: ${issue.message}`);
    }
    // Preview never blocks on validation (renders a banner); export does.
    if (!isPreview && fatal.length > 0) return { exitCode: 1 };

    // Inline project-relative images for both preview (embed <img>) and export.
    for (const screen of parsed.doc.screens) {
      if (screen.imageDataUrl || !screen.imageRef) continue;
      const imagePath = nodePath.resolve(inputDir, screen.imageRef);
      try {
        const bytes = await readFile(imagePath);
        const ext = nodePath.extname(imagePath).toLowerCase().replace('.', '') || 'png';
        const mime = ext === 'jpg' ? 'jpeg' : ext;
        screen.imageDataUrl = `data:image/${mime};base64,${bytes.toString('base64')}`;
      } catch (err) {
        console.error(
          `warning: cannot read imageRef "${screen.imageRef}" for screen "${screen.id}": ${(err as Error).message}`,
        );
      }
    }

    if (isPreview) {
      const html = renderScreenSpecHtml(parsed.doc);
      const target =
        outPath ?? nodePath.join(inputDir, `${parsed.doc.name}_screen_spec_preview.html`);
      await writeFile(target, html, 'utf8');
      console.log(
        JSON.stringify(
          {
            output: nodePath.resolve(target),
            screenCount: parsed.doc.screens.length,
            warnings: parsed.issues.map((issue) => issue.message),
          },
          null,
          2,
        ),
      );
      return { exitCode: 0 };
    }

    const target = outPath ?? nodePath.join(inputDir, `${parsed.doc.name}_screen_spec.pptx`);
    const result = await renderScreenSpecPptx(parsed.doc);
    await writeFile(target, result.buffer);
    console.log(
      JSON.stringify(
        {
          output: nodePath.resolve(target),
          screenCount: result.screenCount,
          warnings: parsed.issues.map((issue) => issue.message),
        },
        null,
        2,
      ),
    );
    return { exitCode: 0 };
  }

  const parsed = parseInterfaceSpecDocument(json);
  if (!parsed.ok) {
    console.error(parsed.error);
    return { exitCode: 1 };
  }

  if (command === 'preview-interface-spec') {
    // Preview never blocks on validation — fatal issues render as a banner so
    // the user still sees the in-progress workbook while fixing them.
    const html = renderInterfaceSpecHtml(parsed.doc);
    const target =
      outPath ??
      nodePath.join(inputDir, `${parsed.doc.source.codebaseName}_api_interface_preview.html`);
    await writeFile(target, html, 'utf8');
    console.log(
      JSON.stringify(
        {
          output: nodePath.resolve(target),
          endpointCount: parsed.doc.endpoints.length,
          warnings: parsed.issues.map((issue) => issue.message),
        },
        null,
        2,
      ),
    );
    return { exitCode: 0 };
  }

  const fatal = parsed.issues.filter((issue) => issue.severity === 'fatal');
  for (const issue of parsed.issues) {
    console.error(`${issue.severity}: ${issue.message}`);
  }
  if (fatal.length > 0) return { exitCode: 1 };

  let style: import('./doc-renderers/interface-spec/preset-data.js').InterfaceSpecStyleOverride | undefined;
  if (stylePath) {
    try {
      style = JSON.parse(await readFile(stylePath, 'utf8'));
    } catch (err) {
      console.error(`Cannot read --style ${stylePath}: ${(err as Error).message}`);
      return { exitCode: 1 };
    }
  }

  const target =
    outPath ??
    nodePath.join(inputDir, `${parsed.doc.source.codebaseName}_api_interface.xlsx`);
  const result = await renderInterfaceSpecXlsx(parsed.doc, style ? { style } : {});
  await writeFile(target, result.buffer);
  console.log(
    JSON.stringify(
      {
        output: nodePath.resolve(target),
        endpointCount: result.endpointCount,
        sheetTitles: result.sheetTitles,
        warnings: parsed.issues.map((issue) => issue.message),
      },
      null,
      2,
    ),
  );
  return { exitCode: 0 };
}
