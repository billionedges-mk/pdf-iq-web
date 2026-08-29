/**
 * In-browser verification for the other six tools.
 *
 * The important case here is the OCR text layer. Everything about it — the custom byte
 * encoding, the ToUnicode CMap, the invisible render mode, the coordinate mapping — is
 * only correct if the words come back out of the finished PDF as the words that went
 * in. So the test writes a layer and then reads it back with pdf.js, which is a
 * different implementation from the one that wrote it.
 */

import { PDFDocument, PDFName, PDFDict, PDFNumber, PDFArray, StandardFonts, degrees } from 'pdf-lib';
import { readOutline, writeOutline, shiftOutline, remapOutline, countOutline, type OutlineNode } from '../lib/outline.js';
import { rebuildAcroForm } from '../lib/acroform.js';
import { makeZip, safeName } from '../lib/zip.js';
import { stripJpegMetadata, readOrientation } from '../lib/image.js';
import { TextLayerFont, buildTextOperators, attachFont, appendContentStream, type OcrWord } from '../lib/textlayer.js';
import { openDocument } from '../lib/pdfjs.js';
import { parseRanges, describeRanges, formatBytes } from '../lib/format.js';

type Log = (line: string) => void;
type Case = { name: string; run: (log: Log) => Promise<void> };

