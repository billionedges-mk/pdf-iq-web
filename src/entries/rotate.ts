/**
 * Rotate PDF.
 *
 * Rotation is a page attribute, so this never touches image data. The result panel
 * reports the real before and after byte counts rather than asserting they match —
 * rewriting a document can move a few hundred bytes around and the honest thing is to
 * show what actually happened.
 */

import { PDFDocument, degrees } from 'pdf-lib';
import { openPdf } from '../lib/open-pdf.js';
import { PageGrid, readShapes, type PageShape } from '../lib/pagegrid.js';
import { ToolShell, Progress, wireDropzone, acceptPdf, saveFile, $, $$, breathe, warnWhileBusy } from '../lib/ui.js';
import { formatBytes, plural, suffixName, describeRanges } from '../lib/format.js';
import { wireNextLinks, claimIncoming } from '../lib/handoff.js';
import * as E from '../lib/errors.js';

const STAGES = ['Applying rotations', 'Writing the file'];

const shell = new ToolShell();
const progress = new Progress(document, STAGES);
const grid = new PageGrid($('[data-grid]')!, { controls: cellControls });

let file: File | null = null;
let sourceBytes: Uint8Array | null = null;
let pageCount = 0;
let shapes: PageShape[] = [];
/** Quarter-turns added by the user, per page index. */
let turns: number[] = [];
let busy = false;

warnWhileBusy(() => busy);

/** The finished file, so the "next" links can carry it to the following tool. */
let lastResult: { bytes: Uint8Array; name: string } | null = null;
wireNextLinks(document, () => lastResult);

const input = $<HTMLInputElement>('[data-file-input]')!;
wireDropzone($('[data-dropzone]')!, input, (files) => void take(files[0]));

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

  const pages = opened.value.doc.getPages();
  pageCount = pages.length;
  shapes = readShapes(pages);
  turns = new Array(pageCount).fill(0);

  const portrait = shapes.filter((s) => !s.landscape).length;
  const landscape = pageCount - portrait;
  $('[data-file-name]')!.textContent = file.name;
  $('[data-file-meta]')!.textContent = [
    formatBytes(file.size),
    plural(pageCount, 'page'),
    `${portrait} portrait, ${landscape} landscape`,
  ].join(' · ');

  shell.show('selected');
  await grid.load(sourceBytes, pageCount);
  renderSideways();
  renderChanged();
}

// ---------------------------------------------------------------- the grid

function cellControls(index: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pagecell__drop';
  for (const [dir, glyph, label] of [[-90, '↺', 'left'], [90, '↻', 'right']] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pagecell__mini';
    b.textContent = glyph;
    b.setAttribute('aria-label', `Turn page ${index + 1} ${label}`);
    b.addEventListener('click', () => turn(index, dir));
    wrap.appendChild(b);
  }
  return wrap;
}

function turn(index: number, by: number): void {
  turns[index] = (((turns[index] + by) % 360) + 360) % 360;
  paint(index);
  renderChanged();
}

function paint(index: number): void {
  const cell = grid.cells[index];
  if (!cell) return;
  cell.canvas.style.transform = `rotate(${turns[index]}deg)`;
  // A quarter turn on a portrait thumbnail would overflow its box, so shrink to fit.
  const quarter = turns[index] === 90 || turns[index] === 270;
  cell.canvas.style.scale = quarter ? '0.707' : '1';
  const total = (shapes[index].rotation + turns[index]) % 360;
  cell.root.setAttribute('aria-label', `Page ${index + 1}, rotated ${total} degrees`);
}

// ------------------------------------------------------- the sideways nudge

function renderSideways(): void {
  const box = $('[data-sideways]')!;
  // Only interesting when the document is mostly one way and a minority is not.
  const landscape = shapes.filter((s) => s.landscape);
  const portrait = shapes.filter((s) => !s.landscape);
  const odd = landscape.length && portrait.length
    ? (landscape.length < portrait.length ? landscape : portrait)
    : [];

  if (!odd.length || odd.length > pageCount / 2) {
    box.hidden = true;
    return;
  }

  const majorityIsPortrait = odd === landscape;
  const list = describeRanges(odd.map((s) => s.index));
  $('[data-sideways-text]')!.textContent =
    `${plural(odd.length, 'page')} ${odd.length === 1 ? 'is' : 'are'} ` +
    `${majorityIsPortrait ? 'landscape while the rest are portrait' : 'portrait while the rest are landscape'} ` +
    `— ${list}. That usually means a sideways scan.`;

  const button = $<HTMLButtonElement>('[data-fix-sideways]')!;
  button.textContent = `Turn just ${odd.length === 1 ? 'that one' : `those ${odd.length}`}`;
  button.onclick = () => {
    for (const s of odd) turn(s.index, 90);
    shell.announce(`Turned ${plural(odd.length, 'page')}.`);
  };
  box.hidden = false;
}

