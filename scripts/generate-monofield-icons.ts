// @ts-nocheck -- deterministic binary asset generator; executed with Node's
// type-stripping mode and intentionally kept dependency-free.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[n] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuffer, data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insideRoundedRect(x, y, size) {
  const scale = size / 444;
  const radius = 104 * scale;
  const nearestX = Math.max(radius, Math.min(size - radius, x));
  const nearestY = Math.max(radius, Math.min(size - radius, y));
  return Math.hypot(x - nearestX, y - nearestY) <= radius;
}

function renderIcon(size) {
  const scale = size / 444;
  const points = [
    [92, 312],
    [92, 138],
    [222, 306],
    [352, 138],
    [352, 312],
  ].map(([x, y]) => [x * scale, y * scale]);
  const halfStroke = 20 * scale;
  const rows = [];

  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x += 1) {
      const sampleX = x + 0.5;
      const sampleY = y + 0.5;
      const offset = 1 + x * 4;
      if (!insideRoundedRect(sampleX, sampleY, size)) continue;

      let distance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < points.length - 1; index += 1) {
        const [ax, ay] = points[index];
        const [bx, by] = points[index + 1];
        distance = Math.min(distance, distanceToSegment(sampleX, sampleY, ax, ay, bx, by));
      }

      const onMark = distance <= halfStroke;
      row[offset] = onMark ? 250 : 9;
      row[offset + 1] = onMark ? 250 : 9;
      row[offset + 2] = onMark ? 248 : 9;
      row[offset + 3] = 255;
    }
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function writeAsset(relativePath, data) {
  const target = resolve(repoRoot, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
}

function buildIco(sizes) {
  const images = sizes.map((size) => ({ size, data: renderIcon(size) }));
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    directory[entry] = size >= 256 ? 0 : size;
    directory[entry + 1] = size >= 256 ? 0 : size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([directory, ...images.map(({ data }) => data)]);
}

function buildIcns(entries) {
  const chunks = entries.map(([type, size]) => {
    const data = renderIcon(size);
    const chunk = Buffer.alloc(8 + data.length);
    chunk.write(type, 0, 4, 'ascii');
    chunk.writeUInt32BE(chunk.length, 4);
    data.copy(chunk, 8);
    return chunk;
  });
  const total = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(total, 4);
  return Buffer.concat([header, ...chunks]);
}

const png1024 = renderIcon(1024);
writeAsset('apps/web/public/app-icon.png', png1024);
writeAsset('tools/pack/resources/linux/icon.png', png1024);
writeAsset('tools/pack/resources/mac/icon.png', png1024);
writeAsset('tools/pack/resources/win/icon.ico', buildIco([16, 24, 32, 48, 64, 128, 256]));
writeAsset('tools/pack/resources/mac/icon.icns', buildIcns([['ic08', 256], ['ic09', 512], ['ic10', 1024]]));

console.log('Generated MonoField application icons.');
