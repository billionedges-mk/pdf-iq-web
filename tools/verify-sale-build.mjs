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
import { PRO as PRO_OFFER } from './site.mjs';

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
  const privacyOff = readFileSync(join(ROOT, 'dist/privacy/index.html'), 'utf8');
  ok(!privacyOff.includes('id="checkout"') && !privacyOff.includes('m.stripe.com') && privacyOff.includes('no third-party script of any kind on this site'), `${label}: /privacy has no checkout section and keeps its original sentence`);
  if (env.PDFIQ_PRO) {
    const flat = privacyOff.replace(/\s+/g, ' ');
    ok(flat.includes('it happens on the account page only:') && !flat.includes('purchase page'), `${label}: /privacy says sign-in happens on the account page only, and names no purchase page`);
  }
}

// ---------------------------------------------------------------- site: selling (sandbox)

{
  // The token is set here too, as it may be in Cloudflare's Preview variables: the site must still not carry it.
  const b = site({ PDFIQ_PRO: '1', PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'sandbox', PDFIQ_PADDLE_CLIENT_TOKEN: TOKEN, PDFIQ_PADDLE_PRICE_ID: PRICE, PDFIQ_CHECKOUT_ORIGIN: CHECKOUT, ...PREVIEW });
  ok(b.status === 0, 'site sale build: builds');
  const page = existsSync(join(ROOT, 'dist/pro/buy/index.html')) ? readFileSync(join(ROOT, 'dist/pro/buy/index.html'), 'utf8') : '';
  ok(page.includes('Buy Pro') && page.includes('SANDBOX'), '/pro/buy/ exists, with the sandbox banner');
  const runnable = files('dist').map(([n, t]) => [n, n.endsWith('.js') ? t : [...t.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>|<script\b[^>]*>/g)].map((m) => m[0]).join('\n')]);
  ok(runnable.filter(([, t]) => /cdn\.paddle\.com|Paddle\.Initialize|Paddle\.Checkout/.test(t)).length === 0, "no Paddle script, host or call in any script on the site's origin");
  const privacy = readFileSync(join(ROOT, 'dist/privacy/index.html'), 'utf8');
  ok(privacy.includes('id="checkout"') && privacy.includes('pro-sale.pdf-iq-checkout.pages.dev') && privacy.includes('m.stripe.com'), '/privacy carries the checkout section, naming this build\'s checkout address and Stripe');
  ok(!/\{\{|<!--\/?(SALE|NOSALE)-->/.test(privacy), '/privacy: no token or sale marker survived');
  ok(hits('dist', new RegExp(TOKEN)).length === 0, "the client token is nowhere on the site's origin");
  const withOrigin = hits('dist', new RegExp(CHECKOUT.replace(/[.]/g, '\\.'))).filter((f) => f !== '_headers');
  ok(withOrigin.length === 1 && /^assets\/buy-/.test(withOrigin[0]), `the checkout origin is named only in the buy bundle (${withOrigin.join(', ')})`);
  const headers = readFileSync(join(ROOT, 'dist/_headers'), 'utf8');
  const buy = /\/pro\/buy\/\*\s*\n\s*! Content-Security-Policy\s*\n\s*Content-Security-Policy: (.+)/.exec(headers)?.[1] ?? '';
  ok(new RegExp(`frame-src [^;]*${CHECKOUT.replace(/[.]/g, '\\.')}`).test(buy), '/pro/buy/ may frame the checkout origin');
  ok(/connect-src [^;]*https:\/\/securetoken\.googleapis\.com/.test(buy), '/pro/buy/ may renew a sign-in (Google token host)');
  ok(/connect-src [^;]*https:\/\/identitytoolkit\.googleapis\.com/.test(buy), '/pro/buy/ may finish a sign-in (Identity Toolkit)');
  // And only those two pages: every other page keeps the site-wide policy, which names no Google host.
  const googleBlocks = [...headers.matchAll(/^(\/[^\s]*)\s*\n(?:\s+[^\n]*\n)*?\s*Content-Security-Policy: ([^\n]+)/gm)]
    .filter((m) => /googleapis\.com/.test(m[2])).map((m) => m[1]);
  ok(googleBlocks.length === 2 && googleBlocks.includes('/account/*') && googleBlocks.includes('/pro/buy/*'), `only /account/ and /pro/buy/ may reach Google (${googleBlocks.join(', ')})`);
  // Hostnames, not the word: the header file's own comment says "Paddle sandbox", and the first version of
  // this check failed on that comment rather than on a policy.
  ok(!/paddle\.com|profitwell\.com/i.test(headers), "no Paddle or ProfitWell host in any of the site's policies");
  ok(/not on sale yet/i.test(readFileSync(join(ROOT, 'dist/pro/index.html'), 'utf8')), 'a sandbox purchase page sells nothing real, so /pro/ still says not on sale');
  const privacyText = readFileSync(join(ROOT, 'dist/privacy/index.html'), 'utf8').replace(/\s+/g, ' ');
  ok(privacyText.includes('pdfiq.entitlement') && privacyText.includes('up to four more if you sign in'), '/privacy lists the stored entitlement token');
  ok(privacyText.includes('pdfiq.pending-purchase') && privacyText.includes('on your account page and the purchase page'), '/privacy lists the pending-purchase note, and the purchase page as a place the token is fetched');
  // Unlock: the button, its price from site.mjs, the return pages, and /privacy saying the handoff store holds it.
  const siteJs = files('dist').filter(([f]) => f.endsWith('.js')).map(([, t]) => t).join('\n');
  const unlockText = `Unlock with Pro \\u2014 ${PRO_OFFER.price} once`;
  ok(siteJs.includes(unlockText) || siteJs.includes(`Unlock with Pro — ${PRO_OFFER.price} once`), `the Unlock button reads "Unlock with Pro — ${PRO_OFFER.price} once", its price taken from site.mjs`);
  ok(/\/pro\/buy\/\?unlock=/.test(siteJs) && /\.unlock=\{feature:/.test(siteJs) && /\.get\("unlock"\)/.test(siteJs), 'Unlock stores its intent with the file, and carries the key to /pro/buy/, which reads it');
  // The allow-list as it compiles, not the paths alone: those appear in every page's navigation too.
  const returns = /\{"\/compress\/":"Compress","\/ocr\/":"OCR","\/password\/":"Password","\/batch\/":"Batch"\}/.exec(siteJs);
  ok(Boolean(returns), '/pro/buy/ returns only to the four Pro pages (its allow-list, in the bundle)');
  ok(privacyText.includes('or an <em>Unlock with Pro</em> button'), '/privacy says Unlock keeps the file in the handoff store');
  ok(!privacyText.includes('happens on the account page only') && privacyText.includes('it happens on the account page and the purchase page only')
    && privacyText.includes('the account page (or the purchase page, while confirming a purchase) renews it')
    && privacyText.includes('account page</a>, or the purchase page if you sign in from there, sends you to Google'),
  '/privacy says sign-in starts and finishes on the purchase page too, and that it renews a sign-in there');
  ok(!/and nothing else, may reach/.test(headers) && /the purchase page may frame the checkout origin and reach the Google sign-in hosts, and nothing else changes\./.test(headers), "_headers' own comments name the purchase page's Google hosts");
  // Step 4: the strip names the price in a sale build and is written hidden (src/pro/strip.ts shows it only to
  // someone who does not own Pro); the nav's Pro labels likewise; the locked controls' words come from pro-copy.mjs.
  const mergeHtml = readFileSync(join(ROOT, 'dist/merge/index.html'), 'utf8');
  const stripTag = /<p class="pro-strip" data-pro-strip hidden>[^\n]*?<\/p>/.exec(mergeHtml)?.[0] ?? '';
  ok(stripTag.includes(`&mdash; ${PRO_OFFER.price} ${PRO_OFFER.qualifier}.`) && !stripTag.includes('not on sale'), `a sale build writes the strip hidden, naming the price (${stripTag ? 'found' : 'no hidden strip'})`);
  ok(/Batch <span class="pro-label" data-pro-label hidden>Pro<\/span>/.test(mergeHtml) && /Password <span class="pro-label" data-pro-label hidden>Pro<\/span>/.test(mergeHtml), 'and the nav labels Batch and Password as Pro, hidden until settled');
  ok(siteJs.includes('pdfiq-pro:strip') && /settleSellingMarks|\[data-pro-strip\], \[data-pro-label\]/.test(siteJs), 'the page code that settles them (show unless owned) is in the bundle');
  ok(siteJs.includes('The three presets are free and report the real before and after') && siteJs.includes('Add a password to a copy of a PDF, or take one off, written AES-256.'), "the locked controls' what and instead sentences are pro-copy.mjs's");
  ok(!siteJs.includes('Yours with Pro'), 'an owner is not told "Yours with Pro" on OCR: after buying, nothing sells');
  // Signing in from a locked feature, and Batch saying its files stay behind.
  ok(siteJs.includes('Buying needs an account, so you sign in with Google first and come straight back.'), 'signed out, a locked feature offers Unlock and says a Google sign-in comes first');
  ok(siteJs.includes('These files do not come with you to the checkout: after paying, you come back here and choose them again.'), 'Batch says before Unlock that its files do not come back');
  const buyHtml = readFileSync(join(ROOT, 'dist/pro/buy/index.html'), 'utf8');
  ok(buyHtml.includes('data-buy-signin>Sign in with Google</button>') && !buyHtml.includes('sign in on your account page</a>, then come back here'), '/pro/buy/ signs in itself rather than sending the buyer to /account/ and back');
  ok(privacyText.includes('That means deleting the record is the one thing that does take Pro away.') && privacyText.includes('deleting the record is not a refund') && privacyText.includes('The Pro purchase record is the exception, and it is deliberate.'), '/privacy states the purchase record, why it outlives the account, and what deleting it costs');
  const refundsText = readFileSync(join(ROOT, 'dist/refunds/index.html'), 'utf8').replace(/\s+/g, ' ');
  ok(refundsText.includes('a refund takes Pro off a browser the next time your account page is opened there with a connection'), '/refunds says when a refund reaches a browser');
}

{
  const b = site({ PDFIQ_PRO: '1', PDFIQ_SALE: 'true', PDFIQ_PADDLE_ENV: 'sandbox', PDFIQ_PADDLE_PRICE_ID: PRICE, ...PREVIEW });
  ok(b.status === 0 && /no PDFIQ_CHECKOUT_ORIGIN/.test(b.out) && !existsSync(join(ROOT, 'dist/pro/buy/index.html')), 'site sale build with no checkout origin: builds, says why, no /pro/buy/');
}

// ---------------------------------------------------------------- checkout: not selling

{
  const b = checkout({});
  ok(b.status === 0, 'checkout, no flags: builds');
  ok(hits('dist-checkout', /paddle\.com|Paddle\.Initialize|test_[0-9a-z]{20}/).length === 0, 'checkout, no flags: no Paddle host, call or token in any file');
  const idx = readFileSync(join(ROOT, 'dist-checkout/index.html'), 'utf8');
  ok(/href="https:\/\/pdf-iq\.com\/terms\/"/.test(idx) && /\/privacy\/#checkout/.test(idx) && /\/refunds\//.test(idx) && !/<main class="standalone" hidden/.test(idx), 'checkout, no flags: shows what it is, with links to terms, privacy and refunds');
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
  ok(/variant:"one-page"|variant: ?['"]one-page['"]/.test(js[0]?.[1] ?? ''), "opens Paddle's one-page checkout");
  const headers = readFileSync(join(ROOT, 'dist-checkout/_headers'), 'utf8');
  const policy = /Content-Security-Policy: (.+)/.exec(headers)?.[1] ?? '';
  ok(/script-src 'self' https:\/\/cdn\.paddle\.com/.test(policy) && /frame-src https:\/\/sandbox-buy\.paddle\.com/.test(policy), "policy: Paddle.js and the sandbox checkout frame");
  ok(new RegExp(`frame-ancestors ${SITE.replace(/[.]/g, '\\.')}(;|$)`).test(policy), 'policy: framed by the site origin and nothing else');
  ok(!/profitwell/i.test(headers) && !/X-Frame-Options/i.test(headers), 'policy: no ProfitWell host, and no X-Frame-Options to contradict frame-ancestors');
  ok(/noindex/.test(readFileSync(join(ROOT, 'dist-checkout/index.html'), 'utf8')) && /Disallow: \//.test(readFileSync(join(ROOT, 'dist-checkout/robots.txt'), 'utf8')), 'not for search engines');
  const idx = readFileSync(join(ROOT, 'dist-checkout/index.html'), 'utf8');
  ok(idx.includes(`href="${SITE}/terms/"`) && idx.includes(`${SITE}/privacy/#checkout`) && idx.includes(`${SITE}/refunds/`), "the standalone text links to the site's terms, privacy and refunds");
  ok(/<main class="standalone" hidden/.test(idx), 'and starts hidden, so nothing flashes inside the frame');
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
