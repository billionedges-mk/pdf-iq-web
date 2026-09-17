/**
 * Every glyph the share images could draw is assembled where the font says it is.
 *
 * tools/font.mjs rasterises the share-image type itself. Moving the cards to Inter Tight (stage 5
 * of the redesign) hit the limit its header named: Inter Tight builds `i`, `j` and the comma from
 * components, and the rasteriser threw on composites. Composites are implemented now, and this
 * is how that is known to be right without trusting the eye on a 1200px card.
 *
 * Each glyph in the font carries a bounding box written by the font's compiler, an independent
 * record of where its outline lies. For every glyph reachable from the Latin subset, the box
 * of the contours font.mjs produces must match it. A component offset dropped, a scale read from
 * the wrong bytes, or a transform applied in the wrong order moves the outline off that box.
 * Checked on the unchanged code this failed on the first composite (it threw), and with offsets
 * deliberately ignored it named every composite whose component is not at the origin.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFont } from './font.mjs';
import { SHARE_FONTS } from './og-images.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0, checked = 0;
const composites = new Map();   // file -> composite glyphs checked

for (const file of SHARE_FONTS) {
  const font = loadFont(join(ROOT, file));
  for (let cp = 32; cp <= 0xffff; cp++) {
    const gid = font.glyphId(cp);
    if (!gid) continue;
    const want = font.bbox(gid);
    if (!want) continue;   // a glyph with no outline (space)
    let contours;
    try {
      contours = font.outline(gid, `U+${cp.toString(16)}`, 0);
    } catch (e) {
      failures++;
      console.log(`FAIL  ${file} U+${cp.toString(16).toUpperCase()}: ${e.message}`);
      continue;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const pts of contours) for (const q of pts) {
      x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
    }
    const got = [x0, y0, x1, y1];
    checked++;
    if (font.contourCount(gid) < 0) composites.set(file, (composites.get(file) ?? 0) + 1);
    // Scaled components can round a unit either way when the compiler wrote the box.
    if (got.some((v, i) => !(Math.abs(v - want[i]) <= 1))) {
      failures++;
      console.log(`FAIL  ${file} '${String.fromCodePoint(cp)}' (U+${cp.toString(16).toUpperCase()}): outline box ${got.map(Math.round)}, font says ${want}`);
    }
  }
  if (!composites.has(file)) { failures++; console.log(`FAIL  ${file}: no composite glyph was checked, so this file proves nothing about composites`); }
}

console.log(`${checked} glyphs across ${SHARE_FONTS.length} font files (${[...composites.values()].reduce((s, n) => s + n, 0)} composites), ${failures} misplaced`);
process.exit(failures || !checked ? 1 : 0);
