/**
 * The free OCR path, end to end, without fetching a 10 MB language model.
 *
 * A born-digital PDF has a text layer on every page, so every page takes the read-the-layer
 * route and no recognition runs. That is exactly the path this re-scope added, and it is
 * the one the automated suite cannot otherwise reach.
 */

import { PDFDocument, StandardFonts } from 'pdf-lib';
import { openDocument, pageHasText, pageText } from '../lib/pdfjs.js';

const out = document.getElementById('out')!;
const say = (s: string) => { out.textContent += s + '\n'; };
let fails = 0;
const ok = (cond: boolean, msg: string) => {
  say(`  ${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) fails++;
};

const SAMPLE = [
  'Zażółć gęślą jaźń Ünicode naïve PDF £42.50',
  'The second line, on the same page.',
];

async function bornDigital(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`Page ${i + 1} of ${pages}`, { x: 56, y: 780, size: 16, font });
    page.drawText(SAMPLE[1], { x: 56, y: 740, size: 12, font });
  }
  return doc.save();
}

(async () => {
  say('• A document that already has text is read, not recognised');
  const bytes = await bornDigital(3);
  const proxy = await openDocument(bytes);

  let withText = 0;
  const texts: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const page = await proxy.doc.getPage(i);
    if (await pageHasText(page)) withText++;
    texts.push(await pageText(page));
    page.cleanup();
  }
  await proxy.close();

  ok(withText === 3, `all 3 pages detected as already carrying text (found ${withText})`);
  say(`      page 1 read as: ${JSON.stringify(texts[0])}`);
  ok(/Page 1 of 3/.test(texts[0]), 'the text is read straight out of the file');
  ok(/second line/.test(texts[0]), 'and all of the page, not just the first run');
  ok(texts[1].includes('Page 2 of 3'), 'page 2 is its own text, not page 1 repeated');
  ok(texts.every((t) => t.length > 10), 'every page produced text');

  // The joined output the result screen builds.
  const joined = texts.map((t, i) => `--- page ${i + 1} ---\n${t}`).join('\n\n');
  ok(joined.split('--- page').length - 1 === 3, 'the joined output carries a marker per page');
  ok(!/undefined|\[object/.test(joined), 'and no placeholder leaked into it');

  say('');
  say(fails === 0 ? 'ALL GREEN' : `${fails} failed`);
  document.title = fails === 0 ? 'ocr-text: pass' : `ocr-text: ${fails} failed`;
})().catch((e) => { say('THREW: ' + (e instanceof Error ? e.stack : String(e))); document.title = 'ocr-text: threw'; });
