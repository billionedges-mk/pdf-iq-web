/**
 * Split PDF.
 *
 * The three modes are offered only when they mean something for the file in hand:
 * "split at bookmarks" does not appear for a document with no bookmarks, and the note
 * beside "every N pages" counts the parts this document would actually produce rather
 * than describing an imaginary one.
 */

import { PDFDocument } from 'pdf-lib';
import { openPdf } from '../lib/open-pdf.js';
import { PageGrid } from '../lib/pagegrid.js';
import { readOutline, writeOutline, remapOutline, countOutline, type OutlineNode } from '../lib/outline.js';
import { makeZip, safeName } from '../lib/zip.js';
import { ToolShell, Progress, wireDropzone, acceptPdf, saveFile, $, $$, breathe, warnWhileBusy } from '../lib/ui.js';
import { formatBytes, plural, parseRanges, describeRanges } from '../lib/format.js';
import * as E from '../lib/errors.js';

const STAGES = ['Building each part', 'Writing the files'];

const shell = new ToolShell();
const progress = new Progress(document, STAGES);
const grid = new PageGrid($('[data-grid]')!, { thumbWidth: 96 });

type Mode = 'range' | 'every' | 'bookmarks';

interface Part {
  name: string;
  pages: number[];
  bytes?: Uint8Array;
}

let file: File | null = null;
let sourceBytes: Uint8Array | null = null;
let pageCount = 0;
let outline: OutlineNode[] = [];
let mode: Mode = 'range';
let parts: Part[] = [];
let busy = false;

warnWhileBusy(() => busy);

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

  const doc = opened.value.doc;
  pageCount = doc.getPageCount();
  outline = readOutline(doc);
  mode = 'range';

  const first = doc.getPage(0).getSize();
  $('[data-file-name]')!.textContent = file.name;
  $('[data-file-meta]')!.textContent = [
    formatBytes(file.size),
    plural(pageCount, 'page'),
    `${Math.round((first.width / 72) * 25.4)}×${Math.round((first.height / 72) * 25.4)} mm`,
    outline.length ? `${plural(topLevel(), 'bookmark')}` : 'no bookmarks',
  ].join(' · ');

  ($('[data-ranges]') as HTMLInputElement).value = `1-${Math.min(pageCount, Math.ceil(pageCount / 2))}`;
  shell.show('selected');
  await grid.load(sourceBytes, pageCount);
  $('[data-preview-title]')!.textContent = `All ${pageCount} pages`;
  renderModes();
  recompute();
}

const topLevel = () => outline.length;

// ---------------------------------------------------------------- modes

function availableModes(): Array<{ key: Mode; name: string; note: string }> {
  const list: Array<{ key: Mode; name: string; note: string }> = [
    { key: 'range', name: 'Extract a page range', note: 'One new file with the pages you name.' },
    { key: 'every', name: 'Split every N pages', note: describeEvery(currentEvery()) },
  ];
  // Only offered when the document has something to split at.
  if (outline.length > 1) {
    list.push({
      key: 'bookmarks',
      name: 'Split at bookmarks',
      note: `${plural(outline.length, 'top-level bookmark')} found in this file.`,
    });
  }
  return list;
}

function describeEvery(n: number): string {
  if (!pageCount || n < 1) return 'Equal parts of the size you choose.';
  const full = Math.floor(pageCount / n);
  const rest = pageCount % n;
  if (full === 0) return `Fewer than ${n} pages here, so this would make one file.`;
  const bits = [`${plural(full, 'file')} of ${n} pages`];
  if (rest) bits.push(`one of ${rest}`);
  return `${bits.join(', ')}.`;
}

function currentEvery(): number {
  const raw = Number(($('[data-every]') as HTMLInputElement)?.value);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 10;
}

function renderModes(): void {
  const host = $('[data-modes]')!;
  host.textContent = '';
  for (const m of availableModes()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset';
    button.setAttribute('aria-pressed', String(m.key === mode));
    if (m.key === mode) {
      const ring = document.createElement('span');
      ring.className = 'preset__ring';
      ring.setAttribute('aria-hidden', 'true');
      button.appendChild(ring);
    }
    const name = document.createElement('span');
    name.className = 'preset__name';
    name.textContent = m.name;
    const note = document.createElement('span');
    note.className = 'preset__note';
    note.textContent = m.note;
    button.append(name, note);
    button.addEventListener('click', () => {
      mode = m.key;
      renderModes();
      recompute();
    });
    host.appendChild(button);
  }
  $('[data-mode-range]')!.hidden = mode !== 'range';
  $('[data-mode-every]')!.hidden = mode !== 'every';
}

$('[data-ranges]')?.addEventListener('input', recompute);
$('[data-every]')?.addEventListener('input', () => { renderModes(); recompute(); });

// ---------------------------------------------------------------- planning

