/**
 * The Pro features, exercised in Node on real PDFs, with every output read back by two readers
 * that did not write it — MuPDF and pypdf. The same standard as verify:crypto: "it opened" and
 * "pdf-lib accepted it" are not evidence, because the corrupt AES-128 output passed both.
 *
 * Sections, one per feature, as each is built:
 *   - searchable PDF: the recognised words come back out of the file in both readers, a skipped
 *     page gets no layer, and the page renders pixel for pixel as it did — the scan is not changed.
 *     A page read from its own text layer gets no second layer and is not counted as given one.
 *   - the searchable result sentence: built from the writer's count, so pages that already had a
 *     layer are named rather than claimed, and a copy that layered nothing cannot be described.
 *   - compress to a target: the ladder, the resolution plan, and the size search against scripted
 *     pass sizes — floor first, at most five passes, the mildest step that fits, nothing returned
 *     over the target or after a cancel. The pass itself is the preset compressor, which needs a
 *     browser canvas; that part is checked in the browser, not here.
 *
 *   npm run verify:pro-features      requires python with PyMuPDF and pypdf
 */
import * as esbuild from 'esbuild';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { PDFDocument, rgb } from 'pdf-lib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = join(tmpdir(), 'pdfiq-verify-pro-features');
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

await esbuild.build({
  entryPoints: [join(ROOT, 'src/pro/searchable.ts')],
  bundle: true, platform: 'node', format: 'esm', logLevel: 'warning', outdir: WORK,
  outExtension: { '.js': '.mjs' },
});
const searchable = await import(pathToFileURL(join(WORK, 'searchable.mjs')).href);

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

// Two readers. `render` returns an MD5 of the first page's pixels at 72 dpi, for the
// "the page looks the same" check.
const READ = [
  'import json, sys, hashlib, fitz, pypdf',
  'fitz.TOOLS.mupdf_display_errors(False)',
  'fitz.TOOLS.reset_mupdf_warnings()',
  'd = fitz.open(sys.argv[1])',
  'mtext = "" if d.needs_pass else "".join(p.get_text() for p in d)',
  'pix = hashlib.md5(d[0].get_pixmap(dpi=72).samples).hexdigest() if len(d) else ""',
  'warn = fitz.TOOLS.mupdf_warnings().strip()',
  'try:',
  '    r = pypdf.PdfReader(sys.argv[1])',
  '    ytext = "".join((p.extract_text() or "") for p in r.pages)',
  '    yerr = ""',
  'except Exception as e:',
  '    ytext, yerr = "", repr(e)',
  'fonts = [list(f) for f in d[0].get_fonts(full=True)] if len(d) else []',
  'print(json.dumps(dict(pages=len(d), mupdf=mtext, pypdf=ytext, pypdfError=yerr, render=pix, warnings=warn, fonts=fonts)))',
].join('\n');
const read = (file) => JSON.parse(execFileSync('python', ['-c', READ, file], { encoding: 'utf8' }));

