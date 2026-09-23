/**
 * What Cloudflare is serving, checked against what was pushed.
 *
 * A gate that passed locally describes the build made on this machine. This checks the one people
 * get: it waits until pdf-iq.com serves the pushed commit (read from the page's `pdfiq-build` meta
 * tag, never inferred from a 200), then proves production says what the source says.
 *
 * ### It asks the live site which state it is in, rather than assuming
 *
 * Until 20 September 2026 this check asserted that production carries no Pro code at all: `pdfiq-pro:`, the Pro
 * wording and the sign-in hosts were forbidden in every bundle. That was true for as long as `PDFIQ_PRO` was
 * refused on production — and the day the sale is switched on it becomes false on every page at once. The check
 * that confirms a deploy would have failed wholesale **because the deploy worked**, at the moment someone is reading
 * it for reassurance, with step 5 of docs/sale-go-live.md telling them to run it. A wall of red there invites
 * rolling back a correct deploy.
 *
 * So the state is read from the live site — whether /pro/buy/ answers, and whether /api/entitlement is configured —
 * and the two must agree or that disagreement is itself the finding. Both states are checked; the selling one is the
 * interesting half, because what it forbids is everything that would mean the wrong build reached production: the
 * preview banner, the local Pro stub, Paddle's sandbox hosts, a test_ token, or Paddle.js running on this origin.
 *
 *   npm run verify:live                        expects `git ls-remote origin main`
 *   npm run verify:live -- 87fa1b9             expects that commit
 *   npm run verify:live -- --no-wait           checks whatever is live now
 *   npm run verify:live -- --expect-present "sentence you just wrote" --expect-absent "one you removed"
 *
 * Every phrase match runs on normalised text: entities decoded, curly apostrophes straightened and
 * whitespace collapsed, on both sides. Page sources hard-wrap prose, so a contiguous match reported
 * a live sentence missing twice in one day, and once nearly sent a deploy that had landed off to be
 * diagnosed as failed. The lists come from the files the build reads (site.mjs, pro-wording.mjs,
 * retired-claims.mjs, auth-config.mjs), so a new page or Pro phrase is checked without editing this.
 */
import { execFileSync } from 'node:child_process';
import { ALL, PRO_PAGES, href, PRO as PRO_OFFER } from './site.mjs';

const PRO_PRICE = PRO_OFFER.price;
import { PRO_WORDING } from './pro-wording.mjs';
import { RETIRED } from './retired-claims.mjs';
import { AUTH } from './auth-config.mjs';

const argv = process.argv.slice(2);
const flagValues = (name) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]] : []));
const argvValue = (name) => flagValues(name)[0];

/**
 * pdf-iq.com by default. `--site` points it somewhere else, which exists for one reason: the selling half of this
 * check cannot be exercised on production until production sells, and the first time it runs must not be the day it
 * matters. Pointed at the Preview it runs the whole selling branch against a real deployment — and the sandbox
 * assertions FAIL there by design, because Preview sells through Paddle's sandbox and production never may. Those
 * named failures are the dry run's output, not a defect in it.
 *
 *   npm run verify:live -- --site https://pro-sale.pdf-iq-web.pages.dev --no-wait
 */
const SITE = (argvValue('--site') ?? 'https://pdf-iq.com').replace(/\/+$/, '');
/** Whether the thing being checked is production itself. Some rules invert on a preview rather than relaxing. */
const PRODUCTION_SITE = SITE === 'https://pdf-iq.com';
const expectPresent = flagValues('--expect-present');
const expectAbsent = flagValues('--expect-absent');
const noWait = argv.includes('--no-wait');
const positional = argv.filter((a, i) => !a.startsWith('--') && !['--expect-present', '--expect-absent', '--site'].includes(argv[i - 1]));

let want = positional[0] ?? '';
if (!want && !noWait && SITE !== 'https://pdf-iq.com') {
  console.log(`--site ${SITE}: not waiting for origin/main, which is a different deployment`);
}
if (!want && !noWait && SITE === 'https://pdf-iq.com') {
  want = execFileSync('git', ['ls-remote', 'origin', 'main'], { encoding: 'utf8' }).split(/\s/)[0].slice(0, 12);
  console.log(`expecting origin/main: ${want}`);
}

