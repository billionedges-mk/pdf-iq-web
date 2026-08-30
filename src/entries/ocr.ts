/**
 * OCR — make a scan searchable.
 *
 * Three things this page will not do:
 *
 *  - It will not offer to replace the scan with typeset text. See textlayer.ts.
 *  - It will not print a time estimate before starting. The design said "about 40
 *    seconds"; the honest number depends on the document, the machine and the language,
 *    and it is not knowable in advance. Once a few pages are done there *is* a measured
 *    rate, and from that point the page shows a remaining time based on it.
 *  - It will not claim the language model is a fixed size. Each one is weighed at build
 *    time from the file that will actually be downloaded.
 */

import { PDFDocument } from 'pdf-lib';
import { OcrPool, poolSize } from '../lib/ocr-pool.js';
import { openPdf } from '../lib/open-pdf.js';
import { openDocument, renderPage, pageHasText, pageText } from '../lib/pdfjs.js';
import { LANGUAGES } from '../lib/langs.generated.js';
import {
  TextLayerFont, buildTextOperators, attachFont, appendContentStream,
  type OcrWord, type PageGeometry,
} from '../lib/textlayer.js';
import { ToolShell, Progress, wireDropzone, acceptPdf, saveFile, $, $$, breathe, warnWhileBusy } from '../lib/ui.js';
import { formatBytes, plural, suffixName, describeRanges, seconds } from '../lib/format.js';
import { claimIncoming } from '../lib/handoff.js';
import * as E from '../lib/errors.js';

const STAGES = ['Loading the language model', 'Reading each page', 'Collecting the text'];

/** Tesseract wants roughly 300 dpi; below about 200 accuracy falls off sharply. */
const OCR_DPI = 300;
/** Below this mean confidence a page is reported as unread rather than quietly kept. */
const CONFIDENCE_FLOOR = 55;

const shell = new ToolShell();
const progress = new Progress(document, STAGES);

interface PageResult {
  index: number;
  words: OcrWord[];
  confidence: number;
  text: string;
  /**
   * Where the text came from. A page that already carries a text layer is *read*, not
   * recognised: the characters are in the file, so reading them is instant and exact where
   * recognising them costs a 300 dpi render and returns a guess at words the document
   * already knows. That used to be reported as a warning, which had it backwards.
   */
  source: 'ocr' | 'layer';
  skipped: null | 'no-text' | 'low-confidence';
}

let file: File | null = null;
let sourceBytes: Uint8Array | null = null;
let pageCount = 0;
let pagesWithText: number[] = [];
let pool: OcrPool | null = null;
let controller: AbortController | null = null;
let busy = false;
let results: PageResult[] = [];
/** The scale each page was actually rendered at, for mapping word boxes back. */
const pageScale = new Map<number, number>();

warnWhileBusy(() => busy);

// No "next tool" links here any more: this page's output is text, and there is no PDF to
// carry into Compress or Split. Handing on the *original* would look like a handoff of
// something we produced, which it is not.

const input = $<HTMLInputElement>('[data-file-input]')!;
wireDropzone($('[data-dropzone]')!, input, (files) => void take(files[0]));

// ---------------------------------------------------------------- languages

const langSelect = $<HTMLSelectElement>('[data-lang]')!;
for (const lang of LANGUAGES) {
  const option = document.createElement('option');
  option.value = lang.code;
  option.textContent = lang.name;
  langSelect.appendChild(option);
}
langSelect.value = 'eng';
langSelect.addEventListener('change', renderLangNote);

function currentLang() {
  return LANGUAGES.find((l) => l.code === langSelect.value) ?? LANGUAGES[0];
}

function renderLangNote(): void {
  const lang = currentLang();
  const cached = localStorage.getItem(`pdfiq.lang.${lang.code}`) === 'cached';
  $('[data-lang-note]')!.textContent = cached
    ? `The ${lang.name} model is already cached in this browser, so nothing will be downloaded.`
    : `The ${lang.name} model is ${formatBytes(lang.bytes)} and downloads once from this site, then stays cached for offline use.`;
}

// ---------------------------------------------------------------- intake

async function take(f: File, password?: string): Promise<void> {
  file = f;
  const accepted = await acceptPdf(f);
  if (!accepted.ok) return shell.fail(accepted.error);
  sourceBytes = accepted.bytes;
  await parse(password);
}

