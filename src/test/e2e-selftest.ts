/**
 * End-to-end tests that drive the real pages.
 *
 * The other suites test the libraries. This one loads each tool page in an iframe, puts a
 * real file through the real file input, clicks the real button, captures whatever the
 * real Save button would write, and re-opens that output to check it is a valid document
 * with the right contents.
 *
 * That distinction matters: every library function can be correct while the page is wired
 * to the wrong one, or not wired at all. A screen-level check proves a callback was
 * passed; only this proves it acts.
 */

import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';

type Log = (line: string) => void;
let emit: Log = () => {};
let failures = 0;
let checks = 0;

function ok(cond: boolean, message: string): void {
  checks++;
  emit(`  ${cond ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!cond) { failures++; throw new Error(message); }
}
const note = (line: string) => emit(`      ${line}`);

// ---------------------------------------------------------------- fixtures

function drawPage(w: number, h: number, n: number, total: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#111111';
  const size = Math.round(h / 40);
  ctx.font = `${size}px Georgia, serif`;
  ctx.textBaseline = 'top';
  const lines = [
    'INVOICE 2026-0417', 'Billion Edges Limited', 'Twelve Hanover Square, London',
    'Description Quantity Amount', 'Professional services 14 1,240.00',
    'Total due on receipt 1,550.50',
  ];
  lines.forEach((l, i) => ctx.fillText(l, w * 0.08, h * 0.08 + i * size * 2));
  ctx.fillText(`Page ${n} of ${total}`, w * 0.08, h * 0.85);
  // Noise, so the image does not compress to nothing.
  let s = n * 7919;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const d = (rnd() - 0.5) * 22;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + d));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + d));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + d));
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const blobOf = (c: HTMLCanvasElement, type: string, q: number) =>
  new Promise<Blob>((r) => c.toBlob((b) => r(b!), type, q));

/** A scanned PDF: one full-page JPEG per page. */
async function scanPdf(pages: number, px = 900, py = 1270, q = 0.9): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const blob = await blobOf(drawPage(px, py, i + 1, pages), 'image/jpeg', q);
    const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const page = doc.addPage([595.28, 841.89]);
    page.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }
  return doc.save();
}

/** A text PDF, optionally with some pages landscape. */
async function textPdf(pages: number, landscape: number[] = []): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const wide = landscape.includes(i);
    const page = doc.addPage(wide ? [841.89, 595.28] : [595.28, 841.89]);
    page.drawText(`Document page ${i + 1} of ${pages}`, { x: 56, y: 700, size: 18, font });
  }
  return doc.save();
}

const fileOf = (bytes: Uint8Array, name: string, type = 'application/pdf') =>
  new File([bytes as BlobPart], name, { type });

// ---------------------------------------------------------------- driving

interface Page {
  win: Window & typeof globalThis;
  doc: Document;
  frame: HTMLIFrameElement;
}

function open(route: string): Promise<Page> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width:1200px;height:900px;position:absolute;left:-4000px;top:0;border:0;';
    frame.src = route;
    frame.addEventListener('load', () => setTimeout(() => {
      const win = frame.contentWindow as Page['win'] | null;
      const doc = frame.contentDocument;
      if (!win || !doc) return reject(new Error(`${route}: no document`));
      resolve({ win, doc, frame });
    }, 300));
    frame.addEventListener('error', () => reject(new Error(`${route}: failed to load`)));
    document.body.appendChild(frame);
  });
}

function feed(p: Page, files: File[]): void {
  const input = p.doc.querySelector<HTMLInputElement>('[data-file-input]');
  if (!input) throw new Error('no file input on this page');
  const dt = new (p.win as unknown as { DataTransfer: typeof DataTransfer }).DataTransfer();
  for (const f of files) dt.items.add(f);
  input.files = dt.files;
  input.dispatchEvent(new (p.win as unknown as { Event: typeof Event }).Event('change', { bubbles: true }));
}

const visible = (doc: Document) =>
  Array.from(doc.querySelectorAll<HTMLElement>('[data-view]')).filter((e) => !e.hidden).map((e) => e.dataset.view!);

async function waitFor(doc: Document, view: string, ms = 25000): Promise<void> {
  const started = performance.now();
  for (;;) {
    if (visible(doc).includes(view)) return;
    if (performance.now() - started > ms) {
      throw new Error(`timed out waiting for "${view}" (showing: ${visible(doc).join(',') || 'nothing'})`);
    }
    await new Promise((r) => setTimeout(r, 120));
  }
}

/**
 * Wait for an element to exist. The tool pages show the "selected" view before the page
 * grid has finished rendering into it, so waiting on the view alone is a race — one that
 * passed on the first run and failed on the second.
 */
async function waitForEl(doc: Document, sel: string, ms = 15000): Promise<HTMLElement> {
  const started = performance.now();
  for (;;) {
    const el = doc.querySelector<HTMLElement>(sel);
    if (el) return el;
    if (performance.now() - started > ms) throw new Error(`timed out waiting for ${sel}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const click = (doc: Document, sel: string) => {
  const el = doc.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`no element for ${sel}`);
  el.click();
};

/** Capture what the Save button would write, without a download prompt. */
async function capture(p: Page, sel = '[data-save]'): Promise<Uint8Array> {
  const url = p.win.URL as unknown as { createObjectURL: (b: Blob) => string };
  const real = url.createObjectURL;
  let blob: Blob | null = null;
  url.createObjectURL = (b: Blob) => { blob = b; return real.call(p.win.URL, b); };
  try {
    click(p.doc, sel);
    await new Promise((r) => setTimeout(r, 150));
  } finally {
    url.createObjectURL = real;
  }
  if (!blob) throw new Error('Save produced no blob');
  return new Uint8Array(await (blob as Blob).arrayBuffer());
}

/** Every output must be a real, re-openable PDF. */
async function reopen(bytes: Uint8Array, label: string): Promise<PDFDocument> {
  ok(bytes.length > 0, `${label}: output is not empty`);
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 5));
  ok(head === '%PDF-', `${label}: output starts with a PDF header`);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc;
}

