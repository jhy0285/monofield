import JSZip from 'jszip';
import PptxGenJSModule from 'pptxgenjs';
import type {
  ScreenSpecCallout,
  ScreenSpecCalloutRelation,
  ScreenSpecDocument,
  ScreenSpecScreen,
} from '@open-design/contracts';
import { validateScreenSpecDocument } from '@open-design/contracts';
import {
  PPTX_LAYOUT,
  PPTX_THEME,
  fitContainBox,
  readImageSizeFromDataUrl,
  type SlideBox,
} from './preset-data.js';

/**
 * Deterministic ScreenSpecDocument → PPTX renderer.
 *
 * Ported from Screen Spec Studio (wireFrame repo, renderers/pptx/
 * renderPptx.ts) with two adaptations for the Open Docs daemon:
 * - runs in Node (image sizes parsed from data-URL bytes, output is a
 *   Buffer instead of a browser Blob), and
 * - renders one slide per entry in `document.screens` instead of a single
 *   spec per file.
 */

// pptxgenjs ships a CJS runtime with ESM-style type declarations; under
// NodeNext the default import is typed as the module namespace, so unwrap
// the constructor from `.default` with a runtime fallback.
type PptxGenJSClass = typeof PptxGenJSModule.default;
const PptxGenJS: PptxGenJSClass =
  (PptxGenJSModule as { default?: PptxGenJSClass }).default ??
  (PptxGenJSModule as unknown as PptxGenJSClass);

type Presentation = InstanceType<PptxGenJSClass>;
type Slide = ReturnType<Presentation['addSlide']>;
type TableCell = ReturnType<typeof labelCell> | ReturnType<typeof valueCell>;
type TableRow = TableCell[];
interface SlidePoint {
  x: number;
  y: number;
}

const MARKER_SIZE_INCH_PER_PIXEL = PPTX_LAYOUT.marker.size / 30;
const LINE_WIDTH_POINT_PER_PIXEL = 2 / 3;
const MIN_LINE_SPAN = 0.001;

export interface RenderScreenSpecPptxResult {
  buffer: Buffer;
  screenCount: number;
}

export class ScreenSpecRenderError extends Error {
  constructor(
    message: string,
    readonly issues: ReturnType<typeof validateScreenSpecDocument>,
  ) {
    super(message);
    this.name = 'ScreenSpecRenderError';
  }
}

export async function renderScreenSpecPptx(
  doc: ScreenSpecDocument,
): Promise<RenderScreenSpecPptxResult> {
  const issues = validateScreenSpecDocument(doc);
  const fatal = issues.filter((issue) => issue.severity === 'fatal');
  if (fatal.length > 0) {
    throw new ScreenSpecRenderError(
      `screen-spec document has ${fatal.length} fatal issue(s): ${fatal
        .map((issue) => issue.message)
        .join(' / ')}`,
      issues,
    );
  }

  const first = doc.screens[0];
  const pptx = new PptxGenJS();
  pptx.layout = PPTX_LAYOUT.name;
  pptx.author = first?.author || 'Open Docs';
  pptx.company = first?.companyName || 'Open Docs';
  pptx.subject = 'Screen specification';
  pptx.title = doc.name;
  pptx.theme = {
    headFontFace: PPTX_THEME.fonts.head,
    bodyFontFace: PPTX_THEME.fonts.body,
  };

  for (const screen of doc.screens) {
    const slide = pptx.addSlide();
    slide.background = { color: PPTX_THEME.colors.background };

    renderMetadataTable(slide, screen);
    const fittedImageBox = renderImageRegion(slide, screen);
    renderCalloutRelations(slide, screen, fittedImageBox);
    renderMarkers(slide, screen, fittedImageBox);
    renderDescriptionTable(slide, screen);
    renderCheckpointBox(slide, screen);
    renderFooter(slide, screen);
  }

  const raw = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  const buffer = await normalizePptxForPowerPoint(raw);
  return { buffer, screenCount: doc.screens.length };
}

