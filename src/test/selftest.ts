/**
 * In-browser verification for the compression path.
 *
 * This exists because none of it can be checked in Node: JPEG decoding, canvas
 * re-encoding and OffscreenCanvas are browser facilities, and a green unit test that
 * stubbed them would prove nothing about whether a real scan actually gets smaller.
 *
 * Every case below builds a real PDF in memory first, so the numbers reported are
 * measurements of this code doing the actual work.
 */

import { PDFDocument } from 'pdf-lib';
import { PRESETS, analyse, compress, explainNoGain, harderOffer, type Analysis, worthIt, worthShowing } from '../lib/compress.js';
import { findImages, measurePlacements } from '../lib/pdf-inspect.js';
import { readJpeg } from '../lib/jpeg.js';
import { validate } from '../lib/probe-validity.js';
import { MAX_BYTES, MEASURED_COLLAPSE_BYTES } from '../lib/ui.js';
import { tooBig } from '../lib/errors.js';
import { formatBytes } from '../lib/format.js';

type Log = (line: string) => void;
type Case = { name: string; run: (log: Log) => Promise<void> };

let emit: Log = () => {};

function ok(cond: boolean, message: string): void {
  emit(`  ${cond ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!cond) throw new Error(message);
}

function note(line: string): void {
  emit(`      ${line}`);
}

// ---------------------------------------------------------------- fixtures

/** Draw something with the statistics of a scanned page: text-like strokes on paper. */
function drawScan(w: number, h: number, seed = 1): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fdfcf8';
  ctx.fillRect(0, 0, w, h);

  // Deterministic pseudo-random so runs are comparable.
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;

  ctx.fillStyle = '#1a1a1a';
  const lineHeight = h / 46;
  for (let line = 2; line < 44; line++) {
    const y = line * lineHeight;
    let x = w * 0.1;
    const limit = w * 0.9;
    while (x < limit) {
      const wordLen = (3 + rnd() * 9) * (w / 120);
      if (x + wordLen > limit) break;
      ctx.fillRect(x, y, wordLen, Math.max(1, lineHeight * 0.32));
      x += wordLen + (w / 90);
    }
  }
  // Scanner noise, which is what makes a scan expensive to store.
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 26;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

async function canvasJpeg(c: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', quality));
  return new Uint8Array(await blob!.arrayBuffer());
}

/** A PDF of `pages` full-page scans at a chosen pixel size and JPEG quality. */
async function makeScanPdf(pages: number, pxW: number, pxH: number, quality: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const jpeg = await canvasJpeg(drawScan(pxW, pxH, i + 1), quality);
    const image = await doc.embedJpg(jpeg);
    // A4 at 72pt/inch.
    const page = doc.addPage([595.28, 841.89]);
    page.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }
  return doc.save();
}

async function makeTextPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595.28, 841.89]);
    for (let line = 0; line < 40; line++) {
      page.drawText(`Page ${i + 1} line ${line + 1} — vector text, nothing to recompress here.`, {
        x: 56, y: 780 - line * 18, size: 11,
      });
    }
  }
  return doc.save();
}

// ---------------------------------------------------------------- cases

const CASES: Case[] = [
  {
    /**
     * Driven with the two runs that actually happened. The iPhone one reported 0.4s of
     * work at 30, 50, 60 and 80 MB — flat, impossible, and printed as a ceiling because
     * nothing checked it. On a device with no heap readout there was no second signal.
     */
    name: 'The memory probe refuses to report a figure from a run that cannot be true',
    async run() {
      const rung = (mb: number, pipeMs: number, builtMb = mb, heapMb?: number) =>
        ({ mb, phase: 'save', outcome: 'survived', pipeMs, heapMb, builtBytes: builtMb * 1048576 }) as never;
      const real = [1_612_000, 1_598_400, 1_640_100, 1_575_300, 1_602_800, 1_588_900];

      // The run as reported from the phone. Fixture sizes were never recorded, which was
      // itself part of the problem, so the check has to fire without them.
      const phone = {
        agent: 'iPhone', started: '', rungs: [rung(30, 400), rung(50, 400), rung(60, 400), rung(80, 400)],
      } as never;
      const bad = validate(phone);
      for (const p of bad.problems) note(`caught: ${p}`);
      ok(!bad.ok, 'the flat run is rejected');
      ok(bad.problems.some((p) => /did not grow with the file/.test(p)),
        'and the reason given is that work did not scale with size');

      // The same shape, but with the fixture recorded as far too small — the likely cause.
      const blank = {
        agent: 'iPhone', started: '', baseImageBytes: [41_000, 41_000, 41_000, 41_000, 41_000, 41_000],
        rungs: [rung(30, 400), rung(50, 400), rung(60, 400), rung(80, 400)],
      } as never;
      const blankVerdict = validate(blank);
      for (const p of blankVerdict.problems) note(`caught: ${p}`);
      ok(blankVerdict.problems.some((p) => /canvas drew nothing/.test(p)),
        'six identically sized source images are caught as a canvas that drew nothing');

      // The desktop run, which is real and must still be accepted.
      const desktop = {
        agent: 'Chrome', started: '', baseImageBytes: real,
        rungs: [rung(30, 1863, 30.2, 118), rung(50, 9136, 50.8, 200), rung(60, 8466, 60.3, 238), rung(80, 13999, 79.4, 315)],
      } as never;
      const good = validate(desktop);
      for (const p of good.problems) note(`WRONGLY caught: ${p}`);
      ok(good.ok, 'the real desktop run is still accepted');

      // A fixture that silently came out small must not pass either.
      const shrunk = {
        agent: 'Chrome', started: '', baseImageBytes: real,
        rungs: [rung(30, 1863, 30.2), rung(50, 9136, 50.8), rung(80, 13999, 40.0)],
      } as never;
      const shrunkVerdict = validate(shrunk);
      note(`caught: ${shrunkVerdict.problems.join('; ')}`);
      ok(!shrunkVerdict.ok, 'a rung whose fixture came out far under the size asked for is rejected');
    },
  },
  {
    name: 'The file ceiling sits below the size where the tab was measured to collapse',
    async run() {
      const limitMb = MAX_BYTES / 1048576;
      const collapseMb = MEASURED_COLLAPSE_BYTES / 1048576;
      note(`ceiling ${limitMb} MB, measured collapse ${collapseMb} MB, margin ${(100 - (limitMb / collapseMb) * 100).toFixed(0)}%`);
      ok(MAX_BYTES < MEASURED_COLLAPSE_BYTES, 'the ceiling is below the measured collapse');
      ok(MAX_BYTES <= MEASURED_COLLAPSE_BYTES * 0.8, 'and leaves at least a fifth as margin, since the measurement was on one strong desktop');

      // The refusal has to state the real number, and must not send the reader to a tool
      // with the identical gate. It used to recommend Split, which loads the whole file.
      // Exactly at the boundary, which is where everybody meets this message. Both numbers
      // round to one decimal, so a file a few KB over used to render as "is 60.0 MB, over
      // the 60.0 MB ceiling" — a sentence that argues with itself.
      const edge = tooBig({ name: 'scan.pdf', size: MAX_BYTES + 4096, type: 'application/pdf' }, MAX_BYTES);
      note(`at the boundary: ${edge.body.split('. ').slice(0, 2).join('. ')}.`);
      note(`mono: ${edge.mono}`);
      ok(!/is ([\d.]+) MB\. The ceiling every tool here shares is  MB/.test(edge.body),
        'the copy does not print the same number as both the file size and the ceiling');
      ok(/fractionally over/.test(edge.body), 'it says the file is fractionally over instead');
      ok(edge.mono !== null && /60\.00 MB · limit 60 MB/.test(edge.mono),
        'and the technical line carries enough precision to show the difference');

      const err = tooBig({ name: 'scan.pdf', size: MAX_BYTES * 2, type: 'application/pdf' }, MAX_BYTES);
      note(`well over: ${err.body}`);
      ok(err.body.includes(`${limitMb}.0 MB`), 'the copy states the ceiling actually in force');
      ok(!/Split it first|copes with far larger|one page at a time/.test(err.body),
        'it no longer recommends splitting here, which shares the same ceiling');
      ok(/will not get round it/.test(err.body), 'it says outright that splitting here does not help');
      ok(!err.action, 'and offers no button, because there is nothing here that would work');
    },
  },
  {
    // Both of these come from the reported file: one JPEG at quality 94 and 72 dpi. The
    // card offered "Try the Smallest setting anyway" and said, three lines apart, that
    // the file was already at Smallest's target resolution.
    name: 'A harder pass is offered only when it would change the file',
    async run() {
      const smallest = PRESETS[PRESETS.length - 1];
      const balanced = PRESETS[0];
      const base = {
        pageCount: 1, totalBytes: 1, images: [], actionableBytes: 1, skippedBytes: 0,
        skipReasons: new Map(), allJpeg: true, hasText: false, signed: false,
      };
      const withImage = (medianQuality: number | null, medianDpi: number | null) =>
        ({ ...base, recompressible: [{} as never], medianQuality, medianDpi }) as unknown as Analysis;

      // Already at 72 dpi but quality 94: dpi is not the lever, quality is. Offer it, and
      // say so — naming dpi here is what made the card contradict itself.
      const qOnly = harderOffer(withImage(94, 72), balanced);
      note(`q94 / 72 dpi → ${qOnly.preset ? 'offered' : 'not offered'}: ${qOnly.note || qOnly.nothingLeft}`);
      ok(qOnly.preset?.key === 'smallest', 'quality 94 at 72 dpi still has somewhere to go');
      ok(/quality 42/.test(qOnly.note), 'the note names quality as the lever');
      ok(!/drops? (scans|them|anything) to 72 dpi/.test(qOnly.note), 'the note does not claim it will resize a file already at 72 dpi');
      ok(/already at 72 dpi/.test(qOnly.note), 'the note says outright that resolution will not change');

      // At or below Smallest on both axes: nothing left. Do not offer it.
      const dead = harderOffer(withImage(40, 72), balanced);
      note(`q40 / 72 dpi → ${dead.preset ? 'offered' : 'not offered'}: ${dead.nothingLeft}`);
      ok(dead.preset === null, 'a file already at quality 40 and 72 dpi is offered nothing');
      ok(/would not change it/.test(dead.nothingLeft), 'and it says why instead');

      // A normal scan: both levers available.
      const both = harderOffer(withImage(88, 300), balanced);
      ok(both.preset?.key === 'smallest', '300 dpi at quality 88 has both levers');
      ok(/quality 42/.test(both.note) && /72 dpi/.test(both.note), 'the note names both');

      // No image to act on, and "already the hardest setting": still nothing to offer.
      ok(harderOffer({ ...base, recompressible: [], medianQuality: 90, medianDpi: 300 } as unknown as Analysis, balanced).preset === null,
        'nothing recompressible means nothing to offer');
      ok(harderOffer(withImage(90, 300), smallest).preset === null, 'Smallest offers no harder setting than itself');
    },
  },
  {
    name: 'The nothing-to-gain sentence agrees with the button under it',
    async run() {
      const balanced = PRESETS[0];
      const base = {
        pageCount: 1, totalBytes: 1, images: [{} as never], actionableBytes: 1, skippedBytes: 0,
        skipReasons: new Map(), allJpeg: true, hasText: false, signed: false,
      };
      const a = (q: number, dpi: number) =>
        ({ ...base, recompressible: [{} as never], medianQuality: q, medianDpi: dpi }) as unknown as Analysis;

      const offered = explainNoGain(a(94, 72), balanced);
      note(`offered:     ${offered}`);
      ok(/visibly worse file/.test(offered), 'when a harder pass is offered, the copy stands');

      const nothing = explainNoGain(a(40, 72), balanced);
      note(`not offered: ${nothing}`);
      ok(!/visibly worse file/.test(nothing),
        'when nothing harder is offered, it stops promising a worse file the card cannot produce');
      ok(/would not change it either/.test(nothing), 'and says the harder setting would not help');
    },
  },
  {
    name: 'An explicitly requested pass is shown, not measured and discarded',
    async run() {
      // 30 KB file, 58.8% saving: the exact shape that left the card reading "58.8%
      // smaller" and "Nothing worth saving" at once.
      const before = 30 * 1024;
      const after = Math.round(before * 0.412);
      note(`${(before / 1024).toFixed(1)} KB → ${(after / 1024).toFixed(1)} KB, ${(((before - after) / before) * 100).toFixed(1)}% smaller`);
      ok(!worthIt(before, after), 'unprompted, a 12 KB saving is still below the floor and stays unoffered');
      ok(worthShowing(before, after), 'but when the user asks for it by name, the result is shown');

      // The bar is not removed, only the absolute floor.
      ok(!worthShowing(1_000_000, 995_000), 'a saving nobody could perceive is still not shown');
      ok(!worthShowing(1000, 1000), 'no saving at all is not shown');
      ok(!worthShowing(1000, 1200), 'a bigger file is never shown as a result');
    },
  },
  {
    name: 'JPEG quality estimate matches what the encoder was asked for',
    async run() {
      const misses: string[] = [];
      for (const q of [0.42, 0.58, 0.72, 0.9]) {
        const bytes = await canvasJpeg(drawScan(600, 850, 3), q);
        const facts = readJpeg(bytes);
        ok(facts !== null, `readJpeg parsed a q${Math.round(q * 100)} JPEG`);
        const estimate = facts!.quality;
        const d = facts!.diagnostic;
        note(`asked q${Math.round(q * 100)} → measured ${estimate ?? 'custom tables'} ` +
          `(${facts!.width}x${facts!.height}, ${facts!.components} comp` +
          (d ? `, scale=${d.scale.toFixed(2)}, worstResidual=${d.worstResidual.toFixed(3)}, usable=${d.usable}, dqt[0..7]=${d.table.join(',')}` : '') + ')');
        if (estimate === null || Math.abs(estimate - q * 100) > 6) {
          misses.push(`q${Math.round(q * 100)}→${estimate ?? 'null'}`);
        }
      }
      ok(misses.length === 0, `every estimate within 6 points${misses.length ? ` (missed: ${misses.join(', ')})` : ''}`);
    },
  },
  {
    name: 'Effective dpi is measured from the content stream, not guessed',
    async run() {
      // 2480x3508 px drawn onto A4 is 300 dpi by construction.
      const pdf = await makeScanPdf(1, 1240, 1754, 0.85);
      const doc = await PDFDocument.load(pdf);
      const placements = await measurePlacements(doc);
      ok(placements.size === 1, `found ${placements.size} placed image`);
      const images = await findImages(doc);
      const dpi = images[0].dpi;
      note(`1240 px across a 595.28 pt page → ${dpi === null ? 'null' : dpi.toFixed(1)} dpi`);
      // 1240 / (595.28/72) = 150.0
      ok(dpi !== null && Math.abs(dpi - 150) < 2, 'dpi within 2 of the constructed 150');
    },
  },
  {
    name: 'A high-quality scan actually gets smaller, and every page survives',
    async run() {
      const pdf = await makeScanPdf(6, 1700, 2400, 0.92);
      const doc = await PDFDocument.load(pdf);
      const a = await analyse(doc, pdf.length);
      note(`in: ${formatBytes(pdf.length)}, ${a.pageCount} pages, ${a.images.length} images, ` +
        `median q${a.medianQuality}, median ${a.medianDpi?.toFixed(0)} dpi`);
      ok(a.recompressible.length === 6, 'all six images are recompressible');

      const r = await compress(doc, pdf.length, a, { preset: PRESETS[0], stripMetadata: true });
      const saved = 1 - r.afterBytes / r.beforeBytes;
      note(`out: ${formatBytes(r.afterBytes)} (${(saved * 100).toFixed(1)}% smaller), ` +
        `${r.imagesRecompressed} recompressed, ${r.downscaled} downscaled to ~${r.writtenDpi} dpi`);
      ok(r.afterBytes < r.beforeBytes, 'the output is smaller than the input');
      ok(worthIt(r.beforeBytes, r.afterBytes), 'the saving clears the worth-it threshold');

      const check = await PDFDocument.load(r.bytes);
      ok(check.getPageCount() === 6, 'the output still has six pages');
      const checkImages = await findImages(check);
      ok(checkImages.length === 6, 'the output still has six images');
      ok(checkImages.every((i) => i.filters.includes('DCTDecode')), 'every image came back as JPEG');
    },
  },
  {
    name: 'An already-small scan is reported as nothing-to-gain, with real reasons',
    async run() {
      // Already at the Balanced target: 150 dpi, quality ~58.
      const pdf = await makeScanPdf(4, 1240, 1754, 0.55);
      const doc = await PDFDocument.load(pdf);
      const a = await analyse(doc, pdf.length);
      const r = await compress(doc, pdf.length, a, { preset: PRESETS[0], stripMetadata: true });
      const delta = r.beforeBytes - r.afterBytes;
      note(`${formatBytes(r.beforeBytes)} → ${formatBytes(r.afterBytes)} (${((delta / r.beforeBytes) * 100).toFixed(1)}%)`);
      ok(!worthIt(r.beforeBytes, r.afterBytes), 'correctly judged not worth it');
      const why = explainNoGain(a, PRESETS[0]);
      note(`says: "${why}"`);
      ok(/\d/.test(why), 'the explanation contains measured numbers');
      ok(!/62|148|quality 61/.test(why), 'the explanation is not the design placeholder text');
    },
  },
  {
    name: 'A text-only PDF is never made larger, and says why',
    async run() {
      const pdf = await makeTextPdf(5);
      const doc = await PDFDocument.load(pdf);
      const a = await analyse(doc, pdf.length);
      note(`${formatBytes(pdf.length)}, ${a.images.length} images, hasText=${a.hasText}`);
      ok(a.images.length === 0, 'no images found');
      ok(a.hasText, 'text layer detected');
      const r = await compress(doc, pdf.length, a, { preset: PRESETS[0], stripMetadata: true });
      note(`${formatBytes(r.beforeBytes)} → ${formatBytes(r.afterBytes)}`);
      ok(!worthIt(r.beforeBytes, r.afterBytes), 'reported as nothing to gain');
      const why = explainNoGain(a, PRESETS[0]);
      note(`says: "${why}"`);
      ok(/no images/i.test(why), 'the explanation names the real reason');
    },
  },
  {
    name: 'Smallest beats Balanced beats the original',
    async run() {
      const pdf = await makeScanPdf(3, 1700, 2400, 0.92);
      const sizes: number[] = [];
      for (const preset of PRESETS) {
        const doc = await PDFDocument.load(pdf);
        const a = await analyse(doc, pdf.length);
        const r = await compress(doc, pdf.length, a, { preset, stripMetadata: true });
        sizes.push(r.afterBytes);
        note(`${preset.name.padEnd(9)} ${formatBytes(r.afterBytes).padStart(9)}  (${((1 - r.afterBytes / pdf.length) * 100).toFixed(1)}% off)`);
      }
      ok(sizes[0] < pdf.length, 'Balanced is smaller than the original');
      ok(sizes[1] < sizes[0], 'Smaller is smaller than Balanced');
      ok(sizes[2] < sizes[1], 'Smallest is smaller than Smaller');
    },
  },
  {
    name: 'Metadata is genuinely gone when asked for',
    async run() {
      const src = await PDFDocument.create();
      src.addPage([300, 300]);
      src.setAuthor('Someone Private');
      src.setTitle('Board minutes, confidential');
      src.setProducer('SomeScanner 4.2');
      const pdf = await src.save();

      // pdf-lib writes Info strings as UTF-16BE hex, so read them back through the
      // parser rather than searching the raw bytes for latin1 text.
      const before = await PDFDocument.load(pdf, { updateMetadata: false });
      note(`before: author=${JSON.stringify(before.getAuthor())} title=${JSON.stringify(before.getTitle())}`);
      ok(before.getAuthor() === 'Someone Private', 'author is present before');
      ok(before.getTitle() === 'Board minutes, confidential', 'title is present before');

      const doc = await PDFDocument.load(pdf, { updateMetadata: false });
      const a = await analyse(doc, pdf.length);
      const r = await compress(doc, pdf.length, a, { preset: PRESETS[0], stripMetadata: true });

      const after = await PDFDocument.load(r.bytes, { updateMetadata: false });
      note(`after:  author=${JSON.stringify(after.getAuthor())} title=${JSON.stringify(after.getTitle())} producer=${JSON.stringify(after.getProducer())}`);
      ok(!after.getAuthor(), 'author is gone after');
      ok(!after.getTitle(), 'title is gone after');
      ok(!after.getProducer()?.includes('SomeScanner'), 'producer no longer names the scanner');

      // And the raw bytes must not still carry it in either encoding.
      const raw = new TextDecoder('latin1').decode(r.bytes);
      const utf16 = 'Someone Private'.split('').map((c) => `00${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('');
      ok(!raw.includes('Someone Private'), 'the name is not in the output as latin1');
      ok(!raw.toLowerCase().includes(utf16), 'the name is not in the output as UTF-16 hex');
    },
  },
  {
    name: 'Timing — what a page of scan actually costs on this machine',
    async run() {
      for (const pages of [1, 10]) {
        const pdf = await makeScanPdf(pages, 1700, 2400, 0.9);
        const doc = await PDFDocument.load(pdf);
        const a = await analyse(doc, pdf.length);
        const t0 = performance.now();
        await compress(doc, pdf.length, a, { preset: PRESETS[0], stripMetadata: true });
        const ms = performance.now() - t0;
        note(`${String(pages).padStart(3)} page(s) of ${formatBytes(pdf.length)}: ${ms.toFixed(0)} ms  (${(ms / pages).toFixed(0)} ms/page)`);
      }
    },
  },
];

// ---------------------------------------------------------------- runner

async function main(): Promise<void> {
  const out = document.getElementById('out')!;
  const write = (s: string) => { out.textContent += s + '\n'; };

  write(`pdf-iq compression self-test — ${navigator.userAgent}`);
  write('');

  let failed = 0;
  emit = write;
  for (const c of CASES) {
    write(`• ${c.name}`);
    try {
      await c.run(write);
    } catch (err) {
      failed++;
      if (!(err instanceof Error) || !err.message) {
        write(`  FAIL  ${String(err)}`);
      }
      if (err instanceof Error && err.stack) write(`        ${err.stack.split('\n')[1]?.trim() ?? ''}`);
    }
    write('');
  }

  write(failed === 0 ? `ALL ${CASES.length} CASES PASSED` : `${failed} of ${CASES.length} CASES FAILED`);
  document.title = failed === 0 ? 'selftest: pass' : `selftest: ${failed} failed`;
  (window as unknown as { selftestDone: boolean }).selftestDone = true;
  (window as unknown as { selftestFailed: number }).selftestFailed = failed;
}

void main();