// Named entities the pages use. The first version decoded only numeric ones and &amp;-style
// basics, so a phrase containing an em dash read as missing from a page that wrote it as &mdash;.
const NAMED = { nbsp: ' ', mdash: '—', ndash: '–', middot: '·', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', times: '×', rarr: '→', larr: '←', copy: '©', apos: "'" };
export const normalise = (s) => String(s)
  .replace(/&([a-z]+);/g, (m, n) => NAMED[n] ?? m)
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/\s+/g, ' ');
const has = (haystack, phrase) => haystack.includes(normalise(phrase));
// Source titles and descriptions carry {{tokens}} the build substitutes (a tool count, say). A token
// matches any text; everything around it must match exactly. The first run compared them literally
// and failed /app/ for a description that was right.
const matchesSource = (served, source) => {
  const parts = normalise(source).split(/\{\{\w+\}\}/).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${parts.join('.+?')}$`).test(normalise(served).trim());
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (path) => {
  const res = await fetch(`${SITE}${path}${path.includes('?') ? '&' : '?'}nocache=${Date.now()}`, {
    redirect: 'manual', headers: { 'cache-control': 'no-cache' },
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
};

const buildOf = (html) => /<meta name="pdfiq-build" content="([0-9a-f]+)"/.exec(html)?.[1] ?? '';
const metaOf = (html, name) => new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(html)?.[1] ?? '';
const titleOf = (html) => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
const bodyOf = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');

// Every JS file a page pulls in: its script tags, then every chunk those import, transitively. A 404
// on a hashed asset is a deploy in flight (the page is from one build, the asset already replaced).
async function bundleText(html) {
  const seen = new Set();
  const queue = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  let all = '';
  while (queue.length) {
    const p = queue.shift();
    if (seen.has(p)) continue;
    seen.add(p);
    const { status, text } = await get(p);
    if (status !== 200) throw new Error(`${p} returned ${status}`);
    all += text + '\n';
    for (const m of text.matchAll(/["'`]\.\/([\w.-]+\.js)["'`]/g)) queue.push('/assets/' + m[1]);
  }
  return { all: normalise(all), files: seen.size };
}

// ---------------------------------------------------------------- wait for the build

