/**
 * Reorder pages.
 *
 * One rule this file exists to keep: the button's enabled state and the work the button
 * does are computed from the same two values, `order` and `dropped`. Deriving "has the
 * user changed anything" separately from "what do we apply" is how a control ends up
 * lit and inert.
 */

import { PDFDocument } from 'pdf-lib';
import { openPdf } from '../lib/open-pdf.js';
import { PageGrid } from '../lib/pagegrid.js';
import { readOutline, writeOutline, remapOutline, countOutline, type OutlineNode } from '../lib/outline.js';
import { ToolShell, Progress, wireDropzone, acceptPdf, saveFile, $, $$, breathe, warnWhileBusy } from '../lib/ui.js';
import { formatBytes, plural, suffixName, describeRanges } from '../lib/format.js';
import { wireNextLinks, claimIncoming } from '../lib/handoff.js';
import * as E from '../lib/errors.js';

const STAGES = ['Copying pages in the new order', 'Rebuilding bookmarks', 'Writing the file'];

const shell = new ToolShell();
const progress = new Progress(document, STAGES);
const grid = new PageGrid($('[data-grid]')!, { controls: cellControls });

let file: File | null = null;
let sourceBytes: Uint8Array | null = null;
let pageCount = 0;
/** Original page indices, in the order they will be written. */
let order: number[] = [];
let dropped = new Set<number>();
let outline: OutlineNode[] = [];
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

  pageCount = opened.value.doc.getPageCount();
  order = Array.from({ length: pageCount }, (_, i) => i);
  dropped = new Set();
  outline = readOutline(opened.value.doc);

  $('[data-file-name]')!.textContent = file.name;
  shell.show('selected');
  await grid.load(sourceBytes, pageCount);
  render();
}

// ---------------------------------------------------------------- the grid

function cellControls(index: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pagecell__drop';

  const mk = (glyph: string, label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pagecell__mini';
    b.textContent = glyph;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', fn);
    return b;
  };

  wrap.append(
    mk('←', `Move page ${index + 1} earlier`, () => move(index, -1)),
    mk('→', `Move page ${index + 1} later`, () => move(index, 1)),
    mk('×', `Drop page ${index + 1}`, () => toggleDrop(index))
  );
  return wrap;
}

function move(index: number, by: number): void {
  const at = order.indexOf(index);
  const to = at + by;
  if (at < 0 || to < 0 || to >= order.length) return;
  order.splice(at, 1);
  order.splice(to, 0, index);
  render();
  grid.cells[index]?.root.focus();
}

function toggleDrop(index: number): void {
  if (dropped.has(index)) dropped.delete(index);
  else dropped.add(index);
  render();
}

// ---------------------------------------------------------------- drag

function wireDragging(): void {
  let dragging: number | null = null;
  for (const cell of grid.cells) {
    cell.root.draggable = true;
    cell.root.addEventListener('dragstart', (e) => {
      dragging = cell.index;
      cell.root.classList.add('trayitem--dragging');
      e.dataTransfer?.setData('text/plain', String(cell.index));
    });
    cell.root.addEventListener('dragend', () => {
      dragging = null;
      cell.root.classList.remove('trayitem--dragging');
      for (const c of grid.cells) c.root.classList.remove('pagecell--dropping');
    });
    cell.root.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (dragging !== null && dragging !== cell.index) cell.root.classList.add('pagecell--dropping');
    });
    cell.root.addEventListener('dragleave', () => cell.root.classList.remove('pagecell--dropping'));
    cell.root.addEventListener('drop', (e) => {
      e.preventDefault();
      cell.root.classList.remove('pagecell--dropping');
      if (dragging === null || dragging === cell.index) return;
      const from = order.indexOf(dragging);
      const to = order.indexOf(cell.index);
      order.splice(from, 1);
      order.splice(to, 0, dragging);
      render();
    });
  }
}

// ---------------------------------------------------------------- render

/** The single place that decides what the current edit is. */
function currentPlan(): { keep: number[]; moved: boolean; changed: boolean } {
  const keep = order.filter((i) => !dropped.has(i));
  const moved = order.some((original, position) => original !== position);
  return { keep, moved, changed: moved || dropped.size > 0 };
}