// ---------------------------------------------------------------- searchable PDF
console.log('\n— searchable PDF');
{
  // A "scan": a page with a grey band drawn on it and no text at all.
  const scan = await PDFDocument.create();
  const page = scan.addPage([595.28, 841.89]);
  page.drawRectangle({ x: 50, y: 680, width: 420, height: 90, color: rgb(0.86, 0.86, 0.86) });
  const src = new Uint8Array(await scan.save());
  const srcFile = join(WORK, 'scan.pdf');
  writeFileSync(srcFile, src);

  // Words as OCR reports them: canvas pixels at 300 dpi, y measured from the top.
  const scale = 300 / 72;
  const box = (text, xPt, topPt, wPt, hPt) => ({
    text, confidence: 92,
    x0: xPt * scale, y0: topPt * scale, x1: (xPt + wPt) * scale, y1: (topPt + hPt) * scale,
  });
  const WORDS = ['PDFIQSEARCHABLE', 'Łódź', '£42.50'];
  const words = [box(WORDS[0], 60, 90, 200, 22), box(WORDS[1], 280, 90, 80, 22), box(WORDS[2], 380, 90, 80, 22)];

  const before = read(srcFile);
  ok(!WORDS.some((w) => before.mupdf.includes(w)), 'the fixture has no text of its own to begin with');

  const written = await searchable.writeSearchable(src, [{ index: 0, words, skipped: null }], () => scale);
  ok(written.layered === 1, 'the writer counts the one page it gave a layer — the result sentence is built from this count');
  const outFile = join(WORK, 'searchable.pdf');
  writeFileSync(outFile, written.bytes);
  const after = read(outFile);
  ok(after.pages === 1, 'one page in, one page out');
  for (const w of WORDS) ok(after.mupdf.includes(w), `MuPDF reads "${w}" out of the file`);
  for (const w of WORDS) ok(after.pypdf.includes(w), `pypdf reads "${w}" out of the file${after.pypdfError ? ` (${after.pypdfError})` : ''}`);
  // One MuPDF warning is known and understood. The layer's font is a Type0 / Identity-H font with
  // no font program: its glyphs are never drawn (text render mode 3), and both readers extract the
  // words through /ToUnicode, as checked above, but MuPDF notes it cannot map the glyphs. Benign for
  // an invisible layer, and still something a preflight would flag; TECH_DEBT has the fix. Exactly
  // that warning is accepted, by its text. Any other warning fails.
  // No warning at all, since 12 September 2026: the layer's font is embedded (src/lib/glyphless-
  // font.ts). Until then MuPDF said "non-embedded font using identity encoding" on every file we
  // wrote, and this check accepted exactly that one line — an accepted warning is a defect with a
  // note attached, and these files are kept by people who did not make them.
  const noise = after.warnings.split(String.fromCharCode(10)).map((l) => l.trim()).filter(Boolean);
  ok(noise.length === 0, `MuPDF raises no warning on the file we wrote${noise.length ? `: ${noise[0]}` : ''}`);
  ok(after.render === before.render, 'the page renders pixel for pixel as it did: the layer is invisible and the scan is unchanged');
  // Embedded, not merely quiet: MuPDF lists the font with a program of its own. A missing
  // /FontFile2 shows here as an empty extension and xref 0.
  const layerFont = (after.fonts ?? []).find((f) => String(f[3] ?? '').includes('PdfiqInvisible'));
  ok(Boolean(layerFont), `MuPDF lists the layer's font${layerFont ? ` (${layerFont[3]})` : ' — IT IS NOT THERE'}`);
  ok(Boolean(layerFont) && layerFont[1] === 'ttf' && Number(layerFont[0]) > 0,
    `and it carries a font program of its own: ${layerFont ? `${layerFont[1] || 'none'}, xref ${layerFont[0]}` : 'no font'}`);
  ok(Boolean(layerFont) && layerFont[2] === 'Type0', `written as a composite font: ${layerFont?.[2]}`);

  const skipped = await searchable.writeSearchable(src, [{ index: 0, words, skipped: 'low-confidence' }], () => scale);
  const skippedFile = join(WORK, 'skipped.pdf');
  writeFileSync(skippedFile, skipped.bytes);
  const s = read(skippedFile);
  ok(!WORDS.some((w) => s.mupdf.includes(w) || s.pypdf.includes(w)), 'a page OCR skipped gets no layer: nothing read, nothing written');
  ok(skipped.layered === 0, 'and is not counted as given one');

  // A page read out of the document's own text layer carries no recognised words: OCR reports it
  // as read (skipped null) with words []. It was already searchable. The offer used to appear for
  // a file made only of such pages, hand over a re-saved copy with nothing added, and say
  // "2 of 2 pages are now searchable".
  const own = await searchable.writeSearchable(src, [{ index: 0, words: [], skipped: null }], () => scale);
  ok(own.layered === 0, 'a page read from its own text layer gets no second layer, and is not counted as given one');
  ok(searchable.pagesToLayer([{ index: 0, words: [], skipped: null }]) === 0,
    'a file whose every page had its own layer has no page a searchable copy would add anything to');
  ok(searchable.pagesToLayer([{ index: 0, words, skipped: null }, { index: 1, words: [], skipped: null }, { index: 2, words, skipped: 'low-confidence' }]) === 1,
    'only pages with recognised words, and not skipped, count as pages to layer');
}

