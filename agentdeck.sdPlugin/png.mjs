// Minimal PNG encoder (RGBA, no dependencies).
import zlib from 'node:zlib';

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePng(w, h, pixel) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * stride + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Anti-aliased colored dot on a black key, in the upper third so the
// title (pushed below it, see plugin.mjs) stays readable.
export function dotPng(size, rgb, { glow = true } = {}) {
  const cx = size / 2, cy = size * 0.32, r = size * 0.18;
  return encodePng(size, size, (x, y) => {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    let a = Math.min(1, Math.max(0, r + 0.5 - d));
    if (glow && a === 0) a = Math.max(0, 0.35 * (1 - (d - r) / (r * 0.6)));
    return [Math.round(rgb[0] * a), Math.round(rgb[1] * a), Math.round(rgb[2] * a), 255];
  });
}

// One frame of a rotating comet ring (same spot as the dot). `phase` in radians;
// the bright head sits at `phase`, the tail fades out behind it.
export function spinnerPng(size, rgb, phase) {
  const cx = size / 2, cy = size * 0.32, R = size * 0.16, half = size * 0.035;
  const TAU = Math.PI * 2;
  return encodePng(size, size, (x, y) => {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const band = Math.min(1, Math.max(0, half + 0.5 - Math.abs(Math.hypot(dx, dy) - R)));
    if (band === 0) return [0, 0, 0, 255];
    const behind = (((phase - Math.atan2(dy, dx)) % TAU) + TAU) % TAU / TAU;
    const a = band * (0.15 + 0.85 * Math.max(0, 1 - behind / 0.5));
    return [Math.round(rgb[0] * a), Math.round(rgb[1] * a), Math.round(rgb[2] * a), 255];
  });
}

// Static key face for menu/command keys: black with a colored bar on top,
// so categories read at a glance and the title has room below.
export function tilePng(size, rgb) {
  const top = size * 0.1, h = size * 0.07, inset = size * 0.18;
  return encodePng(size, size, (x, y) => {
    const on = y >= top && y < top + h && x >= inset && x < size - inset;
    return on ? [...rgb, 255] : [0, 0, 0, 255];
  });
}

// Rounded red border with a fully transparent center, drawn over any key face to
// make the whole deck flash without hiding the titles.
export function ringPng(size, rgb, { r = size * 0.18, bw = size * 0.04 } = {}) {
  const half = size / 2, ext = half - r;
  return encodePng(size, size, (x, y) => {
    const qx = Math.abs(x + 0.5 - half) - ext, qy = Math.abs(y + 0.5 - half) - ext;
    const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    const a = Math.min(1, Math.max(0, bw + 0.5 - Math.abs(d)));
    return [rgb[0], rgb[1], rgb[2], Math.round(a * 255)];
  });
}

export const dataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
