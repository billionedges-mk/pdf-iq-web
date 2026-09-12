/**
 * One mark per tool.
 *
 * The grid used to repeat the brand seam eight times, which meant the icon carried no
 * information: someone scanning the grid learned nothing from it that the label did not
 * already say.
 *
 * Rules these are drawn to, because an icon that reads at 200px routinely collapses at 32:
 *
 *  - 24x24 viewBox, rendered at 20-26px. Nothing thinner than 2 units, no detail below 3.
 *  - Ink is `currentColor` so the mark inherits text colour; amber is one accent per icon,
 *    never the whole mark. Amber is a spark here, not a theme — the seam it replaces was
 *    half amber by area, so eight of these spend less of the budget than what was there.
 *  - Split, Reorder and Merge are all "pages moving about" and are deliberately drawn on
 *    different structures — two panels, stepped bars, and a 2x2 block — rather than three
 *    variations on vertical bars, which is what they would collapse into at 20px.
 *
 * Keyed by slug and required: `npm run build` throws if a tool has no icon, so a new tool
 * cannot ship with a missing or borrowed mark. Same reasoning as TOOLS[].card.
 */

/** Ink shapes use currentColor; the single amber shape carries class="tm-a". */
export const ICONS = {
  // Two slabs pressed together, with the amber one squeezed thin between them. The slabs
  // are full width and the middle is half of it — the contrast is what stops this reading
  // as the OCR mark at 24px, which is what the first version did.
  compress: `
    <rect x="2.5" y="2.5" width="19" height="6" rx="1.5" fill="currentColor"/>
    <rect x="8.5" y="11" width="7" height="2.5" rx="1.25" class="tm-a"/>
    <rect x="2.5" y="15.5" width="19" height="6" rx="1.5" fill="currentColor"/>`,

  // Four blocks becoming one: a 2x2 arrangement, bottom-left arriving.
  merge: `
    <rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor"/>
    <rect x="13" y="3" width="8" height="8" rx="1.5" fill="currentColor"/>
    <rect x="3" y="13" width="8" height="8" rx="1.5" class="tm-a"/>
    <rect x="13" y="13" width="8" height="8" rx="1.5" fill="currentColor"/>`,

  // One sheet cut into two panels, with a clear gutter. Not bars.
  split: `
    <rect x="2.5" y="3" width="8" height="18" rx="1.5" fill="currentColor"/>
    <rect x="13.5" y="3" width="8" height="18" rx="1.5" class="tm-a"/>`,

  // A frame with a horizon and a sun.
  'images-to-pdf': `
    <rect x="2.5" y="4" width="19" height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.4"/>
    <circle cx="8.5" cy="10" r="2" class="tm-a"/>
    <path d="M5 17.5l4.5-4.5 3.5 3.5 3-2.5 3 3.5z" fill="currentColor"/>`,

  // A sheet turned a quarter, with the corner it turned about.
  rotate: `
    <rect x="6" y="6" width="14" height="14" rx="2" transform="rotate(-15 13 13)" fill="currentColor"/>
    <rect x="3" y="3" width="6" height="6" rx="1.5" class="tm-a"/>`,

  // Stepped bars: unmistakably different heights, so it cannot read as Split.
  reorder: `
    <rect x="3" y="13" width="4.5" height="8" rx="1.5" fill="currentColor"/>
    <rect x="9.75" y="3" width="4.5" height="18" rx="1.5" class="tm-a"/>
    <rect x="16.5" y="9" width="4.5" height="12" rx="1.5" fill="currentColor"/>`,

  // Lines of text lifted off a page: four ragged lines, which reads as writing rather than
  // as the two slabs of the Compress mark.
  ocr: `
    <rect x="3" y="3.5" width="14" height="2.6" rx="1.3" class="tm-a"/>
    <rect x="3" y="8.7" width="18" height="2.6" rx="1.3" fill="currentColor"/>
    <rect x="3" y="13.9" width="16" height="2.6" rx="1.3" fill="currentColor"/>
    <rect x="3" y="19.1" width="9" height="2.6" rx="1.3" fill="currentColor"/>`,

  // ---- the routes that are not tools ----
  // These exist because a share card without its subject is what shipped for six routes:
  // ICONS had no entry, the drawing was skipped, and the missing mark looked exactly like a
  // mark that was meant to be absent. Every route has one now and the build throws otherwise.
  // Same rules as above: 24x24, nothing thinner than 2 units, one amber shape.

  // The grid, for the homepage: several tools, one of them lit.
  home: `
    <rect x="2.5" y="2.5" width="8.5" height="8.5" rx="1.5" fill="currentColor"/>
    <rect x="13" y="2.5" width="8.5" height="8.5" rx="1.5" fill="currentColor"/>
    <rect x="2.5" y="13" width="8.5" height="8.5" rx="1.5" fill="currentColor"/>
    <rect x="13" y="13" width="8.5" height="8.5" rx="1.5" class="tm-a"/>`,

  // A closed padlock: shackle as a stroked square above a solid body.
  privacy: `
    <rect x="7" y="3" width="10" height="10" rx="5" fill="none" stroke="currentColor" stroke-width="2.4"/>
    <rect x="3.5" y="11" width="17" height="10.5" rx="2" fill="currentColor"/>
    <rect x="10.75" y="14.5" width="2.5" height="4" rx="1.25" class="tm-a"/>`,

  // A signed sheet: full-width lines and a short one where a name goes.
  terms: `
    <rect x="3.5" y="2.5" width="17" height="19" rx="2" fill="none" stroke="currentColor" stroke-width="2.4"/>
    <rect x="7" y="7" width="10" height="2.2" rx="1.1" fill="currentColor"/>
    <rect x="7" y="11.4" width="10" height="2.2" rx="1.1" fill="currentColor"/>
    <rect x="7" y="15.8" width="5" height="2.2" rx="1.1" class="tm-a"/>`,

  // Money going back: a coin, and a bar returning to the left of it.
  // Pro: the four capabilities as stacked bars, the first picked out — a list with one thing
  // added to it, which is what Pro is rather than a different product.
  pro: `
    <rect x="3" y="3.5" width="18" height="3.2" rx="1.6" class="tm-a"/>
    <rect x="3" y="9" width="18" height="3.2" rx="1.6" fill="currentColor"/>
    <rect x="3" y="14.5" width="18" height="3.2" rx="1.6" fill="currentColor"/>
    <rect x="3" y="20" width="11" height="3.2" rx="1.6" fill="currentColor"/>`,

  refunds: `
    <circle cx="15.5" cy="8.5" r="6" fill="currentColor"/>
    <rect x="2.5" y="14.5" width="19" height="2.8" rx="1.4" fill="currentColor"/>
    <rect x="2.5" y="14.5" width="7" height="2.8" rx="1.4" class="tm-a"/>
    <rect x="2.5" y="19" width="11" height="2.8" rx="1.4" fill="currentColor"/>`,

  // A message and a reply: two stacked panels, the second shorter and set in.
  support: `
    <rect x="2.5" y="3.5" width="19" height="9" rx="2" fill="currentColor"/>
    <rect x="7" y="14.5" width="14.5" height="7" rx="2" class="tm-a"/>`,

  // A building, for firms: two columns and a lintel.
  'for-professionals': `
    <rect x="2.5" y="4" width="19" height="3.4" rx="1.5" class="tm-a"/>
    <rect x="4.5" y="9" width="4" height="9.5" rx="1.5" fill="currentColor"/>
    <rect x="15.5" y="9" width="4" height="9.5" rx="1.5" fill="currentColor"/>
    <rect x="2.5" y="20" width="19" height="2.6" rx="1.3" fill="currentColor"/>`,

  // The probe route is noindex and gets no share image, but the build asks every route for a
  // mark and a route that is exempt-by-accident is the pattern this file exists to stop.
  'memory-probe': `
    <rect x="2.5" y="15" width="4.5" height="6.5" rx="1.5" fill="currentColor"/>
    <rect x="9.75" y="9" width="4.5" height="12.5" rx="1.5" fill="currentColor"/>
    <rect x="17" y="2.5" width="4.5" height="19" rx="1.5" class="tm-a"/>`,

  // A handset.
  app: `
    <rect x="6" y="2.5" width="12" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.4"/>
    <rect x="9.5" y="16" width="5" height="2.6" rx="1.3" class="tm-a"/>`,
};

/** The inline SVG for one slug. Throws rather than rendering a blank card. */
export function icon(slug) {
  const shapes = ICONS[slug];
  if (!shapes) {
    throw new Error(`no icon for '${slug}' — add one to tools/icons.mjs; a card must not ship without a mark`);
  }
  return `<svg class="toolcard__mark" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">${shapes}</svg>`;
}