const clean = (p: Page) =>
  (p.win as unknown as { pdfiqNet?: { clean(): boolean } }).pdfiqNet?.clean() ?? true;

// ---------------------------------------------------------------- the tools

type Case = { name: string; run: () => Promise<void> };

const CASES: Case[] = [
  {
    name: 'Compress — a scan gets smaller, every page survives, nothing is sent',
    async run() {
      const p = await open('/compress/');
      const src = await scanPdf(5, 1400, 1980, 0.94);
      note(`input ${(src.length / 1024).toFixed(0)} KB, 5 pages`);
      feed(p, [fileOf(src, 'contract.pdf')]);
      await waitFor(p.doc, 'selected');
      ok(/5 pages/.test(p.doc.querySelector('[data-file-meta]')!.textContent!), 'reports 5 pages');
      click(p.doc, '[data-start]');
      await waitFor(p.doc, 'result');
      const out = await capture(p);
      const doc = await reopen(out, 'compress');
      note(`output ${(out.length / 1024).toFixed(0)} KB — ${p.doc.querySelector('[data-saved]')!.textContent}`);
      ok(doc.getPageCount() === 5, 'output has 5 pages');
      ok(out.length < src.length, 'output is smaller than the input');
      ok(clean(p), 'nothing sent, no third party');
      p.frame.remove();
    },
  },
  {
    name: 'Merge — three files become one, in the order set',
    async run() {
      const p = await open('/merge/');
      const a = await textPdf(2), b = await textPdf(3), c = await textPdf(4);
      feed(p, [fileOf(a, 'a.pdf'), fileOf(b, 'b.pdf'), fileOf(c, 'c.pdf')]);
      await waitFor(p.doc, 'selected');
      ok(p.doc.querySelectorAll('.trayitem').length === 3, 'three files in the tray');
      click(p.doc, '[data-start]');
      await waitFor(p.doc, 'result');
      const out = await capture(p);
      const doc = await reopen(out, 'merge');
      note(`facts: ${p.doc.querySelector('[data-fact-pages]')!.textContent}`);
      ok(doc.getPageCount() === 9, 'output has 2+3+4 = 9 pages');
      ok(clean(p), 'nothing sent');
      p.frame.remove();
    },
  },
  {
    name: 'Split — every-N produces parts whose pages add up',
    async run() {
      const p = await open('/split/');
      const src = await textPdf(11);
      feed(p, [fileOf(src, 'long.pdf')]);
      await waitFor(p.doc, 'selected');
      const modes = p.doc.querySelectorAll<HTMLElement>('[data-modes] .preset');
      ok(modes.length === 2, 'two modes offered (no bookmarks in this file)');
      modes[1].click();
      await new Promise((r) => setTimeout(r, 200));
      (p.doc.querySelector('[data-every]') as HTMLInputElement).value = '4';
      p.doc.querySelector('[data-every]')!.dispatchEvent(new (p.win as unknown as { Event: typeof Event }).Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      note(`plan: ${p.doc.querySelector('[data-outcome]')!.textContent}`);
      click(p.doc, '[data-start]');
      await waitFor(p.doc, 'result');
      const rows = p.doc.querySelectorAll('[data-outputs] .trayitem');
      ok(rows.length === 3, 'three parts for 11 pages at 4 per file');
      const first = await capture(p, '[data-outputs] .trayitem button');
      const doc = await reopen(first, 'split part 1');
      ok(doc.getPageCount() === 4, 'first part has 4 pages');
      const zip = await capture(p, '[data-save-zip]');
      const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
      ok(dv.getUint32(0, true) === 0x04034b50, 'the zip has a local file header');
      ok(dv.getUint16(zip.length - 22 + 10, true) === 3, 'the zip lists three entries');
      note(`zip ${(zip.length / 1024).toFixed(0)} KB, 3 entries`);
      ok(clean(p), 'nothing sent');
      p.frame.remove();
    },
  },
  {
    name: 'Images to PDF — three images become three pages',
    async run() {
      const p = await open('/images-to-pdf/');
      const files: File[] = [];
      for (const [i, type] of (['image/jpeg', 'image/png', 'image/webp'] as const).entries()) {
        const blob = await blobOf(drawPage(700, 990, i + 1, 3), type, 0.9);
        files.push(new File([blob], `shot-${i + 1}.${type.split('/')[1]}`, { type }));
      }
      feed(p, files);
      await waitFor(p.doc, 'selected');
      ok(p.doc.querySelectorAll('.trayitem').length === 3, 'three images in the tray');
      note(`plan: ${p.doc.querySelector('[data-plan]')!.textContent}`);
      click(p.doc, '[data-start]');
      await waitFor(p.doc, 'result');
      const out = await capture(p);
      const doc = await reopen(out, 'images');
      ok(doc.getPageCount() === 3, 'output has 3 pages');
      ok(clean(p), 'nothing sent');
      p.frame.remove();
    },
  },
  {
    name: 'Rotate — turning pages changes /Rotate and nothing else',
    async run() {
      const p = await open('/rotate/');
      const src = await textPdf(4);
      feed(p, [fileOf(src, 'sideways.pdf')]);
      await waitFor(p.doc, 'selected');
      await waitForEl(p.doc, '.pagecell');
      const before = p.doc.querySelector<HTMLButtonElement>('[data-start]')!.disabled;
      ok(before, 'Save is disabled before anything is turned');
      click(p.doc, '[data-all-right]');
      await new Promise((r) => setTimeout(r, 200));
      ok(!p.doc.querySelector<HTMLButtonElement>('[data-start]')!.disabled, 'Save enables after turning');
      click(p.doc, '[data-start]');
      await waitFor(p.doc, 'result');
      const out = await capture(p);
      const doc = await reopen(out, 'rotate');
      ok(doc.getPageCount() === 4, 'still 4 pages');
      const angles = doc.getPages().map((pg) => ((pg.getRotation().angle % 360) + 360) % 360);
      note(`rotations: ${angles.join(', ')} — ${p.doc.querySelector('[data-result-mono]')!.textContent}`);
      ok(angles.every((a) => a === 90), 'every page is now at 90 degrees');
      ok(clean(p), 'nothing sent');
      p.frame.remove();
    },
  },
  {
    name: 'Reorder — dropping a page removes exactly that page',
    async run() {
      const p = await open('/reorder/');
      const src = await textPdf(6);
      feed(p, [fileOf(src, 'report.pdf')]);
      await waitFor(p.doc, 'selected');
      ok(p.doc.querySelector<HTMLButtonElement>('[data-start]')!.disabled, 'Save disabled before edits');
      const dropBtn = await waitForEl(p.doc, '.pagecell[data-page="2"] [aria-label^="Drop page 3"]');
      ok(!!dropBtn, 'page 3 has a drop control');
      dropBtn.click();
      await new Promise((r) => setTimeout(r, 200));
      ok(!p.doc.querySelector<HTMLButtonElement>('[data-start]')!.disabled, 'Save enables after a drop');
      note(`status: ${p.doc.querySelector('[data-changed]')!.textContent}`);
      click(p.doc, '[data-start]');
      await waitFor(p.doc, 'result');
      const out = await capture(p);
      const doc = await reopen(out, 'reorder');
      ok(doc.getPageCount() === 5, '6 pages became 5');
      ok(clean(p), 'nothing sent');
      p.frame.remove();
    },
  },
];


// ---------------------------------------------------------------- handoff

const HANDOFF_CASES: Case[] = [
  {
    name: 'Compress → Split carries the file across, so nothing is re-picked',
    async run() {
      const p = await open('/compress/');
      const src = await scanPdf(6, 1100, 1550, 0.94);
      feed(p, [fileOf(src, 'chain-test.pdf')]);
      await waitFor(p.doc, 'selected');
      click(p.doc, '[data-start]');
      await waitFor(p.doc, 'result');
      const compressed = await capture(p);
      note(`compressed to ${(compressed.length / 1024).toFixed(0)} KB, 6 pages`);

      // Follow the real link, exactly as a person would.
      const link = p.doc.querySelector<HTMLAnchorElement>('.nextup a[href="/split/"]')!;
      ok(!!link, 'the result offers "Split it"');
      link.click();
      // The click stashes asynchronously and then navigates the frame.
      await new Promise((r) => setTimeout(r, 900));
      await new Promise<void>((r) => {
        if (p.frame.contentWindow?.location.pathname === '/split/') return r();
        p.frame.addEventListener('load', () => r(), { once: true });
      });
      await new Promise((r) => setTimeout(r, 2500));

      const doc2 = p.frame.contentDocument!;
      const views = Array.from(doc2.querySelectorAll<HTMLElement>('[data-view]')).filter((e) => !e.hidden).map((e) => e.dataset.view);
      note(`split opened showing: ${views.join(',')}`);
      ok(views.includes('selected'), 'split opened with the file already loaded, not the drop zone');
      const meta = doc2.querySelector('[data-file-meta]')!.textContent!;
      note(`split sees: ${meta}`);
      ok(/6 pages/.test(meta), 'split reports the same 6 pages');
      ok(doc2.querySelector('[data-file-name]')!.textContent!.includes('-small'),
        'it is the compressed output, not the original');

      // The query string must be gone, so a reload does not try to re-claim it.
      ok(!p.frame.contentWindow!.location.search.includes('from='),
        'the handoff key is removed from the URL');
      p.frame.remove();
    },
  },
  {
    name: 'A handoff is one-shot: claiming it twice gets nothing',
    async run() {
      const p = await open('/compress/');
      const mod = await import('../lib/handoff.js');
      const key = await mod.stash(new Uint8Array([37, 80, 68, 70, 45, 49]), 'once.pdf');
      ok(typeof key === 'string', 'stashing returned a key');
      const first = await mod.claim(key!);
      ok(first !== null && first.name === 'once.pdf', 'the first claim gets the file');
      const second = await mod.claim(key!);
      ok(second === null, 'the second claim gets nothing — it was deleted on read');
      p.frame.remove();
    },
  },
  {
    name: 'A direct visit is unaffected, and a bogus key does not break the page',
    async run() {
      const p = await open('/split/?from=doesnotexist');
      await new Promise((r) => setTimeout(r, 1200));
      const views = Array.from(p.doc.querySelectorAll<HTMLElement>('[data-view]')).filter((e) => !e.hidden).map((e) => e.dataset.view);
      ok(views.includes('empty'), 'falls back to the drop zone rather than erroring');
      ok(!p.frame.contentWindow!.location.search.includes('from='), 'the bad key is cleared from the URL');
      p.frame.remove();
    },
  },
];

// ---------------------------------------------------------------- errors

const ERROR_CASES: Case[] = [
  {
    name: 'Wrong file type is named specifically, not "something went wrong"',
    async run() {
      const p = await open('/compress/');
      // A real ZIP magic number with a .docx name — what a Word file actually looks like.
      const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(200).fill(0x41)]);
      feed(p, [fileOf(zip, 'quarterly-report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')]);
      await waitFor(p.doc, 'error', 8000);
      const title = p.doc.querySelector('[data-err-title]')!.textContent!;
      const body = p.doc.querySelector('[data-err-body]')!.textContent!;
      note(`"${title}"`);
      ok(/Word document/i.test(title), 'identifies it as a Word document from its bytes');
      ok(/quarterly-report\.docx/.test(body), 'names the actual file');
      ok(!/something went wrong/i.test(title + body), 'is not a generic message');
      p.frame.remove();
    },
  },
  {
    name: 'An empty file is named as empty',
    async run() {
      const p = await open('/merge/');
      feed(p, [fileOf(new Uint8Array(0), 'nothing.pdf')]);
      await waitFor(p.doc, 'error', 8000);
      const title = p.doc.querySelector('[data-err-title]')!.textContent!;
      note(`"${title}"`);
      ok(/no contents|zero bytes|empty/i.test(title + p.doc.querySelector('[data-err-body]')!.textContent!),
        'says the file is empty');
      p.frame.remove();
    },
  },
  {
    name: 'A corrupt PDF is reported as damaged, not silently processed',
    async run() {
      const p = await open('/split/');
      const src = await textPdf(4);
      // Keep the header, destroy the trailer and xref.
      const broken = src.slice(0, Math.floor(src.length * 0.55));
      feed(p, [fileOf(broken, 'invoice-scan.pdf')]);
      await waitFor(p.doc, 'error', 10000);
      const title = p.doc.querySelector('[data-err-title]')!.textContent!;
      const mono = p.doc.querySelector('[data-err-mono]')!.textContent!;
      note(`"${title}" / ${mono}`);
      ok(title.trim().length > 0, 'an error is shown');
      ok(/0 bytes sent/.test(mono), 'the technical line still states nothing was sent');
      ok(clean(p), 'nothing sent while failing');
      p.frame.remove();
    },
  },
  {
    name: 'A non-image is refused by Images to PDF',
    async run() {
      const p = await open('/images-to-pdf/');
      const pdf = await textPdf(1);
      feed(p, [fileOf(pdf, 'already.pdf')]);
      await waitFor(p.doc, 'error', 8000);
      const body = p.doc.querySelector('[data-err-body]')!.textContent!;
      note(`"${p.doc.querySelector('[data-err-title]')!.textContent}"`);
      ok(/already a PDF/i.test(body), 'points out it is already a PDF and suggests the right tool');
      p.frame.remove();
    },
  },
];