// ---------------------------------------------------------------- the searchable result sentence
console.log('\n— the searchable result sentence');
{
  // The sentence lives in src/pro/searchable.ts, not in the free src/lib/ocr-result.ts: a Pro
  // branch in a shared function ships in production where no sentinel can see it.
  const { describeSearchable } = searchable;
  const refusal = (o) => { try { describeSearchable(o); return ''; } catch (e) { return String(e.message); } };

  ok(refusal({ pageCount: 2, fromLayer: 2, layered: 0 }) !== '',
    'a searchable copy that layered no page cannot be described as having made anything searchable');
  ok(refusal({ pageCount: 2, fromLayer: 0 }) !== '',
    "and the sentence cannot be written without the writer's own count");
  const mixed = describeSearchable({ pageCount: 4, fromLayer: 1, layered: 2 });
  ok(mixed.head.includes('2 given a text layer here') && mixed.head.includes('1 already had its own') && !mixed.head.includes('now searchable'),
    `pages that already had a layer are named, not counted as made searchable: "${mixed.head}"`);
  ok(mixed.announce.includes('2 given a text layer here') && mixed.announce.includes('1 already had its own'),
    `and the screen-reader announcement says the same: "${mixed.announce}"`);
  const scan = describeSearchable({ pageCount: 3, fromLayer: 0, layered: 3 });
  ok(scan.head === '3 of 3 pages are now searchable.', `a scan with every page layered keeps the plain sentence: "${scan.head}"`);
}

