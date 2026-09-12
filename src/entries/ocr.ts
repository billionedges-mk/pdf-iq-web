/**
 * OCR — read the text off a scan.
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

import { openPdf } from '../lib/open-pdf.js';
import { openDocument, pageHasText } from '../lib/pdfjs.js';
import { readDocumentText, OCR_DPI, type OcrPageResult } from '../lib/ocr-run.js';
import { LANGUAGES } from '../lib/langs.generated.js';
import { ToolShell, Progress, wireDropzone, acceptPdf, saveFile, $, $$, breathe, warnWhileBusy } from '../lib/ui.js';
import { formatBytes, plural, suffixName, describeRanges, seconds } from '../lib/format.js';
import { claimIncoming, wireNextLinks } from '../lib/handoff.js';
import { describeOcr } from '../lib/ocr-result.js';
import * as E from '../lib/errors.js';

const STAGES = ['Loading the language model', 'Reading each page', 'Collecting the text'];

const shell = new ToolShell();
// Recognition is nearly the whole job: on a 30-page scan the model load is a second or two and
// collecting the text is instant, while reading took 47 of the 50 seconds. With equal thirds the
// bar said 66% next to "29 of 30 pages read", which is the sort of disagreement a reader notices
// and cannot resolve.
const progress = new Progress(document, STAGES, [5, 92, 3]);

let file: File | null = null;
let sourceBytes: Uint8Array | null = null;
let pageCount = 0;
let pagesWithText: number[] = [];
let controller: AbortController | null = null;
let busy = false;
let results: OcrPageResult[] = [];
/** The scale each page was actually rendered at, for mapping word boxes back. */
const pageScale = new Map<number, number>();

warnWhileBusy(() => busy);

// No "next tool" links for the free path: its output is text, and there is no PDF to carry into
// Compress or Split. Handing on the *original* would look like a handoff of something we
// produced, which it is not.
//
// A Pro run that writes a searchable copy does produce one, so the links appear then and carry
// that copy. Until 12 September 2026 they did not exist at all, and someone who had just made a
// searchable PDF had no way to take it anywhere: they were left saving it and starting again.
let searchableCopy: { bytes: Uint8Array; name: string } | null = null;

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
  // One run at a time. A second start replaced `controller` — orphaning the first run, which the
  // Stop button could then no longer reach — and reset `results` while the first was still
  // filling it. Watched on 12 September 2026: the page counted to 18 of 30, fell back to 2 of 30,
  // and finished claiming 29 of 30 with the progress line saying 30.
  if (busy) return;
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

    // The pipeline lives in src/lib/ocr-run.ts so that batch runs the same one. Everything the
    // screen shows comes back through these callbacks; nothing about the DOM went with it.
    const read = await readDocumentText(sourceBytes, {
      lang: lang.code,
      signal,
      pagesWithText,
      onModelProgress: (fraction) => {
        $('[data-facts]')!.textContent = `fetching the ${lang.name} model · ${Math.round(fraction * 100)}%`;
      },
      onWorkers: (count) => {
        localStorage.setItem(`pdfiq.lang.${lang.code}`, 'cached');
        $('[data-threads]')!.textContent = `${count} ${count === 1 ? 'worker' : 'workers'}`;
      },
      onPage: (entry, done, total) => {
        markBlock(entry.index, entry.skipped === null);
        const rate = (performance.now() - started) / done;
        progress.set(done, total, 1, `${done} of ${total} pages read`);
        $('[data-rate]')!.textContent = `${(rate / 1000).toFixed(1)}s a page`;
        const left = total - done;
        $('[data-remain]')!.textContent = left > 0 ? `about ${seconds(rate * left)} left` : '';
      },
    });
    results = read.results;
    for (const [index, scale] of read.pageScale) pageScale.set(index, scale);

    if (signal.aborted) {
      progress.stop();
      busy = false;
      shell.show('selected');
      shell.announce('Stopped. Nothing was changed.');
      return;
    }
    const took = performance.now() - started;

    // The third stage was never reported, so a finished run left the bar at 97% and "Collecting
    // the text" marked waiting — a run that had plainly completed, saying it had not. Reporting a
    // stage past the last one marks them all done and fills the bar.
    progress.set(1, 1, STAGES.length, '');
    progress.stop();
    busy = false;
    renderResult(took);
  } catch (err) {
    progress.stop();
    busy = false;
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

  // Generated from what the run produced, not written beside the operation. See
  // src/lib/ocr-result.ts: the free path hands over text, and the describe function refuses
  // to return a sentence claiming a file it did not write.
  const said = describeOcr({
    produced: 'text',
    pagesRead: read.length,
    pageCount,
    fromLayer: read.filter((r) => r.source === 'layer').length,
  });
  $('[data-result-head]')!.textContent = said.head;

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
  shell.announce(said.announce);

  // Pro: a searchable PDF, written from these same results. Absent from a flag-off build: the
  // build defines __PDFIQ_PRO__ false, esbuild drops this branch, and src/pro/ never reaches the
  // bundle. The writer is src/pro/searchable.ts, which used to live on this page.
  if (__PDFIQ_PRO__) {
    const host = $('[data-pro-searchable]');
    if (host) {
      const counts = { pagesRead: read.length, pageCount, fromLayer: read.filter((r) => r.source === 'layer').length };
      const fileName = file!.name;
      const bytes = sourceBytes!;
      const pages = results.map((r) => ({ index: r.index, words: r.words, skipped: r.skipped }));
      void import('../pro/searchable-offer.js').then((m) => m.offerSearchable(host as HTMLElement, {
        fileName,
        sourceBytes: bytes,
        pages,
        scaleFor: (index) => pageScale.get(index) ?? OCR_DPI / 72,
        counts,
        onWritten: (next, copy) => {
          $('[data-result-head]')!.textContent = next.head;
          shell.announce(next.announce);
          // Now there is a file of ours to hand on, so the links appear and carry it.
          searchableCopy = copy;
          const onward = $('[data-pro-next]');
          if (onward) {
            onward.hidden = false;
            wireNextLinks(document, () => searchableCopy);
          }
        },
      }));
    }
  }
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
