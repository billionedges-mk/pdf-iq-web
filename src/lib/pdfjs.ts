/**
 * pdf.js setup.
 *
 * Everything it needs — the worker, the CMap tables, the standard font data — is served
 * from this origin. The default build reaches for a CDN, which would break the offline
 * test and would put a third-party request behind a readout that claims zero.
 */

import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';

const COMMON = {
  cMapUrl: '/vendor/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/vendor/standard_fonts/',
  // Never let pdf.js fetch anything the document points at.
  isEvalSupported: false,
} as const;

export type { PDFDocumentProxy, PDFPageProxy };

export interface OpenedDoc {
  doc: PDFDocumentProxy;
  /** Tear down the worker's copy. `destroy` lives on the loading task, not the proxy. */
  close: () => Promise<void>;
}

export async function openDocument(data: Uint8Array, password?: string): Promise<OpenedDoc> {
  // pdf.js takes ownership of the buffer it is handed, so give it a copy — the caller
  // still needs the original bytes to rebuild the file with pdf-lib.
  const task = pdfjs.getDocument({ ...COMMON, data: data.slice(), password });
  const doc = await task.promise;
  return { doc, close: () => task.destroy() };
}

/**
 * Render one page to a canvas at a chosen pixel width.
 *
 * `crisp` controls whether the device pixel ratio is applied. Thumbnails want it, so
 * they are not soft on a retina screen. OCR emphatically does not: at 300 dpi a
 * doubled A4 page is a 4,960 x 7,016 canvas — 35 megapixels, about 139 MB of RGBA —
 * which wedges the tab, and it would silently double the scale the recognised word
 * boxes have to be divided by. Returns the scale actually used so callers that need to
 * map coordinates back are working from the real number rather than the requested one.
 */
export async function renderPage(
  page: PDFPageProxy,
  targetWidth: number,
  canvas: HTMLCanvasElement,
  crisp = true,
  intent: 'display' | 'print' = 'display'
): Promise<number> {
  const base = page.getViewport({ scale: 1 });
  const scale = targetWidth / base.width;
  const viewport = page.getViewport({ scale });
  const ratio = crisp ? Math.min(window.devicePixelRatio || 1, 2) : 1;

  canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
  canvas.height = Math.max(1, Math.floor(viewport.height * ratio));

  // pdf.js v6 takes the canvas itself and owns the context. Handing it a
  // `canvasContext` as well — the pre-v5 form — makes render() hang rather than fail,
  // which is a much worse way to be wrong. Device-pixel scaling goes through the
  // `transform` parameter instead of a setTransform on a context we no longer own.
  await page.render({
    canvas,
    viewport,
    intent,
    transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
  } as Parameters<PDFPageProxy['render']>[0]).promise;
  return scale * ratio;
}

/** Does this page carry selectable text, or is it only a picture of one? */
export async function pageHasText(page: PDFPageProxy): Promise<boolean> {
  const content = await page.getTextContent();
  const chars = content.items.reduce(
    (n, item) => n + ('str' in item ? item.str.trim().length : 0),
    0
  );
  return chars > 12;
}

/**
 * The text a page already carries, read rather than recognised.
 *
 * `pageHasText` above counts these characters and throws them away. A page that already
 * has a text layer does not need OCR at all: the words are in the file, exact, and reading
 * them is instant where recognising them costs a 300 dpi render and a second of Tesseract
 * per page — and would return a guess at characters the document already knows.
 *
 * pdf.js marks the end of a line with `hasEOL`, which is the only structure worth keeping;
 * everything else about position is layout, and this output is meant to be read.
 */
export async function pageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  let out = '';
  for (const item of content.items) {
    if (!('str' in item)) continue;
    out += item.str;
    if ((item as { hasEOL?: boolean }).hasEOL) out += '\n';
    else if (item.str && !item.str.endsWith(' ')) out += ' ';
  }
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
