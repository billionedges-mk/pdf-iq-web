/**
 * Enough of the TrueType format to draw a line of the site's own type into a bitmap.
 *
 * Why this exists rather than a dependency: the share images were wordless, and the reason
 * given was that a font rasteriser is the part that genuinely needs a library. That was
 * wrong, and it was wrong in a way that cost a real defect — every share of the homepage
 * went out as a nearly empty card for weeks. The price I quoted was a native module. The
 * actual price is this file.
 *
 * The route is short because we already ship the fonts. @fontsource publishes `.woff`
 * alongside the `.woff2` the browser gets, and WOFF1 is a plain container whose tables are
 * zlib-deflated — which Node decompresses without help. So: .woff -> inflate -> the seven
 * tables below -> quadratic outlines -> scanline fill. No new package, and the type on the
 * card is the same Public Sans the page is set in, from the same file the page loads.
 *
 * What it does not do, stated so nobody discovers it in a preview:
 *
 *  - No kerning. There is no `kern` table in these fonts; the pairs live in GPOS, which is
 *    a far larger specification. Public Sans is evenly spaced and a loose "Av" on a share
 *    card is not worth that. Accepted deliberately, not overlooked.
 *  - No composite glyphs. 89 of Public Sans's 278 glyphs are composites — accented letters,
 *    mostly. `glyph()` THROWS on one rather than returning nothing, which is the whole point
 *    of this paragraph: an empty return is what made the old share images fail silently, and
 *    reproducing that here, in the fix for it, would be indefensible. If a card ever needs an
 *    accent, the build stops and someone implements composites.
 *  - Latin subset only. Same reason, same behaviour: an unmapped codepoint throws.
 */

import { readFileSync } from 'node:fs';
import { rgb } from './png.mjs';
import { inflateSync } from 'node:zlib';

/** Unwrap a WOFF1 container into its raw SFNT tables. */
function woffTables(file) {
  const f = readFileSync(file);
  if (f.toString('latin1', 0, 4) !== 'wOFF') throw new Error(`${file} is not a WOFF file`);
  const count = f.readUInt16BE(12);
  const tables = {};
  for (let i = 0; i < count; i++) {
    const at = 44 + i * 20;
    const tag = f.toString('latin1', at, at + 4);
    const offset = f.readUInt32BE(at + 4);
    const compLen = f.readUInt32BE(at + 8);
    const origLen = f.readUInt32BE(at + 12);
    const raw = f.subarray(offset, offset + compLen);
    const out = compLen === origLen ? raw : inflateSync(raw);
    if (out.length !== origLen) {
      throw new Error(`${file}: table ${tag} inflated to ${out.length}, expected ${origLen}`);
    }
    tables[tag] = out;
  }
  for (const need of ['head', 'maxp', 'loca', 'glyf', 'cmap', 'hmtx', 'hhea']) {
    if (!tables[need]) throw new Error(`${file}: no ${need} table — cannot draw text from it`);
  }
  return tables;
}

