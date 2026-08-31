/**
 * The share image for one route: paper, an amber rule, the brand seam, and the tool's own
 * mark drawn large. Colours come from app.css; the mark comes from tools/icons.mjs, so a new
 * tool gets a share image without anyone drawing one.
 *
 * The icon's rects and circles are rasterised; its one `path` (the mountain in Images to
 * PDF) is skipped, which leaves the frame and the sun — still that tool's mark and not
 * another's. See tools/png.mjs for why there is no text.
 */
import { Bitmap } from './png.mjs';
import { ICONS } from './icons.mjs';
import { palette } from './og.mjs';

const attr = (tag, name) => {
  const m = new RegExp(`${name}="([^"]+)"`).exec(tag);
  return m ? m[1] : null;
};

export function ogImage(slug) {
  const p = palette();
  const bmp = new Bitmap(1200, 630, p.paper);

  bmp.rect(0, 0, 1200, 12, p.amber);
  bmp.seam(90, 84, 64, p.ink, p.amber);

  const shapes = ICONS[slug];
  if (shapes) {
    // 24-unit viewBox drawn at 420px, centred low-right of the seam.
    const S = 17.5, ox = 640, oy = 150;
    for (const tag of shapes.match(/<(rect|circle)[^>]*\/>/g) ?? []) {
      const amber = /class="tm-a"/.test(tag);
      const colour = amber ? p.amber : p.ink;
      if (tag.startsWith('<circle')) {
        bmp.circle(ox + +attr(tag, 'cx') * S, oy + +attr(tag, 'cy') * S, +attr(tag, 'r') * S, colour);
      } else if (attr(tag, 'fill') === 'none') {
        bmp.strokeRect(ox + +attr(tag, 'x') * S, oy + +attr(tag, 'y') * S,
          +attr(tag, 'width') * S, +attr(tag, 'height') * S, +attr(tag, 'stroke-width') * S, colour);
      } else {
        bmp.rect(ox + +attr(tag, 'x') * S, oy + +attr(tag, 'y') * S,
          +attr(tag, 'width') * S, +attr(tag, 'height') * S, colour);
      }
    }
  }

  // A bar of the site's ink along the foot, so the card reads as one design at thumbnail size.
  bmp.rect(90, 520, 300, 14, p.ink);
  return bmp.toPng();
}
