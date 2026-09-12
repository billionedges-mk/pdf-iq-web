/**
 * What a tool says about size must be about the operation, not a verdict on the document.
 *
 * Both defects this covers were true sentences about what a tool did, presented as facts about
 * the file — the shape of the "already optimal" message that once hid a decode error:
 *
 *  - Compress refused a document that was mostly embedded fonts as "already about as small as a
 *    PDF of these pages gets", and explained that text "is already the most compact way to store
 *    a page". The tool rewrites images and nothing else; the fonts were untouched, not optimal.
 *  - Merge reported the size of what it wrote and never compared it with what it was given, so a
 *    merged file larger than its inputs arrived with no word about it. On a site whose promise is
 *    "the real before and after", silence about a bigger file is the opposite of that.
 *
 * The fixtures are built here: a one-page document carrying a full TrueType program (the
 * Liberation Sans that ships with pdf.js), so most of its bytes are font and none are image.
 *
 *   npm run verify:size-claims
 */
import * as esbuild from 'esbuild';
import { rmSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { PDFDocument, PDFName } from 'pdf-lib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Inside the repo, so the bundle's `import 'pdf-lib'` resolves to the same node_modules copy.
const WORK = join(ROOT, 'node_modules', '.cache', 'verify-size-claims');
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

const load = async (name) => {
  try {
    await esbuild.build({
      entryPoints: [join(ROOT, `src/lib/${name}.ts`)],
      bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', outdir: WORK,
      // One pdf-lib for the check and the code under test. Bundled, the module had its own copy,
      // every `instanceof PDFDict` in it failed on documents loaded here, and the first run
      // reported a text document as having "no text layer" — a finding about the harness.
      external: ['pdf-lib'], absWorkingDir: ROOT,
      outExtension: { '.js': '.mjs' },
    });
    return await import(pathToFileURL(join(WORK, `${name}.mjs`)).href);
  } catch (e) {
    ok(false, `src/lib/${name}.ts builds and loads: ${String(e.message).split(/\r?\n/)[0]}`);
    return null;
  }
};
const C = await load('compress');
const S = await load('size-report');

// ---------------------------------------------------------------- a document that is mostly font

async function fontHeavyPdf() {
  const ttf = readFileSync(join(ROOT, 'node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'));
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const file = ctx.flateStream(ttf, { Length1: ttf.length });
  const fileRef = ctx.register(file);
  const descriptor = ctx.register(ctx.obj({
    Type: 'FontDescriptor', FontName: 'LiberationSans', Flags: 32,
    FontBBox: [-203, -303, 1050, 910], ItalicAngle: 0, Ascent: 905, Descent: -212, CapHeight: 716, StemV: 80,
    FontFile2: fileRef,
  }));
  const font = ctx.register(ctx.obj({
    Type: 'Font', Subtype: 'TrueType', BaseFont: 'LiberationSans', FirstChar: 32, LastChar: 126,
    Widths: Array(95).fill(556), Encoding: 'WinAnsiEncoding', FontDescriptor: descriptor,
  }));
  const page = doc.addPage([595, 842]);
  page.node.setFontDictionary(PDFName.of('F1'), font);
  const content = ctx.flateStream('BT /F1 11 Tf 72 770 Td (A contract clause, set in an embedded font.) Tj ET');
  page.node.set(PDFName.of('Contents'), ctx.register(content));
  return doc.save({ useObjectStreams: true });
}

if (C) {
  const bytes = await fontHeavyPdf();
  const doc = await PDFDocument.load(bytes);
  const analysis = await C.analyse(doc, bytes.length);
  ok(analysis.images.length === 0, `fixture: ${bytes.length} bytes, no images`);
  ok(typeof analysis.fontBytes === 'number' && analysis.fontBytes > bytes.length / 2,
    `the analysis measures the embedded font: ${analysis.fontBytes} of ${bytes.length} bytes`);

  const result = await C.compress(await PDFDocument.load(bytes), bytes.length, analysis, { preset: C.PRESETS[0], stripMetadata: false });
  ok(!C.worthIt(result.beforeBytes, result.afterBytes), `compressing it is not worth it (${result.beforeBytes} → ${result.afterBytes}), so the no-gain card is what a person sees`);

  const why = C.explainNoGain(analysis, C.PRESETS[0], result);
  console.log(`        says: ${why}`);
  ok(!/most compact|already about as small|as small as it gets|optimal/i.test(why), 'it passes no verdict on the document');
  ok(/font/i.test(why), 'it names the fonts, which is where the bytes are');
  ok(/does not|doesn’t|leaves/i.test(why) && /images/i.test(why), 'and says what this tool does and does not change');

  // With no fonts either, the explanation must still describe the tool rather than the file.
  const bare = C.explainNoGain({ ...analysis, fontBytes: 0 }, C.PRESETS[0], result);
  console.log(`        no fonts: ${bare}`);
  ok(!/most compact|optimal/i.test(bare), 'a text-only document is not called the most compact form either');
}

const card = readFileSync(join(ROOT, 'src/pages/compress.html'), 'utf8');
const nogain = /data-view="nogain"[\s\S]*?<\/section>/.exec(card)?.[0] ?? '';
ok(nogain && !/as small as a PDF of these pages gets/.test(nogain), 'the no-gain card has no fixed headline about the document');
const entry = readFileSync(join(ROOT, 'src/entries/compress.ts'), 'utf8');
ok(!/already about as small as it gets/.test(entry), 'and the screen-reader announcement makes no such claim either');

// ---------------------------------------------------------------- merge

if (S) {
  const bigger = S.describeMergedSize([100_000, 150_000], 262_500);
  console.log(`        bigger: ${bigger.fact} / ${bigger.note}`);
  ok(/larger/.test(bigger.note), 'a merged file larger than its inputs says so');
  ok(/12(\.\d)? KB/.test(bigger.note), 'with the measured difference');
  const smaller = S.describeMergedSize([100_000, 150_000], 240_000);
  ok(smaller.note === '', 'a merged file no larger than its inputs adds no note');
  ok(/in/.test(smaller.fact) && /out/.test(smaller.fact), `the size fact shows both ends: ${smaller.fact}`);
}
const mergeEntry = readFileSync(join(ROOT, 'src/entries/merge.ts'), 'utf8');
ok(/describeMergedSize\(/.test(mergeEntry), 'the merge result calls describeMergedSize');
const mergePage = readFileSync(join(ROOT, 'src/pages/merge.html'), 'utf8');
ok(/data-fact-bytes/.test(mergePage) && /data-size-note/.test(mergePage), 'the merge result has somewhere to show it');

console.log(fails ? `\n${fails} FAILED` : '\nsize claims describe the operation, not the document');
process.exit(fails ? 1 : 0);
