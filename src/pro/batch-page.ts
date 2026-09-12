/**
 * /batch/ — one operation across many files. Pro, and preview-only like the rest of it.
 *
 * The decisions live in src/pro/batch.ts, which is driven in Node by tools/verify-batch.mjs. This
 * file is the screen and the wiring: it turns the three operations into real work using the same
 * libraries the single-file tools use — `analyse`/`compress` from src/lib/compress.ts,
 * `readDocumentText` from src/lib/ocr-run.ts, pdf-lib for rotation — so a batch cannot drift away
 * from what the tool pages do to the same document.
 *
 * What a person is promised here, from docs/batch.md:
 *
 *   - one zip per run, entries keeping the names they arrived with;
 *   - a failed file puts nothing in it, and is named underneath with the reason;
 *   - "nothing to gain" is not a failure;
 *   - stopping keeps what finished;
 *   - the summary is reconciled against the archive before it is shown.
 */
import { degrees } from 'pdf-lib';
import { ToolShell, wireDropzone, acceptPdf, saveFile, $, warnWhileBusy } from '../lib/ui.js';
import { formatBytes, plural } from '../lib/format.js';
import { openPdf } from '../lib/open-pdf.js';
import { PRESETS, analyse, compress, worthIt } from '../lib/compress.js';
import { readDocumentText } from '../lib/ocr-run.js';
import * as E from '../lib/errors.js';
import { signedIn, signInPrompt } from './gate.js';
import {
  OPERATIONS, runBatch, describeRun, BATCH_SENTINEL,
  type BatchOp, type FileResult, type Produced, type RunReport,
} from './batch.js';

const shell = new ToolShell();

let chosen: File[] = [];
let op: BatchOp = 'compress';
let controller: AbortController | null = null;
let busy = false;
let report: RunReport | null = null;
let wakeLock: { release(): Promise<void> } | null = null;

warnWhileBusy(() => busy);

const input = $<HTMLInputElement>('[data-file-input]')!;
wireDropzone($('[data-dropzone]')!, input, (files) => take(files));
$('[data-replace]')?.addEventListener('click', () => input.click());
for (const again of document.querySelectorAll('[data-again]')) {
  again.addEventListener('click', () => { reset(); shell.show('empty'); });
}
$('[data-stop]')?.addEventListener('click', () => controller?.abort());

function reset(): void {
  chosen = [];
  report = null;
  busy = false;
  input.value = '';
}

// ---------------------------------------------------------------- choosing

function take(files: FileList | File[]): void {
  const list = Array.from(files).filter((f) => f.size > 0);
  if (!list.length) return;
  chosen = list;
  document.documentElement.dataset.pdfiqBatch = BATCH_SENTINEL;

  $('[data-chosen]')!.textContent =
    `${plural(list.length, 'file')}, ${formatBytes(list.reduce((n, f) => n + f.size, 0))} in total`;
  const ol = $('[data-file-list]')!;
  ol.textContent = '';
  for (const f of list) ol.append(row(f.name, formatBytes(f.size)));

  renderOps();
  renderGate();
  shell.show('selected');
  shell.announce(`${plural(list.length, 'file')} chosen.`);
}

function row(name: string, right: string, state = ''): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'batch-row';
  const a = document.createElement('span');
  a.className = 'batch-row__name';
  a.textContent = name;
  const b = document.createElement('span');
  b.className = 'batch-row__state';
  b.textContent = right;
  if (state) b.dataset.state = state;
  li.append(a, b);
  return li;
}