// ---------------------------------------------------------------- controls

$('[data-all-left]')?.addEventListener('click', () => {
  for (let i = 0; i < pageCount; i++) turn(i, -90);
  shell.announce('Turned every page left.');
});
$('[data-all-right]')?.addEventListener('click', () => {
  for (let i = 0; i < pageCount; i++) turn(i, 90);
  shell.announce('Turned every page right.');
});
$('[data-reset-rot]')?.addEventListener('click', () => {
  turns.fill(0);
  for (let i = 0; i < pageCount; i++) paint(i);
  renderChanged();
});

function renderChanged(): void {
  const changed = turns.filter((t) => t !== 0).length;
  $<HTMLButtonElement>('[data-start]')!.disabled = changed === 0;
  $('[data-reset-rot]')!.hidden = changed === 0;
  $('[data-changed]')!.textContent = changed === 0
    ? 'no pages turned yet'
    : `${plural(changed, 'page')} turned · ${describeRanges(turns.map((t, i) => (t ? i : -1)).filter((i) => i >= 0))}`;
}

$('[data-replace]')?.addEventListener('click', reset);
$$('[data-again]').forEach((b) => b.addEventListener('click', reset));
$('[data-keep-adjusting]')?.addEventListener('click', () => shell.show('selected'));

// ---------------------------------------------------------------- run

$('[data-start]')?.addEventListener('click', () => void run());

async function run(): Promise<void> {
  if (!sourceBytes || !file) return;
  const facts = { name: file.name, size: file.size, type: file.type };

  busy = true;
  shell.show('processing');
  progress.start();

  try {
    const doc = await PDFDocument.load(sourceBytes, { updateMetadata: false });
    const pages = doc.getPages();
    for (let i = 0; i < pages.length; i++) {
      if (turns[i]) {
        const next = (((shapes[i].rotation + turns[i]) % 360) + 360) % 360;
        pages[i].setRotation(degrees(next));
      }
      if ((i & 31) === 31) {
        progress.set(i, pages.length, 0, `page ${i + 1} of ${pages.length}`);
        await breathe();
      }
    }
    progress.set(pages.length, pages.length, 1, 'writing');
    await breathe();

    const bytes = await doc.save({ useObjectStreams: true });
    progress.stop();
    busy = false;
    renderResult(bytes);
  } catch (err) {
    progress.stop();
    busy = false;
    shell.fail(E.classify(err, facts));
  }
}

function renderResult(bytes: Uint8Array): void {
  const changed = turns.filter((t) => t !== 0).length;
  $('[data-result-head]')!.textContent =
    `${plural(changed, 'page')} turned. Every page is still here, and no image was re-encoded.`;

  // Measured, not asserted: rewriting a PDF rarely lands on exactly the same size.
  const before = file!.size;
  const delta = bytes.length - before;
  const drift = delta === 0
    ? 'identical size'
    : `${delta > 0 ? '+' : '−'}${formatBytes(Math.abs(delta), { precise: true })}`;
  $('[data-result-mono]')!.textContent =
    `${formatBytes(before)} in, ${formatBytes(bytes.length)} out (${drift}) · ${plural(pageCount, 'page')}, none re-encoded`;

  const outName = suffixName(file!.name, '-rotated');
  lastResult = { bytes, name: outName };
  const save = $<HTMLButtonElement>('[data-save]')!;
  save.textContent = `Save ${outName}`;
  save.onclick = () => saveFile(bytes, outName);

  shell.show('result');
  shell.announce('Rotations written.');
}

$('[data-stop]')?.addEventListener('click', () => shell.show('selected'));

$('[data-err-password]')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const pw = $<HTMLInputElement>('[data-password-input]')!.value;
  if (pw) void parse(pw);
});

function reset(): void {
  grid.destroy();
  file = null;
  sourceBytes = null;
  pageCount = 0;
  shapes = [];
  turns = [];
  busy = false;
  shell.show('empty');
}

// A file handed over from another tool's "next" links. Nothing happens on a normal
// visit; claimIncoming returns null unless this page was opened with a handoff key.
void claimIncoming().then((handed) => {
  if (handed) void take(handed);
});
