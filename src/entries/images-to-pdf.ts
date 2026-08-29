/**
 * Images to PDF.
 *
 * The design listed HEIC as supported. Only Safari can decode it — Chrome and Firefox
 * cannot, and there is no permissively licensed HEIC decoder small enough to ship with
 * a page whose whole argument is that it loads fast. So HEIC is detected by its own
 * bytes and named specifically, in the browser that cannot read it, with the fix that
 * actually works. Claiming support and failing would be worse than saying so.
 */

import { PDFDocument, degrees } from 'pdf-lib';
import { loadImage, isHeic, type LoadedImage } from '../lib/image.js';
import { ToolShell, Progress, wireDropzone, saveFile, readHead, $, $$, breathe, warnWhileBusy, MAX_BYTES } from '../lib/ui.js';
import { formatBytes, plural } from '../lib/format.js';
import * as E from '../lib/errors.js';

const STAGES = ['Placing each image on a page', 'Writing the file'];

const PAGE_SIZES = [
  { key: 'fit', name: 'Fit the page to each image', note: 'No white borders, mixed page sizes.' },
  { key: 'a4', name: 'A4', note: 'Every image centred on an A4 page.', size: [595.28, 841.89] as [number, number] },
  { key: 'letter', name: 'US Letter', note: 'Every image centred on Letter.', size: [612, 792] as [number, number] },
];

const shell = new ToolShell();
const progress = new Progress(document, STAGES);

interface Item extends LoadedImage {
  id: number;
  size: number;
}

let items: Item[] = [];
let nextId = 1;
let pageSize = PAGE_SIZES[0];
let busy = false;

warnWhileBusy(() => busy);

const input = $<HTMLInputElement>('[data-file-input]')!;
wireDropzone($('[data-dropzone]')!, input, (files) => void addFiles(files));
$('[data-add]')?.addEventListener('click', () => input.click());

// ---------------------------------------------------------------- intake

async function addFiles(files: File[]): Promise<void> {
  const strip = $<HTMLInputElement>('[data-strip-exif]')!.checked;

  for (const file of files) {
    const facts = { name: file.name, size: file.size, type: file.type };
    if (file.size === 0) return shell.fail(E.empty(facts));
    if (file.size > MAX_BYTES) return shell.fail(E.tooBig(facts, MAX_BYTES));

    const head = await readHead(file, 32);
    if (isHeic(head)) {
      const canDecode = await heicSupported();
      if (!canDecode) return shell.fail(heicError(facts));
    }

    try {
      const loaded = await loadImage(file, strip);
      items.push({ ...loaded, id: nextId++, size: file.size });
    } catch {
      return shell.fail(E.notImage(facts, head));
    }
  }
  shell.show('selected');
  render();
}

/** Ask the browser rather than sniffing the user agent. Cached after the first call. */
let heicAnswer: Promise<boolean> | null = null;
function heicSupported(): Promise<boolean> {
  if (!heicAnswer) {
    heicAnswer = (async () => {
      // A one-pixel HEIF is not worth embedding; probing the type support is enough.
      if (typeof createImageBitmap !== 'function') return false;
      const probe = document.createElement('canvas');
      // Safari reports HEIC support through canvas type negotiation.
      return probe.toDataURL('image/heic').startsWith('data:image/heic');
    })();
  }
  return heicAnswer;
}

