// One-off script: generates PNG app icons using only Node's built-in zlib (no deps, no internet).
const zlib = require('zlib');
const fs = require('fs');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
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
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; ihdrData[9] = 6; ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;
  return Buffer.concat([sig, chunk('IHDR', ihdrData), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

function setPx(rgba, w, x, y, r, g, b, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= w) return;
  const i = (y * w + x) * 4;
  if (i < 0 || i + 3 >= rgba.length) return;
  rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
}

function fillRoundedRect(rgba, w, h, x0, y0, x1, y1, r, color) {
  for (let y = Math.floor(y0); y < y1; y++) {
    for (let x = Math.floor(x0); x < x1; x++) {
      const inCornerZone =
        (x < x0 + r && y < y0 + r) || (x < x0 + r && y > y1 - r) ||
        (x > x1 - r && y < y0 + r) || (x > x1 - r && y > y1 - r);
      let ok = true;
      if (inCornerZone) {
        const ccx = x < x0 + r ? x0 + r : x1 - r;
        const ccy = y < y0 + r ? y0 + r : y1 - r;
        if (Math.hypot(x - ccx, y - ccy) > r) ok = false;
      }
      if (ok) setPx(rgba, w, x, y, color[0], color[1], color[2], 255);
    }
  }
}

function fillCircle(rgba, w, cx, cy, r, color, alpha) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (Math.hypot(x - cx, y - cy) <= r) setPx(rgba, w, x, y, color[0], color[1], color[2], alpha === undefined ? 255 : alpha);
    }
  }
}

// Icon: rounded square background + 4 fruit-colored gems in a 2x2 diamond (representing a match-3 duel)
function drawIcon(size) {
  const w = size, h = size;
  const rgba = Buffer.alloc(w * h * 4);
  const bg = [0x2b, 0x0f, 0x4e]; // deep purple

  fillRoundedRect(rgba, w, h, 0, 0, w, h, size * 0.18, bg);

  const cx = w / 2, cy = h / 2;
  const gemR = size * 0.155;
  const offset = size * 0.19;
  const gems = [
    { dx: -offset, dy: -offset, color: [0xff, 0x4d, 0x6d] }, // red
    { dx: offset, dy: -offset, color: [0xff, 0xd1, 0x3d] },  // yellow
    { dx: -offset, dy: offset, color: [0x3d, 0xd6, 0x8c] },  // green
    { dx: offset, dy: offset, color: [0x4d, 0xa3, 0xff] },   // blue
  ];
  for (const g of gems) {
    fillCircle(rgba, w, cx + g.dx, cy + g.dy, gemR, g.color, 255);
    // small highlight
    fillCircle(rgba, w, cx + g.dx - gemR * 0.35, cy + g.dy - gemR * 0.35, gemR * 0.28, [255, 255, 255], 210);
  }
  // center vs spark (small white diamond)
  const spikeR = size * 0.05;
  fillCircle(rgba, w, cx, cy, spikeR, [255, 255, 255], 235);

  return rgba;
}

function drawMaskable(size) {
  const w = size, h = size;
  const rgba = Buffer.alloc(w * h * 4);
  const bg = [0x2b, 0x0f, 0x4e];
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = bg[0]; rgba[i * 4 + 1] = bg[1]; rgba[i * 4 + 2] = bg[2]; rgba[i * 4 + 3] = 255;
  }
  const innerSize = Math.round(size * 0.7);
  const inner = drawIcon(innerSize);
  const off = Math.round(size * 0.15);
  for (let y = 0; y < innerSize; y++) {
    for (let x = 0; x < innerSize; x++) {
      const si = (y * innerSize + x) * 4;
      const a = inner[si + 3];
      if (a === 0) continue;
      const dx = x + off, dy = y + off;
      if (dx < 0 || dy < 0 || dx >= w || dy >= h) continue;
      const di = (dy * w + dx) * 4;
      rgba[di] = inner[si]; rgba[di + 1] = inner[si + 1]; rgba[di + 2] = inner[si + 2]; rgba[di + 3] = 255;
    }
  }
  return rgba;
}

for (const size of [192, 512]) {
  fs.writeFileSync(`icon-${size}.png`, encodePNG(size, size, drawIcon(size)));
  console.log(`wrote icon-${size}.png`);
}
fs.writeFileSync('icon-512-maskable.png', encodePNG(512, 512, drawMaskable(512)));
console.log('wrote icon-512-maskable.png');