// ---------------------------------------------------------------- encryption

const ENCRYPTED_CASES: Case[] = [
  {
    name: 'A locked file reaches the password prompt, not the catch-all',
    async run() {
      const p = await open('/compress/');
      const bytes = new Uint8Array(await (await fetch('/fixtures/encrypted-rc4.pdf')).arrayBuffer());
      note(`fixture ${bytes.length} bytes, RC4 40-bit, user password set`);
      feed(p, [fileOf(bytes, 'board-minutes.pdf')]);
      await waitFor(p.doc, 'error', 10000);

      const kicker = p.doc.querySelector('[data-err-kicker]')!.textContent!;
      const title = p.doc.querySelector('[data-err-title]')!.textContent!;
      const mono = p.doc.querySelector('[data-err-mono]')!.textContent!;
      note(`"${kicker}" — ${title}`);
      note(mono);
      ok(/Locked file/i.test(kicker), 'identified as locked, not "unexpected failure"');
      ok(!/did not anticipate|Unexpected failure/i.test(title + kicker), 'did not fall through to the catch-all');
      ok(/RC4/.test(mono), 'the technical line names the handler it found');
      ok(!p.doc.querySelector<HTMLElement>('[data-err-password]')!.hidden, 'the password field is shown');
      p.frame.remove();
    },
  },
  {
    name: 'A wrong password is rejected and says so specifically',
    async run() {
      const p = await open('/compress/');
      const bytes = new Uint8Array(await (await fetch('/fixtures/encrypted-rc4.pdf')).arrayBuffer());
      feed(p, [fileOf(bytes, 'board-minutes.pdf')]);
      await waitFor(p.doc, 'error', 10000);

      const input = p.doc.querySelector<HTMLInputElement>('[data-password-input]')!;
      input.value = 'not-the-password';
      p.doc.querySelector<HTMLFormElement>('[data-err-password]')!
        .dispatchEvent(new (p.win as unknown as { Event: typeof Event }).Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 1500));

      const title = p.doc.querySelector('[data-err-title]')!.textContent!;
      note(`"${title}"`);
      ok(/did not open the file/i.test(title), 'says the password was rejected');
      ok(!p.doc.querySelector<HTMLElement>('[data-err-password]')!.hidden, 'the field stays available to try again');
      p.frame.remove();
    },
  },
  {
    name: 'The right password unlocks it and the tool then works end to end',
    async run() {
      const p = await open('/compress/');
      const bytes = new Uint8Array(await (await fetch('/fixtures/encrypted-rc4.pdf')).arrayBuffer());
      feed(p, [fileOf(bytes, 'board-minutes.pdf')]);
      await waitFor(p.doc, 'error', 10000);

      const input = p.doc.querySelector<HTMLInputElement>('[data-password-input]')!;
      input.value = 'correct-horse';
      p.doc.querySelector<HTMLFormElement>('[data-err-password]')!
        .dispatchEvent(new (p.win as unknown as { Event: typeof Event }).Event('submit', { bubbles: true, cancelable: true }));
      await waitFor(p.doc, 'selected', 12000);

      const meta = p.doc.querySelector('[data-file-meta]')!.textContent!;
      note(`unlocked: ${meta}`);
      ok(/3 pages/.test(meta), 'the unlocked document reports its 3 pages');

      // And it has to be genuinely usable afterwards, not merely opened.
      click(p.doc, '[data-start]');
      await waitFor(p.doc, 'result', 25000).catch(async () => {
        await waitFor(p.doc, 'nogain', 5000);
      });
      const views = visible(p.doc);
      note(`after compressing: ${views.join(',')}`);
      ok(views.includes('result') || views.includes('nogain'), 'compression completed on the unlocked file');

      if (views.includes('result')) {
        const out = await capture(p);
        const doc = await reopen(out, 'unlocked compress');
        ok(doc.getPageCount() === 3, 'the saved output has all 3 pages');
        const raw = new TextDecoder('latin1').decode(out);
        ok(!/\/Encrypt/.test(raw), 'the output carries no encryption dictionary');
      }
      ok(clean(p), 'nothing sent while unlocking');
      p.frame.remove();
    },
  },
  {
    // The first real locked file to reach this code was rejected with the correct
    // password, because the password was the *owner* one and only the user password was
    // ever checked. A PDF has two, either opens it, and the fixture's differ — so this
    // case fails against the code as it was.
    name: 'The owner password unlocks it too, not just the user password',
    async run() {
      const p = await open('/compress/');
      const bytes = new Uint8Array(await (await fetch('/fixtures/encrypted-rc4.pdf')).arrayBuffer());
      feed(p, [fileOf(bytes, 'board-minutes.pdf')]);
      await waitFor(p.doc, 'error', 10000);

      const input = p.doc.querySelector<HTMLInputElement>('[data-password-input]')!;
      // Deliberately not the user password this fixture also carries.
      input.value = 'correct-horse-owner';
      p.doc.querySelector<HTMLFormElement>('[data-err-password]')!
        .dispatchEvent(new (p.win as unknown as { Event: typeof Event }).Event('submit', { bubbles: true, cancelable: true }));
      await waitFor(p.doc, 'selected', 12000);

      const meta = p.doc.querySelector('[data-file-meta]')!.textContent!;
      note(`unlocked with the owner password: ${meta}`);
      ok(/3 pages/.test(meta), 'the owner password opens all 3 pages');
      ok(clean(p), 'nothing sent while unlocking');
      p.frame.remove();
    },
  },
];