function renderMetadataTable(slide: Slide, screen: ScreenSpecScreen): void {
  const rows = [
    ...buildLevelRows(screen.levels),
    [
      labelCell('화면ID/명'),
      valueCell(`${screen.id || '-'} / ${screen.screenName || '-'}`),
      labelCell('Version'),
      valueCell(screen.version),
      labelCell('Date'),
      valueCell(screen.date),
    ],
    [labelCell('개요'), valueCell(screen.overview, 5, 7.3)],
    [
      labelCell('Screen Path'),
      valueCell(screen.screenPath, 3, 7.3),
      labelCell('Author'),
      valueCell(screen.author, 1, 7.3),
    ],
  ];

  slide.addTable(rows as never, {
    ...PPTX_LAYOUT.metadata,
    border: tableBorder(PPTX_THEME.colors.border),
    colW: [0.85, 2.1, 0.85, 2.1, 0.85, 2.1],
    rowH: rows.map((row) => (row.length === 2 ? 0.42 : 0.3)),
    margin: 0.05,
    fontFace: PPTX_THEME.fonts.body,
    fontSize: 8,
    color: PPTX_THEME.colors.text,
    valign: 'middle',
  });
}

function buildLevelRows(levels: string[]): TableRow[] {
  const normalizedLevels = levels.length > 0 ? levels : [''];
  const chunks: string[][] = [];

  for (let index = 0; index < normalizedLevels.length; index += 3) {
    chunks.push(normalizedLevels.slice(index, index + 3));
  }

  return chunks.map((chunk, chunkIndex) => {
    const row: TableRow = [];
    for (let index = 0; index < 3; index += 1) {
      const levelIndex = chunkIndex * 3 + index;
      row.push(labelCell(`Level ${levelIndex + 1}`), valueCell(chunk[index] ?? '-'));
    }
    return row;
  });
}

function renderImageRegion(slide: Slide, screen: ScreenSpecScreen): SlideBox {
  const imageRegion: SlideBox = { ...PPTX_LAYOUT.image };

  slide.addShape('rect', {
    ...imageRegion,
    fill: { color: PPTX_THEME.colors.canvas },
    line: { color: PPTX_THEME.colors.border, width: 1 },
  });

  const imageSize = readImageSizeFromDataUrl(screen.imageDataUrl);
  const fittedImageBox = fitContainBox(imageRegion, imageSize);

  if (screen.imageDataUrl) {
    slide.addImage({ data: screen.imageDataUrl, ...fittedImageBox });
  } else {
    renderImagePlaceholder(slide, screen, imageRegion);
  }

  return fittedImageBox;
}

function renderImagePlaceholder(
  slide: Slide,
  screen: ScreenSpecScreen,
  imageRegion: SlideBox,
): void {
  const gridStep = 0.46;
  const verticalLineCount = Math.floor(imageRegion.w / gridStep);
  const horizontalLineCount = Math.floor(imageRegion.h / gridStep);

  for (let index = 1; index < verticalLineCount; index += 1) {
    const x = imageRegion.x + index * gridStep;
    renderPptxLine(
      slide,
      { x, y: imageRegion.y },
      { x, y: imageRegion.y + imageRegion.h },
      { color: PPTX_THEME.colors.grid, width: 0.45 },
    );
  }

  for (let index = 1; index < horizontalLineCount; index += 1) {
    const y = imageRegion.y + index * gridStep;
    renderPptxLine(
      slide,
      { x: imageRegion.x, y },
      { x: imageRegion.x + imageRegion.w, y },
      { color: PPTX_THEME.colors.grid, width: 0.45 },
    );
  }

  slide.addText('SCREEN IMAGE PLACEHOLDER', {
    x: imageRegion.x + 0.3,
    y: imageRegion.y + 0.32,
    w: imageRegion.w - 0.6,
    h: 0.24,
    color: PPTX_THEME.colors.accentDark,
    fontFace: PPTX_THEME.fonts.body,
    fontSize: 9,
    bold: true,
    align: 'left',
  });
  slide.addText(screen.screenName || 'Untitled screen', {
    x: imageRegion.x + 0.3,
    y: imageRegion.y + 0.62,
    w: imageRegion.w - 0.6,
    h: 0.4,
    color: PPTX_THEME.colors.text,
    fontFace: PPTX_THEME.fonts.head,
    fontSize: 18,
    bold: true,
    align: 'left',
  });
  slide.addText('Upload an image to document an existing screen.', {
    x: imageRegion.x + 0.3,
    y: imageRegion.y + 1.08,
    w: imageRegion.w - 0.6,
    h: 0.28,
    color: PPTX_THEME.colors.mutedText,
    fontFace: PPTX_THEME.fonts.body,
    fontSize: 8,
    align: 'left',
  });
}

