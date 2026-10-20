// Erzeugt build/icon.png (256×256) aus dem Cephalon-Merlin-Logo – ohne zusätzliche Pakete.
// Logo: Zauberhut (Merlin) mit leuchtendem Cephalon-Kern. Gleiche Formen wie das SVG in src/components/Icons.jsx.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const S = 256;
const SS = 4; // Kantenglättung: 4×4 Unterabtastung

// ---- Formen im 24er-Raster (identisch zum SVG) ----
const HAT = [[6.6, 16.6], [9.4, 10.4], [11.6, 6.0], [13.6, 3.2], [16.4, 1.6], [15.2, 3.6], [15.0, 6.6], [15.6, 10.6], [17.4, 16.6]];
const BRIM = { cx: 12, cy: 17.2, rx: 9.6, ry: 2.5 };
const CORE = [[12, 8.7], [14.3, 12], [12, 15.3], [9.7, 12]];
const CORE_IN = [[12, 10.4], [13.1, 12], [12, 13.6], [10.9, 12]];
const star = (cx, cy, r) => [[cx, cy - r], [cx + r * 0.28, cy - r * 0.28], [cx + r, cy], [cx + r * 0.28, cy + r * 0.28], [cx, cy + r], [cx - r * 0.28, cy + r * 0.28], [cx - r, cy], [cx - r * 0.28, cy - r * 0.28]];
const STARS = [star(5.2, 6.4, 1.9), star(19.4, 9.2, 1.2), star(7.6, 2.8, 0.9)];

// Farben
const BG_OUT = [15, 18, 28];
const BG_IN = [42, 34, 82];
const HAT_TOP = [240, 243, 252];
const HAT_BOT = [176, 185, 214];
const BRIM_C = [204, 211, 232];
const ACCENT = [139, 109, 255];
const CORE_HI = [236, 230, 255];
const STAR_C = [196, 182, 255];

// Raster: Logo auf ~80 % der Fläche, leicht nach unten versetzt (Hutkrempe optisch mittig)
const K = (S * 0.8) / 24;
const OX = (S - 24 * K) / 2;
const OY = (S - 24 * K) / 2 + 4;
const toGrid = (px, py) => [(px - OX) / K, (py - OY) / K];

function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const inEllipse = (e, x, y) => ((x - e.cx) / e.rx) ** 2 + ((y - e.cy) / e.ry) ** 2 <= 1;
// Abgerundetes Quadrat als Hintergrund
function inRounded(x, y) {
  const r = 54;
  const cx = Math.min(Math.max(x, r), S - r);
  const cy = Math.min(Math.max(y, r), S - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function colorAt(px, py) {
  // Hintergrund: dunkel, zur Mitte hin violett
  const d = Math.hypot(px - S / 2, py - S * 0.55) / (S * 0.7);
  let col = mix(BG_IN, BG_OUT, Math.min(1, d));
  const [x, y] = toGrid(px, py);

  if (inEllipse(BRIM, x, y)) col = mix(BRIM_C, HAT_BOT, Math.max(0, (y - BRIM.cy + BRIM.ry) / (2 * BRIM.ry)) * 0.6);
  if (inside(HAT, x, y)) col = mix(HAT_TOP, HAT_BOT, Math.min(1, Math.max(0, (y - 2) / 15)));
  // Leuchten um den Kern (auf dem Hut)
  const g = Math.hypot(x - 12, y - 12);
  if (inside(HAT, x, y) || inEllipse(BRIM, x, y)) col = mix(col, ACCENT, Math.max(0, 0.55 * Math.exp(-g / 2.2) - 0.05));
  if (inside(CORE, x, y)) col = mix(ACCENT, CORE_HI, Math.max(0, 1 - g / 3.2) * 0.35);
  if (inside(CORE_IN, x, y)) col = CORE_HI;
  for (const s of STARS) if (inside(s, x, y)) col = STAR_C;
  return col;
}

const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  for (let x = 0; x < S; x++) {
    let r = 0, g = 0, b = 0, hits = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS;
        const py = y + (sy + 0.5) / SS;
        if (!inRounded(px, py)) continue;
        const c = colorAt(px, py);
        r += c[0]; g += c[1]; b += c[2]; hits++;
      }
    }
    const i = y * (S * 4 + 1) + 1 + x * 4;
    raw[i] = hits ? Math.round(r / hits) : 0;
    raw[i + 1] = hits ? Math.round(g / hits) : 0;
    raw[i + 2] = hits ? Math.round(b / hits) : 0;
    raw[i + 3] = Math.round((hits / (SS * SS)) * 255);
  }
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(td) >>> 0 : crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
// Fenster-/Taskleisten-Icon (auch für die Preview, die keine eigene .exe-Ressource hat)
fs.writeFileSync(path.join(__dirname, '..', 'electron', 'icon.png'), png);
console.log('icon.png', png.length, 'Bytes');
