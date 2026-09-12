/**
 * Reading the text out of a document: the pipeline, without a screen around it.
 *
 * This was inside src/entries/ocr.ts, wound through that page's progress bar, page blocks and
 * rate line. Batch needs the same work across many files, and a second implementation of OCR is
 * the kind of divergence this project keeps paying for — two paths that agree until the day one
 * of them is fixed. So the pipeline moved here and the page kept its screen: everything DOM comes
 * back through callbacks.
 *
 * What it does, in order, and why:
 *
 *   - Pages that already carry a text layer are read straight out of the file rather than
 *     recognised. It is instant, and it returns the document's own characters instead of a
 *     recognition of a picture of them.
 *   - Every other page is rendered at 300 dpi and recognised in a worker pool. The canvas is not
 *     queued: at 300 dpi an A4 page is 8.7 megapixels, so holding several as raw pixels would
 *     cost more than the document. Each page is encoded to JPEG first, which bounds it.
 *   - Rendering uses print intent. pdf.js paces display rendering with requestAnimationFrame,
 *     which browsers stop firing in a background tab; print intent schedules itself, so a run
 *     keeps going when someone switches away — which they will, on a long document.
 *   - Words come back with boxes because a searchable layer cannot be placed without them, and
 *     the confidence floor marks a page as read poorly rather than averaging it away.
 */
import { OcrPool, poolSize } from './ocr-pool.js';
import { openDocument, renderPage, pageHasText, pageText } from './pdfjs.js';
import type { OcrWord } from './textlayer.js';

/** The resolution pages are rendered at before recognition. */
export const OCR_DPI = 300;

/** Below this mean confidence a page is reported as read poorly, not as read. */
export const CONFIDENCE_FLOOR = 55;

export interface OcrPageResult {
  index: number;
  words: OcrWord[];
  confidence: number;
  text: string;
  source: 'ocr' | 'layer';
  skipped: null | 'no-text' | 'low-confidence';
}

export interface ReadTextOptions {
  /** Tesseract language code, e.g. 'eng'. */
  lang: string;
  signal: AbortSignal;
  /** Pages known to carry a text layer. Worked out here when not given. */
  pagesWithText?: number[];
  /** While the language model loads, 0..1. Nothing else reports until it is ready. */
  onModelProgress?(fraction: number): void;
  /** How many workers the pool actually started. */
  onWorkers?(count: number): void;
  /** After each recognised page, in completion order — which is not page order. */
  onPage?(result: OcrPageResult, done: number, total: number): void;
}

export interface ReadTextResult {
  /** One per page, sorted by page index. */
  results: OcrPageResult[];
  /** The render scale each recognised page was measured at, for placing a text layer. */
  pageScale: Map<number, number>;
  pageCount: number;
  /** How many of the results came from the document's own text layer. */
  fromLayer: number;
}

export async function readDocumentText(bytes: Uint8Array, opts: ReadTextOptions): Promise<ReadTextResult> {
  const { lang, signal } = opts;
  const results: OcrPageResult[] = [];
  const pageScale = new Map<number, number>();

  const proxy = await openDocument(bytes);
  let pool: OcrPool | null = null;
  try {
    const pageCount = proxy.doc.numPages;

    let withText = opts.pagesWithText;
    if (!withText) {
      withText = [];
      for (let i = 0; i < pageCount; i++) {
        const page = await proxy.doc.getPage(i + 1);
        if (await pageHasText(page)) withText.push(i);
        page.cleanup();
      }
    }

    const toRead = Array.from({ length: pageCount }, (_, i) => i).filter((i) => !withText.includes(i));

    if (toRead.length) {
      let modelReady = false;
      pool = await OcrPool.create(poolSize(), {
        lang,
        signal,
        onProgress: (_status, fraction) => {
          if (!modelReady) opts.onModelProgress?.(fraction);
        },
      });
      modelReady = true;
      opts.onWorkers?.(pool.size);

      const canvas = document.createElement('canvas');
      let completed = 0;

      await pool.run<OcrPageResult>(
        toRead,
        async (index) => {
          const page = await proxy.doc.getPage(index + 1);
          const base = page.getViewport({ scale: 1 });
          const actualScale = await renderPage(page, base.width * (OCR_DPI / 72), canvas, false, 'print');
          pageScale.set(index, actualScale);
          const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.95));
          page.cleanup();
          return blob;
        },
        async (worker, image) => {
          const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
          const words: OcrWord[] = [];
          for (const block of data.blocks ?? []) {
            for (const paragraph of block.paragraphs ?? []) {
              for (const line of paragraph.lines ?? []) {
                for (const w of line.words ?? []) {
                  if (!w.text.trim()) continue;
                  words.push({
                    text: w.text,
                    x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1,
                    confidence: w.confidence,
                  });
                }
              }
            }
          }
          const confidence = words.length
            ? words.reduce((sum, w) => sum + w.confidence, 0) / words.length
            : 0;
          return {
            index: -1, // filled in below, where the page is known
            words,
            confidence,
            text: (data.text ?? '').trim(),
            source: 'ocr' as const,
            skipped: !words.length ? 'no-text' : confidence < CONFIDENCE_FLOOR ? 'low-confidence' : null,
          };
        },
        // Pages finish out of order, so results carry their index and are sorted at the end.
        (index, result) => {
          const entry: OcrPageResult = result
            ? { ...result, index }
            : { index, words: [], confidence: 0, text: '', source: 'ocr', skipped: 'no-text' };
          results.push(entry);
          completed++;
          opts.onPage?.(entry, completed, toRead.length);
        },
        signal,
      );
    }

    // Done after recognition so the two sets can be merged in page order.
    for (const index of withText) {
      const page = await proxy.doc.getPage(index + 1);
      const text = await pageText(page);
      page.cleanup();
      results.push({
        index,
        words: [],
        confidence: 100,
        text,
        source: 'layer',
        skipped: text ? null : 'no-text',
      });
    }

    results.sort((a, b) => a.index - b.index);
    return {
      results,
      pageScale,
      pageCount,
      fromLayer: results.filter((r) => r.source === 'layer' && !r.skipped).length,
    };
  } finally {
    await pool?.terminate();
    await proxy.close();
  }
}
