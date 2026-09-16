/**
 * ASCII85 and ASCIIHex, checked against another implementation, and a real ReportLab page read end to end.
 *
 * Until 16 September 2026 pdf-inspect.ts treated both filters as opaque ("rare in modern writers"). ReportLab writes page
 * content as [/ASCII85Decode /FlateDecode] and images as [/ASCII85Decode /DCTDecode] by default, so on its files Compress
 * found no image drawn anywhere, told the person "Its 2 images are never drawn on any page", and compressed nothing.
 *
 *  - The decoders are compared with Python's base64.a85encode and bytes.hex(), not with an encoder written here: a
 *    fixture made by our own encoder agrees with our own decoder whether or not either follows the specification.
 *  - The fixture is page 1 of scan_lowres_5p.pdf from the Android repo's test corpus, written by ReportLab, trimmed with
 *    pypdf, which copies the streams as they are (filters checked below).
 *
 *   npm run verify:ascii-filters
 */
import * as esbuild from 'esbuild';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = join(ROOT, 'node_modules', '.cache', 'verify-ascii-filters');
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

async function load(entry) {
  const out = join(WORK, entry.replace(/[\\/]/g, '_') + '.mjs');
  try {
    // pdf-lib stays external: a bundled copy is a second set of classes, every instanceof check against the test's own
    // document fails, and the inspector silently finds nothing. That made this check fail on the fix itself.
    await esbuild.build({ entryPoints: [join(ROOT, entry)], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'silent', external: ['pdf-lib'] });
    return await import(pathToFileURL(out).href);
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------- the decoders, against Python's encoders
const A = await load('src/lib/ascii-filters.ts');
ok(typeof A.ascii85Decode === 'function' && typeof A.asciiHexDecode === 'function', 'src/lib/ascii-filters.ts decodes ASCII85 and ASCIIHex');
const ascii85Decode = A.ascii85Decode ?? (() => new Uint8Array());
const asciiHexDecode = A.asciiHexDecode ?? (() => new Uint8Array());

let seed = 20260916;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const cases = [
  ['empty', []], ['one byte', [0x41]], ['two bytes', [1, 2]], ['three bytes', [0xff, 0, 0x7f]], ['four bytes', [0x4d, 0x61, 0x6e, 0x20]],
  ['five bytes', [9, 8, 7, 6, 5]], ['four zeros ("z")', [0, 0, 0, 0]], ['zeros then a tail', [0, 0, 0, 0, 0, 0, 0, 0, 1]],
  ['all ones (largest group)', [0xff, 0xff, 0xff, 0xff]],
  ['1,000 random bytes', Array.from({ length: 1000 }, () => Math.floor(rand() * 256))],
  ['997 random bytes (partial final group)', Array.from({ length: 997 }, () => Math.floor(rand() * 256))],
];
const py = String.raw`
import base64, json, sys
out = []
for name, data in json.load(sys.stdin):
    b = bytes(data)
    out.append({"a85": base64.a85encode(b, wrapcol=76).decode() + "~>", "hex": b.hex().upper()})
print(json.dumps(out))
`;
const r = spawnSync('python', ['-c', py], { input: JSON.stringify(cases), encoding: 'utf8' });
ok(r.status === 0, `Python's encoders ran${r.status === 0 ? '' : `: ${r.stderr}`}`);
const encoded = r.status === 0 ? JSON.parse(r.stdout) : [];
cases.forEach(([name, data], i) => {
  const want = Buffer.from(data);
  if (!encoded[i]) return;
  let got;
  try { got = Buffer.from(ascii85Decode(new TextEncoder().encode(encoded[i].a85))); } catch (e) { got = `threw ${e.message}`; }
  ok(Buffer.isBuffer(got) && got.equals(want), `ASCII85 (Python-encoded, wrapped at 76): ${name}`);
  const spaced = encoded[i].hex.replace(/(..)/g, '$1 ') + '>';
  try { got = Buffer.from(asciiHexDecode(new TextEncoder().encode(spaced))); } catch (e) { got = `threw ${e.message}`; }
  ok(Buffer.isBuffer(got) && got.equals(want), `ASCIIHex (upper case, spaced): ${name}`);
});
const enc = (s) => new TextEncoder().encode(s);
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
ok(Buffer.from(asciiHexDecode(enc('9>'))).equals(Buffer.from([0x90])), 'ASCIIHex: an odd final digit is followed by an implied 0');
ok(Buffer.from(ascii85Decode(enc('<~87cURD_*#TDfTZ)~>'))).toString() === 'Hello, world', 'ASCII85: a "<~" prefix is tolerated ("Hello, world" as Python encodes it)');
ok(throws(() => ascii85Decode(enc('87cUR'))), 'ASCII85: no "~>" end marker throws');
ok(throws(() => ascii85Decode(enc('87cUv~>'))), 'ASCII85: a character outside "!".."u" throws');
ok(throws(() => ascii85Decode(enc('8z~>'))), 'ASCII85: "z" inside a group throws');
ok(throws(() => asciiHexDecode(enc('4G>'))), 'ASCIIHex: a non-hex digit throws');

// ---------------------------------------------------------------- a real ReportLab page
const I = await load('src/lib/pdf-inspect.ts');
const { PDFDocument, PDFName } = await import('pdf-lib');
const fixture = readFileSync(join(ROOT, 'tools/fixtures/reportlab/reportlab-scan-1p.pdf'));
const doc = await PDFDocument.load(fixture);
const page = doc.getPages()[0].node;
const xobjects = page.Resources().lookup(PDFName.of('XObject'));
const imageStream = xobjects.lookup(xobjects.keys()[0]);
ok(String(page.Contents().dict.lookup(PDFName.of('Filter'))) === '[ /ASCII85Decode /FlateDecode ]', `fixture: page content is ${page.Contents().dict.lookup(PDFName.of('Filter'))}, as ReportLab writes it`);
ok(String(imageStream.dict.lookup(PDFName.of('Filter'))) === '[ /ASCII85Decode /DCTDecode ]', `fixture: the image is ${imageStream.dict.lookup(PDFName.of('Filter'))}`);

const placements = typeof I.measurePlacements === 'function' ? await I.measurePlacements(doc) : new Map();
ok(placements.size === 1, `the image drawn on the page is found (${placements.size} placement${placements.size === 1 ? '' : 's'})`);
const images = typeof I.findImages === 'function' ? await I.findImages(doc) : [];
const img = images[0];
ok(images.length === 1 && img.placement !== null && img.skipReason !== 'never drawn on any page', `it is not reported as "never drawn on any page" (${img?.skipReason ?? 'no reason: recompressible'})`);
ok(img?.recompressible === true && JSON.stringify(img?.filters) === '["DCTDecode"]' && img?.jpeg?.quality > 0,
  `it is a recompressible JPEG once unwrapped (filters ${JSON.stringify(img?.filters)}, quality ${img?.jpeg?.quality}, ${img?.dpi?.toFixed(0)} dpi)`);
ok(img && img.data?.[0] === 0xff && img.data?.[1] === 0xd8, 'the bytes handed to the decoder start with a JPEG marker, not ASCII85 text');

// DecodeParms follows the original chain, including the wrapper removed in front.
if (typeof I.decodeParms === 'function') {
  const probe = await PDFDocument.create();
  const ctx = probe.context;
  const pred = ctx.obj({ Predictor: 12, Columns: 3 });
  const dict = ctx.obj({ Filter: [PDFName.of('ASCII85Decode'), PDFName.of('FlateDecode')], DecodeParms: [null, pred] });
  ok(I.decodeParms(dict, 1)?.lookup(PDFName.of('Predictor'))?.asNumber() === 12 && I.decodeParms(dict, 0) === null,
    '/DecodeParms is read from the slot of FlateDecode, not the first slot');
} else {
  ok(false, 'pdf-inspect.ts exports decodeParms');
}

console.log(fails ? `\n${fails} FAILED` : '\nASCII85 and ASCIIHex decode as Python encodes them, and a ReportLab page is read as drawn');
process.exitCode = fails ? 1 : 0;
