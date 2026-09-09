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

/** '#RRGGBB' -> [r,g,b]. Exported so per-pixel callers convert once, outside the loop. */
export const rgb = hex;

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

  /**
   * Composite `rgb` — a [r,g,b] triple, NOT a hex string — over `x,y` with coverage `a`.
   *
   * The triple is deliberate: this runs per pixel per glyph edge and must not re-parse a
   * colour each time. It is also the one method here that differs from its siblings, which
   * all take hex, so it checks. Passing '#1E2A38' indexes the string: '#' and 'E' multiply
   * to NaN and store as 0, and the text renders in rgb(0,1,0) — a readable card in the
   * wrong colour, which looks like a working card until someone samples a pixel.
   */
  blend(x, y, rgb, a) {
    if (!Array.isArray(rgb)) {
      throw new TypeError(`blend() takes [r,g,b], not ${JSON.stringify(rgb)} — use rgb() to convert once, outside the loop`);
    }
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    for (let k = 0; k < 3; k++) this.px[i + k] = Math.round(rgb[k] * a + this.px[i + k] * (1 - a));
  }

  rect(x, y, w, h, colour) {
    const rgb = hex(colour);
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++) {
      for (let xx = Math.round(x); xx < Math.round(x + w); xx++) this.set(xx, yy, rgb);
    }
  }

  /** A filled rectangle with corner radius `r`. The tool marks are drawn with rx and the
   *  share images ignored it, so every mark rasterised as hard blocks — the same shape as
   *  the drawn icon in outline only. */
  roundRect(x, y, w, h, r, colour) {
    const rgb = hex(colour);
    const rad = Math.min(r, w / 2, h / 2);
    const x0 = Math.round(x), y0 = Math.round(y);
    const x1 = Math.round(x + w), y1 = Math.round(y + h);
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        // Distance from the nearest corner circle's centre, only inside the corner boxes.
        const cx = xx < x0 + rad ? x0 + rad : xx >= x1 - rad ? x1 - rad : xx;
        const cy = yy < y0 + rad ? y0 + rad : yy >= y1 - rad ? y1 - rad : yy;
        if ((xx - cx) ** 2 + (yy - cy) ** 2 <= rad * rad + rad) this.set(xx, yy, rgb);
      }
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
