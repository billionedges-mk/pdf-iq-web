/**
 * Merge PDF.
 *
 * The design's "what gets kept" list is a set of promises, so each one is either
 * implemented here or removed from the page. Bookmarks are rebuilt as a group per
 * source file; form fields are collected into a real AcroForm with collisions renamed;
 * page sizes are left alone. The form-fields line only appears when the files in the
 * tray actually have fields, so the page never promises something about a document
 * that has nothing to promise about.
 */

import { PDFDocument } from 'pdf-lib';
import { openPdf } from '../lib/open-pdf.js';
import { readOutline, writeOutline, shiftOutline, countOutline, type OutlineNode } from '../lib/outline.js';
import { rebuildAcroForm, hasFormFields } from '../lib/acroform.js';
import { ToolShell, Progress, wireDropzone, acceptPdf, saveFile, $, $$, breathe, warnWhileBusy } from '../lib/ui.js';
import { formatBytes, plural } from '../lib/format.js';
import * as E from '../lib/errors.js';

const STAGES = ['Copying pages', 'Rebuilding bookmarks', 'Writing the file'];

const shell = new ToolShell();
const progress = new Progress(document, STAGES);

interface Item {
  id: number;
  file: File;
  bytes: Uint8Array;
  pageCount: number;
  outline: OutlineNode[];
  hasForms: boolean;
  sizes: string;
}

let items: Item[] = [];
let nextId = 1;
let busy = false;

warnWhileBusy(() => busy);

const input = $<HTMLInputElement>('[data-file-input]')!;
wireDropzone($('[data-dropzone]')!, input, (files) => void addFiles(files));

// The tray's own "add another" reuses the same hidden input.
$('[data-add]')?.addEventListener('click', () => input.click());

// ---------------------------------------------------------------- intake

async function addFiles(files: File[]): Promise<void> {
  for (const file of files) {
    const accepted = await acceptPdf(file);
    if (!accepted.ok) {
      // One bad file should not discard the tray the user has already built.
      if (items.length) {
        shell.announce(accepted.error.title);
        shell.fail(accepted.error);
      } else {
        shell.fail(accepted.error);
      }
      return;
    }
    const facts = { name: file.name, size: file.size, type: file.type };
    const opened = await openPdf(accepted.bytes, facts);
    if (!opened.ok) return shell.fail(opened.error);

    const doc = opened.value.doc;
    items.push({
      id: nextId++,
      file,
      bytes: opened.value.bytes,
      pageCount: doc.getPageCount(),
      outline: readOutline(doc),
      hasForms: hasFormFields(doc),
      sizes: describeSizes(doc),
    });
  }
  shell.show('selected');
  render();
}

function describeSizes(doc: PDFDocument): string {
  const seen = new Set<string>();
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    seen.add(namePageSize(width, height));
    if (seen.size > 3) break;
  }
  return [...seen].join(', ');
}

/** Name the common paper sizes; fall back to the measurement in millimetres. */
function namePageSize(width: number, height: number): string {
  const [w, h] = width <= height ? [width, height] : [height, width];
  const near = (a: number, b: number) => Math.abs(a - b) < 3;
  if (near(w, 595) && near(h, 842)) return 'A4';
  if (near(w, 612) && near(h, 792)) return 'Letter';
  if (near(w, 612) && near(h, 1008)) return 'Legal';
  if (near(w, 842) && near(h, 1191)) return 'A3';
  if (near(w, 420) && near(h, 595)) return 'A5';
  return `${Math.round((w / 72) * 25.4)}×${Math.round((h / 72) * 25.4)} mm`;
}

// ---------------------------------------------------------------- the tray

function render(): void {
  const tray = $('[data-tray]')!;
  tray.textContent = '';

  items.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'trayitem';
    li.draggable = true;
    li.dataset.id = String(item.id);

    const grip = document.createElement('span');
    grip.className = 'trayitem__grip';
    grip.setAttribute('aria-hidden', 'true');
    grip.textContent = `${index + 1}`;

    const body = document.createElement('div');
    body.className = 'trayitem__body';
    const name = document.createElement('p');
    name.className = 'trayitem__name';
    name.textContent = item.file.name;
    const meta = document.createElement('p');
    meta.className = 'trayitem__meta';
    meta.textContent = [
      plural(item.pageCount, 'page'),
      formatBytes(item.file.size),
      item.sizes,
      item.outline.length ? `${plural(countOutline(item.outline), 'bookmark')}` : null,
      item.hasForms ? 'has form fields' : null,
    ].filter(Boolean).join(' · ');
    body.append(name, meta);

    const moves = document.createElement('div');
    moves.className = 'trayitem__moves';
    const mk = (glyph: string, label: string, fn: () => void, disabled = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pagecell__mini';
      b.textContent = glyph;
      b.setAttribute('aria-label', label);
      b.disabled = disabled;
      b.addEventListener('click', fn);
      return b;
    };
    moves.append(
      mk('↑', `Move ${item.file.name} earlier`, () => move(index, -1), index === 0),
      mk('↓', `Move ${item.file.name} later`, () => move(index, 1), index === items.length - 1),
      mk('×', `Remove ${item.file.name}`, () => remove(item.id))
    );

    li.append(grip, body, moves);
    wireItemDrag(li);
    tray.appendChild(li);
  });

  const totalPages = items.reduce((n, i) => n + i.pageCount, 0);
  const totalBytes = items.reduce((n, i) => n + i.file.size, 0);
  $('[data-totals]')!.textContent = items.length
    ? `${plural(items.length, 'file')} · ${plural(totalPages, 'page')} · ${formatBytes(totalBytes)}`
    : 'nothing added yet';

  const anyForms = items.some((i) => i.hasForms);
  $('[data-forms-note]')!.hidden = !anyForms;

  $<HTMLButtonElement>('[data-start]')!.disabled = items.length < 2;
  $('[data-plan]')!.textContent = items.length < 2
    ? 'Add at least two files to merge.'
    : `${plural(totalPages, 'page')} will be copied in this order, at their original size and quality.`;

  const outname = $<HTMLInputElement>('[data-outname]')!;
  if (!outname.dataset.touched && items.length) {
    outname.value = `${items[0].file.name.replace(/\.pdf$/i, '')}-merged.pdf`;
  }
}