let live = '';
const deadline = Date.now() + 9 * 60 * 1000;
for (;;) {
  try {
    live = buildOf((await get('/compress/')).text);
  } catch (e) {
    console.log(`  (fetch failed: ${e.message}; retrying)`);
  }
  if (noWait || (live && live.startsWith(want))) break;
  if (Date.now() > deadline) {
    console.log(`FAIL  ${want} not live after 9 minutes; serving ${live || 'nothing readable'}`);
    process.exit(1);
  }
  console.log(`  serving ${live || '?'}, waiting for ${want}`);
  await wait(20000);
}
console.log(`live build: ${live}\n`);

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${msg}`); if (!c) fails++; };

// ---------------------------------------------------------------- which site is this?

/**
 * Two signals, because one of them can be true of a half-finished deploy: the purchase page exists (the build sold),
 * and /api/entitlement is configured (the Functions have the flag and their bindings). Both answer from the same
 * deployment but through different mechanisms — a page written at build time, and a Function reading its environment
 * — so agreement is evidence and disagreement is the finding: variables set without a rebuild, or the reverse.
 */
const buyPage = await get('/pro/buy/');
const entitlement = await get('/api/entitlement');
const sellsPage = buyPage.status === 200;
const sellsApi = entitlement.status !== 404;
ok(sellsPage === sellsApi,
  `the page and the API agree about whether Pro is sold here — /pro/buy/ ${buyPage.status}, /api/entitlement ${entitlement.status}`
  + (sellsPage === sellsApi ? '' : '\n        one without the other is a deploy that is half done: variables set without a rebuild, or a build shipped before its variables'));
const SELLING = sellsPage && sellsApi;
console.log(`state: Pro is ${SELLING ? 'ON SALE' : 'not sold'} on ${PRODUCTION_SITE ? 'production' : SITE}\n`);


// ---------------------------------------------------------------- what must not be there

// Never on production, in either state. These are the things that mean the wrong build reached it.
const FORBIDDEN_ALWAYS_JS = [
  // Writer-only strings. NOT "AESV3": decrypt.ts matches that to detect an AES-encrypted file, and
  // reading locked files is free; the first version of this list failed on free code.
  'AuthEvent', 'already encrypted; decrypt it first',
  // The local Pro stub: only in a build served from a developer machine.
  'pdfiq.local-pro', 'Turn the local stub on',
  // Paddle's sandbox, and Paddle itself: the site never runs Paddle.js, sale or not — that is the
  // two-origin boundary (CLAIMS 38), and a sandbox host on production is a build pointed at play money.
  'sandbox-buy.paddle.com', 'sandbox-cdn.paddle.com', 'sandbox-checkout', 'cdn.paddle.com/paddle',
];
const FORBIDDEN_ALWAYS_HTML = [
  // Markers the build resolves; one surviving means the resolver did not run.
  '<!--PRO-->', '<!--/PRO-->', '<!--FREE-->', '<!--SALE-->', '<!--NOSALE-->',
];
// On production only: the preview banner says "selling through the Paddle SANDBOX — test payments only; no real card
// is charged", which is a false statement about the charge at the top of the page where the charge happens. On a
// preview it is the truth and must be there, which is why it is not in the list above.
const FORBIDDEN_PRODUCTION_HTML = ['Preview build with the Pro flag on'];
// Only while Pro is not sold here. Each of these is correct on a selling build and would fail every page.
const FORBIDDEN_UNSOLD_JS = ['pdfiq-pro:', ...PRO_WORDING, ...AUTH.hosts, AUTH.sessionKey, AUTH.pendingKey];
const FORBIDDEN_UNSOLD_HTML = ['data-pro-target', 'data-pro-searchable', 'data-pro-next'];
const FORBIDDEN_JS = [...FORBIDDEN_ALWAYS_JS, ...(SELLING ? [] : FORBIDDEN_UNSOLD_JS)];
const FORBIDDEN_HTML = [...FORBIDDEN_ALWAYS_HTML, ...(PRODUCTION_SITE ? FORBIDDEN_PRODUCTION_HTML : []), ...(SELLING ? [] : FORBIDDEN_UNSOLD_HTML)];

// ---------------------------------------------------------------- every free page

// Bundles are shared across pages; crawl each distinct set of script tags once.
const crawled = new Map();
for (const page of ALL) {
  const route = href(page.slug);
  let res;
  try { res = await get(route); } catch (e) { ok(false, `${route} fetch failed: ${e.message}`); continue; }
  ok(res.status === 200, `${route} returns 200`);
  if (res.status !== 200) continue;
  const html = res.text;
  const text = normalise(html);
  const problems = [];

  if (buildOf(html) !== live) problems.push(`serves build ${buildOf(html) || 'none'}, /compress/ serves ${live}`);
  if (page.title && !matchesSource(titleOf(html), page.title)) problems.push(`title is "${titleOf(html)}", source says "${page.title}"`);
  // A selling build uses a route's saleDescription where it has one (build.mjs), so the source side has to make the
  // same choice. Comparing the live selling site against the not-selling text reported /pro/ and /for-professionals/
  // as mismatches when both were exactly right — the checker assuming the state instead of reading it, which is the
  // defect this whole rewrite exists to remove, found in the rewrite.
  const wantDescription = (SELLING && page.saleDescription) || page.description;
  if (wantDescription && !matchesSource(metaOf(html, 'description'), wantDescription)) problems.push(`description is "${metaOf(html, 'description')}", source says "${wantDescription}"`);
  // Production follows each page's own noindex flag; a preview deployment is noindex throughout, whatever the flags
  // say, and asserting production's rule against it reported the preview working as a defect.
  const robots = /<meta name="robots"[^>]*>/.exec(html)?.[0] ?? '';
  const noindexed = /noindex/.test(robots);
  const wantNoindex = PRODUCTION_SITE ? Boolean(page.noindex) : true;
  if (noindexed !== wantNoindex) {
    problems.push(wantNoindex
      ? (page.noindex ? 'declared noindex, served without it' : 'a preview deployment served without noindex')
      : 'served noindex, and this page is meant to be found');
  }
  const csp = res.headers.get('content-security-policy') ?? '';
  if (!csp || /googleapis|accounts\.google/.test(csp)) problems.push('CSP missing or names a Google host');

  const htmlHits = FORBIDDEN_HTML.filter((s) => has(text, s));
  if (htmlHits.length) problems.push(`Pro markup: ${htmlHits.join(', ')}`);

  const places = { body: normalise(bodyOf(html)), title: normalise(titleOf(html)), description: normalise(metaOf(html, 'description')) };
  for (const { phrase } of RETIRED) {
    for (const [where, s] of Object.entries(places)) if (has(s, phrase)) problems.push(`retired claim in ${where}: "${phrase}"`);
  }

  // Every script on the served page must be one this build made. The host can add its own — a
  // beacon, an email decoder — with nothing in the repo to show it (CLAIMS 11 and 37).
  // JSON-LD is this build's own structured data, not code; the CSP would refuse any inline script.
  const foreign = [...html.matchAll(/<script\b([^>]*)>/g)]
    .filter((m) => !/type="application\/ld\+json"/.test(m[1]))
    .map((m) => /\bsrc="([^"]*)"/.exec(m[1])?.[1] ?? 'inline script')
    .filter((src) => !/^\/assets\/[\w.-]+\.js$/.test(src));
  if (foreign.length) problems.push(`script not built by this repo: ${[...new Set(foreign)].join(', ')}`);
  if (/data-cfemail|__cf_email__|\/cdn-cgi\/l\/email-protection/.test(html)) problems.push('an email address rewritten by the host (Email Address Obfuscation)');

  const key = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]).sort().join(' ');
  if (!crawled.has(key)) {
    try { crawled.set(key, await bundleText(html)); } catch (e) { problems.push(`bundle crawl: ${e.message}`); crawled.set(key, { all: '', files: 0 }); }
  }
  const jsHits = FORBIDDEN_JS.filter((s) => has(crawled.get(key).all, s));
  if (jsHits.length) problems.push(`Pro code or sign-in in JS: ${jsHits.join(', ')}`);

  ok(problems.length === 0, `${route} is build ${live}, matches source, ${SELLING ? 'sells soundly' : 'flag-off'}${problems.length ? '\n        ' + problems.join('\n        ') : ''}`);
}
const jsFiles = [...crawled.values()].reduce((n, b) => n + b.files, 0);
ok(jsFiles > 0, `${jsFiles} JS files crawled across ${crawled.size} distinct bundle sets`);

// ---------------------------------------------------------------- Pro routes and the 404 control

for (const page of PRO_PAGES) {
  const r = await get(href(page.slug));
  // A sale page (/pro/buy/) exists only on a selling build; the rest of the Pro pages exist whenever Pro does.
  const want = SELLING ? 200 : 404;
  ok(r.status === want, `${href(page.slug)} ${want === 200 ? 'is served' : 'does not exist in production'} (status ${r.status}, expected ${want})`);
}
// Without this, a site that 404'd everything would pass the line above.
const control = await get(`/no-such-page-${Date.now()}/`);
ok(control.status === 404, `an invented path returns 404 (status ${control.status}), so the 200s above mean something`);

// ---------------------------------------------------------------- the crawl, which nothing here read before

// The per-page noindex is checked in the loop above, against each page's own flag. robots.txt was not checked at
// all — and it is the half that was silent when the noindex rule still keyed off the Pro flag: a production build
// with Pro on served "Disallow: /" for the whole site, which nothing local or live would have reported.
{
  const r = await get('/robots.txt');
  const disallowsAll = /Disallow: \/\s*$/m.test(r.text);
  if (PRODUCTION_SITE) {
    ok(r.status === 200 && !disallowsAll && /Sitemap:/.test(r.text),
      `robots.txt allows the crawl and names the sitemap${disallowsAll ? ' — IT DISALLOWS EVERYTHING' : ''}`);
  } else {
    // A preview deployment is the opposite: it must stay out of search however much of it is switched on.
    ok(r.status === 200 && disallowsAll, `a preview deployment keeps itself out of search (robots.txt ${disallowsAll ? 'disallows all' : 'ALLOWS THE CRAWL'})`);
  }
  const map = await get('/sitemap.xml');
  const locs = (map.text.match(/<loc>/g) ?? []).length;
  ok(map.status === 200 && locs > 10, `the sitemap lists the pages (${locs} entries)`);
}

// ---------------------------------------------------------------- selling: what a working sale looks like from outside

if (SELLING) {
  ok(entitlement.status === 401, `/api/entitlement answers 401 unauthenticated, not 404 or 200 (status ${entitlement.status})`);

  const hook = await fetch(`${SITE}/api/paddle/webhook`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
  ok(hook.status === 401 || hook.status === 403, `the webhook refuses an unsigned delivery (status ${hook.status})`);

  // The purchase page frames the checkout origin and nothing else, and names the production Paddle hosts. A sandbox
  // host here is a build selling play money; the site's own origin here would undo the two-origin split entirely.
  const csp = buyPage.headers.get('content-security-policy') ?? '';
  const frames = /frame-src ([^;]*)/.exec(csp)?.[1]?.trim() ?? '';
  const framed = frames.split(/\s+/).filter((h) => h.startsWith('https://'));
  ok(framed.length === 1 && framed[0] !== SITE && !framed[0].includes('sandbox'),
    `/pro/buy/ frames exactly one origin, not this one and not a sandbox (frame-src: ${frames || 'absent'})`);

  // The checkout origin itself: reachable, and carrying the statement Paddle's reviewer reads.
  try {
    const checkoutOrigin = SITE === 'https://pdf-iq.com'
      ? 'https://checkout.pdf-iq.com'
      : (/frame-src ([^;]*)/.exec(buyPage.headers.get('content-security-policy') ?? '')?.[1] ?? '').split(/\s+/).find((h) => h.startsWith('https://')) ?? '';
    const co = await fetch(`${checkoutOrigin}/`, { headers: { 'cache-control': 'no-cache' } });
    const coText = await co.text();
    // Back to the site it serves — `${SITE}/terms/`, not a hard-coded pdf-iq.com, which was this check describing
    // production while reading a preview. Paddle's reviewer follows these links, so they have to reach a real page.
    ok(co.status === 200 && coText.includes(`${SITE}/terms/`) && coText.includes(`${SITE}/refunds/`),
      `the checkout origin answers and links back to ${SITE}'s terms and refunds (status ${co.status})`);
    ok(!/sandbox/.test(coText) && !/\btest_[0-9a-z]{20}/.test(coText),
      'the checkout origin carries no sandbox host and no test token');

    // Pages deploys functions/ with BOTH projects, so the checkout origin serves these routes too — with no database
    // and no signing secret behind them. server/origin.js answers 404 there. While the checkout was not selling its
    // 404 could equally have been the PDFIQ_SALE gate; once it sells, a 404 here is the guard and nothing else
    // (23 September 2026).
    for (const route of ['/api/entitlement', '/api/paddle/webhook']) {
      const rr = await fetch(`${checkoutOrigin}${route}?n=${Date.now()}`, { cache: 'no-store' });
      ok(rr.status === 404, `the checkout origin does not serve ${route} (status ${rr.status}) — nothing is behind it there`);
    }
  } catch (e) {
    ok(false, `the checkout origin could not be read: ${e.message}`);
  }

  // The price, where someone can act on it. verify-price-offers proves this of the build; this proves it of the site.
  const home = normalise((await get('/')).text);
  ok(has(home, PRO_PRICE) , `the homepage names the price (${PRO_PRICE})`);
  ok(has(normalise(buyPage.text), PRO_PRICE), 'and so does the purchase page');
}

// ---------------------------------------------------------------- phrases named for this deploy

if (expectPresent.length || expectAbsent.length) {
  const everything = [];
  for (const page of ALL) everything.push(normalise((await get(href(page.slug))).text));
  const site = everything.join('\n');
  for (const p of expectPresent) ok(has(site, p), `present somewhere on the site: "${p}"`);
  for (const p of expectAbsent) ok(!has(site, p), `absent from every page: "${p}"`);
}

// Name what was read, not what was assumed: this says "production is …" only when it read production. A dry run
// that signs off as production is the same defect class as everything else this rewrite removes (CLAIMS 49).
console.log(fails
  ? `\n${fails} FAILED  (${SITE})`
  : `\n${PRODUCTION_SITE ? 'production' : SITE} is ${live}: every page matches source, no retired claim, ${SELLING ? 'and the sale is live and sound' : 'and nothing is for sale'}`);
process.exit(fails ? 1 : 0);
