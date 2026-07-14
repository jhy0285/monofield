/**
 * Slide layout + theme presets for the screen-spec PPTX renderer.
 * Ported 1:1 from Screen Spec Studio (wireFrame repo, renderers/pptx/
 * layout.ts + theme.ts). Keep as data — the renderer is a pure function of
 * (ScreenSpecDocument, presets).
 */

export interface SlideBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

export const PPTX_LAYOUT = {
  name: 'LAYOUT_WIDE',
  slide: { w: 13.333, h: 7.5 },
  metadata: { x: 0.35, y: 0.18, w: 12.6, h: 1.38 },
  image: { x: 0.35, y: 1.72, w: 8.2, h: 4.98 },
  description: { x: 8.75, y: 1.78, w: 4.2, h: 3.04 },
  descriptionTitle: { x: 8.75, y: 1.58, w: 4.2, h: 0.18 },
  checkpoint: { x: 8.75, y: 5.0, w: 4.2, h: 1.7 },
  footer: { x: 0.35, y: 6.95, w: 12.6, h: 0.32 },
  marker: { size: 0.32 },
} as const;

export const PPTX_THEME = {
  fonts: {
    head: 'Aptos Display',
    body: 'Aptos',
    fallback: 'Arial',
  },
  colors: {
    background: 'FFFFFF',
    canvas: 'F7F8FA',
    border: 'D9DEE7',
    grid: 'EEF1F5',
    text: '1F2328',
    mutedText: '68707C',
    labelFill: 'F1F3F6',
    headerFill: '30343A',
    headerText: 'FFFFFF',
    accent: 'D92D20',
    accentDark: 'B42318',
    warningFill: 'FFF7E6',
  },
} as const;

export function fitContainBox(region: SlideBox, imageSize?: ImageSize): SlideBox {
  if (!imageSize || imageSize.width <= 0 || imageSize.height <= 0) {
    return region;
  }

  const imageRatio = imageSize.width / imageSize.height;
  const regionRatio = region.w / region.h;

  if (imageRatio > regionRatio) {
    const height = region.w / imageRatio;
    return {
      x: region.x,
      y: region.y + (region.h - height) / 2,
      w: region.w,
      h: height,
    };
  }

  const width = region.h * imageRatio;
  return {
    x: region.x + (region.w - width) / 2,
    y: region.y,
    w: width,
    h: region.h,
  };
}

/**
 * Node-side replacement for the browser `Image` probe the original renderer
 * used: parse PNG / JPEG / GIF dimensions straight from the data-URL bytes.
 * Returns undefined for unknown formats (renderer then uses the full region).
 */
export function readImageSizeFromDataUrl(dataUrl?: string): ImageSize | undefined {
  if (!dataUrl) return undefined;
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || !dataUrl.slice(0, comma).includes('base64')) return undefined;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(dataUrl.slice(comma + 1), 'base64');
  } catch {
    return undefined;
  }
  if (bytes.length < 26) return undefined;

  // PNG: signature + IHDR width/height at offsets 16/20.
  if (bytes.readUInt32BE(0) === 0x89504e47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }

  // GIF: logical screen descriptor at offsets 6/8 (little-endian).
  if (bytes.toString('ascii', 0, 3) === 'GIF') {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }

  // JPEG: scan segments for a SOFn marker.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return {
          height: bytes.readUInt16BE(offset + 5),
          width: bytes.readUInt16BE(offset + 7),
        };
      }
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2) return undefined;
      offset += 2 + length;
    }
  }

  return undefined;
}
