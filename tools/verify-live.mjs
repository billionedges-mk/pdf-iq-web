/**
 * What Cloudflare is serving, checked against what was pushed.
 *
 * A gate that passed locally describes the build made on this machine. This checks the one people
 * get: it waits until pdf-iq.com serves the pushed commit (read from the page's `pdfiq-build` meta
 * tag, never inferred from a 200), then proves production is flag-off and says what the source says.
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
import { ALL, PRO_PAGES, href } from './site.mjs';
import { PRO_WORDING } from './pro-wording.mjs';
import { RETIRED } from './retired-claims.mjs';
import { AUTH } from './auth-config.mjs';

const SITE = 'https://pdf-iq.com';
const argv = process.argv.slice(2);
const flagValues = (name) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]] : []));
const expectPresent = flagValues('--expect-present');
const expectAbsent = flagValues('--expect-absent');
const noWait = argv.includes('--no-wait');
const positional = argv.filter((a, i) => !a.startsWith('--') && !['--expect-present', '--expect-absent'].includes(argv[i - 1]));

let want = positional[0] ?? '';
if (!want && !noWait) {
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

// ---------------------------------------------------------------- what must not be there

const FORBIDDEN_JS = [
  'pdfiq-pro:', ...PRO_WORDING, ...AUTH.hosts, AUTH.sessionKey, AUTH.pendingKey,
  // Writer-only strings. NOT "AESV3": decrypt.ts matches that to detect an AES-encrypted file, and
  // reading locked files is free; the first version of this list failed on free code.
  'AuthEvent', 'already encrypted; decrypt it first',
  // The local Pro stub: only in a build served from a developer machine.
  'pdfiq.local-pro', 'Turn the local stub on',
];
const FORBIDDEN_HTML = ['data-pro-target', 'data-pro-searchable', 'data-pro-next', 'Preview build with the Pro flag on', '<!--PRO-->', '<!--/PRO-->', '<!--FREE-->'];

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
  if (page.description && !matchesSource(metaOf(html, 'description'), page.description)) problems.push(`description is "${metaOf(html, 'description')}", source says "${page.description}"`);
  const robots = /<meta name="robots"[^>]*>/.exec(html)?.[0] ?? '';
  if (/noindex/.test(robots) !== Boolean(page.noindex)) problems.push(page.noindex ? 'declared noindex, served without it' : 'served noindex (preview-only)');
  const csp = res.headers.get('content-security-policy') ?? '';
  if (!csp || /googleapis|accounts\.google/.test(csp)) problems.push('CSP missing or names a Google host');

  const htmlHits = FORBIDDEN_HTML.filter((s) => has(text, s));
  if (htmlHits.length) problems.push(`Pro markup: ${htmlHits.join(', ')}`);

  const places = { body: normalise(bodyOf(html)), title: normalise(titleOf(html)), description: normalise(metaOf(html, 'description')) };
  for (const { phrase } of RETIRED) {
    for (const [where, s] of Object.entries(places)) if (has(s, phrase)) problems.push(`retired claim in ${where}: "${phrase}"`);
  }

  const key = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]).sort().join(' ');
  if (!crawled.has(key)) {
    try { crawled.set(key, await bundleText(html)); } catch (e) { problems.push(`bundle crawl: ${e.message}`); crawled.set(key, { all: '', files: 0 }); }
  }
  const jsHits = FORBIDDEN_JS.filter((s) => has(crawled.get(key).all, s));
  if (jsHits.length) problems.push(`Pro code or sign-in in JS: ${jsHits.join(', ')}`);

  ok(problems.length === 0, `${route} is build ${live}, matches source, flag-off${problems.length ? '\n        ' + problems.join('\n        ') : ''}`);
}
const jsFiles = [...crawled.values()].reduce((n, b) => n + b.files, 0);
ok(jsFiles > 0, `${jsFiles} JS files crawled across ${crawled.size} distinct bundle sets`);

// ---------------------------------------------------------------- Pro routes and the 404 control

for (const page of PRO_PAGES) {
  const r = await get(href(page.slug));
  ok(r.status === 404, `${href(page.slug)} does not exist in production (status ${r.status})`);
}
// Without this, a site that 404'd everything would pass the line above.
const control = await get(`/no-such-page-${Date.now()}/`);
ok(control.status === 404, `an invented path returns 404 (status ${control.status}), so the 200s above mean something`);

// ---------------------------------------------------------------- phrases named for this deploy

if (expectPresent.length || expectAbsent.length) {
  const everything = [];
  for (const page of ALL) everything.push(normalise((await get(href(page.slug))).text));
  const site = everything.join('\n');
  for (const p of expectPresent) ok(has(site, p), `present somewhere on the site: "${p}"`);
  for (const p of expectAbsent) ok(!has(site, p), `absent from every page: "${p}"`);
}

console.log(fails ? `\n${fails} FAILED` : `\nproduction is ${live}: every page matches source, flag-off, no retired claim`);
process.exit(fails ? 1 : 0);