// ---------------------------------------------------------------- compress to a target
console.log('\n— compress to a target');
{
  await esbuild.build({
    entryPoints: [join(ROOT, 'src/pro/compress-target.ts'), join(ROOT, 'src/lib/compress.ts')],
    bundle: true, splitting: true, entryNames: '[name]', platform: 'node', format: 'esm', logLevel: 'warning', outdir: WORK,
    outExtension: { '.js': '.mjs' },
  });
  const t = await import(pathToFileURL(join(WORK, 'compress-target.mjs')).href);
  const { PRESETS } = await import(pathToFileURL(join(WORK, 'compress.mjs')).href);
  const MB = 1024 * 1024;

  ok(t.LADDER.length === 9 && t.LADDER.every((s, i) => i === 0 || (s.dpi < t.LADDER[i - 1].dpi && s.quality < t.LADDER[i - 1].quality)),
    'the ladder has nine steps, each harsher than the last in both resolution and quality');
  const same = (s, p) => s.dpi === p.targetDpi && s.quality === p.quality;
  ok(same(t.LADDER[3], PRESETS[0]) && same(t.LADDER[5], PRESETS[1]) && same(t.LADDER[8], PRESETS[2]),
    'steps 4, 6 and 9 are the Balanced, Smaller and Smallest presets, and the floor is Smallest');
  ok(t.MAX_PASSES === 5, 'a search takes at most five passes');

  // Scripted pass sizes: step i comes out at (9 - i) MB, so the floor is 1 MB.
  const scripted = (sizes) => {
    const calls = [];
    return { calls, pass: async (step, n) => { const i = t.LADDER.indexOf(step); calls.push(i); return { size: sizes[i], result: { step: i } }; } };
  };
  const down = t.LADDER.map((_, i) => (9 - i) * MB);

  let s = scripted(down);
  let o = await t.searchSize(10 * MB, 5.5 * MB, s.pass);
  ok(o.kind === 'reached' && o.stepIndex === 4 && o.size === 5 * MB, 'reaches 5.5 MB at the mildest step that fits (step 5, 5 MB)');
  ok(s.calls[0] === t.FLOOR_INDEX, 'the first pass is the floor, so "cannot" would be measured');
  ok(o.passes === s.calls.length && o.passes <= 5, `in ${o.passes} passes, all of them real`);
  ok(o.result.step === o.stepIndex, 'and hands over the result of the pass that measured under the target');

  s = scripted(down);
  o = await t.searchSize(10 * MB, 0.5 * MB, s.pass);
  ok(o.kind === 'cannot' && o.floorSize === 1 * MB && s.calls.length === 1, 'under 0.5 MB cannot be met: one pass at the floor, and it says so');
  ok(!('result' in o), 'and hands over nothing');

  s = scripted(down);
  o = await t.searchSize(4 * MB, 5 * MB, s.pass);
  ok(o.kind === 'already' && s.calls.length === 0, 'a file already under the target: nothing run, nothing handed over');

  // An encoder that breaks the ordering: step 2 comes out smaller than step 3.
  const bumpy = [...down];
  bumpy[2] = 5 * MB;
  s = scripted(bumpy);
  o = await t.searchSize(10 * MB, 5.2 * MB, s.pass);
  ok(o.kind === 'reached' && o.size <= 5.2 * MB, 'if an encoder breaks the ordering, the result is still one measured under the target');

  const ac = new AbortController();
  s = { calls: [], pass: async (step) => { ac.abort(); return { size: 1 * MB, result: {} }; } };
  let threw = '';
  try { await t.searchSize(10 * MB, 5.5 * MB, s.pass, ac.signal); } catch (e) { threw = e.name; }
  ok(threw === 'AbortError', 'a cancel stops the search and returns nothing — not the best pass so far');

  const cannot = t.describeSize({ kind: 'cannot', floorSize: 6612480, passes: 1 }, 5 * MB);
  ok(cannot.includes("can't be brought under 5.00 MB here") && cannot.includes('72 dpi, quality 42') && cannot.includes('6,612,480 bytes'),
    `the "cannot" wording names the target, the floor and the exact measured size: "${cannot}"`);
  const reached = t.describeSize({ kind: 'reached', stepIndex: 4, size: 4845000, passes: 4 }, 5 * MB);
  ok(reached.includes('130 dpi, quality 66') && reached.includes('the mildest setting that got there') && reached.includes('4,845,000 bytes'),
    `the "reached" wording names the step and the exact size: "${reached}"`);

  ok(t.parseTarget('5', 'MB') === 5 * MB && t.parseTarget('800', 'KB') === 800 * 1024 && t.parseTarget('4,5', 'MB') === Math.floor(4.5 * MB),
    'sizes are read in the site\'s own units: 1 MB = 1,048,576 bytes');
  ok(t.parseTarget('0', 'MB') === null && t.parseTarget('lots', 'MB') === null, 'and nothing unusable is accepted as a target');

  const plan = t.resolutionPlan(150);
  const img = (dpi, quality) => ({ key: String(dpi), dpi, jpeg: quality == null ? null : { quality } });
  ok(plan(img(300, 90)).targetDpi === 150 && plan(img(300, 90)).quality === 0.9, 'resolution: an image above N comes down to N at its own JPEG quality');
  ok(plan(img(300, null)).quality === t.FALLBACK_QUALITY, 'and at 85 when the file does not say');
  ok(plan(img(150, 90)) === 'keep' && plan(img(96, 90)) === 'keep', 'an image at or below N is left byte for byte');
  ok(plan(img(null, 90)) === 'keep', 'an image with no measurable resolution is left, not guessed');

  const analysis = { images: [img(300, 90), img(250, 80), img(100, 70), img(null, 70), { key: 'cmyk' }], recompressible: [img(300, 90), img(250, 80), img(100, 70), img(null, 70)] };
  const outcomes = new Map([['300', 'replaced'], ['250', 'not-smaller']]);
  const said = t.describeResolution(analysis, 150, outcomes);
  ok(said.includes('1 image brought down to 150 dpi') && said.includes('stayed above 150 dpi'),
    `the resolution result says which images came down and which stayed above: "${said}"`);
  ok(t.resolutionNothingToDo({ images: [img(100, 70)], recompressible: [img(100, 70)] }, 150)?.startsWith('Every image in this file is already at or below 150 dpi'),
    'and when nothing is above N, says so before running anything');
}

console.log(`\n${fails ? `${fails} FAILED` : 'the Pro features behave as described, each output read by MuPDF and pypdf'}`);
process.exitCode = fails ? 1 : 0;