// ---------------------------------------------------------------- a11y

const A11Y_CASES: Case[] = [
  {
    name: 'Every page has one h1, a skip link, a main landmark and a live region',
    async run() {
      for (const route of ['/', '/compress/', '/merge/', '/split/', '/images-to-pdf/', '/rotate/', '/reorder/', '/ocr/', '/app/', '/privacy/', '/terms/', '/support/']) {
        const p = await open(route);
        const d = p.doc;
        ok(d.querySelectorAll('h1').length === 1, `${route}: exactly one h1`);
        ok(!!d.querySelector('.skip-link'), `${route}: has a skip link`);
        ok(!!d.querySelector('main#main'), `${route}: has a main landmark`);
        ok(d.documentElement.lang === 'en', `${route}: html lang is set`);
        ok(!!d.querySelector('title')?.textContent?.trim(), `${route}: has a title`);
        p.frame.remove();
      }
    },
  },
  {
    name: 'Every interactive control has an accessible name',
    async run() {
      for (const route of ['/compress/', '/merge/', '/split/', '/rotate/', '/reorder/', '/images-to-pdf/', '/ocr/']) {
        const p = await open(route);
        const nameless: string[] = [];
        for (const el of Array.from(p.doc.querySelectorAll<HTMLElement>('button, a[href], select, input:not([type=hidden])'))) {
          // Elements inside a hidden subtree are not in the accessibility tree, so an
          // unnamed one there is invisible to a screen reader rather than confusing to it.
          if (el.closest('[hidden]')) continue;
          const label = (el.getAttribute('aria-label') ?? '').trim()
            || (el.textContent ?? '').trim()
            || (el.getAttribute('title') ?? '').trim()
            || (el.id && p.doc.querySelector(`label[for="${el.id}"]`)?.textContent?.trim())
            || (el.closest('label')?.textContent ?? '').trim();
          if (!label) nameless.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''));
        }
        ok(nameless.length === 0, `${route}: every control is named${nameless.length ? ' (' + nameless.join(', ') + ')' : ''}`);
        p.frame.remove();
      }
    },
  },
  {
    name: 'The drop zone is reachable and operable by keyboard',
    async run() {
      const p = await open('/compress/');
      const zone = p.doc.querySelector<HTMLElement>('[data-dropzone]')!;
      ok(zone.getAttribute('role') === 'button', 'the drop zone is exposed as a button');
      ok(zone.tabIndex === 0, 'it is in the tab order');
      ok(!!zone.getAttribute('aria-label'), 'it has an accessible name');
      let opened = false;
      const input = p.doc.querySelector<HTMLInputElement>('[data-file-input]')!;
      input.addEventListener('click', (e) => { opened = true; e.preventDefault(); });
      zone.dispatchEvent(new (p.win as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      ok(opened, 'pressing Enter opens the file picker');
      p.frame.remove();
    },
  },
];

// ---------------------------------------------------------------- runner

async function main(): Promise<void> {
  const out = document.getElementById('out')!;
  const write = (s: string) => { out.textContent += s + '\n'; };
  emit = write;

  write(`pdf-iq end-to-end suite — ${navigator.userAgent}`);
  write('');

  const groups: Array<[string, Case[]]> = [
    ['TOOLS — real files through the real pages', CASES],
    ['HANDOFF — the next tool gets the file', HANDOFF_CASES],
    ['ERROR PATHS — every failure named specifically', ERROR_CASES],
    ['ENCRYPTION — detection, refusal, and unlock', ENCRYPTED_CASES],
    ['ACCESSIBILITY', A11Y_CASES],
  ];

  let groupFails = 0;
  for (const [title, cases] of groups) {
    write(`════ ${title} ════`);
    write('');
    for (const c of cases) {
      write(`• ${c.name}`);
      try {
        await c.run();
      } catch (err) {
        groupFails++;
        if (!(err instanceof Error) || !err.message) write(`  FAIL  ${String(err)}`);
        else if (!err.message.startsWith('  ')) write(`  FAIL  ${err.message}`);
      }
      write('');
    }
  }

  write(`${checks} checks, ${failures} failed, ${groupFails} case(s) aborted`);
  const pass = failures === 0 && groupFails === 0;
  write(pass ? 'ALL GREEN' : 'FAILURES ABOVE');
  document.title = pass ? 'e2e: pass' : `e2e: ${failures + groupFails} failed`;
  (window as unknown as { selftestDone: boolean }).selftestDone = true;
  (window as unknown as { selftestFailed: number }).selftestFailed = failures + groupFails;
}

void main().catch((e) => emit('SUITE THREW: ' + (e instanceof Error ? e.stack : String(e))));
