/**
 * Build the checkout origin: the only place Paddle's script runs. Output: dist-checkout/.
 *
 * Its own Cloudflare Pages project (pdf-iq-checkout), so it is a different origin from pdf-iq.com and
 * neither it nor Paddle's script can read the site's storage (tools/paddle-config.mjs explains why).
 *
 *   Cloudflare build command:   node tools/build-checkout.mjs
 *   Build output directory:     dist-checkout
 *
 * What it writes:
 *   - index.html: a blank, transparent page. In a build that is selling, it loads one small script.
 *     In any other build, it loads nothing at all.
 *   - _headers: a content security policy that allows Paddle's hosts for the environment and no
 *     ProfitWell host, and may be framed only by the site origin (frame-ancestors).
 *   - robots.txt: nothing here is for search engines.
 */
import * as esbuild from 'esbuild';
import { mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Before importing the config: it tells paddle-config.mjs not to validate the site build's variables
// (the checkout project has no PDFIQ_PRO) and to leave the checkout's to resolveCheckout().
process.env.PDFIQ_CHECKOUT_BUILD = '1';
const { resolveCheckout, PADDLE_SCRIPT } = await import('./paddle-config.mjs');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist-checkout');
const CONFIG = resolveCheckout();
const SELLING = Boolean(CONFIG?.page);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let scriptTag = '';
if (SELLING) {
  const result = await esbuild.build({
    entryPoints: [join(ROOT, 'src/checkout/checkout.ts')],
    bundle: true, format: 'esm', target: ['es2022'], minify: true, write: false, logLevel: 'warning',
    define: {
      __CHECKOUT_PADDLE_ENV__: JSON.stringify(CONFIG.env),
      __CHECKOUT_PADDLE_TOKEN__: JSON.stringify(CONFIG.token),
      __CHECKOUT_PADDLE_PRICE__: JSON.stringify(CONFIG.priceId),
      __CHECKOUT_PADDLE_SCRIPT__: JSON.stringify(PADDLE_SCRIPT),
      __CHECKOUT_SITE_ORIGIN__: JSON.stringify(CONFIG.siteOrigin),
    },
  });
  const code = result.outputFiles[0].contents;
  const name = `checkout-${createHash('sha256').update(code).digest('hex').slice(0, 10)}.js`;
  writeFileSync(join(OUT, name), code);
  scriptTag = `<script type="module" src="/${name}"></script>`;
}

// Opened directly — by Paddle's domain review, or anyone typing the address — the page says what this
// address is and links to the site's terms, privacy notice and refund policy, which Paddle's website approval
// asks for. In a build that sells, it starts hidden and the script reveals it only when the page is not inside
// the site's frame, so nothing flashes over the purchase page. A build that is not selling has no script and
// shows it plainly.
const LEGAL = CONFIG?.siteOrigin || 'https://pdf-iq.com';
const standalone = `<main class="standalone"${SELLING ? ' hidden' : ''}>
  <p><strong>pdf-iq checkout</strong></p>
  <p>This address runs Paddle's checkout for Pro, bought on <a href="${LEGAL}/pro/">pdf-iq</a>. It keeps nothing
  and does nothing on its own.</p>
  <p><a href="${LEGAL}/terms/">Terms</a> · <a href="${LEGAL}/privacy/#checkout">Privacy</a> · <a href="${LEGAL}/refunds/">Refunds</a></p>
</main>`;

writeFileSync(join(OUT, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="normal">
<title>Checkout — pdf-iq</title>
<style>html,body{margin:0;background:transparent}.standalone{font:16px/1.6 system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 20px;color:#1E2A38}.standalone a{color:#1E2A38}</style>
${scriptTag}
</head>
<body>${standalone}</body>
</html>
`);

const policy = SELLING
  ? [
      "default-src 'none'",
      `script-src 'self' ${CONFIG.hosts.script.join(' ')}`,
      `style-src 'self' 'unsafe-inline' ${CONFIG.hosts.style.join(' ')}`,
      `img-src 'self' data: ${CONFIG.hosts.img.join(' ')}`,
      `frame-src ${CONFIG.hosts.frame.join(' ')}`,
      "connect-src 'none'",
      `frame-ancestors ${CONFIG.siteOrigin}`,
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; ')
  : "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
if (/profitwell/i.test(policy)) throw new Error('the checkout policy names a ProfitWell host; Retain analytics must stay blocked');

writeFileSync(join(OUT, '_headers'), `# The checkout origin (tools/build-checkout.mjs). ${SELLING ? `Selling through Paddle ${CONFIG.env}; framed only by ${CONFIG.siteOrigin}.` : 'Not selling: this page loads nothing and may not be framed.'}
/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Content-Security-Policy: ${policy}
  Cache-Control: public, max-age=0, must-revalidate
/checkout-*
  Cache-Control: public, max-age=31536000, immutable
`);
writeFileSync(join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');

// Checked against what was written. Not selling: nothing of Paddle anywhere. Selling: the one script
// may use no storage of any kind, because this origin's promise is that it keeps nothing.
const files = readdirSync(OUT).map((f) => [f, readFileSync(join(OUT, f), 'utf8')]);
if (!SELLING) {
  const leaked = files.filter(([, t]) => /paddle\.com|Paddle\.Initialize|test_[0-9a-f]{20}|live_[0-9a-f]{20}/.test(t)).map(([f]) => f);
  if (leaked.length) throw new Error(`the checkout is not selling, but Paddle reached ${leaked.join(', ')}`);
} else {
  const js = files.filter(([f]) => f.endsWith('.js'));
  const storing = js.filter(([, t]) => /localStorage|sessionStorage|indexedDB|document\.cookie/.test(t)).map(([f]) => f);
  if (storing.length) throw new Error(`the checkout script uses browser storage (${storing.join(', ')}); this origin keeps nothing`);
}

console.log(`built checkout -> dist-checkout/  (${SELLING ? `selling, Paddle ${CONFIG.env}, framed by ${CONFIG.siteOrigin}` : 'not selling: blank page'})`);
