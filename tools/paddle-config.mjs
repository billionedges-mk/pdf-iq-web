/**
 * Whether a build may sell Pro, and with what. The one place that decides it, for both origins.
 *
 * The sale spans two origins, on purpose (13 September 2026). Paddle.js is a third-party script, and a
 * script running in a pdf-iq.com page can read that origin's localStorage, where the Pro sign-in
 * keeps a Firebase refresh token that can act as the account. /privacy promises the only code that
 * can read it is this site's own. So Paddle.js never runs on the site's origin:
 *
 *   - pdf-iq.com /pro/buy/ (tools/build.mjs): no Paddle script, host or token. On Pay it embeds the
 *     checkout origin in a frame and hands it only the uid and email, by postMessage, to that exact
 *     origin. It needs PDFIQ_CHECKOUT_ORIGIN.
 *   - the checkout origin (tools/build-checkout.mjs, its own Cloudflare Pages project): loads
 *     Paddle.js, stores nothing, and accepts messages only from PDFIQ_SITE_ORIGIN. It needs the token,
 *     the price and the environment.
 *
 * The browser enforces the boundary: different origins cannot read each other's storage. pages.dev is
 * on the Public Suffix List, so even the two Preview hostnames are separate sites.
 *
 * Refusals, each by name, because each is a way to take money by accident or put the boundary back:
 *   - a sale build without the Pro flag (site);
 *   - a production sale build that is INCOMPLETE — missing the checkout origin, the entitlement key, the client
 *     token, the price id or the site origin. Off production the same state is a warning and the purchase page is
 *     left out, because every preview branch shares Cloudflare's Preview variables and an incomplete preview is
 *     ordinary. On production it would be a site naming a price with no way to pay (CLAIMS 14);
 *   - a live_ client token in any build that is not production;
 *   - a token whose prefix disagrees with PDFIQ_PADDLE_ENV;
 *   - a checkout origin that is the site's own origin, which would undo the whole point.
 * A build missing what it needs to sell does not fail: it leaves the purchase out and says why, since
 * every preview branch shares Cloudflare's Preview variables.
 */

import { readFileSync } from 'node:fs';

const on = (v) => /^(1|true|on)$/i.test(v ?? '');
const env = process.env;

export const SALE = on(env.PDFIQ_SALE);
const PRO = on(env.PDFIQ_PRO);
const ON_CLOUDFLARE = Boolean(env.CF_PAGES);
const PRODUCTION = ON_CLOUDFLARE && (env.CF_PAGES_BRANCH ?? 'main') === 'main';

export const PADDLE_SCRIPT = 'https://cdn.paddle.com/paddle/v2/paddle.js';

/** Paddle.js 2.9.7's own defaults per environment (checkoutFrontEndBase, the assets base). */
export const PADDLE_HOSTS = {
  sandbox: { script: ['https://cdn.paddle.com'], frame: ['https://sandbox-buy.paddle.com'], style: ['https://sandbox-cdn.paddle.com'], img: ['https://sandbox-cdn.paddle.com'] },
  production: { script: ['https://cdn.paddle.com'], frame: ['https://buy.paddle.com'], style: ['https://cdn.paddle.com'], img: ['https://cdn.paddle.com'] },
};

function httpsOrigin(value, name) {
  if (!value) return '';
  let u;
  try { u = new URL(value); } catch { throw new Error(`${name} is not a URL: "${value}"`); }
  // http only for a local test with two loopback ports, never on Cloudflare.
  const localHttp = !ON_CLOUDFLARE && u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname);
  if ((u.protocol !== 'https:' && !localHttp) || u.origin !== value.replace(/\/+$/, '')) {
    throw new Error(`${name} must be a bare https origin such as https://checkout.pdf-iq.com, not "${value}"`);
  }
  return u.origin;
}

/**
 * Until 20 September 2026 this refused a production sale build outright: the sale was not switched on, and the
 * refusal existed so that setting a variable could never be the thing that started selling. The switch-on is a
 * reviewed change, and this commit is it (docs/sale-go-live.md, step 0).
 *
 * What replaces it is narrower and does more. A sale build that is missing something ships WITHOUT the purchase
 * page — correct off production, where every preview branch shares one set of Cloudflare variables and half-configured
 * previews are ordinary. On production that same silence is the defect this repo keeps naming: pages that quote
 * $14.99 with nothing behind the button (CLAIMS 14, and verify-price-offers exists for its milder form). So off
 * production it warns and drops the page; on production it refuses to build at all.
 *
 * A site that does not deploy is a bad afternoon. A site that deploys and cannot take money is a bad afternoon
 * nobody notices.
 */
