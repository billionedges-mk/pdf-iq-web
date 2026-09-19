/**
 * Every built page that LISTS the Pro features says which of them the Android app has.
 *
 * Pro is four things on the website and three in the app — compress-to-a-size is web-only until the app's 1.3. A
 * page that lists the four without saying so implies parity, and the owner's instruction was that the sentence be
 * generated from the flags rather than written into each page, so that it is true now and still true after 1.3
 * (19 September 2026).
 *
 * Generating it is half the job. The other half is this: the day someone adds a fifth listing surface — another price
 * card, another sheet, a new page — nothing makes them add the token. So the check reads the BUILT pages, decides for
 * itself which ones list the features, and fails when one of them does not carry the line. It reads the built page and
 * not the source because the source is templates and markers: {{proSurfaces}} in a file proves nothing about what a
 * reader sees, and <!--PRO_FEATURES--> renders a list with no token in sight.
 *
 * What counts as "listing the features" is every shape PRO_COPY renders into, derived from PRO_COPY itself:
 *   - the long feature lines (<!--PRO_FEATURES-->, /app/'s price cards);
 *   - the panel/sheet pairs, "<b>Batch</b> &mdash; one operation across many files";
 *   - the /pro/ section headings (<!--PRO_COPY-->);
 *   - the per-tool links proWhere() writes (/pro/buy/, for someone who already owns it).
 * A page matching ALL FOUR entries in any one of those shapes is listing them.
 *
 * Deliberately NOT a listing shape: the tool-page strip. It names the four in a single sentence under a tool's lede,
 * where the subject is that tool and the surfaces line would be a third clause about something else (owner, 19
 * September 2026). Those pages carry the phone Pro sheet, which does carry the line.
 *
 * The check also asserts the pages that MUST list them still do. Without that, a build that stopped rendering the
 * panel entirely would pass with nothing to find — the ignored-output failure this repo keeps writing down.
 *
 * Uses dist/, so do not run it while a dev server is serving (CLAIMS 35).
 *
 *   npm run verify:surfaces
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRO_COPY, PRO_FEATURES, proSurfaces, proWhere } from './pro-copy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

const CLEAN = { PDFIQ_PRO: '', PDFIQ_SALE: '', PDFIQ_PADDLE_ENV: '', PDFIQ_PADDLE_CLIENT_TOKEN: '', PDFIQ_PADDLE_PRICE_ID: '',
  PDFIQ_CHECKOUT_ORIGIN: '', PDFIQ_SITE_ORIGIN: '', CF_PAGES: '', CF_PAGES_BRANCH: '', PDFIQ_LOCAL: '' };

function build(env) {
  const r = spawnSync(process.execPath, ['tools/build.mjs'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...CLEAN, ...env } });
  if (r.status !== 0) throw new Error(`build failed: ${r.stdout}\n${r.stderr}`);
}

/** Every built page, flattened: HTML wraps, and wrapped text has twice made present copy look missing (CLAIMS 38). */
function pages() {
  const out = [];
  for (const rel of readdirSync(join(ROOT, 'dist'), { recursive: true })) {
    const name = String(rel).split(/[\\/]/).join('/');
    if (!name.endsWith('.html')) continue;
    out.push([`/${name.replace(/(^|\/)index\.html$/, '$1')}`, readFileSync(join(ROOT, 'dist', name), 'utf8').replace(/\s+/g, ' ')]);
  }
  return out;
}

/**
 * The shapes PRO_COPY renders into, each built from PRO_COPY so a changed feature changes what is looked for. A page
 * lists the features when one shape matches every entry — four of four, not three.
 */
const SHAPES = [
  ['the long feature lines', PRO_FEATURES.map((f) => `<li>${f}</li>`)],
  ['the panel and sheet pairs', PRO_COPY.map((c) => `<b>${c.panel[0]}</b> &mdash; ${c.panel[1]}`)],
  ['the /pro/ sections', PRO_COPY.map((c) => `<h2 class="kicker">${c.title}</h2>`)],
  ['the per-tool links', proWhere().split(/,| and /).map((s) => s.trim()).filter(Boolean)],
];
const flat = (s) => s.replace(/\s+/g, ' ');

