/**
 * A retired claim must not come back — anywhere, including where nobody reads.
 *
 * This searches the **built** pages, not the source, because that is what ships: tokens have been
 * substituted, FAQ blocks and feature lists have been generated from data, and a claim can arrive
 * through any of them. It checks the visible body and, separately and by name, `<title>` and
 * `<meta name="description">`.
 *
 * The metadata half is the reason this exists. The scanner was claimed in three places a reader
 * could see and in /app/'s description tag, which is the copy Google indexes and shows in results
 * and which no amount of reading the page will reveal. Three were found by review; the fourth was
 * found by grepping, and only because someone thought to grep (CLAIMS 36).
 *
 *   npm run verify:retired        after npm run build
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RETIRED } from './retired-claims.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) fails++;
};

if (!existsSync(DIST)) {
  console.error('\ndist/ does not exist — run npm run build first.\n');
  process.exit(1);
}

/** Every built HTML page. */
function pages(dir = DIST) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pages(path));
    else if (entry.name.endsWith('.html')) out.push(path);
  }
  return out;
}

const files = pages().map((path) => ({
  rel: relative(DIST, path).split('\\').join('/'),
  html: readFileSync(path, 'utf8'),
}));
// The selftest harness pages are built into dist/ too and are not the site.
const site = files.filter((f) => !/^(selftest|tools-selftest|ocr-probe|readout-selftest|e2e-selftest|ocr-text-probe)\.html$/.test(f.rel));

ok(site.length > 0, `${site.length} built pages to search`);

const meta = (html, name) => {
  const m = new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(html);
  return m ? m[1] : '';
};
const title = (html) => (/<title>([^<]*)<\/title>/.exec(html) ?? ['', ''])[1];

for (const { phrase, instead } of RETIRED) {
  const needle = phrase.toLowerCase();
  // Whitespace collapsed first: page sources wrap prose, and a phrase split across a line break
  // would otherwise be reported absent while a reader sees it whole.
  const inBody = site.filter((f) => f.html.toLowerCase().replace(/\s+/g, ' ').includes(needle)).map((f) => f.rel);
  // Named separately: a claim in metadata is invisible to anyone reading the page, and is the
  // half that survived the last sweep.
  const inMeta = site
    .filter((f) => `${title(f.html)} ${meta(f.html, 'description')} ${meta(f.html, 'twitter:description')}`.toLowerCase().includes(needle))
    .map((f) => f.rel);

  ok(inBody.length === 0,
    `"${phrase}" appears nowhere${inBody.length ? ` — in ${inBody.slice(0, 4).join(', ')}; it was replaced by "${instead}"` : ''}`);
  if (inBody.length === 0) {
    ok(inMeta.length === 0, `  and in no title or description${inMeta.length ? ` — ${inMeta.join(', ')}` : ''}`);
  }
}

console.log(`\n${fails ? `${fails} FAILED` : `no retired claim has come back, in ${site.length} pages or their metadata`}`);
process.exitCode = fails ? 1 : 0;
