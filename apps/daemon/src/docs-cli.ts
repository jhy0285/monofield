import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
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
  monofield docs create-manual-interface-spec --input <manual-draft.json> [--out <interface-spec.json>]
  monofield docs render-interface-spec  --input <interface-spec.json> [--out <workbook.xlsx>] [--style <style.json>]
  monofield docs preview-interface-spec --input <interface-spec.json> [--out <preview.html>]
  monofield docs render-screen-spec     --input <screen-spec.json>    [--out <deck.pptx>]
  monofield docs preview-screen-spec    --input <screen-spec.json>    [--out <preview.html>]

Renders a document JSON into its Korean SI-style deliverable (interface-spec
→ XLSX workbook, screen-spec → PPTX deck). Prints a JSON result on stdout.
Schema errors are printed as "<path>: <message>" lines on stderr so a
collecting agent can self-correct. screen-spec screens may reference images
by project-relative path via "imageRef"; they are inlined before rendering.`;

interface DocsCliResult {
  exitCode: number;
}

const MAX_SCREEN_SPEC_IMAGE_BYTES = 20 * 1024 * 1024;
const SCREEN_SPEC_IMAGE_MIME_BY_EXTENSION = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

function pathIsInside(rootPath: string, candidatePath: string): boolean {
  const relative = nodePath.relative(rootPath, candidatePath);
  return relative !== '..' && !relative.startsWith(`..${nodePath.sep}`) && !nodePath.isAbsolute(relative);
}

function detectedScreenSpecImageMime(bytes: Buffer): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp';
  return null;
}

async function readScreenSpecImage(
  inputDir: string,
  realInputDir: string,
  imageRef: string,
): Promise<string> {
  const extension = nodePath.extname(imageRef).toLowerCase();
  const expectedMime = SCREEN_SPEC_IMAGE_MIME_BY_EXTENSION.get(extension);
  if (!expectedMime) {
    throw new Error('only .png, .jpg, .jpeg, and .webp images are supported');
  }

  const resolvedPath = nodePath.resolve(inputDir, imageRef);
  if (!pathIsInside(inputDir, resolvedPath)) {
    throw new Error('the path must stay inside the screen-spec input directory');
  }

  const realImagePath = await realpath(resolvedPath);
  if (!pathIsInside(realInputDir, realImagePath)) {
    throw new Error('the resolved file must stay inside the screen-spec input directory');
  }

  const info = await stat(realImagePath);
  if (!info.isFile()) throw new Error('the referenced image is not a regular file');
  if (info.size > MAX_SCREEN_SPEC_IMAGE_BYTES) {
    throw new Error(`the referenced image exceeds ${MAX_SCREEN_SPEC_IMAGE_BYTES} bytes`);
  }

  const bytes = await readFile(realImagePath);
  if (bytes.length > MAX_SCREEN_SPEC_IMAGE_BYTES) {
    throw new Error(`the referenced image exceeds ${MAX_SCREEN_SPEC_IMAGE_BYTES} bytes`);
  }
  const detectedMime = detectedScreenSpecImageMime(bytes);
  if (detectedMime !== expectedMime) {
    throw new Error(`the file contents do not match the ${extension} image type`);
  }
  return `data:${detectedMime};base64,${bytes.toString('base64')}`;
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
        : command === 'render-screen-spec' || command === 'preview-screen-spec'
          ? 'Missing required --input <screen-spec.json>'
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
    // Resolve both the lexical and real paths so `..` segments and symlink
    // targets cannot escape the directory containing the screen-spec JSON.
    const realInputDir = await realpath(inputDir);
    let imageRefFailed = false;
    for (const screen of parsed.doc.screens) {
      if (screen.imageDataUrl || !screen.imageRef) continue;
      try {
        screen.imageDataUrl = await readScreenSpecImage(inputDir, realInputDir, screen.imageRef);
      } catch (err) {
        imageRefFailed = true;
        console.error(
          `error: cannot use imageRef "${screen.imageRef}" for screen "${screen.id}": ${(err as Error).message}`,
        );
      }
    }
    if (imageRefFailed) return { exitCode: 1 };

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
