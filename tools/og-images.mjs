/**
 * The share image for one route: the wordmark small at the top, the page's subject large
 * under it, one true line under that, and the route's own mark to the right as support.
 * Colours come from app.css; the type is the site's own Public Sans, read out of the .woff
 * we already ship; the mark comes from tools/icons.mjs.
 *
 * These used to be wordless, and the argument for that was that drawing text needs a native
 * module. It does not — see tools/font.mjs. Being wrong about it cost a real defect, and the
 * defect was not the wordlessness. Six routes had no entry in ICONS, the `if (shapes)` around
 * the mark quietly did nothing, and every share of the homepage went out as a seam, a rule
 * and a short bar on an otherwise empty card. It read as a broken link, and it read that way
 * for weeks, because **a missing mark was indistinguishable from a mark that was meant to be
 * absent.** That is the bug. The empty card was only its symptom.
 *
 * So there is no fallback anywhere in this file. Three things throw:
 *
 *   - `mark()` on a slug with no entry in ICONS. Not a default mark, not a skip.
 *   - a route with no `ogSubject` or `ogLine` in site.mjs, so a new route cannot inherit a
 *     claim that happens to be false for it. Two already are: /app describes software that
 *     contacts Firebase on launch, and /for-professionals is the one page on this site that
 *     posts anything. Neither may say "Nothing leaves your device".
 *   - `assertNotBlank`, which is the check the old cards would have failed. They generated
 *     cleanly, had the right dimensions, were valid PNGs of a plausible size, and said
 *     nothing. Every check we had passed. Only opening one would have caught it, so this
 *     measures the thing opening it would have told you: how much of the card is not paper.
 */
import { Bitmap } from './png.mjs';
import { ICONS } from './icons.mjs';
import { palette } from './og.mjs';
import { loadFont, drawText, measureText } from './font.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONTS = join(ROOT, 'node_modules/@fontsource/public-sans/files');

const W = 1200, H = 630;
const LEFT = 90;
const MARK_LEFT = 830;          // the text may not cross this

let fonts = null;
function type() {
  if (!fonts) {
    fonts = {
      bold: loadFont(join(FONTS, 'public-sans-latin-800-normal.woff')),
      mid: loadFont(join(FONTS, 'public-sans-latin-700-normal.woff')),
    };
  }
  return fonts;
}

const attr = (tag, name) => {
  const m = new RegExp(`${name}="([^"]+)"`).exec(tag);
  return m ? m[1] : null;
};

/** The route's mark, at `size`, top-left at `x,y`. Throws for a slug with no mark. */
function mark(bmp, slug, x, y, size, p) {
  const shapes = ICONS[slug];
  if (!shapes) {
    throw new Error(
      `no mark in tools/icons.mjs for '${slug}', so its share image would be drawn without ` +
      `its subject. Add one — there is deliberately no default. Six routes shipped an ` +
      `almost-empty card for weeks because this case used to be a silent skip.`
    );
  }
  const S = size / 24;
  const drawn = shapes.match(/<(rect|circle)[^>]*\/>/g) ?? [];
  if (!drawn.length) throw new Error(`the mark for '${slug}' has no rasterisable shape`);
  for (const tag of drawn) {
    const colour = /class="tm-a"/.test(tag) ? p.amber : p.ink;
    if (tag.startsWith('<circle')) {
      bmp.circle(x + +attr(tag, 'cx') * S, y + +attr(tag, 'cy') * S, +attr(tag, 'r') * S, colour);
    } else if (attr(tag, 'fill') === 'none') {
      bmp.strokeRect(x + +attr(tag, 'x') * S, y + +attr(tag, 'y') * S,
        +attr(tag, 'width') * S, +attr(tag, 'height') * S, +attr(tag, 'stroke-width') * S, colour);
    } else {
      // rx was ignored, so every mark rasterised as hard blocks rather than the drawn shape.
      bmp.roundRect(x + +attr(tag, 'x') * S, y + +attr(tag, 'y') * S,
        +attr(tag, 'width') * S, +attr(tag, 'height') * S, +(attr(tag, 'rx') ?? 0) * S, colour);
    }
  }
}

/** Fraction of the card that is not the background colour. */
export function inkedFraction(bmp, background) {
  const n = parseInt(background.slice(1), 16);
  const bg = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  let inked = 0;
  for (let i = 0; i < bmp.px.length; i += 3) {
    if (bmp.px[i] !== bg[0] || bmp.px[i + 1] !== bg[1] || bmp.px[i + 2] !== bg[2]) inked++;
  }
  return inked / (bmp.w * bmp.h);
}

export function ogImage(route) {
  if (typeof route === 'string') {
    throw new Error('ogImage takes the route object now, not a slug — it needs ogSubject and ogLine');
  }
  const slug = route.slug || 'home';
  const { ogSubject, ogLine } = route;
  if (!ogSubject) throw new Error(`route '${slug}' has no ogSubject — its card would have no subject`);
  if (!ogLine) {
    throw new Error(
      `route '${slug}' has no ogLine. Every card carries one claim and it must be true of ` +
      `that route; there is no shared default, because "Nothing leaves your device" is false ` +
      `for /app and for /for-professionals.`
    );
  }

  const p = palette();
  const f = type();
  const bmp = new Bitmap(W, H, p.paper);

  bmp.rect(0, 0, W, 12, p.amber);
  bmp.seam(LEFT, 96, 44, p.ink, p.amber);
  drawText(bmp, f.bold, 'pdf-iq', { x: LEFT + 62, y: 96 + 36, size: 44, colour: p.ink });

  // The subject, as large as it fits without reaching the mark.
  const room = MARK_LEFT - LEFT - 30;
  let size = 100;
  while (size > 46 && measureText(f.bold, ogSubject, size) > room) size -= 2;
  drawText(bmp, f.bold, ogSubject, { x: LEFT, y: 360, size, colour: p.ink });

  drawText(bmp, f.mid, ogLine, { x: LEFT, y: 440, size: 38, colour: p.ink });

  // Supporting, not the subject: right, vertically centred, a third of its old size.
  mark(bmp, slug, MARK_LEFT, 250, 200, p);

  bmp.rect(LEFT, 522, 260, 10, p.ink);

  const inked = inkedFraction(bmp, p.paper);
  if (inked < 0.04) {
    throw new Error(
      `the share image for '${slug}' is ${(inked * 100).toFixed(1)}% inked — effectively blank. ` +
      `The wordless cards sat at about 3% and passed every check for weeks.`
    );
  }
  return bmp.toPng();
}