export function loadFont(file) {
  const t = woffTables(file);
  const unitsPerEm = t.head.readUInt16BE(18);
  const longLoca = t.head.readInt16BE(50) === 1;
  const numGlyphs = t.maxp.readUInt16BE(4);
  const numHMetrics = t.hhea.readUInt16BE(34);
  const ascender = t.hhea.readInt16BE(4);
  const descender = t.hhea.readInt16BE(6);

  // cmap: format 4, Windows Unicode BMP (3,1) or Unicode (0,x).
  let sub = null;
  const numCmap = t.cmap.readUInt16BE(2);
  for (let i = 0; i < numCmap; i++) {
    const platform = t.cmap.readUInt16BE(4 + i * 8);
    const encoding = t.cmap.readUInt16BE(6 + i * 8);
    const offset = t.cmap.readUInt32BE(8 + i * 8);
    if ((platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0) {
      const candidate = t.cmap.subarray(offset);
      if (candidate.readUInt16BE(0) === 4) { sub = candidate; break; }
    }
  }
  if (!sub) throw new Error(`${file}: no format 4 cmap subtable`);

  const segX2 = sub.readUInt16BE(6);
  const segments = segX2 / 2;
  const END = 14, START = END + segX2 + 2, DELTA = START + segX2, RANGE = DELTA + segX2;

  function glyphId(cp) {
    for (let i = 0; i < segments; i++) {
      if (sub.readUInt16BE(END + i * 2) < cp) continue;
      const start = sub.readUInt16BE(START + i * 2);
      if (start > cp) return 0;
      const delta = sub.readInt16BE(DELTA + i * 2);
      const rangeOffset = sub.readUInt16BE(RANGE + i * 2);
      if (rangeOffset === 0) return (cp + delta) & 0xffff;
      const at = RANGE + i * 2 + rangeOffset + (cp - start) * 2;
      const g = sub.readUInt16BE(at);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  }

  const locaAt = (i) => (longLoca ? t.loca.readUInt32BE(i * 4) : t.loca.readUInt16BE(i * 2) * 2);
  const advanceOf = (gid) => t.hmtx.readUInt16BE(Math.min(gid, numHMetrics - 1) * 4);

  const show = (cp) =>
    cp >= 32 && cp < 127 ? `'${String.fromCodePoint(cp)}'` : `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

  /**
   * Contours for one codepoint, in font units. Throws rather than returning nothing —
   * see the header. A blank where a word should be is the failure this file exists to fix.
   */
  function glyph(cp) {
    const gid = glyphId(cp);
    if (gid === 0) {
      throw new Error(
        `${show(cp)} is not in this font (${file}). The share images may only use characters ` +
        `the font actually has; nothing may render as a blank.`
      );
    }
    const a = locaAt(gid), b = locaAt(gid + 1);
    if (a === b) return { contours: [], advance: advanceOf(gid) };   // a real space
    const d = t.glyf.subarray(a, b);
    const numContours = d.readInt16BE(0);
    if (numContours < 0) {
      throw new Error(
        `${show(cp)} is a composite glyph and this rasteriser does not assemble composites, ` +
        `so it would draw nothing. Either use a character built from a simple glyph, or ` +
        `implement composites in tools/font.mjs. It must not silently render blank.`
      );
    }
    const ends = [];
    for (let i = 0; i < numContours; i++) ends.push(d.readUInt16BE(10 + i * 2));
    const pointCount = ends[numContours - 1] + 1;
    let p = 10 + numContours * 2;
    p += 2 + d.readUInt16BE(p);                       // skip hinting instructions

    const flags = [];
    while (flags.length < pointCount) {
      const f = d[p++];
      flags.push(f);
      if (f & 8) { let repeat = d[p++]; while (repeat-- > 0) flags.push(f); }
    }
    const xs = []; let x = 0;
    for (const f of flags) {
      if (f & 2) { const dx = d[p++]; x += (f & 16) ? dx : -dx; }
      else if (!(f & 16)) { x += d.readInt16BE(p); p += 2; }
      xs.push(x);
    }
    const ys = []; let y = 0;
    for (const f of flags) {
      if (f & 4) { const dy = d[p++]; y += (f & 32) ? dy : -dy; }
      else if (!(f & 32)) { y += d.readInt16BE(p); p += 2; }
      ys.push(y);
    }
    const contours = [];
    let start = 0;
    for (const end of ends) {
      const pts = [];
      for (let i = start; i <= end; i++) pts.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) });
      contours.push(pts);
      start = end + 1;
    }
    return { contours, advance: advanceOf(gid) };
  }

  return { file, unitsPerEm, numGlyphs, ascender, descender, glyph };
}

/** Flatten one glyph's contours into device-space polygons. */
function polygons(contours, scale, ox, oy) {
  const out = [];
  for (const pts of contours) {
    if (!pts.length) continue;
    const P = pts.slice();
    if (!P[0].on) {
      const i = P.findIndex((q) => q.on);
      if (i === -1) {
        const a = P[0], b = P[P.length - 1];
        P.unshift({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
      } else {
        P.push(...P.splice(0, i));
      }
    }
    const dev = (q) => [ox + q.x * scale, oy - q.y * scale];
    const poly = [dev(P[0])];
    const quad = (control, end) => {
      const [x0, y0] = poly[poly.length - 1];
      const [cx, cy] = dev(control);
      const [x1, y1] = dev(end);
      const steps = Math.max(3, Math.ceil((Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy)) / 2));
      for (let i = 1; i <= steps; i++) {
        const s = i / steps, m = 1 - s;
        poly.push([m * m * x0 + 2 * m * s * cx + s * s * x1, m * m * y0 + 2 * m * s * cy + s * s * y1]);
      }
    };
    for (let i = 1; i <= P.length; i++) {
      const cur = P[i % P.length];
      if (cur.on) { poly.push(dev(cur)); continue; }
      const next = P[(i + 1) % P.length];
      const end = next.on ? next : { x: (cur.x + next.x) / 2, y: (cur.y + next.y) / 2 };
      quad(cur, end);
      if (next.on) i++;
    }
    out.push(poly);
  }
  return out;
}

/** Nonzero-winding scanline fill, four vertical samples a row plus exact horizontal coverage. */
function fillPolygons(bmp, polys, colour) {
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (const poly of polys) {
    for (const [x, y] of poly) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  if (minY > maxY) return;

  const SAMPLES = 4;
  const baseX = Math.floor(minX);
  const width = Math.ceil(maxX) - baseX + 2;
  for (let py = Math.floor(minY); py <= Math.ceil(maxY); py++) {
    const coverage = new Float32Array(width);
    for (let s = 0; s < SAMPLES; s++) {
      const sy = py + (s + 0.5) / SAMPLES;
      const crossings = [];
      for (const poly of polys) {
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) {
            crossings.push({ x: a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), w: b[1] > a[1] ? 1 : -1 });
          }
        }
      }
      crossings.sort((p, q) => p.x - q.x);
      let winding = 0, openAt = null;
      for (const c of crossings) {
        const before = winding;
        winding += c.w;
        if (before === 0 && winding !== 0) openAt = c.x;
        else if (before !== 0 && winding === 0 && openAt !== null) {
          for (let px = Math.floor(openAt); px <= Math.ceil(c.x); px++) {
            const l = Math.max(openAt, px), r = Math.min(c.x, px + 1);
            const i = px - baseX;
            if (r > l && i >= 0 && i < width) coverage[i] += (r - l) / SAMPLES;
          }
          openAt = null;
        }
      }
    }
    for (let i = 0; i < width; i++) {
      const a = Math.min(1, coverage[i]);
      if (a > 0.002) bmp.blend(baseX + i, py, colour, a);
    }
  }
}

/** Advance width of `text` at `size`, in pixels. Same path the drawing takes. */
export function measureText(font, text, size) {
  const scale = size / font.unitsPerEm;
  let w = 0;
  for (const ch of text) w += font.glyph(ch.codePointAt(0)).advance * scale;
  return w * 1;
}

/**
 * Draw `text` with its baseline at `y`, starting at `x`. Returns the advance width.
 * No kerning — see the header.
 */
export function drawText(bmp, font, text, { x, y, size, colour }) {
  // Once, here — not per pixel. bmp.blend refuses a hex string for this reason.
  const ink = typeof colour === 'string' ? rgb(colour) : colour;
  const scale = size / font.unitsPerEm;
  let pen = x;
  for (const ch of text) {
    const { contours, advance } = font.glyph(ch.codePointAt(0));
    if (contours.length) fillPolygons(bmp, polygons(contours, scale, pen, y), ink);
    pen += advance * scale;
  }
  return pen - x;
}