let emit: Log = () => {};
function ok(cond: boolean, message: string): void {
  emit(`  ${cond ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!cond) throw new Error(message);
}
function note(line: string): void { emit(`      ${line}`); }

// ---------------------------------------------------------------- fixtures

async function makePdf(pages: number, label: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`${label} page ${i + 1}`, { x: 60, y: 760, size: 18, font });
  }
  return doc.save();
}

/** A document with a two-level bookmark tree. */
async function makeBookmarkedPdf(pages: number, label: string): Promise<Uint8Array> {
  const bytes = await makePdf(pages, label);
  const doc = await PDFDocument.load(bytes);
  writeOutline(doc, [
    { title: `${label} — front`, pageIndex: 0, children: [
      { title: `${label} — intro`, pageIndex: 1, children: [] },
    ] },
    { title: `${label} — back`, pageIndex: Math.min(pages - 1, 2), children: [] },
  ]);
  return doc.save();
}

function canvasOf(w: number, h: number, fill = '#eeeeee'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, w, h);
  return c;
}

// ---------------------------------------------------------------- cases

const CASES: Case[] = [
  {
    name: 'Bookmarks survive a write / read round trip',
    async run() {
      const bytes = await makeBookmarkedPdf(5, 'Alpha');
      const doc = await PDFDocument.load(bytes);
      const tree = readOutline(doc);
      note(`read back: ${JSON.stringify(tree.map((n) => [n.title, n.pageIndex, n.children.length]))}`);
      ok(tree.length === 2, 'two top-level entries');
      ok(tree[0].title === 'Alpha — front', 'first title survived');
      ok(tree[0].pageIndex === 0, 'first destination is page 1');
      ok(tree[0].children.length === 1, 'nesting survived');
      ok(tree[0].children[0].pageIndex === 1, 'child destination is page 2');
      ok(countOutline(tree) === 3, 'three entries in total');
    },
  },
  {
    name: 'Merging nests each file’s bookmarks under its own name',
    async run() {
      const a = await makeBookmarkedPdf(4, 'Alpha');
      const b = await makeBookmarkedPdf(3, 'Beta');

      const out = await PDFDocument.create();
      const groups: OutlineNode[] = [];
      let at = 0;
      for (const [bytes, label] of [[a, 'Alpha'], [b, 'Beta']] as const) {
        const src = await PDFDocument.load(bytes);
        const tree = readOutline(src);
        const copied = await out.copyPages(src, src.getPages().map((_, i) => i));
        for (const p of copied) out.addPage(p);
        groups.push({ title: label, pageIndex: at, children: shiftOutline(tree, at) });
        at += src.getPageCount();
      }
      writeOutline(out, groups);
      const merged = await out.save();

      const check = await PDFDocument.load(merged);
      ok(check.getPageCount() === 7, `merged page count is 7 (got ${check.getPageCount()})`);
      const tree = readOutline(check);
      note(`groups: ${tree.map((n) => `${n.title}@${n.pageIndex}(${n.children.length})`).join(', ')}`);
      ok(tree.length === 2, 'one group per source file');
      ok(tree[0].title === 'Alpha' && tree[1].title === 'Beta', 'groups named after the files');
      ok(tree[1].pageIndex === 4, 'second group starts at page 5');
      // Beta's own first bookmark pointed at its page 1, which is now page 5.
      ok(tree[1].children[0].pageIndex === 4, 'nested destination was shifted correctly');
      ok(tree[1].children[0].children[0].pageIndex === 5, 'deep nested destination shifted too');
    },
  },
  {
    name: 'Splitting renumbers bookmarks and drops the ones whose pages are gone',
    async run() {
      const bytes = await makeBookmarkedPdf(6, 'Gamma');
      const src = await PDFDocument.load(bytes);
      const tree = readOutline(src);
      note(`source bookmarks: ${tree.map((n) => `${n.title}@${n.pageIndex}`).join(', ')}`);

      // Take pages 3..6 (indices 2..5). The "front" bookmark at page 0 must vanish.
      const keep = [2, 3, 4, 5];
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, keep);
      for (const p of copied) out.addPage(p);
      const map = new Map(keep.map((original, position) => [original, position]));
      writeOutline(out, remapOutline(tree, map));
      const part = await out.save();

      const check = await PDFDocument.load(part);
      const got = readOutline(check);
      note(`part bookmarks: ${got.map((n) => `${n.title}@${n.pageIndex}`).join(', ') || '(none)'}`);
      ok(check.getPageCount() === 4, 'part has four pages');
      ok(!got.some((n) => n.title.includes('front')), 'the front bookmark was dropped, not left pointing wrongly');
      ok(got.some((n) => n.title.includes('back') && n.pageIndex === 0), 'the back bookmark moved to page 1');
    },
  },
  {
    name: 'Page ranges parse, and refuse what they should',
    async run() {
      const good = parseRanges('1-4, 7, 9-12', 20);
      note(`"1-4, 7, 9-12" of 20 → ${describeRanges(good.pages)}`);
      ok(good.error === null && good.pages.length === 9, 'nine pages selected');
      ok(good.pages[0] === 0 && good.pages[8] === 11, 'converted to zero-based');

      ok(parseRanges('5-2', 20).error !== null, 'a backwards range is refused');
      ok(parseRanges('1-99', 20).error !== null, 'a range past the end is refused');
      ok(parseRanges('abc', 20).error !== null, 'nonsense is refused');
      ok(parseRanges('', 20).error !== null, 'empty is refused');
      note(`"1-99" of 20 says: "${parseRanges('1-99', 20).error}"`);
      const dupes = parseRanges('3, 3, 3', 20);
      ok(dupes.pages.length === 1, 'duplicates collapse');
    },
  },
  {
    name: 'The zip is a real zip',
    async run() {
      const a = new TextEncoder().encode('hello from part one');
      const b = await makePdf(2, 'Zipped');
      const zip = makeZip([{ name: 'one.txt', data: a }, { name: 'two.pdf', data: b }]);
      note(`zip is ${formatBytes(zip.length)} for ${formatBytes(a.length + b.length)} of content`);

      const view = new DataView(zip.buffer);
      ok(view.getUint32(0, true) === 0x04034b50, 'starts with a local file header');
      // End-of-central-directory sits at the end for an archive with no comment.
      const eocd = zip.length - 22;
      ok(view.getUint32(eocd, true) === 0x06054b50, 'ends with an end-of-central-directory record');
      ok(view.getUint16(eocd + 10, true) === 2, 'the directory lists two entries');

      // Pull the first entry back out by hand and compare it byte for byte.
      const nameLen = view.getUint16(26, true);
      const extraLen = view.getUint16(28, true);
      const size = view.getUint32(18, true);
      const start = 30 + nameLen + extraLen;
      const recovered = zip.subarray(start, start + size);
      ok(size === a.length, 'stored size matches');
      ok(new TextDecoder().decode(recovered) === 'hello from part one', 'the bytes come back unchanged');

      ok(safeName('a/b\\c:d*e?f"g<h>i|j.pdf').indexOf('/') === -1, 'safeName removes path separators');
      const traversal = safeName('../../etc/passwd');
      ok(!traversal.includes('/') && !traversal.startsWith('.'), 'safeName defuses path traversal');
      note(`safeName("../../etc/passwd") → "${safeName('../../etc/passwd')}"`);
    },
  },
  {
    name: 'EXIF is removed without touching the pixels',
    async run() {
      const canvas = canvasOf(400, 300, '#c87a1e');
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
      const plain = new Uint8Array(await blob!.arrayBuffer());

      // Splice a fake EXIF APP1 segment in after SOI, as a camera would.
      const payload = new TextEncoder().encode('Exif\0\0' + 'II*\0' + '\0\0\0' + 'GPS 51.5074,-0.1278 iPhone 15 Pro');
      const seg = new Uint8Array(4 + payload.length);
      seg[0] = 0xff; seg[1] = 0xe1;
      seg[2] = ((payload.length + 2) >> 8) & 0xff;
      seg[3] = (payload.length + 2) & 0xff;
      seg.set(payload, 4);
      const withExif = new Uint8Array(plain.length + seg.length);
      withExif.set(plain.subarray(0, 2), 0);
      withExif.set(seg, 2);
      withExif.set(plain.subarray(2), 2 + seg.length);

      const raw = new TextDecoder('latin1').decode(withExif);
      ok(raw.includes('GPS 51.5074'), 'the GPS string is present before');

      const stripped = stripJpegMetadata(withExif);
      ok(stripped.removed, 'reported as removed');
      const after = new TextDecoder('latin1').decode(stripped.bytes);
      ok(!after.includes('GPS 51.5074'), 'the GPS string is gone after');
      ok(!after.includes('iPhone 15 Pro'), 'the phone model is gone after');
      note(`${withExif.length} bytes → ${stripped.bytes.length} bytes (removed ${withExif.length - stripped.bytes.length})`);

      // And it must still be a decodable JPEG of the same size.
      const bitmap = await createImageBitmap(new Blob([stripped.bytes as BlobPart], { type: 'image/jpeg' }));
      ok(bitmap.width === 400 && bitmap.height === 300, 'still decodes at 400x300');
      bitmap.close();
      ok(stripJpegMetadata(plain).removed === false, 'a clean JPEG is left exactly alone');
      ok(readOrientation(plain) === 1, 'a JPEG with no EXIF reads as orientation 1');
    },
  },
  {
    name: 'The OCR text layer comes back out as the words that went in',
    async run() {
      const doc = await PDFDocument.create();
      const page = doc.addPage([595.28, 841.89]);

      // Words as an OCR pass would report them: pixel boxes at 300 dpi, y from the top.
      const scale = 300 / 72;
      const sample = ['Zażółć', 'gęślą', 'jaźń', 'Ünicode', 'naïve', 'PDF', '£42.50'];
      const words: OcrWord[] = sample.map((text, i) => ({
        text,
        x0: 100 * scale,
        y0: (100 + i * 30) * scale,
        x1: (100 + text.length * 9) * scale,
        y1: (100 + i * 30 + 18) * scale,
        confidence: 90,
      }));

      const font = new TextLayerFont();
      for (const w of words) font.register(w.text);
      ok(!font.overflowed, 'the character table did not overflow');
      const fontRef = font.embed(doc);
      const ops = buildTextOperators(words, { widthPt: 595.28, heightPt: 841.89, rotation: 0, scale }, font, 'F0');
      ok(ops !== null, 'operators were produced');
      note(`operator stream is ${ops!.length} bytes, starts: ${ops!.slice(0, 34).replace(/\n/g, ' ')}`);
      ok(ops!.includes('3 Tr'), 'render mode 3 (invisible) is set');

      attachFont(page, fontRef, 'F0');
      appendContentStream(doc, page, ops!);
      const bytes = await doc.save();

      // Dump what actually got written, so a failure says why rather than just failing.
      const raw = new TextDecoder('latin1').decode(bytes);
      const fontAt = raw.indexOf('/BaseFont');
      note(`font dict: ${raw.slice(Math.max(0, fontAt - 120), fontAt + 120).replace(/\s+/g, ' ')}`);
      const cmapAt = raw.indexOf('beginbfchar');
      note(`cmap: ${cmapAt === -1 ? 'NOT FOUND IN OUTPUT' : raw.slice(cmapAt, cmapAt + 150).replace(/\s+/g, ' ')}`);
      const tjAt = raw.indexOf(' Tj');
      note(`content: ${tjAt === -1 ? 'NO Tj IN OUTPUT' : raw.slice(Math.max(0, tjAt - 90), tjAt + 4).replace(/\s+/g, ' ')}`);

      // Read it back with pdf.js — a different implementation from the one that wrote it.
      const opened = await openDocument(bytes);
      const p = await opened.doc.getPage(1);
      const content = await p.getTextContent();
      const extracted = content.items.map((i) => ('str' in i ? i.str : '')).join(' ');
      await opened.close();

      note(`pdf.js extracted: "${extracted.trim()}"`);
      for (const word of sample) {
        ok(extracted.includes(word), `"${word}" survived the round trip`);
      }
    },
  },
  {
    name: 'The text layer lands in the right place, including on a rotated page',
    async run() {
      const scale = 300 / 72;
      for (const rotation of [0, 90, 180, 270]) {
        const doc = await PDFDocument.create();
        const page = doc.addPage([595.28, 841.89]);
        if (rotation) page.setRotation(degrees(rotation));

        // One word near the top-left of the page as the reader sees it.
        const viewW = rotation === 90 || rotation === 270 ? 841.89 : 595.28;
        const viewH = rotation === 90 || rotation === 270 ? 595.28 : 841.89;
        const words: OcrWord[] = [{
          text: 'CORNER',
          x0: 40 * scale, y0: 40 * scale,
          x1: 140 * scale, y1: 58 * scale,
          confidence: 95,
        }];
        const font = new TextLayerFont();
        font.register('CORNER');
        const fontRef = font.embed(doc);
        const ops = buildTextOperators(
          words,
          { widthPt: 595.28, heightPt: 841.89, rotation, scale },
          font, 'F0'
        )!;
        attachFont(page, fontRef, 'F0');
        appendContentStream(doc, page, ops);
        const bytes = await doc.save();

        const opened = await openDocument(bytes);
        const p = await opened.doc.getPage(1);
        const viewport = p.getViewport({ scale: 1 });
        const content = await p.getTextContent();
        const item = content.items.find((i) => 'str' in i && i.str.includes('CORNER')) as
          { str: string; transform: number[] } | undefined;
        await opened.close();

        ok(!!item, `rotation ${rotation}: the word was extracted`);
        // Map the reported position into the rotated view pdf.js reports for the page.
        const [, , , , tx, ty] = item!.transform;
        // Convert user space to view space using the viewport transform.
        const [a, b, c, d, e, f] = viewport.transform;
        const vx = a * tx + c * ty + e;
        const vy = b * tx + d * ty + f;
        note(`rotation ${rotation}: word baseline lands at view (${vx.toFixed(0)}, ${vy.toFixed(0)}) in a ${viewW.toFixed(0)}x${viewH.toFixed(0)} view`);
        ok(vx > 10 && vx < viewW * 0.45, `rotation ${rotation}: x is in the left part of the view`);
        ok(vy > 10 && vy < viewH * 0.35, `rotation ${rotation}: y is in the top part of the view`);
      }
    },
  },
  {
    name: 'Merged form fields end up in a real AcroForm, with clashes renamed',
    async run() {
      // Two documents that both call their field "Name".
      const build = async (label: string) => {
        const doc = await PDFDocument.create();
        const page = doc.addPage([400, 300]);
        const form = doc.getForm();
        const field = form.createTextField('Name');
        field.addToPage(page, { x: 40, y: 200, width: 200, height: 24 });
        field.setText(label);
        return doc.save();
      };
      const a = await build('one');
      const b = await build('two');

      const out = await PDFDocument.create();
      for (const bytes of [a, b]) {
        const src = await PDFDocument.load(bytes);
        const copied = await out.copyPages(src, [0]);
        for (const p of copied) out.addPage(p);
      }
      const result = rebuildAcroForm(out);
      note(`collected ${result.fields} fields, renamed ${result.renamed}`);
      ok(result.fields === 2, 'both fields were collected');
      ok(result.renamed === 1, 'the duplicate name was renamed');

      const saved = await out.save();
      const check = await PDFDocument.load(saved);
      const names = check.getForm().getFields().map((f) => f.getName());
      note(`field names in the merged file: ${JSON.stringify(names)}`);
      ok(names.length === 2, 'the reloaded document reports two fields');
      ok(new Set(names).size === 2, 'the two fields have different names');
    },
  },
];

// ---------------------------------------------------------------- runner

async function main(): Promise<void> {
  const out = document.getElementById('out')!;
  const write = (s: string) => { out.textContent += s + '\n'; };
  emit = write;

  write(`pdf-iq tools self-test — ${navigator.userAgent}`);
  write('');

  let failed = 0;
  for (const c of CASES) {
    write(`• ${c.name}`);
    try {
      await c.run(write);
    } catch (err) {
      failed++;
      if (!(err instanceof Error) || !err.message) write(`  FAIL  ${String(err)}`);
      if (err instanceof Error && err.stack) write(`        ${err.stack.split('\n')[1]?.trim() ?? ''}`);
    }
    write('');
  }

  write(failed === 0 ? `ALL ${CASES.length} CASES PASSED` : `${failed} of ${CASES.length} CASES FAILED`);
  document.title = failed === 0 ? 'tools selftest: pass' : `tools selftest: ${failed} failed`;
  (window as unknown as { selftestDone: boolean }).selftestDone = true;
  (window as unknown as { selftestFailed: number }).selftestFailed = failed;
}

void main();