function renderCalloutRelations(
  slide: Slide,
  screen: ScreenSpecScreen,
  coordinateBase: SlideBox,
): void {
  screen.calloutRelations.forEach((relation) => {
    const fromCallout = screen.callouts.find((callout) => callout.no === relation.fromNo);
    const toCallout = screen.callouts.find((callout) => callout.no === relation.toNo);
    if (!fromCallout || !toCallout || fromCallout.no === toCallout.no) return;

    const from = toSlidePoint(fromCallout, coordinateBase);
    const to = toSlidePoint(toCallout, coordinateBase);
    const lineWidth = screen.visualSettings.relationLineWidthPx * LINE_WIDTH_POINT_PER_PIXEL;
    const markerSize = screen.visualSettings.markerSizePx * MARKER_SIZE_INCH_PER_PIXEL;
    const endpointOffset = markerSize / 2 + lineWidth / 72;

    renderRelationSegments(slide, from, to, relation, lineWidth, endpointOffset);

    if (relation.label) {
      const labelPoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      slide.addText(relation.label, {
        x: labelPoint.x + 0.06,
        y: labelPoint.y - 0.16,
        w: 1.8,
        h: 0.18,
        color: PPTX_THEME.colors.accentDark,
        fontFace: PPTX_THEME.fonts.body,
        fontSize: 6.5,
        bold: true,
        margin: 0,
        fit: 'shrink',
      });
    }
  });
}

function renderRelationSegments(
  slide: Slide,
  from: SlidePoint,
  to: SlidePoint,
  relation: ScreenSpecCalloutRelation,
  lineWidth: number,
  endpointOffset: number,
): void {
  if ((relation.lineMode ?? 'straight') === 'straight') {
    const trimmed = trimRelationPathEndpoints([from, to], endpointOffset);
    renderLineSegment(slide, trimmed[0]!, trimmed[trimmed.length - 1]!, lineWidth, true);
    return;
  }

  const middleY = (from.y + to.y) / 2;
  const points = trimRelationPathEndpoints(
    [from, { x: from.x, y: middleY }, { x: to.x, y: middleY }, to],
    endpointOffset,
  );
  const segments = points.slice(0, -1).flatMap((point, index) => {
    const nextPoint = points[index + 1]!;
    if (!hasSegmentLength(point, nextPoint)) return [];
    return [{ from: point, to: nextPoint }];
  });

  segments.forEach((segment, index) => {
    renderLineSegment(slide, segment.from, segment.to, lineWidth, index === segments.length - 1);
  });
}

function renderLineSegment(
  slide: Slide,
  from: SlidePoint,
  to: SlidePoint,
  lineWidth: number,
  hasArrow: boolean,
): void {
  renderPptxLine(slide, from, to, { color: PPTX_THEME.colors.accent, width: lineWidth }, hasArrow);
}

function renderPptxLine(
  slide: Slide,
  from: SlidePoint,
  to: SlidePoint,
  line: { color: string; width: number },
  hasArrow = false,
): void {
  const delta = getPptxSafeLineDelta(to.x - from.x, to.y - from.y);
  slide.addShape('line', {
    x: from.x,
    y: from.y,
    w: delta.w,
    h: delta.h,
    line: {
      color: line.color,
      width: line.width,
      ...(hasArrow ? { endArrowType: 'triangle' as const } : {}),
    },
  });
}

function getPptxSafeLineDelta(w: number, h: number): { w: number; h: number } {
  return {
    w: Math.abs(w) < MIN_LINE_SPAN ? signedMinSpan(w) : w,
    h: Math.abs(h) < MIN_LINE_SPAN ? signedMinSpan(h) : h,
  };
}

function signedMinSpan(value: number): number {
  return value < 0 ? -MIN_LINE_SPAN : MIN_LINE_SPAN;
}

/**
 * pptxgenjs writes `<a:tailEnd type="none"/>` / `<a:headEnd type="none"/>`
 * on plain lines, which desktop PowerPoint flags as a repairable file.
 * Strip them, exactly like the original Screen Spec Studio renderer.
 */
