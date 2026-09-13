/**
 * The sale, proved against what each build writes, on both origins.
 *
 * The site (pdf-iq.com, tools/build.mjs) and the checkout origin (tools/build-checkout.mjs) are built in
 * the configurations that matter, and their output is read:
 *   - not selling: no purchase page, no Paddle host, no token, no link to /pro/buy/, anywhere;
 *   - selling (sandbox): the site's /pro/buy/ frames only the checkout origin and carries no Paddle script,
 *     host or token in any file. The checkout carries the token in its one script, that script uses no
 *     browser storage, and its policy allows Paddle's sandbox hosts, no ProfitWell host, and framing by the
 *     site origin only;
 *   - incomplete: builds, says what is missing, leaves the purchase out;
 *   - each refusal, on each side.
 *
 * The boundary this protects: Paddle.js must never run on the site's origin, where the Pro sign-in keeps a
 * refresh token (tools/paddle-config.mjs).
 *
 * Uses dist/ and dist-checkout/, so do not run it while a dev server is serving (CLAIMS 35).
 *
 *   npm run verify:sale-build
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

const TOKEN = `test_${'a1'.repeat(13)}`;
const LIVE = `live_${'a1'.repeat(13)}`;
const PRICE = 'pri_01m2cv2xegy64zmhtxrbk0b1bf';
const SITE = 'https://pro-sale.pdf-iq-web.pages.dev';
const CHECKOUT = 'https://pro-sale.pdf-iq-checkout.pages.dev';
const CLEAN = { PDFIQ_PRO: '', PDFIQ_SALE: '', PDFIQ_PADDLE_ENV: '', PDFIQ_PADDLE_CLIENT_TOKEN: '', PDFIQ_PADDLE_PRICE_ID: '',
  PDFIQ_CHECKOUT_ORIGIN: '', PDFIQ_SITE_ORIGIN: '', PDFIQ_CHECKOUT_BUILD: '', CF_PAGES: '', CF_PAGES_BRANCH: '', PDFIQ_LOCAL: '' };
const PREVIEW = { CF_PAGES: '1', CF_PAGES_BRANCH: 'pro-sale' };

function run(script, env) {
  const r = spawnSync(process.execPath, [script], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...CLEAN, ...env } });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}
const site = (env) => run('tools/build.mjs', env);
const checkout = (env) => run('tools/build-checkout.mjs', env);

function files(dir) {
  const out = [];
  for (const rel of readdirSync(join(ROOT, dir), { recursive: true })) {
    const name = String(rel);
    if (/\.(html|js|css|json|txt|xml)$/.test(name) || name.endsWith('_headers')) out.push([name.split(/[\\/]/).join('/'), readFileSync(join(ROOT, dir, name), 'utf8')]);
  }
  return out;
}
const hits = (dir, re) => files(dir).filter(([, t]) => re.test(t)).map(([n]) => n);

// ---------------------------------------------------------------- site: not selling

for (const [label, env] of [['site, no flags', {}], ['site, Pro without sale', { PDFIQ_PRO: '1' }]]) {
  const b = site(env);
  ok(b.status === 0, `${label}: builds`);
  ok(!existsSync(join(ROOT, 'dist/pro/buy/index.html')), `${label}: no /pro/buy/`);
  const found = hits('dist', /paddle\.com|Paddle\.Checkout|pdfiq-pro:buy|\/pro\/buy\/|pdfiq-checkout|test_[0-9a-z]{20}/);
  ok(found.length === 0, `${label}: no Paddle, checkout message, buy module, /pro/buy/ link or token in any file${found.length ? ` — ${found.slice(0, 4).join(', ')}` : ''}`);
}

// ---------------------------------------------------------------- site: selling (sandbox)

{
  // The token is set here too, as it may be in Cloudflare's Preview variables: the site must still not carry it.
  const b = site({ PDFIQ_PRO: '1', PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'sandbox', PDFIQ_PADDLE_CLIENT_TOKEN: TOKEN, PDFIQ_PADDLE_PRICE_ID: PRICE, PDFIQ_CHECKOUT_ORIGIN: CHECKOUT, ...PREVIEW });
  ok(b.status === 0, 'site sale build: builds');
  const page = existsSync(join(ROOT, 'dist/pro/buy/index.html')) ? readFileSync(join(ROOT, 'dist/pro/buy/index.html'), 'utf8') : '';
  ok(page.includes('Buy Pro') && page.includes('SANDBOX'), '/pro/buy/ exists, with the sandbox banner');
  ok(hits('dist', /cdn\.paddle\.com|Paddle\.Initialize|Paddle\.Checkout/).length === 0, "no Paddle script, host or call in any file on the site's origin");
  ok(hits('dist', new RegExp(TOKEN)).length === 0, "the client token is nowhere on the site's origin");
  const withOrigin = hits('dist', new RegExp(CHECKOUT.replace(/[.]/g, '\\.'))).filter((f) => f !== '_headers');
  ok(withOrigin.length === 1 && /^assets\/buy-/.test(withOrigin[0]), `the checkout origin is named only in the buy bundle (${withOrigin.join(', ')})`);
  const headers = readFileSync(join(ROOT, 'dist/_headers'), 'utf8');
  const buy = /\/pro\/buy\/\*\s*\n\s*! Content-Security-Policy\s*\n\s*Content-Security-Policy: (.+)/.exec(headers)?.[1] ?? '';
  ok(new RegExp(`frame-src [^;]*${CHECKOUT.replace(/[.]/g, '\\.')}`).test(buy), '/pro/buy/ may frame the checkout origin');
  // Hostnames, not the word: the header file's own comment says "Paddle sandbox", and the first version of
  // this check failed on that comment rather than on a policy.
  ok(!/paddle\.com|profitwell\.com/i.test(headers), "no Paddle or ProfitWell host in any of the site's policies");
  ok(/not on sale yet/i.test(readFileSync(join(ROOT, 'dist/pro/index.html'), 'utf8')), 'a sandbox purchase page sells nothing real, so /pro/ still says not on sale');
}

{
  const b = site({ PDFIQ_PRO: '1', PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'sandbox', PDFIQ_PADDLE_PRICE_ID: PRICE, ...PREVIEW });
  ok(b.status === 0 && /no PDFIQ_CHECKOUT_ORIGIN/.test(b.out) && !existsSync(join(ROOT, 'dist/pro/buy/index.html')), 'site sale build with no checkout origin: builds, says why, no /pro/buy/');
}

// ---------------------------------------------------------------- checkout: not selling

{
  const b = checkout({});
  ok(b.status === 0, 'checkout, no flags: builds');
  ok(hits('dist-checkout', /paddle|test_[0-9a-z]{20}/i).length === 0, 'checkout, no flags: nothing of Paddle in any file');
  ok(!readdirSync(join(ROOT, 'dist-checkout')).some((f) => f.endsWith('.js')), 'checkout, no flags: no script at all');
  ok(/frame-ancestors 'none'/.test(readFileSync(join(ROOT, 'dist-checkout/_headers'), 'utf8')), 'checkout, no flags: may not be framed by anyone');
}

// ---------------------------------------------------------------- checkout: selling (sandbox)

{
  const b = checkout({ PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'sandbox', PDFIQ_PADDLE_CLIENT_TOKEN: TOKEN, PDFIQ_PADDLE_PRICE_ID: PRICE, PDFIQ_SITE_ORIGIN: SITE, PDFIQ_CHECKOUT_ORIGIN: CHECKOUT, ...PREVIEW });
  ok(b.status === 0, 'checkout sale build: builds (with no PDFIQ_PRO, as in its own project)');
  const js = files('dist-checkout').filter(([f]) => f.endsWith('.js'));
  ok(js.length === 1 && js[0][1].includes(TOKEN), 'one script, carrying the token');
  ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(js[0]?.[1] ?? ''), 'the script uses no browser storage');
  ok((js[0]?.[1] ?? '').includes(SITE), 'the script addresses its messages to the site origin');
  const headers = readFileSync(join(ROOT, 'dist-checkout/_headers'), 'utf8');
  const policy = /Content-Security-Policy: (.+)/.exec(headers)?.[1] ?? '';
  ok(/script-src 'self' https:\/\/cdn\.paddle\.com/.test(policy) && /frame-src https:\/\/sandbox-buy\.paddle\.com/.test(policy), "policy: Paddle.js and the sandbox checkout frame");
  ok(new RegExp(`frame-ancestors ${SITE.replace(/[.]/g, '\\.')}(;|$)`).test(policy), 'policy: framed by the site origin and nothing else');
  ok(!/profitwell/i.test(headers) && !/X-Frame-Options/i.test(headers), 'policy: no ProfitWell host, and no X-Frame-Options to contradict frame-ancestors');
  ok(/noindex/.test(readFileSync(join(ROOT, 'dist-checkout/index.html'), 'utf8')) && /Disallow: \//.test(readFileSync(join(ROOT, 'dist-checkout/robots.txt'), 'utf8')), 'not for search engines');
}

{
  const b = checkout({ PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'sandbox', PDFIQ_PADDLE_PRICE_ID: PRICE, PDFIQ_SITE_ORIGIN: SITE, ...PREVIEW });
  ok(b.status === 0 && /no PDFIQ_PADDLE_CLIENT_TOKEN/.test(b.out) && !readdirSync(join(ROOT, 'dist-checkout')).some((f) => f.endsWith('.js')), 'checkout sale build with no token: builds, says why, loads nothing');
}

// ---------------------------------------------------------------- refusals

const refusals = [
  ['site', 'sale without Pro', { PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'sandbox', PDFIQ_CHECKOUT_ORIGIN: CHECKOUT }, /without PDFIQ_PRO/],
  ['site', 'sale on the production branch', { PDFIQ_PRO: '1', PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'sandbox', PDFIQ_CHECKOUT_ORIGIN: CHECKOUT, CF_PAGES: '1', CF_PAGES_BRANCH: 'main' }, /production build of the site/],
  ['site', 'a live_ token in its Preview variables', { PDFIQ_PRO: '1', PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'production', PDFIQ_PADDLE_CLIENT_TOKEN: LIVE, PDFIQ_CHECKOUT_ORIGIN: CHECKOUT, ...PREVIEW }, /real money/],
  ['site', 'a checkout origin that is not a bare https origin', { PDFIQ_PRO: '1', PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'sandbox', PDFIQ_CHECKOUT_ORIGIN: `${CHECKOUT}/pay`, ...PREVIEW }, /bare https origin/],
  ['checkout', 'sale on the production branch', { PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'sandbox', PDFIQ_PADDLE_CLIENT_TOKEN: TOKEN, PDFIQ_PADDLE_PRICE_ID: PRICE, PDFIQ_SITE_ORIGIN: SITE, CF_PAGES: '1', CF_PAGES_BRANCH: 'main' }, /production build of the checkout/],
  ['checkout', 'a live_ token on a preview branch', { PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'production', PDFIQ_PADDLE_CLIENT_TOKEN: LIVE, PDFIQ_PADDLE_PRICE_ID: PRICE, PDFIQ_SITE_ORIGIN: SITE, ...PREVIEW }, /real money/],
  ['checkout', 'a live_ token locally', { PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'production', PDFIQ_PADDLE_CLIENT_TOKEN: LIVE, PDFIQ_PADDLE_PRICE_ID: PRICE, PDFIQ_SITE_ORIGIN: SITE }, /real money/],
  ['checkout', 'a test_ token with environment production', { PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'production', PDFIQ_PADDLE_CLIENT_TOKEN: TOKEN, PDFIQ_PADDLE_PRICE_ID: PRICE, PDFIQ_SITE_ORIGIN: SITE, ...PREVIEW }, /does not match/],
  ['checkout', 'the site origin as its own origin', { PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'sandbox', PDFIQ_PADDLE_CLIENT_TOKEN: TOKEN, PDFIQ_PADDLE_PRICE_ID: PRICE, PDFIQ_SITE_ORIGIN: SITE, PDFIQ_CHECKOUT_ORIGIN: SITE, ...PREVIEW }, /same origin/],
];
for (const [which, label, env, reason] of refusals) {
  const b = which === 'site' ? site(env) : checkout(env);
  ok(b.status !== 0 && reason.test(b.out), `${which} refuses ${label}${b.status === 0 ? ' — IT BUILT' : reason.test(b.out) ? '' : ` — failed for another reason: ${b.out.split('\n').find((l) => /Error/.test(l))}`}`);
}

// Leave both as ordinary builds.
site({});
checkout({});
console.log(fails ? `\n${fails} FAILED` : "\nPaddle runs only on the checkout origin, and every way to take money by accident refuses");
process.exit(fails ? 1 : 0);