function incomplete(what, missing) {
  const line = `(sale) ${missing}`;
  if (!PRODUCTION) { console.warn(`  ${line}: /pro/buy/ is left out of this build`); return; }
  throw new Error(
    `A production sale build of ${what} is incomplete: ${missing}. On Cloudflare Pages branch ` +
    `${env.CF_PAGES_BRANCH ?? 'unknown, treated as main'}, with PDFIQ_SALE set, this would publish a site that names ` +
    'a price and cannot take the payment. Set the variable, or remove PDFIQ_SALE until you can — ' +
    'docs/sale-go-live.md § "Credentials and configuration" lists every one of them.'
  );
}

function paddleEnv() {
  const e = env.PDFIQ_PADDLE_ENV ?? '';
  if (!['sandbox', 'production'].includes(e)) throw new Error(`PDFIQ_SALE is set but PDFIQ_PADDLE_ENV is "${e}". It must be sandbox or production.`);
  return e;
}

/** Validated whenever a token is present, in either build, so a live token cannot sit anywhere in Preview. */
function checkToken(e) {
  const token = env.PDFIQ_PADDLE_CLIENT_TOKEN ?? '';
  if (token.startsWith('live_') && !PRODUCTION) {
    throw new Error(
      'PDFIQ_PADDLE_CLIENT_TOKEN is a live_ token in a build that is not production. A checkout here would take ' +
      "real money from whoever tests it. Use the Paddle sandbox account's test_ token for Preview."
    );
  }
  if (token && !token.startsWith(e === 'sandbox' ? 'test_' : 'live_')) {
    throw new Error(`PDFIQ_PADDLE_CLIENT_TOKEN does not match PDFIQ_PADDLE_ENV=${e}: sandbox takes test_, production takes live_.`);
  }
  return token;
}

/** For pdf-iq.com: null when not selling; otherwise where the checkout lives, with `page` false if incomplete. */
function resolveSite() {
  if (!SALE) return null;
  if (!PRO) throw new Error('PDFIQ_SALE is set without PDFIQ_PRO. There is nothing to sell in a build without Pro.');
  const e = paddleEnv();
  checkToken(e);
  const checkoutOrigin = httpsOrigin(env.PDFIQ_CHECKOUT_ORIGIN ?? '', 'PDFIQ_CHECKOUT_ORIGIN');
  if (!checkoutOrigin) {
    incomplete('the site', 'no PDFIQ_CHECKOUT_ORIGIN');
    return { env: e, checkoutOrigin: '', page: false };
  }
  // A build that sells but cannot verify an entitlement would take payment and then never grant Pro.
  const keys = JSON.parse(readFileSync(new URL('../src/pro/entitlement-public-keys.json', import.meta.url), 'utf8'));
  if (!keys[e]) {
    incomplete('the site', `no ${e} key in src/pro/entitlement-public-keys.json (npm run entitlement:keys -- ${e})`);
    return { env: e, checkoutOrigin, page: false };
  }
  return { env: e, checkoutOrigin, page: true };
}

/** For the checkout origin: null when not selling; otherwise the Paddle configuration, `page` false if incomplete. */
export function resolveCheckout() {
  if (!SALE) return null;
  const e = paddleEnv();
  const token = checkToken(e);
  const priceId = env.PDFIQ_PADDLE_PRICE_ID ?? '';
  const siteOrigin = httpsOrigin(env.PDFIQ_SITE_ORIGIN ?? '', 'PDFIQ_SITE_ORIGIN');
  const checkoutOrigin = httpsOrigin(env.PDFIQ_CHECKOUT_ORIGIN ?? '', 'PDFIQ_CHECKOUT_ORIGIN');
  if (siteOrigin && checkoutOrigin && siteOrigin === checkoutOrigin) {
    throw new Error('PDFIQ_SITE_ORIGIN and PDFIQ_CHECKOUT_ORIGIN are the same origin. The checkout exists to be a different one.');
  }
  if (!token || !/^pri_[a-z0-9]{26}$/.test(priceId) || !siteOrigin) {
    const missing = !token ? 'PDFIQ_PADDLE_CLIENT_TOKEN' : !siteOrigin ? 'PDFIQ_SITE_ORIGIN' : 'a valid PDFIQ_PADDLE_PRICE_ID';
    incomplete('the checkout', `no ${missing}`);
    return { env: e, token: '', priceId: '', siteOrigin, page: false, hosts: PADDLE_HOSTS[e] };
  }
  return { env: e, token, priceId, siteOrigin, page: true, hosts: PADDLE_HOSTS[e] };
}

/**
 * pdf-iq.com's view. The checkout build sets PDFIQ_CHECKOUT_BUILD before importing this file and calls
 * resolveCheckout() instead, so neither build validates the other's variables: the checkout project has
 * no PDFIQ_PRO, and the site build's refusal of a sale without Pro must not fire there.
 */
export const PADDLE = env.PDFIQ_CHECKOUT_BUILD ? null : resolveSite();
