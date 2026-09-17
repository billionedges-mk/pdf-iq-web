/**
 * In a build that sells Pro, every place that names the price offers the purchase, and nothing says Pro cannot be bought.
 *
 * Naming a price without offering the purchase is a defect, not a layout choice (owner, 17 September 2026). It happened
 * three times before this existed: /account/ had no way to buy, /batch/ looked free, and /pro/, the page that explains
 * what Pro adds, named $14.99 and ended with nowhere to go. And four pages said "not on sale yet" in words typed into
 * the page, so a sale build carried them beside the price, and a live one would have too, with nothing failing.
 *
 * So, on a sandbox sale build (the Preview's shape), for every built page:
 *
 *   1. Every text that names the price sits inside an element marked `data-pro-strip` (the marks the site hides from
 *      someone who owns Pro: src/pro/strip.ts), and that element holds a link to /pro/buy/. The owner sees neither the
 *      price nor the link; everyone else sees both together.
 *   2. No "not on sale" wording anywhere in the page.
 *   3. /pro/buy/ exists, so every such link lands.
 *
 * Out of scope, by name: /pro/buy/ is the purchase itself. /terms and /refunds define the purchase as legal text and are
 * being redrafted separately (owner reads them as legal text); they are named here so the exemption is visible, not
 * silent. A price rendered at runtime is the Unlock button itself (src/pro/unlock.ts), which is the purchase.
 *
 *   npm run verify:price-offers
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRO } from './site.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

const CLEAN = { PDFIQ_PRO: '', PDFIQ_SALE: '', PDFIQ_PADDLE_ENV: '', PDFIQ_PADDLE_CLIENT_TOKEN: '', PDFIQ_PADDLE_PRICE_ID: '',
  PDFIQ_CHECKOUT_ORIGIN: '', PDFIQ_SITE_ORIGIN: '', PDFIQ_CHECKOUT_BUILD: '', CF_PAGES: '', CF_PAGES_BRANCH: '', PDFIQ_LOCAL: '' };
const SALE = { CF_PAGES: '1', CF_PAGES_BRANCH: 'pro-sale', PDFIQ_PRO: '1', PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'sandbox',
  PDFIQ_PADDLE_CLIENT_TOKEN: `test_${'a1'.repeat(13)}`, PDFIQ_CHECKOUT_ORIGIN: 'https://pro-sale.pdf-iq-checkout.pages.dev' };

const EXEMPT = new Map([
  ['pro/buy/index.html', 'the purchase page itself'],
  ['terms/index.html', 'legal text, redrafted separately'],
  ['refunds/index.html', 'legal text, redrafted separately'],
  ['privacy/index.html', 'the Play policy: sale wording proposed to the owner, not applied (17 September 2026)'],
]);
// "For firms · not on sale yet" on /for-professionals is about the firm tier, which is not for sale; it is not about Pro.
const NOT_ON_SALE = [/not on sale/i, /for sale yet/i, /not yet on sale/i, /when it opens/i, /nothing to buy/i, /not purchasable/i, /when it goes on sale/i];

const b = spawnSync(process.execPath, ['tools/build.mjs'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...CLEAN, ...SALE } });
ok(b.status === 0, `a sandbox sale build${b.status === 0 ? '' : `: ${(b.stdout + b.stderr).trim().split('\n').slice(-3).join(' | ')}`}`);
if (b.status !== 0) process.exit(1);

const DIST = join(ROOT, 'dist');
ok(existsSync(join(DIST, 'pro/buy/index.html')), 'the build has /pro/buy/, where every offer lands');

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** Every text run with the chain of elements it sits in. Scripts, styles and comments are not text anyone reads. */
function textsWithAncestors(html) {
  const out = [];
  const stack = [];
  const re = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>|<\/([a-zA-Z0-9]+)\s*>|<([a-zA-Z0-9]+)((?:\s[^>]*)?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[2]) {
      const name = m[2].toLowerCase();
      const at = stack.map((e) => e.name).lastIndexOf(name);
      if (at >= 0) stack.length = at;
    } else if (m[3]) {
      const name = m[3].toLowerCase();
      const el = { name, attrs: m[4] ?? '', start: m.index };
      if (!VOID.has(name) && !/\/\s*$/.test(el.attrs)) stack.push(el);
    } else if (m[5] && m[5].trim()) {
      out.push({ text: m[5], ancestors: stack.slice(), index: m.index });
    }
  }
  return out;
}

/** The HTML of an element, from its start tag to its matching close. */
function outerHtml(html, el) {
  const re = new RegExp(`<(/?)${el.name}\\b[^>]*>`, 'gi');
  re.lastIndex = el.start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    if (!m[1]) depth++;
    else if (--depth === 0) return html.slice(el.start, m.index + m[0].length);
  }
  return html.slice(el.start);
}

const pages = readdirSync(DIST, { recursive: true }).map(String).map((p) => p.split(/[\\/]/).join('/'))
  .filter((p) => p.endsWith('.html') && !/selftest|probe/.test(p));
let named = 0;
for (const rel of pages) {
  const html = readFileSync(join(DIST, rel), 'utf8');
  const texts = textsWithAncestors(html);
  const visible = texts.map((t) => t.text).join(' ').replace(/\s+/g, ' ');
  // The firm tier's own label, and only on its own page.
  const read = rel === 'for-professionals/index.html' ? visible.replace(/For firms (&middot;|·) not on sale yet/, '') : visible;

  if (EXEMPT.has(rel)) {
    console.log(`skip  ${rel}: ${EXEMPT.get(rel)}`);
    continue;
  }
  for (const re of NOT_ON_SALE) {
    const m = re.exec(read);
    ok(!m, `${rel}: says nothing about Pro not being for sale${m ? ` — "…${read.slice(Math.max(0, m.index - 60), m.index + 40)}…"` : ''}`);
  }
  // Metadata, by name: a description is copy nobody reading the page sees, and /pro/'s said "Not on sale yet." in a sale
  // build after the page itself had stopped saying it. A price there cannot sit beside a way to pay, so none may name it.
  const meta = [...html.matchAll(/<title>([^<]*)<\/title>|<meta (?:name|property)="(?:description|og:description|twitter:description|og:title|twitter:title)" content="([^"]*)"/g)]
    .map((m) => m[1] ?? m[2]).join(' | ');
  for (const re of NOT_ON_SALE) {
    const m = re.exec(meta);
    ok(!m, `${rel}: its title and descriptions say nothing about Pro not being for sale${m ? ` — "${meta.slice(Math.max(0, m.index - 60), m.index + 40)}"` : ''}`);
  }
  ok(!meta.includes(PRO.price), `${rel}: its title and descriptions name no price`);
  for (const t of texts.filter((x) => x.text.includes(PRO.price))) {
    named++;
    const strip = [...t.ancestors].reverse().find((e) => /\sdata-pro-strip\b/.test(e.attrs));
    const where = `${rel}: "${t.text.trim().slice(0, 70)}"`;
    if (!strip) { ok(false, `${where} names the price outside anything hidden from owners`); continue; }
    const block = outerHtml(html, strip);
    ok(/<a\s[^>]*href="\/pro\/buy\/[^"]*"/.test(block), `${where} offers the purchase beside it (a link to /pro/buy/ in the same <${strip.name} data-pro-strip>)`);
  }
}
ok(named > 0, `${named} places name the price in this build`);

console.log(`\n${fails ? `${fails} FAILED` : 'every price in a sale build comes with a way to pay, and nothing says Pro is not for sale'}`);
process.exitCode = fails ? 1 : 0;
