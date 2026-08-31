/**
 * A very small PNG writer, and just enough rasterising to draw the share images.
 *
 * Why this exists rather than a dependency: rasterising SVG in Node means a native module —
 * `sharp`, `resvg`, `node-canvas` — and the licence gate plus the README's "27 packages,
 * zero copyleft" claim both argue against adding one for a decorative asset. Rasterising
 * through the browser instead was tried and abandoned: the images come back at 53-85 KB each
 * and there is no path from the page to disk that does not go through a tool result.
 *
 * So the share images are drawn from primitives this file can rasterise — filled rectangles,
 * stroked rectangles and circles — which is exactly what the tool icons are made of. No text:
 * a font rasteriser is the part that genuinely needs a library, and og:title and
 * og:description already carry the words in every preview that renders one.
 *
 * Output is 8-bit RGB, one IDAT, filter type 0 on every row. Flat artwork, so it deflates
 * to a few kilobytes.
 */

import { deflateSync } from 'node:zlib';

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const hex = (c) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c).trim());
  if (!m) throw new Error(`not a hex colour: ${c}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export class Bitmap {
  constructor(width, height, background) {
    this.w = width;
    this.h = height;
    this.px = Buffer.alloc(width * height * 3);
    const [r, g, b] = hex(background);
    for (let i = 0; i < this.px.length; i += 3) {
      this.px[i] = r;
      this.px[i + 1] = g;
      this.px[i + 2] = b;
    }
  }

  set(x, y, rgb) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = rgb[0];
    this.px[i + 1] = rgb[1];
    this.px[i + 2] = rgb[2];
  }

  rect(x, y, w, h, colour) {
    const rgb = hex(colour);
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++) {
      for (let xx = Math.round(x); xx < Math.round(x + w); xx++) this.set(xx, yy, rgb);
    }
  }

  /** A rectangle outline of the given thickness, drawn inward from the bounds. */
  strokeRect(x, y, w, h, thickness, colour) {
    this.rect(x, y, w, thickness, colour);
    this.rect(x, y + h - thickness, w, thickness, colour);
    this.rect(x, y, thickness, h, colour);
    this.rect(x + w - thickness, y, thickness, h, colour);
  }

  circle(cx, cy, r, colour) {
    const rgb = hex(colour);
    for (let yy = Math.round(cy - r); yy <= cy + r; yy++) {
      for (let xx = Math.round(cx - r); xx <= cx + r; xx++) {
        if ((xx - cx) ** 2 + (yy - cy) ** 2 <= r * r) this.set(xx, yy, rgb);
      }
    }
  }

  /** The brand seam: a square, with its lower-left triangle in the second colour. */
  seam(x, y, size, inkColour, amberColour) {
    this.rect(x, y, size, size, inkColour);
    const rgb = hex(amberColour);
    for (let yy = 0; yy < size; yy++) {
      for (let xx = 0; xx < size; xx++) {
        if (xx >= yy) this.set(x + xx, y + yy, rgb);
      }
    }
  }

  toPng() {
    const raw = Buffer.alloc(this.h * (this.w * 3 + 1));
    for (let y = 0; y < this.h; y++) {
      const at = y * (this.w * 3 + 1);
      raw[at] = 0; // filter: none
      this.px.copy(raw, at + 1, y * this.w * 3, (y + 1) * this.w * 3);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 2;  // colour type: truecolour
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}