function renderOps(): void {
  const host = $('[data-ops]')!;
  host.textContent = '';
  for (const key of Object.keys(OPERATIONS) as BatchOp[]) {
    const spec = OPERATIONS[key];
    // The same control the compress presets use, for the same reason: one look, one behaviour.
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset';
    button.setAttribute('aria-pressed', String(key === op));
    if (key === op) {
      const ring = document.createElement('span');
      ring.className = 'preset__ring';
      ring.setAttribute('aria-hidden', 'true');
      button.appendChild(ring);
    }
    const name = document.createElement('span');
    name.className = 'preset__name';
    name.textContent = spec.label;
    const note = document.createElement('span');
    note.className = 'preset__note';
    note.textContent = key === 'compress'
      ? 'the Balanced setting, exactly as Compress applies it'
      : key === 'text'
        ? 'the words, as a .txt file for each PDF'
        : 'every page a quarter turn clockwise; nothing is re-encoded';
    button.append(name, note);
    button.addEventListener('click', () => { op = key; renderOps(); });
    host.appendChild(button);
  }
}

/** Ruled out locally first: the files are read and listed before an account is mentioned. */
function renderGate(): void {
  const gate = $('[data-gate]')!;
  gate.textContent = '';
  const account = signedIn();
  $<HTMLButtonElement>('[data-start]')!.hidden = !account;
  $('[data-run-note]')!.hidden = !account;
  if (!account) gate.append(signInPrompt('Running one operation across many files'));
}

// ---------------------------------------------------------------- the work

/** One file, with the same libraries the single-file tools use. */
async function applyTo(which: BatchOp, file: File, onPage: (done: number, total: number) => void, signal: AbortSignal): Promise<Produced> {
  const accepted = await acceptPdf(file);
  if (!accepted.ok) throw accepted.error;
  const facts = { name: file.name, size: file.size, type: file.type };
  const bytes = accepted.bytes;

  if (which === 'text') {
    const read = await readDocumentText(bytes, {
      lang: 'eng',
      signal,
      onPage: (_entry, done, total) => onPage(done, total),
    });
    const text = read.results.map((r) => r.text).filter(Boolean).join('\n\n').trim();
    if (!text) throw E.unknown(facts, new Error('no text could be read from this file'));
    return { bytes: new TextEncoder().encode(text) };
  }

  const opened = await openPdf(bytes, facts);
  if (!opened.ok) throw opened.error;
  const doc = opened.value.doc;

  if (which === 'rotate') {
    for (const page of doc.getPages()) {
      page.setRotation(degrees((page.getRotation().angle + 90) % 360));
    }
    return { bytes: await doc.save({ useObjectStreams: false }) };
  }

  const analysis = await analyse(doc, file.size);
  const result = await compress(doc, file.size, analysis, {
    preset: PRESETS[0],
    stripMetadata: false,
    signal,
    onProgress: (done, total) => onPage(done, total),
  });
  // The engine declining is not a failure: re-encoding images that are already small spends
  // quality and saves nothing. Reporting that as an error is how the app once described twenty
  // good documents as deleted.
  if (!worthIt(file.size, result.afterBytes)) {
    return { leftAlone: 'its images are already small enough that compressing would only cost quality' };
  }
  return { bytes: result.bytes };
}

/** An unknown failure as one short line: the tools' own words where they have them. */
function describeError(err: unknown, file: File): string {
  const facts = { name: file.name, size: file.size, type: file.type };
  const tool = (err && typeof err === 'object' && 'title' in err ? err : E.classify(err, facts)) as { title?: string; body?: string };
  return tool.title ?? (err instanceof Error ? err.message : String(err));
}

// ---------------------------------------------------------------- running

$('[data-start]')?.addEventListener('click', () => void run(chosen));
$('[data-retry]')?.addEventListener('click', () => {
  const failed = (report?.results ?? []).filter((r) => r.outcome.kind === 'failed').map((r) => r.source);
  const again = chosen.filter((f) => failed.includes(f.name));
  if (again.length) void run(again);
});

