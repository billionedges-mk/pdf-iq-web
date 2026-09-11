/**
 * The searchable-PDF output: the recognised words written back into the PDF as an invisible
 * text layer, so the file itself can be searched and copied from. The scan is not changed.
 *
 * This is the function that lived in src/entries/ocr.ts as an uncalled `writeLayer()`, kept
 * alive — along with the round-trip test in src/test/tools-selftest.ts that covers
 * src/lib/textlayer.ts — precisely so this moment would not need it rewritten against a library
 * nothing had exercised in months. It moved here unchanged in substance; what changed is that its
 * inputs are now parameters instead of the OCR page's module state, so it can be tested on its
 * own (tools/verify-pro-features.mjs) and reached only through the Pro flag.
 *
 * No DOM here: the button that calls it is src/pro/searchable-offer.ts.
 */
import { PDFDocument } from 'pdf-lib';
import {
  TextLayerFont, buildTextOperators, attachFont, appendContentStream,
  type OcrWord, type PageGeometry,
} from '../lib/textlayer.js';

export const SEARCHABLE_SENTINEL = 'pdfiq-pro:searchable';

export interface SearchablePage {
  /** Zero-based page index. */
  index: number;
  words: OcrWord[];
  /** Pages that were skipped get no layer: nothing was read from them. */
  skipped: null | string;
}

/**
 * Pages a searchable copy would give a layer to: read by OCR, not skipped, and carrying recognised
 * words. A page read out of the file's own text layer arrives with no words — it was searchable
 * already — so a file made only of those has nothing to gain, and the offer says so rather than
 * saving a re-saved copy with nothing added.
 */
export function pagesToLayer(pages: SearchablePage[]): number {
  return pages.filter((p) => !p.skipped && p.words.some((w) => w.text.trim())).length;
}

/**
 * @param scaleFor the render scale the words' coordinates were measured at, per page — the
 *   OCR page renders at 300 dpi, and a page it could not render at that size records its own.
 * @returns the file, and how many pages it gave a layer. Counted here, where the layer is
 *   appended, because the result sentence is built from it.
 */
export async function writeSearchable(
  sourceBytes: Uint8Array,
  pages: SearchablePage[],
  scaleFor: (index: number) => number,
): Promise<{ bytes: Uint8Array; layered: number }> {
  const doc = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  const docPages = doc.getPages();

  const font = new TextLayerFont();
  for (const page of pages) {
    if (page.skipped) continue;
    for (const word of page.words) font.register(word.text.trim());
  }
  const fontRef = font.embed(doc);
  const fontName = 'PdfiqOcr';
  let layered = 0;

  for (const page of pages) {
    if (page.skipped) continue;
    const target = docPages[page.index];
    if (!target) continue;

    const { width, height } = target.getSize();
    const rotation = ((target.getRotation().angle % 360) + 360) % 360;
    const geometry: PageGeometry = {
      widthPt: width,
      heightPt: height,
      rotation,
      scale: scaleFor(page.index),
    };

    const ops = buildTextOperators(page.words, geometry, font, fontName);
    if (!ops) continue;

    attachFont(target, fontRef, fontName);
    appendContentStream(doc, target, ops);
    layered++;
  }

  return { bytes: await doc.save({ useObjectStreams: true }), layered };
}

/** Referenced so the sentinel survives minification in the bundle that carries this module. */
export function searchableMark(): string {
  return SEARCHABLE_SENTINEL;
}
