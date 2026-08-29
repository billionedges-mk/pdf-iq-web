/**
 * Compress PDF.
 *
 * No number on this page is predicted. Before the work runs, the page describes what it
 * is going to do (how many images, at what target) and how long the document is. It does
 * not say how small the result will be, because it does not know — and a projected size
 * that turns out wrong is worse than no projection at all.
 */

import { PDFDocument } from 'pdf-lib';
import { PRESETS, STAGES, analyse, compress, explainNoGain, harderOffer, type Analysis, type CompressResult, type Preset, worthIt, worthShowing } from '../lib/compress.js';
import { openPdf } from '../lib/open-pdf.js';
import { ToolShell, Progress, wireDropzone, acceptPdf, saveFile, $, $$, warnWhileBusy } from '../lib/ui.js';
import { formatBytes, plural, suffixName, percent } from '../lib/format.js';
import { wireNextLinks, claimIncoming } from '../lib/handoff.js';
import * as E from '../lib/errors.js';

const shell = new ToolShell();
const progress = new Progress(document, STAGES);

let file: File | null = null;
let sourceBytes: Uint8Array | null = null;
let doc: PDFDocument | null = null;
let analysis: Analysis | null = null;
let preset: Preset = PRESETS[0];
let result: CompressResult | null = null;
let controller: AbortController | null = null;
let busy = false;

warnWhileBusy(() => busy);

/** The finished file, so the "next" links can carry it to the following tool. */
let lastResult: { bytes: Uint8Array; name: string } | null = null;
wireNextLinks(document, () => lastResult);

// ---------------------------------------------------------------- intake

const input = $<HTMLInputElement>('[data-file-input]')!;
const zone = $('[data-dropzone]')!;
wireDropzone(zone, input, (files) => void take(files[0]));

async function take(f: File, password?: string): Promise<void> {
  file = f;
  const facts = { name: f.name, size: f.size, type: f.type };

  const accepted = await acceptPdf(f);
  if (!accepted.ok) return shell.fail(accepted.error);
  sourceBytes = accepted.bytes;

  await parse(facts, password);
}

async function parse(facts: E.FileFacts, password?: string): Promise<void> {
  if (!sourceBytes) return;
  shell.announce('Reading the document.');

  const opened = await openPdf(sourceBytes, facts, password);
  if (!opened.ok) return shell.fail(opened.error);

  doc = opened.value.doc;
  sourceBytes = opened.value.bytes;

  try {
    analysis = await analyse(doc, file!.size);
  } catch (err) {
    return shell.fail(E.classify(err, facts));
  }

  renderSelected();
  shell.show('selected');
}

// ------------------------------------------------------------- selected view

function renderSelected(): void {
  if (!file || !analysis) return;

  $('[data-file-name]')!.textContent = file.name;

  // Everything in this line is read from the document, not assumed.
  const bits = [formatBytes(file.size), plural(analysis.pageCount, 'page')];
  if (analysis.images.length) bits.push(plural(analysis.images.length, 'image'));
  bits.push(analysis.hasText ? 'has a text layer' : 'scanned, no text layer');
  $('[data-file-meta]')!.textContent = bits.join(' · ');

  $('[data-signed-note]')!.hidden = !analysis.signed;

  renderPresets();
  renderPlan();
}

function renderPresets(): void {
  const host = $('[data-presets]')!;
  host.textContent = '';
  for (const p of PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset';
    button.setAttribute('aria-pressed', String(p.key === preset.key));
    if (p.key === preset.key) {
      const ring = document.createElement('span');
      ring.className = 'preset__ring';
      ring.setAttribute('aria-hidden', 'true');
      button.appendChild(ring);
    }
    const name = document.createElement('span');
    name.className = 'preset__name';
    name.textContent = p.name;
    const note = document.createElement('span');
    note.className = 'preset__note';
    note.textContent = p.note;
    button.append(name, note);
    button.addEventListener('click', () => {
      preset = p;
      renderPresets();
      renderPlan();
    });
    host.appendChild(button);
  }
}

/** What we are about to do — facts about this document, not a projected size. */
function renderPlan(): void {
  const el = $('[data-plan]')!;
  if (!analysis) { el.textContent = ''; return; }

  const n = analysis.recompressible.length;
  if (n === 0) {
    const total = analysis.images.length;
    el.textContent = total === 0
      ? 'This document holds no images, so there is very little here that compressing can change.'
      : `None of its ${total} images are in a form worth rebuilding. We will try, and tell you honestly if nothing moves.`;
    return;
  }

  const above = analysis.recompressible.filter((i) => i.dpi != null && i.dpi > preset.targetDpi).length;
  const parts = [`${plural(n, 'image')} will be re-encoded at quality ${Math.round(preset.quality * 100)}`];
  if (above) parts.push(`${above} of them scaled down to ${preset.targetDpi} dpi`);
  if (analysis.skipReasons.size) {
    const skipped = analysis.images.length - n;
    parts.push(`${skipped} left alone`);
  }
  el.textContent = `${parts.join(', ')}.`;
}

$('[data-replace]')?.addEventListener('click', () => reset());
$$('[data-again]').forEach((b) => b.addEventListener('click', () => reset()));
$('[data-strip-meta]')?.addEventListener('change', () => renderPlan());

// ---------------------------------------------------------------- run

$('[data-start]')?.addEventListener('click', () => void run(preset));