async function run(files: File[]): Promise<void> {
  if (busy || !files.length || !signedIn()) return;
  busy = true;
  controller = new AbortController();
  const signal = controller.signal;
  const spec = OPERATIONS[op];

  shell.show('processing');
  shell.announce(`${spec.verb} ${plural(files.length, 'file')}.`);
  const live = $('[data-live-list]')!;
  live.textContent = '';
  const started = performance.now();
  const elapsed = window.setInterval(() => {
    $('[data-elapsed]')!.textContent = `${((performance.now() - started) / 1000).toFixed(1)}s elapsed`;
  }, 100);
  await requestWake();

  let current = { index: 0, total: files.length, name: '' };
  const paint = (withinFile: number) => {
    const overall = (current.index + withinFile) / Math.max(1, current.total);
    const pct = Math.min(100, Math.round(overall * 100));
    $('[data-bar]')!.style.width = `${pct}%`;
    $('[data-pct]')!.textContent = `${pct}%`;
    $('[data-view="processing"]')!.querySelector('[role="progressbar"]')?.setAttribute('aria-valuenow', String(pct));
  };

  try {
    const done = await runBatch(files, op, {
      apply: (which, file, onPage, sig) => applyTo(which, file, onPage, sig),
      describeError: (err) => describeError(err, files[Math.min(current.index, files.length - 1)]),
    }, signal, {
      onFile: (index, total, name) => {
        current = { index, total, name };
        $('[data-facts]')!.textContent = `${spec.verb} ${index + 1} of ${total} · ${name}`;
        $('[data-pages]')!.textContent = '';
        paint(0);
      },
      onPage: (pageDone, pageTotal) => {
        if (spec.pages && pageTotal) $('[data-pages]')!.textContent = `page ${pageDone} of ${pageTotal}`;
        paint(pageTotal ? pageDone / pageTotal : 0);
      },
      onResult: (result) => live.append(resultRow(result)),
    });

    report = done;
    renderReport(done);
  } catch (err) {
    shell.fail(E.classify(err, { name: 'this run', size: 0, type: 'application/pdf' }));
  } finally {
    clearInterval(elapsed);
    await releaseWake();
    busy = false;
  }
}

function resultRow(result: FileResult): HTMLLIElement {
  const o = result.outcome;
  const said = o.kind === 'done'
    ? `done · ${formatBytes(o.bytes)}`
    : o.kind === 'failed'
      ? o.reason
      : o.kind === 'left-alone'
        ? 'left alone'
        : o.kind === 'interrupted'
          ? 'stopped partway — nothing kept'
          : 'not attempted';
  return row(result.source, said, o.kind);
}

function renderReport(done: RunReport): void {
  const said = describeRun(done);
  $('[data-result-head]')!.textContent = said.head;
  $('[data-result-detail]')!.textContent = said.detail;

  const list = $('[data-result-list]')!;
  list.textContent = '';
  for (const result of done.results) list.append(resultRow(result));

  const save = $<HTMLButtonElement>('[data-save]')!;
  // Nothing to hand over, or an archive that disagrees with the summary: no button, because a
  // button that cannot be trusted is worse than none.
  save.hidden = !done.zip || !done.reconciles;
  save.textContent = `Save the zip (${done.entries.length} ${done.entries.length === 1 ? 'file' : 'files'})`;
  $<HTMLButtonElement>('[data-retry]')!.hidden = !done.results.some((r) => r.outcome.kind === 'failed');
  $('[data-result-mono]')!.textContent = done.zip ? `${done.zipName} · ${formatBytes(done.zip.length)}` : '';

  shell.show('result');
  shell.announce(said.head);
}

$('[data-save]')?.addEventListener('click', () => {
  if (report?.zip && report.reconciles) saveFile(report.zip, report.zipName, 'application/zip');
});

// ---------------------------------------------------------------- keeping the screen awake

/**
 * A long run is the one time a tool here asks for anything of the browser. If it refuses, the run
 * carries on and nothing is claimed about it — the copy says "where the browser allows it".
 */
async function requestWake(): Promise<void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(kind: 'screen'): Promise<{ release(): Promise<void> }> } };
    wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
  } catch {
    wakeLock = null;
  }
}

async function releaseWake(): Promise<void> {
  try {
    await wakeLock?.release();
  } catch {
    // Already gone: the tab was hidden, or the browser took it back.
  }
  wakeLock = null;
}
