/**
 * Generates PWA icon PNGs programmatically.
 * Renders a "G" letter on dark background in blue accent color.
 *
 * Usage: node scripts/generate-icons.cjs
 */

const { writeFileSync } = require('fs');
const { join } = require('path');
const { deflateSync } = require('zlib');

const ICONS_DIR = join(__dirname, '..', 'public', 'icons');
const SIZES = [192, 512];

// Colors
const BG = { r: 10, g: 10, b: 15 };
const FG = { r: 59, g: 130, b: 246 };

function createIconPNG(size) {
  const pixels = Buffer.alloc(size * size * 4);

  const margin = Math.floor(size * 0.2);
  const left = margin;
  const right = size - margin;
  const top = margin;
  const bottom = size - margin;
  const thick = Math.floor(size * 0.13);
  const midY = Math.floor((top + bottom) / 2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      let { r, g, b } = BG;

      if (x >= left && x <= right && y >= top && y <= bottom) {
        const isTop = y < top + thick;
        const isBottom = y > bottom - thick;
        const isLeft = x < left + thick;
        const isMid = y >= midY && y < midY + thick && x >= Math.floor((left + right) / 2);
        const isRightLow = x > right - thick && y >= midY;

        if (isTop || isBottom || isLeft || isMid || isRightLow) {
          r = FG.r;
          g = FG.g;
          b = FG.b;
        }
      }

      pixels[idx] = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = 255;
    }
  }

  return encodePNG(size, size, pixels);
}

function encodePNG(w, h, pixels) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 4);
    raw[off] = 0;
    pixels.copy(raw, off + 1, y * w * 4, (y + 1) * w * 4);
  }

  const compressed = deflateSync(raw);
  const chunks = [];

  // PNG signature
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunks.push(makeChunk('IHDR', ihdr));

  // IDAT
  chunks.push(makeChunk('IDAT', compressed));

  // IEND
  chunks.push(makeChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

function makeChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crcBuf]);
}

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? ((c >>> 1) ^ 0xEDB88320) : (c >>> 1);
    }
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

console.log('Generating PWA icons...');
for (const size of SIZES) {
  const png = createIconPNG(size);
  const name = `icon-${size}x${size}.png`;
  writeFileSync(join(ICONS_DIR, name), png);
  console.log(`  ${name} (${png.length} bytes)`);
}
console.log('Done!');