async function run(which: Preset, explicit = false): Promise<void> {
  if (!doc || !analysis || !file || !sourceBytes) return;

  // Each run starts from a clean parse: a previous pass mutated the object graph.
  const facts = { name: file.name, size: file.size, type: file.type };
  let fresh: PDFDocument;
  try {
    fresh = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  } catch (err) {
    return shell.fail(E.classify(err, facts));
  }
  const freshAnalysis = await analyse(fresh, file.size);

  controller = new AbortController();
  busy = true;
  shell.show('processing');
  progress.start();
  shell.announce('Compressing.');

  const stripMeta = $<HTMLInputElement>('[data-strip-meta]')!.checked;

  try {
    result = await compress(fresh, file.size, freshAnalysis, {
      preset: which,
      stripMetadata: stripMeta,
      signal: controller.signal,
      onProgress: (done, total, stage) => {
        const detail = stage === 1 && total
          ? `image ${Math.min(done + 1, total)} of ${total}`
          : STAGES[stage] ?? '';
        progress.set(done, total, stage, detail);
      },
    });
  } catch (err) {
    progress.stop();
    busy = false;
    if (err instanceof DOMException && err.name === 'AbortError') {
      shell.show('selected');
      shell.announce('Stopped. Nothing was changed.');
      return;
    }
    return shell.fail(E.classify(err, facts));
  }

  progress.stop();
  busy = false;
  analysis = freshAnalysis;

  const show = explicit
    ? worthShowing(result.beforeBytes, result.afterBytes)
    : worthIt(result.beforeBytes, result.afterBytes);
  if (show) renderResult(result);
  else renderNoGain(result, which);
}

$('[data-stop]')?.addEventListener('click', () => {
  controller?.abort();
});

// ---------------------------------------------------------------- outcomes

function renderResult(r: CompressResult): void {
  const saved = r.beforeBytes - r.afterBytes;
  $('[data-before]')!.textContent = formatBytes(r.beforeBytes);
  $('[data-after]')!.textContent = formatBytes(r.afterBytes);
  $('[data-saved]')!.textContent = `${percent(saved / r.beforeBytes)} smaller`;
  ($('[data-after-bar]') as HTMLElement).style.width = `${Math.max(2, (r.afterBytes / r.beforeBytes) * 100)}%`;

  const n = analysis!.pageCount;
  $('[data-fact-pages]')!.textContent = `${n} in, ${n} out`;

  const imgBits: string[] = [];
  if (r.imagesRecompressed) {
    imgBits.push(`${r.imagesRecompressed} recompressed at q${r.writtenQuality}`);
    if (r.downscaled) imgBits.push(`${r.downscaled} downscaled${r.writtenDpi ? ` to about ${r.writtenDpi} dpi` : ''}`);
  }
  if (r.imagesSkipped) imgBits.push(`${r.imagesSkipped} left as they were`);
  $('[data-fact-images]')!.textContent = imgBits.length ? imgBits.join(', ') : 'none to change';

  $('[data-fact-meta]')!.textContent = r.metadataStripped ? 'author and timestamps removed' : 'kept as-is';
  $('[data-signed-warning]')!.hidden = !r.signed;

  const outName = suffixName(file!.name, '-small');
  lastResult = { bytes: r.bytes, name: outName };
  const save = $<HTMLButtonElement>('[data-save]')!;
  save.textContent = `Save ${outName}`;
  save.onclick = () => saveFile(r.bytes, outName);

  shell.show('result');
  shell.announce(`Done. ${formatBytes(r.beforeBytes)} became ${formatBytes(r.afterBytes)}.`);
}

function renderNoGain(r: CompressResult, which: Preset): void {
  const saved = r.beforeBytes - r.afterBytes;
  $('[data-nogain-delta]')!.textContent = `${formatBytes(r.beforeBytes)} → ${formatBytes(r.afterBytes)}`;
  $('[data-nogain-pct]')!.textContent = saved > 0
    ? `${percent(saved / r.beforeBytes, 1)} smaller`
    : 'no smaller at all';
  $('[data-nogain-why]')!.textContent = explainNoGain(analysis!, which);

  // Only offer a harder pass when it would actually change this file. Both numbers the
  // decision rests on are the ones already used to write the sentence above the button.
  const offer = harderOffer(analysis!, which);
  const harder = $<HTMLButtonElement>('[data-harder]')!;
  const note = $('[data-nogain-harder-note]')!;
  harder.hidden = !offer.preset;
  note.hidden = !offer.preset;
  if (offer.preset) {
    const target = offer.preset;
    harder.textContent = `Try the ${target.name} setting anyway`;
    note.textContent = offer.note;
    // Explicit: the user has been told it is not worth it and asked regardless, so the
    // result is shown rather than measured and thrown away.
    harder.onclick = () => void run(target, true);
  } else {
    harder.onclick = null;
  }

  $('[data-keep]')!.onclick = () => reset();

  shell.show('nogain');
  shell.announce('This file is already about as small as it gets.');
}

// ---------------------------------------------------------------- password

$('[data-err-password]')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const pw = $<HTMLInputElement>('[data-password-input]')!.value;
  if (!file || !pw) return;
  void parse({ name: file.name, size: file.size, type: file.type }, pw);
});

// ---------------------------------------------------------------- reset

function reset(): void {
  controller?.abort();
  progress.stop();
  busy = false;
  file = null;
  sourceBytes = null;
  doc = null;
  analysis = null;
  result = null;
  preset = PRESETS[0];
  shell.show('empty');
}

// A file handed over from another tool's "next" links. Nothing happens on a normal
// visit; claimIncoming returns null unless this page was opened with a handoff key.
void claimIncoming().then((handed) => {
  if (handed) void take(handed);
});