/**
 * Not just "somewhere on the page": the line has to be beside the list a reader is looking at. /app/ is the case that
 * made this necessary — its price card lists the four, and the phone Pro sheet at the far end of the same document
 * carries the line, so a page-level check would have passed with the price card silent. The window is measured, not
 * chosen: the widest real gap in the build today is 963 characters on /pro/, where the line follows the last of four
 * feature sections. Every run prints the worst gap it saw, so the day one grows the number is visible before it fails.
 */
const NEAR = 1500;

function listing(html, line) {
  const found = [];
  for (const [name, marks] of SHAPES) {
    const at = marks.map((m) => html.indexOf(flat(m)));
    if (at.some((i) => i < 0)) continue;
    const last = at.indexOf(Math.max(...at));
    const [from, to] = [Math.min(...at), Math.max(...at) + flat(marks[last]).length];
    let gap = Infinity;
    for (let i = html.indexOf(line); i >= 0; i = html.indexOf(line, i + 1)) {
      gap = Math.min(gap, i >= from && i <= to ? 0 : i < from ? from - i : i - to);
    }
    found.push({ name, gap });
  }
  return found;
}

const LINE = flat(proSurfaces());
console.log(`the generated line: "${LINE}"\n`);

for (const [label, env, mustList] of [
  ['free', {}, ['/', '/app/', '/pro/']],
  ['Pro, not selling', { PDFIQ_PRO: '1' }, ['/', '/app/', '/pro/']],
  ['Pro, selling', { PDFIQ_PRO: '1', PDFIQ_SALE: '1', PDFIQ_PADDLE_ENV: 'sandbox', PDFIQ_PADDLE_CLIENT_TOKEN: `test_${'a1'.repeat(13)}`,
    PDFIQ_PADDLE_PRICE_ID: 'pri_01m2cv2xegy64zmhtxrbk0b1bf', PDFIQ_CHECKOUT_ORIGIN: 'https://pro-sale.pdf-iq-checkout.pages.dev' },
  ['/', '/app/', '/pro/', '/pro/buy/']],
]) {
  build(env);
  const all = pages();
  const lists = all.flatMap(([route, html]) => listing(html, LINE).map((f) => ({ route, ...f })));
  const silent = lists.filter((f) => f.gap > NEAR);
  const worst = lists.reduce((m, f) => (f.gap > m.gap ? f : m), { gap: -1 });

  ok(lists.length > 0, `${label}: ${lists.length} lists of the Pro features across ${new Set(lists.map((f) => f.route)).size} built pages`);
  ok(silent.length === 0,
    `${label}: every list says which of them the Android app has${silent.length
      ? ` — ${silent.map((f) => `${f.route} (${f.name}, ${f.gap === Infinity ? 'the line is not on the page at all' : `${f.gap} characters away`})`).join('; ')}`
      : `, within ${worst.gap} characters at worst (${worst.route}, ${worst.name}; the limit is ${NEAR})`}`);

  for (const route of mustList) {
    const page = all.find(([p]) => p === route);
    const shapes = page ? listing(page[1], LINE) : [];
    ok(shapes.length > 0, `${label}: ${route} still lists the features (${shapes.map((f) => f.name).join('; ') || 'NOTHING MATCHED'})`);
  }

  // The tool strips are the stated exception, so state it as a fact about the build rather than an absence nobody sees.
  const strips = all.filter(([, html]) => html.includes('class="pro-strip"'));
  ok(strips.length > 0 && strips.every(([, html]) => html.includes(LINE)),
    `${label}: the ${strips.length} pages carrying the strip reach the line through the phone Pro sheet`);
}

if (existsSync(join(ROOT, 'dist/pro/buy/index.html'))) {
  const buy = flat(readFileSync(join(ROOT, 'dist/pro/buy/index.html'), 'utf8'));
  ok(buy.includes(flat(proWhere())), 'the purchase page points an owner at every feature, from PRO_COPY\'s own routes');
}

// Leave dist/ as a plain build. The last configuration checked here is the selling one, and a dist/ left in it is a
// build nobody asked for that still reads as the current one — which cost half an hour today, reading "Bought once"
// off a page that had not been rebuilt (CLAIMS 35, and the same shape as reading a served build without printing it).
build({});

console.log(fails ? `\n${fails} FAILED` : '\nevery built page that lists the Pro features says which of them the Android app has');
process.exit(fails ? 1 : 0);
