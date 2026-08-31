/**
 * The palette behind the share images, read out of the stylesheet the site actually uses.
 *
 * Colours are read out of `src/styles/app.css` rather than written here. A second palette is
 * a second source of truth, and this project has watched two of those drift.
 *
 * This file holds only the palette reader now. The drawing lives in og-images.mjs, which
 * rasterises straight to PNG — see tools/png.mjs for why there is no SVG step and no
 * rasterising dependency.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The palette, from the stylesheet that the site actually uses. */
export function palette() {
  const css = readFileSync(join(ROOT, 'src/styles/app.css'), 'utf8');
  const read = (name) => {
    const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
    if (!m) throw new Error(`--${name} is not in app.css — the share images would invent a palette`);
    return m[1].trim();
  };
  return {
    paper: read('paper'),
    card: read('card'),
    ink: read('ink'),
    amber: read('amber'),
  };
}