$('[data-outname]')?.addEventListener('input', (e) => {
  (e.currentTarget as HTMLInputElement).dataset.touched = '1';
});

function move(index: number, by: number): void {
  const to = index + by;
  if (to < 0 || to >= items.length) return;
  const [item] = items.splice(index, 1);
  items.splice(to, 0, item);
  render();
}

function remove(id: number): void {
  items = items.filter((i) => i.id !== id);
  if (!items.length) return reset();
  render();
}

function wireItemDrag(li: HTMLElement): void {
  li.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData('text/plain', li.dataset.id!);
    li.classList.add('trayitem--dragging');
  });
  li.addEventListener('dragend', () => {
    li.classList.remove('trayitem--dragging');
    $$('.trayitem').forEach((el) => el.classList.remove('trayitem--over'));
  });
  li.addEventListener('dragover', (e) => {
    e.preventDefault();
    li.classList.add('trayitem--over');
  });
  li.addEventListener('dragleave', () => li.classList.remove('trayitem--over'));
  li.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    li.classList.remove('trayitem--over');
    const draggedId = Number(e.dataTransfer?.getData('text/plain'));
    const from = items.findIndex((i) => i.id === draggedId);
    const to = items.findIndex((i) => i.id === Number(li.dataset.id));
    if (from < 0 || to < 0 || from === to) return;
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
    render();
  });
}

$('[data-clear]')?.addEventListener('click', reset);
$$('[data-again]').forEach((b) => b.addEventListener('click', reset));
$('[data-keep-adjusting]')?.addEventListener('click', () => shell.show('selected'));
$('[data-stop]')?.addEventListener('click', () => shell.show('selected'));

// ---------------------------------------------------------------- run

$('[data-start]')?.addEventListener('click', () => void run());

async function run(): Promise<void> {
  if (items.length < 2) return;
  busy = true;
  shell.show('processing');
  progress.start();

  const facts = { name: items[0].file.name, size: items[0].file.size, type: 'application/pdf' };

  try {
    const out = await PDFDocument.create();
    const groups: OutlineNode[] = [];
    let pagesSoFar = 0;
    const sizes = new Set<string>();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      progress.set(i, items.length, 0, `${item.file.name} — ${plural(item.pageCount, 'page')}`);
      await breathe();

      const source = await PDFDocument.load(item.bytes, { updateMetadata: false });
      const indices = source.getPages().map((_, n) => n);
      const copied = await out.copyPages(source, indices);
      for (const page of copied) {
        out.addPage(page);
        sizes.add(namePageSize(page.getSize().width, page.getSize().height));
      }

      // One top-level bookmark per file, with that file's own tree nested beneath it.
      groups.push({
        title: item.file.name.replace(/\.pdf$/i, ''),
        pageIndex: pagesSoFar,
        children: shiftOutline(item.outline, pagesSoFar),
      });
      pagesSoFar += item.pageCount;
    }

    progress.set(items.length, items.length, 1, 'bookmarks');
    await breathe();
    const bookmarks = writeOutline(out, groups);
    const forms = rebuildAcroForm(out);

    progress.set(items.length, items.length, 2, 'writing');
    await breathe();
    const bytes = await out.save({ useObjectStreams: true });

    progress.stop();
    busy = false;
    renderResult(bytes, pagesSoFar, bookmarks, [...sizes], forms);
  } catch (err) {
    progress.stop();
    busy = false;
    shell.fail(E.classify(err, facts));
  }
}

function renderResult(
  bytes: Uint8Array,
  pages: number,
  bookmarks: number,
  sizes: string[],
  forms: { fields: number; renamed: number }
): void {
  $('[data-result-head]')!.textContent =
    `${plural(items.length, 'file')} became one — ${plural(pages, 'page')}, ${formatBytes(bytes.length)}.`;

  $('[data-fact-pages]')!.textContent =
    `${items.map((i) => i.pageCount).join(' + ')} = ${pages}`;
  $('[data-fact-bookmarks]')!.textContent = bookmarks
    ? `${bookmarks} entries, ${items.length} groups`
    : 'none — no source file had any';
  $('[data-fact-sizes]')!.textContent = sizes.length > 1
    ? `${sizes.join(' and ')}, all kept`
    : `${sizes[0] ?? 'unknown'}, unchanged`;
  $('[data-fact-forms]')!.textContent = forms.fields
    ? `${plural(forms.fields, 'field')} kept${forms.renamed ? `, ${forms.renamed} renamed to avoid a clash` : ''}`
    : 'none in these files';

  const name = ($<HTMLInputElement>('[data-outname]')!.value || 'merged.pdf').replace(/(\.pdf)?$/i, '.pdf');
  const save = $<HTMLButtonElement>('[data-save]')!;
  save.textContent = `Save ${name}`;
  save.onclick = () => saveFile(bytes, name);

  shell.show('result');
  shell.announce(`Merged into ${plural(pages, 'page')}.`);
}

function reset(): void {
  items = [];
  busy = false;
  const outname = $<HTMLInputElement>('[data-outname]')!;
  delete outname.dataset.touched;
  outname.value = 'merged.pdf';
  shell.show('empty');
}
