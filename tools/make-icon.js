// Generates the app icon set as real PNGs with no image libraries — pure Node
// (zlib for PNG compression). Draws a green/cream chessboard so the app reads as
// "Offline Chess" at a glance. Run: node tools/make-icon.js
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

// --- CRC32 (PNG chunk checksums) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// draw(x,y) -> [r,g,b,a]
function makePng(width, height, draw) {
  const rowSize = width * 4;
  const raw = Buffer.alloc((rowSize + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (rowSize + 1)] = 0; // filter type 0
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = draw(x, y);
      const o = y * (rowSize + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// chess.com-style palette
const LIGHT = [0xec, 0xec, 0xd0, 255];
const DARK = [0x6f, 0x8f, 0x57, 255];
const BG = [0x0e, 0x0f, 0x13, 255];

// A board occupying [x0,x0+size) with 8x8 squares.
function boardPixel(x, y, x0, y0, size) {
  const rel = (v, o) => v - o;
  const sq = size / 8;
  const cx = rel(x, x0);
  const cy = rel(y, y0);
  if (cx < 0 || cy < 0 || cx >= size || cy >= size) return null;
  const col = Math.floor(cx / sq);
  const row = Math.floor(cy / sq);
  return (col + row) % 2 === 0 ? LIGHT : DARK;
}

function fullBleedBoard(size) {
  return (x, y) => boardPixel(x, y, 0, 0, size) || LIGHT;
}

// board centered on dark bg with margin (adaptive foreground / splash)
function centeredBoard(size, boardFrac) {
  const bs = Math.floor(size * boardFrac);
  const off = Math.floor((size - bs) / 2);
  return (x, y) => boardPixel(x, y, off, off, bs) || BG;
}

const ASSETS = path.join(__dirname, "..", "assets");
fs.mkdirSync(ASSETS, { recursive: true });

const out = [
  ["icon.png", makePng(1024, 1024, fullBleedBoard(1024))],
  ["adaptive-icon.png", makePng(1024, 1024, centeredBoard(1024, 0.68))],
  ["splash.png", makePng(1024, 1024, centeredBoard(1024, 0.5))],
];
for (const [name, buf] of out) {
  const p = path.join(ASSETS, name);
  fs.writeFileSync(p, buf);
  // sanity: PNG signature
  const ok = buf[0] === 137 && buf[1] === 80 && buf[2] === 78 && buf[3] === 71;
  console.log(`${name}: ${buf.length} bytes, valid PNG=${ok}`);
}