function heicError(facts: E.FileFacts): E.ToolError {
  return {
    kind: 'not-image',
    kicker: 'HEIC, in a browser that cannot read it',
    title: `${facts.name} is an iPhone HEIC, and this browser has no decoder for it.`,
    body:
      'Safari can open HEIC; Chrome and Firefox cannot, and shipping a decoder for it would mean shipping a ' +
      'few megabytes of code to every visitor for a format most of them never use. Two things that do work: ' +
      'share the photos out of the Photos app, which converts them to JPEG on the way, or set Camera → Formats ' +
      'to "Most Compatible" so the phone writes JPEG in the first place.',
    mono: `image/heic · ${formatBytes(facts.size)} · 0 bytes sent`,
  };
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

    const thumb = document.createElement('img');
    thumb.className = 'trayitem__thumb';
    thumb.src = item.thumb;
    thumb.alt = '';

    const body = document.createElement('div');
    body.className = 'trayitem__body';
    const name = document.createElement('p');
    name.className = 'trayitem__name';
    name.textContent = item.name;
    const meta = document.createElement('p');
    meta.className = 'trayitem__meta';
    meta.textContent = [
      `${item.width} × ${item.height}`,
      formatBytes(item.size),
      item.rotate ? `turned ${item.rotate}°` : null,
      item.reencoded ? 're-encoded' : 'placed as-is',
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
      mk('←', `Move ${item.name} earlier`, () => move(index, -1), index === 0),
      mk('→', `Move ${item.name} later`, () => move(index, 1), index === items.length - 1),
      mk('×', `Remove ${item.name}`, () => remove(item.id))
    );

    li.append(grip, thumb, body, moves);
    wireItemDrag(li);
    tray.appendChild(li);
  });

  const bytes = items.reduce((n, i) => n + i.size, 0);
  $('[data-totals]')!.textContent = items.length
    ? `${plural(items.length, 'image')} · ${formatBytes(bytes)}`
    : 'nothing added yet';

  $<HTMLButtonElement>('[data-start]')!.disabled = items.length === 0;
  renderSizes();
  renderPlan();
}

function renderSizes(): void {
  const host = $('[data-sizes]')!;
  host.textContent = '';
  for (const s of PAGE_SIZES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset';
    button.setAttribute('aria-pressed', String(s.key === pageSize.key));
    if (s.key === pageSize.key) {
      const ring = document.createElement('span');
      ring.className = 'preset__ring';
      ring.setAttribute('aria-hidden', 'true');
      button.appendChild(ring);
    }
    const name = document.createElement('span');
    name.className = 'preset__name';
    name.textContent = s.name;
    const note = document.createElement('span');
    note.className = 'preset__note';
    note.textContent = s.note;
    button.append(name, note);
    button.addEventListener('click', () => { pageSize = s; renderSizes(); renderPlan(); });
    host.appendChild(button);
  }
}

function renderPlan(): void {
  const el = $('[data-plan]')!;
  if (!items.length) { el.textContent = 'Add at least one image.'; return; }
  const reencoded = items.filter((i) => i.reencoded).length;
  const bits = [`${plural(items.length, 'image')} → ${plural(items.length, 'page')}`];
  if (reencoded) bits.push(`${reencoded} converted because the format cannot go straight into a PDF`);
  el.textContent = `${bits.join(', ')}.`;
}

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
  li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('trayitem--over'); });
  li.addEventListener('dragleave', () => li.classList.remove('trayitem--over'));
  li.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    li.classList.remove('trayitem--over');
    const from = items.findIndex((i) => i.id === Number(e.dataTransfer?.getData('text/plain')));
    const to = items.findIndex((i) => i.id === Number(li.dataset.id));
    if (from < 0 || to < 0 || from === to) return;
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
    render();
  });
}

$('[data-strip-exif]')?.addEventListener('change', () => {
  // Reloading is the only way to honour the change: stripping happens at decode time.
  shell.announce('Re-reading the images with the new metadata setting.');
  void reload();
});

async function reload(): Promise<void> {
  const strip = $<HTMLInputElement>('[data-strip-exif]')!.checked;
  const files = items.map((i) => new File([i.bytes as BlobPart], i.name));
  const reloaded: Item[] = [];
  for (let i = 0; i < items.length; i++) {
    try {
      const loaded = await loadImage(files[i], strip);
      reloaded.push({ ...loaded, id: items[i].id, size: items[i].size });
    } catch {
      reloaded.push(items[i]);
    }
  }
  items = reloaded;
  render();
}

$('[data-clear]')?.addEventListener('click', reset);
$$('[data-again]').forEach((b) => b.addEventListener('click', reset));
$('[data-keep-adjusting]')?.addEventListener('click', () => shell.show('selected'));
$('[data-stop]')?.addEventListener('click', () => shell.show('selected'));

// ---------------------------------------------------------------- run

$('[data-start]')?.addEventListener('click', () => void run());

