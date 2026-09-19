/**
 * What a purchase covers, and what it does not, said the same way everywhere — proved on the built output.
 *
 * Two sentences travel together across this site. One names what the payment covers (`PRO.coversToday` today,
 * `PRO.covers` when the Android app honours a web purchase). The other excludes the app: "it does not unlock anything
 * in the Android app". The second is only true while the first says "the web tools on this site", and the day the app
 * release that honours purchases is live on Play they both change, in one commit, everywhere.
 *
 * That is a bulk edit across pages, a generated panel, a generated sheet and a TypeScript screen, and the last time
 * this claim moved, a hand-written list of five places missed /app/ — it had taken the wording through a placeholder.
 * A list is the wrong instrument. This check reads the BUILT output (HTML and the JS bundles, because the account
 * screen's copy is in src/pro/account.ts and never appears in a page source) and holds the two sentences to each
 * other, whichever way the flag is set:
 *
 *   - while the site says the purchase covers the web tools, every page that names the scope must also exclude the
 *     app, and no page anywhere may claim the purchase reaches it;
 *   - once it says the purchase covers both, no file may still exclude the app — a stale exclusion is then a page
 *     telling a buyer they did not get what they paid for.
 *
 * And in BOTH states, the Play constraint stays: buying happens on this website, not inside the Android app. That is
 * not a temporary state and must survive the sweep that deletes the exclusions — deleting it with them is the obvious
 * mistake, so it is the one thing this check asserts identically on either side of the flip.
 *
 * Uses dist/, so do not run it while a dev server is serving (CLAIMS 35).
 *
 *   npm run verify:purchase-scope
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRO } from './site.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

const CLEAN = { PDFIQ_PRO: '', PDFIQ_SALE: '', PDFIQ_PADDLE_ENV: '', PDFIQ_PADDLE_CLIENT_TOKEN: '', PDFIQ_PADDLE_PRICE_ID: '',
  PDFIQ_CHECKOUT_ORIGIN: '', PDFIQ_SITE_ORIGIN: '', CF_PAGES: '', CF_PAGES_BRANCH: '', PDFIQ_LOCAL: '' };

function build(env) {
  const r = spawnSync(process.execPath, ['tools/build.mjs'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...CLEAN, ...env } });
  if (r.status !== 0) throw new Error(`build failed: ${r.stdout}\n${r.stderr}`);
}

/** Pages and bundles both: the account screen's wording is in a JS chunk and in no page source. */
function output() {
  const out = [];
  for (const rel of readdirSync(join(ROOT, 'dist'), { recursive: true })) {
    const name = String(rel).split(/[\\/]/).join('/');
    if (!/\.(html|js)$/.test(name)) continue;
    out.push([name, readFileSync(join(ROOT, 'dist', name), 'utf8').replace(/\s+/g, ' ')]);
  }
  return out;
}

// Every way each claim is worded. Not one phrasing: /app/ says "in this app" rather than "in the Android app", which is
// how a search for the other spelling once under-counted it (memory: search by every name a feature has).
const EXCLUDES = [/(does|will) not unlock anything in (the Android|this) app/i, /covers [^.<]{0,60}, not the Android app/i];
const REACHES = [/unlocks it (there too|in the Android app)/i, /covers both the web tools and the Android app/i];
// The Play constraint is worded four ways across three pages and two sale states ("bought on this website and not
// inside", "not inside", "rather than inside", "not made inside"). Listing the wordings would quietly pass a fifth, so
// EVERY mention of "inside the Android app" in the build must match one of these — a new phrasing fails loudly and is
// added deliberately, which is the opposite of a pattern that silently matches nothing.
const PLAY = [/(?:and )?not inside the Android app/i, /rather than inside the Android app/i, /not made inside the Android app/i];
const MENTIONS = /inside the Android app/gi;
const any = (res, text) => res.some((re) => re.test(text));

function unknownPhrasings(text) {
  const out = [];
  for (const m of text.matchAll(MENTIONS)) {
    const around = text.slice(Math.max(0, m.index - 60), m.index + 30);
    if (!any(PLAY, around)) out.push(around.replace(/<[^>]+>/g, '').trim());
  }
  return out;
}

const SELLING = { PDFIQ_PRO: '1', PDFIQ_SALE: '1', PDFIQ_PADDLE_ENV: 'sandbox', PDFIQ_PADDLE_CLIENT_TOKEN: `test_${'a1'.repeat(13)}`,
  PDFIQ_PADDLE_PRICE_ID: 'pri_01m2cv2xegy64zmhtxrbk0b1bf', PDFIQ_CHECKOUT_ORIGIN: 'https://pro-sale.pdf-iq-checkout.pages.dev' };

// Which of the two scope sentences this build renders, read from site.mjs rather than assumed, so the check flips with
// the site instead of having to be rewritten on the day.
const webOnly = PRO.coversToday && PRO.coversToday !== PRO.covers;
console.log(`the purchase covers: "${webOnly ? PRO.coversToday : PRO.covers}"${webOnly ? '  (the app does not honour a web purchase yet)' : '  (both surfaces)'}\n`);

for (const [label, env] of [['free', {}], ['Pro, not selling', { PDFIQ_PRO: '1' }], ['Pro, selling', SELLING]]) {
  build(env);
  const files = output();
  const scope = files.filter(([, t]) => t.includes(webOnly ? PRO.coversToday : PRO.covers));
  const excludes = files.filter(([, t]) => any(EXCLUDES, t));
  const reaches = files.filter(([, t]) => any(REACHES, t));

  if (webOnly) {
    const bare = scope.filter(([n, t]) => !any(EXCLUDES, t) && n.endsWith('.html'));
    ok(scope.length > 0, `${label}: ${scope.length} files name what a purchase covers`);
    ok(bare.length === 0,
      `${label}: every page naming it also says the app is not included${bare.length ? ` — ${bare.map(([n]) => n).join(', ')}` : ''}`);
    ok(reaches.length === 0,
      `${label}: nothing claims the purchase reaches the app${reaches.length ? ` — ${reaches.map(([n]) => n).join(', ')}` : ''}`);
  } else {
    ok(excludes.length === 0,
      `${label}: no file still excludes the Android app${excludes.length ? ` — ${excludes.map(([n]) => n).join(', ')}` : ''}`);
    ok(scope.length > 0, `${label}: ${scope.length} files say the purchase covers both surfaces`);
  }

  // Both states, identically. Buying on the website is the Play constraint, not a stage the product passes through.
  for (const route of ['terms/index.html', 'support/index.html', 'privacy/index.html']) {
    const page = files.find(([n]) => n === route);
    ok(Boolean(page) && any(PLAY, page[1]), `${label}: /${route.replace('index.html', '')} still says buying happens on this website, not in the app`);
  }
  const strange = files.flatMap(([n, t]) => unknownPhrasings(t).map((s) => `${n}: "${s}"`));
  ok(strange.length === 0, `${label}: every mention of buying inside the app is one this check knows${strange.length ? ` — ${strange.slice(0, 3).join('; ')}` : ''}`);
}

build({});
console.log(fails ? `\n${fails} FAILED` : '\nwhat a purchase covers and what it excludes agree, on every built page and bundle');
process.exit(fails ? 1 : 0);
