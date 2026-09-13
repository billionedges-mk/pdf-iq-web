/**
 * The sale flag, proved against what each build writes.
 *
 * Builds the site in the configurations that matter and reads dist/ after each:
 *   - no flags, and Pro without sale: no purchase page, no Paddle host, no token, anywhere;
 *   - a complete sandbox sale build: /pro/buy/ exists, carries the sandbox token and price, has its
 *     own policy naming Paddle's sandbox hosts and no ProfitWell host, and the banner says sandbox;
 *   - a sale build missing its token: builds, warns, and leaves the page out;
 *   - each refusal: sale without Pro, sale on the production branch, a live_ token outside
 *     production, and a token that disagrees with the environment.
 *
 * Uses dist/ like every build, so do not run it while a dev server is serving (CLAIMS 35).
 *
 *   npm run verify:sale-build
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

const TOKEN = `test_${'a1'.repeat(13)}`;
const PRICE = 'pri_01m2cv2xegy64zmhtxrbk0b1bf';
const CLEAN = { PDFIQ_PRO: '', PDFIQ_SALE: '', PDFIQ_PADDLE_ENV: '', PDFIQ_PADDLE_CLIENT_TOKEN: '', PDFIQ_PADDLE_PRICE_ID: '', CF_PAGES: '', CF_PAGES_BRANCH: '', PDFIQ_LOCAL: '' };

function build(env) {
  const r = spawnSync(process.execPath, ['tools/build.mjs'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...CLEAN, ...env } });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

function everything() {
  const files = [];
  for (const rel of readdirSync(DIST, { recursive: true })) {
    const name = String(rel);
    if (/\.(html|js|css|json|txt|xml)$/.test(name) || name.endsWith('_headers')) files.push([name.split(/[\\/]/).join('/'), readFileSync(join(DIST, name), 'utf8')]);
  }
  return files;
}
const hits = (re) => everything().filter(([, text]) => re.test(text)).map(([n]) => n);

// ---------------------------------------------------------------- not selling

for (const [label, env] of [['no flags', {}], ['Pro without sale', { PDFIQ_PRO: '1' }]]) {
  const b = build(env);
  ok(b.status === 0, `${label}: builds`);
  ok(!existsSync(join(DIST, 'pro/buy/index.html')), `${label}: no /pro/buy/ page`);
  const found = hits(/paddle\.com|Paddle\.Checkout|pdfiq-pro:buy|\/pro\/buy\/|test_[0-9a-z]{20}/);
  ok(found.length === 0, `${label}: no Paddle host, checkout call, buy module, link to /pro/buy/ or token in any file${found.length ? ` — ${found.slice(0, 4).join(', ')}` : ''}`);
}

// ---------------------------------------------------------------- selling, sandbox

{
  const b = build({ PDFIQ_PRO: '1', PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'sandbox', PDFIQ_PADDLE_CLIENT_TOKEN: TOKEN, PDFIQ_PADDLE_PRICE_ID: PRICE, CF_PAGES: '1', CF_PAGES_BRANCH: 'pro-sale' });
  ok(b.status === 0, 'sandbox sale build on a preview branch: builds');
  const page = existsSync(join(DIST, 'pro/buy/index.html')) ? readFileSync(join(DIST, 'pro/buy/index.html'), 'utf8') : '';
  ok(page.includes('Buy Pro'), '/pro/buy/ exists');
  ok(page.includes('SANDBOX') && page.includes('no real card is charged'), 'its banner says sandbox, test payments only');
  ok(!/<script[^>]+paddle\.com/.test(page), 'the page does not load Paddle.js on arrival: no Paddle script tag in the HTML');
  const withToken = hits(new RegExp(TOKEN));
  ok(withToken.length === 1 && /^assets\/buy-[A-Z0-9]+\.js$/.test(withToken[0]), `the token is in the purchase page's own bundle and nowhere else (${withToken.join(', ')})`);
  const paddleUrl = hits(/cdn\.paddle\.com/).filter((f) => f !== '_headers');
  ok(paddleUrl.length === 1 && /^assets\/buy-/.test(paddleUrl[0]), `Paddle.js's address is in that bundle only (${paddleUrl.join(', ')})`);
  const headers = readFileSync(join(DIST, '_headers'), 'utf8');
  const buyPolicy = /\/pro\/buy\/\*\s*\n\s*! Content-Security-Policy\s*\n\s*Content-Security-Policy: (.+)/.exec(headers)?.[1] ?? '';
  ok(/script-src [^;]*https:\/\/cdn\.paddle\.com/.test(buyPolicy), 'the purchase page policy allows Paddle.js');
  ok(/frame-src [^;]*https:\/\/sandbox-buy\.paddle\.com/.test(buyPolicy) && !/[^-]buy\.paddle\.com/.test(buyPolicy), 'and frames only from the sandbox checkout host');
  ok(!/profitwell/i.test(headers), 'no ProfitWell host anywhere in the headers');
  const policies = [...headers.matchAll(/^\s*Content-Security-Policy: (.+)$/gm)].map((m) => m[1]);
  ok(policies.length === 3 && !/paddle/.test(policies[0]) && !/paddle/.test(policies[1]) && /paddle/.test(policies[2]),
    `only the /pro/buy/ policy names Paddle (${policies.length} policies: site, /account/, /pro/buy/)`);
  const pro = readFileSync(join(DIST, 'pro/index.html'), 'utf8');
  ok(/not on sale yet/i.test(pro), 'a sandbox purchase page sells nothing real, so /pro/ still says Pro is not on sale');
}

// ---------------------------------------------------------------- selling but incomplete

{
  const b = build({ PDFIQ_PRO: '1', PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'sandbox', PDFIQ_PADDLE_PRICE_ID: PRICE, CF_PAGES: '1', CF_PAGES_BRANCH: 'pro-sale' });
  ok(b.status === 0 && /no PDFIQ_PADDLE_CLIENT_TOKEN/.test(b.out), 'sale build with no token: builds, and says why the page is missing');
  ok(!existsSync(join(DIST, 'pro/buy/index.html')), 'and there is no /pro/buy/');
  ok(hits(/paddle\.com|Paddle\.Checkout/).length === 0, 'and no purchase path in any file');
  ok(readFileSync(join(DIST, 'pro/index.html'), 'utf8').includes('not on sale yet'), 'and /pro/ still says not on sale');
}

// ---------------------------------------------------------------- refusals

const refusals = [
  ['sale without Pro', { PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'sandbox', PDFIQ_PADDLE_CLIENT_TOKEN: TOKEN, PDFIQ_PADDLE_PRICE_ID: PRICE }, /without PDFIQ_PRO/],
  ['sale on the production branch', { PDFIQ_PRO: '1', PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'sandbox', PDFIQ_PADDLE_CLIENT_TOKEN: TOKEN, PDFIQ_PADDLE_PRICE_ID: PRICE, CF_PAGES: '1', CF_PAGES_BRANCH: 'main' }, /production build/],
  ['a live_ token on a preview branch', { PDFIQ_PRO: '1', PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'production', PDFIQ_PADDLE_CLIENT_TOKEN: `live_${'a1'.repeat(13)}`, PDFIQ_PADDLE_PRICE_ID: PRICE, CF_PAGES: '1', CF_PAGES_BRANCH: 'pro-sale' }, /real money/],
  ['a test_ token with environment production', { PDFIQ_PRO: '1', PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'production', PDFIQ_PADDLE_CLIENT_TOKEN: TOKEN, PDFIQ_PADDLE_PRICE_ID: PRICE, CF_PAGES: '1', CF_PAGES_BRANCH: 'pro-sale' }, /does not match/],
  ['a live_ token with environment sandbox', { PDFIQ_PRO: '1', PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'sandbox', PDFIQ_PADDLE_CLIENT_TOKEN: `live_${'a1'.repeat(13)}`, PDFIQ_PADDLE_PRICE_ID: PRICE, CF_PAGES: '1', CF_PAGES_BRANCH: 'pro-sale' }, /real money/],
  ['a live_ token locally, not on Cloudflare', { PDFIQ_PRO: '1', PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'production', PDFIQ_PADDLE_CLIENT_TOKEN: `live_${'a1'.repeat(13)}`, PDFIQ_PADDLE_PRICE_ID: PRICE }, /real money/],
];
for (const [label, env, reason] of refusals) {
  const b = build(env);
  ok(b.status !== 0 && reason.test(b.out), `refuses ${label}${b.status === 0 ? ' — IT BUILT' : reason.test(b.out) ? '' : ` — failed for another reason: ${b.out.split('\n').find((l) => /Error/.test(l))}`}`);
}

// Leave dist/ as an ordinary build.
build({});
console.log(fails ? `\n${fails} FAILED` : '\nthe sale flag decides the purchase path, and every way to take money by accident refuses');
process.exit(fails ? 1 : 0);
