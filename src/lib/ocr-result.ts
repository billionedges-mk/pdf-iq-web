/**
 * What to say about an OCR run, derived from what the run actually produced.
 *
 * This exists because of a specific failure. The free path was re-scoped to hand the reader
 * the text rather than write a searchable PDF; the code changed, most of the copy changed,
 * and one string did not. The result screen went on saying "16 of 16 pages are now
 * searchable" directly above three buttons offering to copy text, download a .txt and start
 * again. Nothing had been made searchable.
 *
 * That was the fifth time a re-scope landed in the code and in most of the copy while one
 * sentence kept describing the old behaviour, and every one of the five was caught by a
 * person reading the screen rather than by a check.
 *
 * So the sentence is no longer written next to the operation and kept in step by hand. It is
 * generated from `produced` — what the run actually handed over — and the function refuses
 * to return a sentence that claims an artefact the run did not make. A text run cannot
 * render "searchable" because the guard below throws, in the build, before anyone reads it.
 *
 * The guard is deliberately about vocabulary rather than intent. It cannot tell whether a
 * sentence is true; it can tell that a sentence claiming a file came from a run that made
 * none, which is the specific mistake that has actually happened five times.
 */

export type OcrProduced = 'text' | 'searchable-pdf';

export interface OcrOutcome {
  /** What the reader was actually handed. Not what the tool is called. */
  produced: OcrProduced;
  /** Pages that yielded text, whether recognised or read from an existing layer. */
  pagesRead: number;
  /** Pages in the document. */
  pageCount: number;
  /** Of `pagesRead`, how many were read straight out of an existing text layer. */
  fromLayer: number;
  /**
   * For a searchable PDF only: how many pages the saved copy was given a text layer on, as counted
   * by the writer itself (src/pro/searchable.ts). Pages that already had their own layer are not
   * among them: they were searchable before, and nothing was added to them.
   */
  layered?: number;
}

/**
 * Words that assert a file was written. Only meaningful for `produced: 'searchable-pdf'`.
 * "searchable" is here because it is the exact word that survived the re-scope.
 */
const CLAIMS_A_FILE = /\bsearchable\b|\bwritten back\b|\bsaved copy\b/i;

export function describeOcr(o: OcrOutcome): { head: string; announce: string } {
  const { produced, pagesRead, pageCount, fromLayer } = o;

  // A searchable copy is described from the writer's own count, never from what OCR read. A page
  // read out of the file's own text layer was searchable already and was given nothing: the offer
  // once saved a file made only of such pages and said "2 of 2 pages are now searchable".
  if (produced === 'searchable-pdf') {
    const { layered } = o;
    if (layered == null) {
      throw new Error("a searchable-PDF sentence needs the writer's own count of the pages it layered");
    }
    if (layered === 0) {
      throw new Error('this copy was given a text layer on no page, so it cannot be described as having made anything searchable');
    }
    const are = pageCount === 1 ? 'page is' : 'pages are';
    const own = `${fromLayer} already had ${fromLayer === 1 ? 'its' : 'their'} own`;
    return fromLayer
      ? {
        head: `${layered + fromLayer} of ${pageCount} ${are} searchable in the saved copy: ${layered} given a text layer here, ${own}.`,
        announce: `${layered + fromLayer} of ${pageCount} pages are searchable: ${layered} given a text layer here, ${own}.`,
      }
      : {
        head: `${layered} of ${pageCount} ${are} now searchable.`,
        announce: `${layered} of ${pageCount} pages are searchable.`,
      };
  }

  const head = pagesRead === 0
    ? 'No text could be read from this document.'
    : `The text was read from ${pagesRead} of ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}.`;

  const announce = pagesRead === 0
    ? 'No text could be read.'
    : `Text read from ${pagesRead} of ${pageCount} pages.` +
      (fromLayer ? ` ${fromLayer} came from the document's own text layer.` : '');

  // The point of the file. A run that wrote nothing cannot describe itself as having done so.
  if (produced === 'text') {
    for (const [what, s] of [['heading', head], ['announcement', announce]] as const) {
      if (CLAIMS_A_FILE.test(s)) {
        throw new Error(
          `the OCR ${what} claims a file was written, but this run produced text only: "${s}"`
        );
      }
    }
  }

  return { head, announce };
}