async function normalizePptxForPowerPoint(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const xmlPartNames = Object.keys(zip.files).filter(
    (fileName) => fileName.endsWith('.xml') || fileName.endsWith('.rels'),
  );

  await Promise.all(
    xmlPartNames.map(async (fileName) => {
      const file = zip.file(fileName);
      if (!file) return;
      const xml = await file.async('text');
      const normalizedXml = xml
        .replace(/<a:tailEnd type="none"(?: [^/>]*)?\/>/g, '')
        .replace(/<a:headEnd type="none"(?: [^/>]*)?\/>/g, '');
      if (normalizedXml !== xml) zip.file(fileName, normalizedXml);
    }),
  );

  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

function hasSegmentLength(from: SlidePoint, to: SlidePoint): boolean {
  return Math.abs(to.x - from.x) > 0.01 || Math.abs(to.y - from.y) > 0.01;
}

function trimRelationPathEndpoints(points: SlidePoint[], offset: number): SlidePoint[] {
  const filteredPoints = points.filter((point, index) => {
    if (index === 0) return true;
    return getDistance(points[index - 1]!, point) > 0.01;
  });

  if (filteredPoints.length < 2) return filteredPoints;

  const first = filteredPoints[0]!;
  const second = filteredPoints[1]!;
  const last = filteredPoints[filteredPoints.length - 1]!;
  const beforeLast = filteredPoints[filteredPoints.length - 2]!;

  return [
    movePointToward(first, second, offset),
    ...filteredPoints.slice(1, -1),
    movePointToward(last, beforeLast, offset),
  ];
}

function movePointToward(point: SlidePoint, target: SlidePoint, offset: number): SlidePoint {
  const distance = getDistance(point, target);
  if (distance <= 0) return point;
  const safeOffset = Math.min(offset, distance / 2);
  const ratio = safeOffset / distance;
  return {
    x: point.x + (target.x - point.x) * ratio,
    y: point.y + (target.y - point.y) * ratio,
  };
}

function getDistance(first: SlidePoint, second: SlidePoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function renderMarkers(slide: Slide, screen: ScreenSpecScreen, coordinateBase: SlideBox): void {
  const markerSize = screen.visualSettings.markerSizePx * MARKER_SIZE_INCH_PER_PIXEL;

  screen.callouts.forEach((callout) => {
    const { x, y } = toSlidePoint(callout, coordinateBase);

    slide.addShape('ellipse', {
      x: x - markerSize / 2,
      y: y - markerSize / 2,
      w: markerSize,
      h: markerSize,
      fill: { color: PPTX_THEME.colors.accent },
      line: { color: PPTX_THEME.colors.background, width: 1.2 },
    });
    slide.addText(String(callout.no), {
      x: x - markerSize / 2,
      y: y - markerSize / 2 + 0.01,
      w: markerSize,
      h: markerSize,
      align: 'center',
      valign: 'middle',
      color: PPTX_THEME.colors.background,
      fontFace: PPTX_THEME.fonts.body,
      fontSize: Math.max(7, Math.round(markerSize * 31)),
      bold: true,
      margin: 0,
      breakLine: false,
    });
  });
}

function toSlidePoint(callout: ScreenSpecCallout, coordinateBase: SlideBox): SlidePoint {
  return {
    x: coordinateBase.x + coordinateBase.w * callout.position.x,
    y: coordinateBase.y + coordinateBase.h * callout.position.y,
  };
}

function renderDescriptionTable(slide: Slide, screen: ScreenSpecScreen): void {
  slide.addText('Description', {
    ...PPTX_LAYOUT.descriptionTitle,
    color: PPTX_THEME.colors.text,
    fontFace: PPTX_THEME.fonts.head,
    fontSize: 10,
    bold: true,
  });

  const rows = [
    [tableHeaderCell('No'), tableHeaderCell('Label'), tableHeaderCell('Description')],
    ...screen.callouts.map((callout) => [
      numberCell(String(callout.no)),
      valueCell(callout.label || '-', 1, 7),
      valueCell(callout.description || '-', 1, 7),
    ]),
  ];

  slide.addTable(rows as never, {
    ...PPTX_LAYOUT.description,
    border: tableBorder(PPTX_THEME.colors.border),
    colW: [0.42, 1.04, 2.74],
    rowH: [0.32, ...screen.callouts.map(() => 0.66)],
    margin: 0.06,
    fontFace: PPTX_THEME.fonts.body,
    fontSize: 7.2,
    color: PPTX_THEME.colors.text,
    valign: 'middle',
  });
}

function renderCheckpointBox(slide: Slide, screen: ScreenSpecScreen): void {
  const box = PPTX_LAYOUT.checkpoint;

  slide.addShape('rect', {
    ...box,
    fill: { color: 'FFFFFF' },
    line: { color: PPTX_THEME.colors.border, width: 1 },
  });
  slide.addShape('rect', {
    x: box.x,
    y: box.y,
    w: box.w,
    h: 0.34,
    fill: { color: PPTX_THEME.colors.headerFill },
    line: { color: PPTX_THEME.colors.headerFill, width: 1 },
  });
  slide.addText('Check Point', {
    x: box.x + 0.12,
    y: box.y + 0.07,
    w: box.w - 0.24,
    h: 0.18,
    color: PPTX_THEME.colors.headerText,
    fontFace: PPTX_THEME.fonts.head,
    fontSize: 9,
    bold: true,
  });

  const checkpoints =
    screen.checkpoints.length > 0 ? screen.checkpoints : ['No checkpoints registered.'];
  const lineHeight = Math.min(0.34, (box.h - 0.62) / checkpoints.length);

  checkpoints.forEach((checkpoint, index) => {
    slide.addText(checkpoint, {
      x: box.x + 0.28,
      y: box.y + 0.48 + index * lineHeight,
      w: box.w - 0.52,
      h: lineHeight,
      color: PPTX_THEME.colors.text,
      fontFace: PPTX_THEME.fonts.body,
      fontSize: 7.8,
      bullet: { type: 'bullet', indent: 10 },
      breakLine: false,
      fit: 'shrink',
      valign: 'top',
      margin: 0,
    });
  });
}

function renderFooter(slide: Slide, screen: ScreenSpecScreen): void {
  const footer = PPTX_LAYOUT.footer;
  renderPptxLine(
    slide,
    { x: footer.x, y: footer.y - 0.08 },
    { x: footer.x + footer.w, y: footer.y - 0.08 },
    { color: PPTX_THEME.colors.border, width: 0.75 },
  );
  slide.addText(screen.companyName || 'Open Docs', {
    x: footer.x,
    y: footer.y,
    w: 3,
    h: footer.h,
    color: PPTX_THEME.colors.mutedText,
    fontFace: PPTX_THEME.fonts.body,
    fontSize: 7,
  });
  slide.addText(`Ver ${screen.version || '-'}`, {
    x: footer.x + footer.w - 3,
    y: footer.y,
    w: 3,
    h: footer.h,
    color: PPTX_THEME.colors.mutedText,
    fontFace: PPTX_THEME.fonts.body,
    fontSize: 7,
    align: 'right',
  });
}

function labelCell(text: string) {
  return {
    text,
    options: {
      fill: { color: PPTX_THEME.colors.labelFill },
      color: PPTX_THEME.colors.mutedText,
      bold: true,
      fontSize: 7,
      valign: 'middle' as const,
    },
  };
}

function valueCell(text: string, colspan = 1, fontSize = 8) {
  return {
    text: text || '-',
    options: {
      colspan,
      color: PPTX_THEME.colors.text,
      fontSize,
      valign: 'middle' as const,
      fit: 'shrink' as const,
    },
  };
}

function tableHeaderCell(text: string) {
  return {
    text,
    options: {
      fill: { color: PPTX_THEME.colors.headerFill },
      color: PPTX_THEME.colors.headerText,
      bold: true,
      fontSize: 7.5,
      align: 'center' as const,
      valign: 'middle' as const,
    },
  };
}

function numberCell(text: string) {
  return {
    text,
    options: {
      color: PPTX_THEME.colors.accentDark,
      bold: true,
      fontSize: 8,
      align: 'center' as const,
      valign: 'middle' as const,
    },
  };
}

function tableBorder(color: string) {
  return {
    type: 'solid' as const,
    color,
    pt: 0.6,
  };
}