async function run(): Promise<void> {
  if (!items.length) return;
  busy = true;
  shell.show('processing');
  progress.start();

  try {
    const doc = await PDFDocument.create();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      progress.set(i, items.length, 0, `image ${i + 1} of ${items.length}`);

      const embedded = item.kind === 'jpeg'
        ? await doc.embedJpg(item.bytes)
        : await doc.embedPng(item.bytes);

      // A quarter turn swaps which way round the image sits on the page.
      const turned = item.rotate === 90 || item.rotate === 270;
      const drawnW = turned ? embedded.height : embedded.width;
      const drawnH = turned ? embedded.width : embedded.height;

      if (pageSize.key === 'fit') {
        // 72 pt to the inch; place at 1:1 so the page is exactly the image.
        const page = doc.addPage([drawnW, drawnH]);
        place(page, embedded, item.rotate, drawnW, drawnH, 0, 0, drawnW, drawnH);
      } else {
        const [pw, ph] = pageSize.size!;
        const page = doc.addPage([pw, ph]);
        const margin = 24;
        const scale = Math.min((pw - margin * 2) / drawnW, (ph - margin * 2) / drawnH, 1);
        const w = drawnW * scale;
        const h = drawnH * scale;
        place(page, embedded, item.rotate, w, h, (pw - w) / 2, (ph - h) / 2, w, h);
      }

      if ((i & 3) === 3) await breathe();
    }

    progress.set(items.length, items.length, 1, 'writing');
    await breathe();
    const bytes = await doc.save({ useObjectStreams: true });

    progress.stop();
    busy = false;
    renderResult(bytes);
  } catch (err) {
    progress.stop();
    busy = false;
    shell.fail(E.classify(err, { name: items[0]?.name ?? 'images', size: 0, type: '' }));
  }
}

/**
 * Draw the image, expressing any EXIF rotation as a placement transform so the original
 * compressed data goes in untouched.
 */
function place(
  page: import('pdf-lib').PDFPage,
  image: import('pdf-lib').PDFImage,
  rotate: number,
  boxW: number,
  boxH: number,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  if (rotate === 0) {
    page.drawImage(image, { x, y, width: w, height: h });
    return;
  }
  // pdf-lib rotates about the bottom-left corner, so the origin is shifted to put the
  // turned image back inside its box.
  const opts: Record<number, { x: number; y: number; width: number; height: number }> = {
    90: { x: x + w, y, width: h, height: w },
    180: { x: x + w, y: y + h, width: w, height: h },
    270: { x, y: y + h, width: h, height: w },
  };
  const o = opts[rotate];
  page.drawImage(image, {
    x: o.x, y: o.y, width: o.width, height: o.height,
    rotate: degrees(rotate),
  });
}

function renderResult(bytes: Uint8Array): void {
  $('[data-result-head]')!.textContent =
    `${plural(items.length, 'image')} became ${plural(items.length, 'page')} — ${formatBytes(bytes.length)}.`;

  const reencoded = items.filter((i) => i.reencoded).length;
  $('[data-fact-images]')!.textContent = `${items.length} in, ${items.length} pages out`;

  const maxW = Math.max(...items.map((i) => i.width));
  const maxH = Math.max(...items.map((i) => i.height));
  $('[data-fact-res]')!.textContent = reencoded
    ? `${maxW} × ${maxH} max, ${reencoded} converted`
    : `unchanged, ${maxW} × ${maxH} max`;

  const stripped = $<HTMLInputElement>('[data-strip-exif]')!.checked;
  const had = items.filter((i) => i.hadMetadata).length;
  $('[data-fact-exif]')!.textContent = !had
    ? 'none of these carried any'
    : stripped ? `removed from ${had} of ${items.length}` : `kept on ${had} of ${items.length}`;

  $('[data-fact-size]')!.textContent = pageSize.key === 'fit'
    ? 'each page matches its image'
    : pageSize.name;

  const name = 'images.pdf';
  const save = $<HTMLButtonElement>('[data-save]')!;
  save.textContent = `Save ${name}`;
  save.onclick = () => saveFile(bytes, name);

  shell.show('result');
  shell.announce('Document built.');
}

function reset(): void {
  items = [];
  busy = false;
  shell.show('empty');
}