/** Work out the parts. The same function drives the button state and the run. */
function plan(): { parts: Part[]; error: string | null } {
  const base = (file?.name ?? 'document').replace(/\.pdf$/i, '');

  if (mode === 'range') {
    const input = ($('[data-ranges]') as HTMLInputElement).value;
    const { pages, error } = parseRanges(input, pageCount);
    if (error) return { parts: [], error };
    return { parts: [{ name: `${base}-pages-${describeRanges(pages).replace(/,\s*/g, '_')}.pdf`, pages }], error: null };
  }

  if (mode === 'every') {
    const n = currentEvery();
    if (n < 1) return { parts: [], error: 'Pages per file has to be at least 1.' };
    const out: Part[] = [];
    for (let start = 0; start < pageCount; start += n) {
      const pages = [];
      for (let p = start; p < Math.min(start + n, pageCount); p++) pages.push(p);
      out.push({ name: `${base}-part-${out.length + 1}.pdf`, pages });
    }
    return { parts: out, error: null };
  }

  // bookmarks: each top-level entry starts a part, running to the next one.
  const starts = outline
    .map((n) => n.pageIndex)
    .filter((i): i is number => i !== null)
    .sort((a, b) => a - b);
  if (!starts.length) return { parts: [], error: 'No bookmark in this file points at a page.' };

  const out: Part[] = [];
  // Anything before the first bookmark is still a part; dropping it would lose pages.
  if (starts[0] > 0) {
    out.push({ name: `${base}-front.pdf`, pages: range(0, starts[0]) });
  }
  starts.forEach((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : pageCount;
    const title = outline.find((n) => n.pageIndex === start)?.title ?? `part-${i + 1}`;
    out.push({ name: `${base}-${safeName(title)}.pdf`, pages: range(start, end) });
  });
  return { parts: out.filter((p) => p.pages.length), error: null };
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i++) out.push(i);
  return out;
}

function recompute(): void {
  const result = plan();
  const button = $<HTMLButtonElement>('[data-start]')!;
  const outcome = $('[data-outcome]')!;

  if (result.error) {
    button.disabled = true;
    outcome.textContent = result.error;
    highlight([]);
    return;
  }
  parts = result.parts;
  button.disabled = parts.length === 0;
  const total = parts.reduce((n, p) => n + p.pages.length, 0);
  outcome.textContent = parts.length === 1
    ? `One file of ${plural(parts[0].pages.length, 'page')}.`
    : `${plural(parts.length, 'file')}, ${plural(total, 'page')} in total.`;
  highlight(parts.length === 1 ? parts[0].pages : []);
}

/** Mark the pages a single-range split would take, so the choice is visible. */
function highlight(pages: number[]): void {
  const set = new Set(pages);
  for (const cell of grid.cells) {
    cell.root.setAttribute('aria-pressed', String(set.has(cell.index)));
    cell.root.classList.toggle('pagecell--removed', pages.length > 0 && !set.has(cell.index));
  }
}

$('[data-replace]')?.addEventListener('click', reset);
$$('[data-again]').forEach((b) => b.addEventListener('click', reset));
$('[data-stop]')?.addEventListener('click', () => shell.show('selected'));

// ---------------------------------------------------------------- run

$('[data-start]')?.addEventListener('click', () => void run());

async function run(): Promise<void> {
  if (!sourceBytes || !file || !parts.length) return;
  const facts = { name: file.name, size: file.size, type: file.type };

  busy = true;
  shell.show('processing');
  progress.start();

  try {
    const source = await PDFDocument.load(sourceBytes, { updateMetadata: false });

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      progress.set(i, parts.length, 0, `part ${i + 1} of ${parts.length} — ${plural(part.pages.length, 'page')}`);
      await breathe();

      const out = await PDFDocument.create();
      const copied = await out.copyPages(source, part.pages);
      for (const page of copied) out.addPage(page);

      const map = new Map<number, number>();
      part.pages.forEach((original, position) => map.set(original, position));
      writeOutline(out, remapOutline(outline, map));

      part.bytes = await out.save({ useObjectStreams: true });
    }

    progress.set(parts.length, parts.length, 1, 'done');
    progress.stop();
    busy = false;
    renderResult();
  } catch (err) {
    progress.stop();
    busy = false;
    shell.fail(E.classify(err, facts));
  }
}

function renderResult(): void {
  const total = parts.reduce((n, p) => n + (p.bytes?.length ?? 0), 0);
  $('[data-result-head]')!.textContent = parts.length === 1
    ? `One file, ${plural(parts[0].pages.length, 'page')}, ${formatBytes(parts[0].bytes?.length ?? 0)}.`
    : `${plural(parts.length, 'file')}, ${formatBytes(total)} in total.`;

  const list = $('[data-outputs]')!;
  list.textContent = '';
  for (const part of parts) {
    const li = document.createElement('li');
    li.className = 'trayitem';

    const body = document.createElement('div');
    body.className = 'trayitem__body';
    const name = document.createElement('p');
    name.className = 'trayitem__name';
    name.textContent = part.name;
    const meta = document.createElement('p');
    meta.className = 'trayitem__meta';
    meta.textContent = `${plural(part.pages.length, 'page')} · ${formatBytes(part.bytes?.length ?? 0)} · pages ${describeRanges(part.pages)}`;
    body.append(name, meta);

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn-quiet btn-quiet--xs';
    save.textContent = 'Save';
    save.addEventListener('click', () => part.bytes && saveFile(part.bytes, part.name));

    li.append(body, save);
    list.appendChild(li);
  }

  const zipButton = $<HTMLButtonElement>('[data-save-zip]')!;
  zipButton.hidden = parts.length < 2;
  zipButton.onclick = () => {
    const zip = makeZip(parts.filter((p) => p.bytes).map((p) => ({ name: safeName(p.name), data: p.bytes! })));
    saveFile(zip, `${(file?.name ?? 'document').replace(/\.pdf$/i, '')}-split.zip`, 'application/zip');
  };

  shell.show('result');
  shell.announce(`Split into ${plural(parts.length, 'file')}.`);
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
  outline = [];
  parts = [];
  mode = 'range';
  busy = false;
  shell.show('empty');
}