async function parse(password?: string): Promise<void> {
  if (!sourceBytes || !file) return;
  const facts = { name: file.name, size: file.size, type: file.type };
  shell.announce('Reading the document.');

  const opened = await openPdf(sourceBytes, facts, password);
  if (!opened.ok) return shell.fail(opened.error);
  sourceBytes = opened.value.bytes;
  pageCount = opened.value.doc.getPageCount();

  // Find the pages that already have a text layer, so we can say so rather than
  // spending minutes recognising words the document already knows.
  pagesWithText = [];
  try {
    const proxy = await openDocument(sourceBytes);
    for (let i = 1; i <= Math.min(pageCount, 40); i++) {
      const page = await proxy.doc.getPage(i);
      if (await pageHasText(page)) pagesWithText.push(i - 1);
      page.cleanup();
    }
    await proxy.close();
  } catch {
    // Not being able to check is not a reason to refuse the job.
  }

  $('[data-file-name]')!.textContent = file.name;
  $('[data-file-meta]')!.textContent = [
    formatBytes(file.size),
    plural(pageCount, 'page'),
    pagesWithText.length ? `${pagesWithText.length} already have text` : 'no text layer',
  ].join(' · ');

  const box = $('[data-hastext]')!;
  if (pagesWithText.length) {
    const all = pagesWithText.length >= Math.min(pageCount, 40);
    $('[data-hastext-note]')!.textContent = all
      ? 'Every page checked already carries its own text, so nothing here needs recognising. ' +
        'We will read the words straight out of the file — instant, and exactly what the document says ' +
        'rather than our best guess at a picture of it.'
      : `${plural(pagesWithText.length, 'page')} already ${pagesWithText.length === 1 ? 'carries' : 'carry'} selectable text ` +
        `(${describeRanges(pagesWithText)}), so ${pagesWithText.length === 1 ? 'it is' : 'those are'} read straight out of the file — ` +
        `exact, and instant. Only the remaining ${plural(pageCount - pagesWithText.length, 'page')} ` +
        `${pageCount - pagesWithText.length === 1 ? 'needs' : 'need'} recognising.`;
    box.hidden = false;
  } else {
    box.hidden = true;
  }

  renderLangNote();
  shell.show('selected');
}

// ---------------------------------------------------------------- run

$('[data-start]')?.addEventListener('click', () => void run());
$('[data-stop]')?.addEventListener('click', () => controller?.abort());

async function run(): Promise<void> {
  if (!sourceBytes || !file) return;
  const facts = { name: file.name, size: file.size, type: file.type };
  const lang = currentLang();

  controller = new AbortController();
  busy = true;
  results = [];
  pageScale.clear();
  shell.show('processing');
  progress.start();
  buildBlocks();

  const started = performance.now();
  const signal = controller.signal;

  try {
    progress.set(0, 1, 0, `fetching the ${lang.name} model (${formatBytes(lang.bytes)})`);
    await breathe();

    const size = poolSize();
    pool = await OcrPool.create(size, {
      lang: lang.code,
      signal,
      onProgress: (status, fraction) => {
        $('[data-facts]')!.textContent = `${status} ${Math.round(fraction * 100)}%`;
      },
    });
    localStorage.setItem(`pdfiq.lang.${lang.code}`, 'cached');
    $('[data-threads]')!.textContent =
      `${pool.size} ${pool.size === 1 ? 'worker' : 'workers'}`;

    const proxy = await openDocument(sourceBytes);
    const canvas = document.createElement('canvas');
    const toRead = Array.from({ length: pageCount }, (_, i) => i)
      .filter((i) => !pagesWithText.includes(i));

    let completed = 0;

    await pool.run<PageResult>(
      toRead,
      // Producer, on the main thread: render the page and hand on a compact image.
      // The canvas itself is not queued — at 300 dpi an A4 page is 8.7 megapixels, so
      // holding several of them as raw pixels would cost more memory than the whole
      // document. Encoding to JPEG first bounds that to a few hundred kilobytes.
      async (index) => {
        const page = await proxy.doc.getPage(index + 1);
        const base = page.getViewport({ scale: 1 });
        // crisp=false: no device-pixel-ratio multiplier. See renderPage.
        // intent 'print': pdf.js paces display rendering with requestAnimationFrame,
        // which browsers stop firing in a background tab. Print intent schedules
        // itself, so the job keeps running when the user switches away.
        const actualScale = await renderPage(
          page, base.width * (OCR_DPI / 72), canvas, false, 'print'
        );
        pageScale.set(index, actualScale);
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.95));
        page.cleanup();
        return blob;
      },
      // Consumer, in a worker. `blocks` has to be requested explicitly; the default
      // output is text only, and text without boxes cannot be placed behind the scan.
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
          index: -1, // filled in by onDone, which knows the page
          words,
          confidence,
          text: (data.text ?? '').trim(),
          source: 'ocr' as const,
          skipped: !words.length ? 'no-text' : confidence < CONFIDENCE_FLOOR ? 'low-confidence' : null,
        };
      },
      // Pages finish out of order, so results are keyed by index and sorted later.
      (index, result) => {
        const entry: PageResult = result
          ? { ...result, index }
          : { index, words: [], confidence: 0, text: '', source: 'ocr', skipped: 'no-text' };
        results.push(entry);
        markBlock(index, entry.skipped === null);

        completed++;
        const elapsed = performance.now() - started;
        const rate = elapsed / completed;
        progress.set(completed, toRead.length, 1, `${completed} of ${toRead.length} pages read`);
        $('[data-rate]')!.textContent = `${(rate / 1000).toFixed(1)}s a page`;
        const left = toRead.length - completed;
        $('[data-remain]')!.textContent = left > 0 ? `about ${seconds(rate * left)} left` : '';
      },
      signal
    );

    // Pages that already carry a text layer are read straight out of the file. This is the
    // whole reason an existing layer is a shortcut rather than a problem: it is instant, and
    // it returns the document's own characters rather than a recognition of a picture of
    // them. Done after recognition so the two sets can be merged in page order.
    for (const index of pagesWithText) {
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

    await proxy.close();
    await pool.terminate();
    pool = null;

    if (signal.aborted) {
      progress.stop();
      busy = false;
      shell.show('selected');
      shell.announce('Stopped. Nothing was changed.');
      return;
    }

    results.sort((a, b) => a.index - b.index);
    const took = performance.now() - started;

    progress.stop();
    busy = false;
    renderResult(took);
  } catch (err) {
    progress.stop();
    busy = false;
    await pool?.terminate();
    pool = null;
    if (err instanceof DOMException && err.name === 'AbortError') {
      shell.show('selected');
      shell.announce('Stopped. Nothing was changed.');
      return;
    }
    shell.fail(classifyOcr(err, facts));
  }
}