function render(): void {
  grid.applyOrder(order);
  wireDragging();

  for (const cell of grid.cells) {
    const isDropped = dropped.has(cell.index);
    cell.root.classList.toggle('pagecell--removed', isDropped);
    if (isDropped) cell.label.textContent = 'dropped';
  }
  // applyOrder renumbers everything; put the dropped labels back and renumber the rest.
  let n = 0;
  for (const index of order) {
    const cell = grid.cells[index];
    if (!cell) continue;
    if (dropped.has(index)) cell.label.textContent = 'dropped';
    else cell.label.textContent = `${++n}`;
  }

  const plan = currentPlan();
  $<HTMLButtonElement>('[data-start]')!.disabled = !plan.changed || plan.keep.length === 0;
  $('[data-restore]')!.hidden = !plan.changed;

  const bits: string[] = [];
  if (plan.moved) bits.push('order changed');
  if (dropped.size) bits.push(`${plural(dropped.size, 'page')} dropped (${describeRanges([...dropped])})`);
  $('[data-changed]')!.textContent = bits.length ? bits.join(' · ') : 'nothing moved yet';

  $('[data-status-line]')!.textContent = [
    formatBytes(file!.size),
    `${plural(pageCount, 'page')} in`,
    `${plan.keep.length} out`,
    outline.length ? `${plural(countOutline(outline), 'bookmark')}` : 'no bookmarks',
  ].join(' · ');
}

$('[data-restore]')?.addEventListener('click', () => {
  order = Array.from({ length: pageCount }, (_, i) => i);
  dropped = new Set();
  render();
});

$('[data-replace]')?.addEventListener('click', reset);
$$('[data-again]').forEach((b) => b.addEventListener('click', reset));
$('[data-keep-adjusting]')?.addEventListener('click', () => shell.show('selected'));
$('[data-stop]')?.addEventListener('click', () => shell.show('selected'));

// ---------------------------------------------------------------- run

$('[data-start]')?.addEventListener('click', () => void run());

async function run(): Promise<void> {
  if (!sourceBytes || !file) return;
  const facts = { name: file.name, size: file.size, type: file.type };
  const plan = currentPlan();

  if (!plan.keep.length) return shell.fail(E.noPagesLeft());

  busy = true;
  shell.show('processing');
  progress.start();

  try {
    const source = await PDFDocument.load(sourceBytes, { updateMetadata: false });
    const out = await PDFDocument.create();

    const copied = await out.copyPages(source, plan.keep);
    for (let i = 0; i < copied.length; i++) {
      out.addPage(copied[i]);
      if ((i & 15) === 15) {
        progress.set(i, copied.length, 0, `page ${i + 1} of ${copied.length}`);
        await breathe();
      }
    }

    progress.set(copied.length, copied.length, 1, 'bookmarks');
    await breathe();
    // Old page index -> new position, so surviving bookmarks still land correctly.
    const map = new Map<number, number>();
    plan.keep.forEach((original, position) => map.set(original, position));
    const kept = writeOutline(out, remapOutline(outline, map));

    progress.set(copied.length, copied.length, 2, 'writing');
    await breathe();
    const bytes = await out.save({ useObjectStreams: true });

    progress.stop();
    busy = false;
    renderResult(bytes, plan.keep.length, kept);
  } catch (err) {
    progress.stop();
    busy = false;
    shell.fail(E.classify(err, facts));
  }
}

function renderResult(bytes: Uint8Array, kept: number, bookmarks: number): void {
  const lost = pageCount - kept;
  $('[data-result-head]')!.textContent = lost
    ? `${plural(kept, 'page')} in the new order, ${lost} left out.`
    : `${plural(kept, 'page')}, in the order you set.`;

  const bits = [
    `${formatBytes(file!.size)} in, ${formatBytes(bytes.length)} out`,
    `${pageCount} → ${kept} pages`,
    'no images re-encoded',
  ];
  if (outline.length) {
    bits.push(bookmarks ? `${plural(bookmarks, 'bookmark')} kept` : 'bookmarks dropped — their pages are gone');
  }
  $('[data-result-mono]')!.textContent = bits.join(' · ');

  const outName = suffixName(file!.name, '-reordered');
  lastResult = { bytes, name: outName };
  const save = $<HTMLButtonElement>('[data-save]')!;
  save.textContent = `Save ${outName}`;
  save.onclick = () => saveFile(bytes, outName);

  shell.show('result');
  shell.announce('New order written.');
}

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
  order = [];
  dropped = new Set();
  outline = [];
  busy = false;
  shell.show('empty');
}

// A file handed over from another tool's "next" links. Nothing happens on a normal
// visit; claimIncoming returns null unless this page was opened with a handoff key.
void claimIncoming().then((handed) => {
  if (handed) void take(handed);
});