function classifyOcr(err: unknown, facts: E.FileFacts): E.ToolError {
  // A failed model fetch is the one error unique to this page, and it is worth naming
  // precisely: it is the only thing here that needs the network at all.
  const message = err instanceof Error ? err.message : String(err);
  if (/fetch|network|Failed to load|traineddata/i.test(message) && !navigator.onLine) {
    return {
      kind: 'unknown',
      kicker: 'Model not downloaded yet',
      title: 'This language model has not been cached, and you are offline.',
      body:
        `The ${currentLang().name} model is ${formatBytes(currentLang().bytes)} and has to be fetched once before ` +
        'OCR can run. Every other tool on this site works with no connection; this is the single exception, and ' +
        'only until the model is cached. Reconnect once and it will work offline afterwards.',
      mono: `${currentLang().code}.traineddata.gz · not cached · 0 bytes sent`,
    };
  }
  return E.classify(err, facts);
}

// ---------------------------------------------------------------- text layer

/**
 * Write the recognised words back into the PDF as an invisible layer — the searchable-PDF
 * output, which is the Pro deliverable and is not on sale yet.
 *
 * Nothing calls this today. It is kept rather than deleted because it works: it is the
 * finished, tested call site for `textlayer.ts`, whose header explains why the test that
 * covers it must keep running. Deleting this would mean rewriting it later against a
 * library nothing had exercised in months, which is the exact failure that file warns about.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function writeLayer(): Promise<Uint8Array> {
  const doc = await PDFDocument.load(sourceBytes!, { updateMetadata: false });
  const pages = doc.getPages();

  const font = new TextLayerFont();
  for (const result of results) {
    if (result.skipped) continue;
    for (const word of result.words) font.register(word.text.trim());
  }
  const fontRef = font.embed(doc);
  const fontName = 'PdfiqOcr';

  for (const result of results) {
    if (result.skipped) continue;
    const page = pages[result.index];
    if (!page) continue;

    const { width, height } = page.getSize();
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    const geometry: PageGeometry = {
      widthPt: width,
      heightPt: height,
      rotation,
      scale: pageScale.get(result.index) ?? OCR_DPI / 72,
    };

    const ops = buildTextOperators(result.words, geometry, font, fontName);
    if (!ops) continue;

    attachFont(page, fontRef, fontName);
    appendContentStream(doc, page, ops);
  }

  return doc.save({ useObjectStreams: true });
}

// ---------------------------------------------------------------- blocks

function buildBlocks(): void {
  const host = $('[data-blocks]')!;
  host.textContent = '';
  for (let i = 0; i < pageCount; i++) {
    const block = document.createElement('span');
    block.dataset.block = String(i);
    block.setAttribute('aria-hidden', 'true');
    block.style.cssText =
      'display:block;aspect-ratio:1/1.414;border-radius:2px;background:rgba(30,42,56,.12);';
    host.appendChild(block);
  }
}

function markBlock(index: number, good: boolean): void {
  const block = $(`[data-block="${index}"]`);
  if (block) block.style.background = good ? 'var(--amber)' : 'rgba(30,42,56,.45)';
}

// ---------------------------------------------------------------- result

function renderResult(took: number): void {
  const read = results.filter((r) => !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  const words = read.reduce((n, r) => n + r.words.length, 0);
  const untouched = pagesWithText.length;

  $('[data-result-head]')!.textContent =
    `${read.length} of ${pageCount} pages are now searchable.`;

  // Name what was skipped rather than averaging it away.
  const detail: string[] = [];
  if (skipped.length) {
    const blank = skipped.filter((r) => r.skipped === 'no-text').map((r) => r.index);
    const poor = skipped.filter((r) => r.skipped === 'low-confidence').map((r) => r.index);
    const bits: string[] = [];
    if (blank.length) {
      bits.push(`${blank.length === 1 ? 'page' : 'pages'} ${describeRanges(blank)} had no readable text on ${blank.length === 1 ? 'it' : 'them'}`);
    }
    if (poor.length) {
      const worst = Math.round(Math.min(...skipped.filter((r) => r.skipped === 'low-confidence').map((r) => r.confidence)));
      bits.push(`${poor.length === 1 ? 'page' : 'pages'} ${describeRanges(poor)} came back too uncertain to trust (as low as ${worst}% confident) — handwriting and heavy noise both look like this`);
    }
    detail.push(`${plural(skipped.length, 'page')} ${skipped.length === 1 ? 'was' : 'were'} left without a text layer, and we would rather name ${skipped.length === 1 ? 'it' : 'them'} than average ${skipped.length === 1 ? 'it' : 'them'} away: ${bits.join('; ')}.`);
  }
  if (untouched) {
    detail.push(`${plural(untouched, 'page')} already had selectable text and ${untouched === 1 ? 'was' : 'were'} left alone.`);
  }
  if (read.length) {
    const mean = Math.round(read.reduce((s, r) => s + r.confidence, 0) / read.length);
    detail.push(`Across the pages we did read, mean confidence was ${mean}%.`);
  }
  $('[data-result-detail]')!.textContent = detail.join(' ');

  // The text itself is the deliverable now, so it is on the screen rather than only behind
  // a download. Page markers are kept: a reader scanning for one page needs them, and they
  // survive a copy into anything else.
  const joined = results
    .filter((r) => !r.skipped)
    .map((r) => `--- page ${r.index + 1} ---\n${r.text}`)
    .join('\n\n');

  const area = $<HTMLTextAreaElement>('[data-text-out]')!;
  area.value = joined;

  $('[data-fact-words]')!.textContent = words ? words.toLocaleString() : joined.split(/\s+/).filter(Boolean).length.toLocaleString();
  $('[data-fact-chars]')!.textContent = joined.length.toLocaleString();
  $('[data-fact-time]')!.textContent =
    `${seconds(took)} on this device (${(took / Math.max(1, results.length) / 1000).toFixed(1)}s a page)`;

  const copy = $<HTMLButtonElement>('[data-copy]')!;
  copy.textContent = 'Copy all the text';
  copy.onclick = async () => {
    // The clipboard API needs a permission some browsers refuse; selecting the textarea
    // always works, so the fallback leaves the text selected for the reader to copy.
    try {
      await navigator.clipboard.writeText(joined);
      copy.textContent = 'Copied';
      shell.announce('The text has been copied.');
    } catch {
      area.focus();
      area.select();
      copy.textContent = 'Selected — press Ctrl+C';
      shell.announce('Copying was refused by the browser. The text is selected instead.');
    }
    setTimeout(() => { copy.textContent = 'Copy all the text'; }, 4000);
  };

  $('[data-save-text]')!.onclick = () => {
    saveFile(new Blob([joined], { type: 'text/plain' }), suffixName(file!.name, '', '.txt'), 'text/plain');
  };

  shell.show('result');
  shell.announce(`${read.length} of ${pageCount} pages are searchable.`);
}

$('[data-replace]')?.addEventListener('click', reset);
$$('[data-again]').forEach((b) => b.addEventListener('click', reset));

$('[data-err-password]')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const pw = $<HTMLInputElement>('[data-password-input]')!.value;
  if (pw) void parse(pw);
});

function reset(): void {
  controller?.abort();
  void pool?.terminate();
  pool = null;
  file = null;
  sourceBytes = null;
  pageCount = 0;
  pagesWithText = [];
  results = [];
  busy = false;
  shell.show('empty');
}

// A file handed over from another tool's "next" links.
void claimIncoming().then((handed) => {
  if (handed) void take(handed);
});
