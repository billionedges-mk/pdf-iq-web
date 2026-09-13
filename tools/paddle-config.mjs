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
 *   - a sale build of the production branch, until the sale is switched on in code (docs/sale-go-live.md);
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

function refuseProduction(what) {
  if (!PRODUCTION) return;
  throw new Error(
    `PDFIQ_SALE is set on a production build of ${what} (Cloudflare Pages, branch ` +
    `${env.CF_PAGES_BRANCH ?? 'unknown, treated as main'}). The sale is not switched on. Remove PDFIQ_SALE from the ` +
    'Production environment variables; turning it on is a code change, not a setting, and docs/sale-go-live.md is what ' +
    'that change must satisfy, starting with the production measurement of Paddle.js, which sandbox cannot perform.'
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
  refuseProduction('the site');
  const e = paddleEnv();
  checkToken(e);
  const checkoutOrigin = httpsOrigin(env.PDFIQ_CHECKOUT_ORIGIN ?? '', 'PDFIQ_CHECKOUT_ORIGIN');
  if (!checkoutOrigin) {
    console.warn('  (sale) no PDFIQ_CHECKOUT_ORIGIN: /pro/buy/ is left out of this build');
    return { env: e, checkoutOrigin: '', page: false };
  }
  // A build that sells but cannot verify an entitlement would take payment and then never grant Pro.
  const keys = JSON.parse(readFileSync(new URL('../src/pro/entitlement-public-keys.json', import.meta.url), 'utf8'));
  if (!keys[e]) {
    console.warn(`  (sale) no ${e} key in src/pro/entitlement-public-keys.json (npm run entitlement:keys -- ${e}): /pro/buy/ is left out of this build`);
    return { env: e, checkoutOrigin, page: false };
  }
  return { env: e, checkoutOrigin, page: true };
}

/** For the checkout origin: null when not selling; otherwise the Paddle configuration, `page` false if incomplete. */
export function resolveCheckout() {
  if (!SALE) return null;
  refuseProduction('the checkout');
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
    console.warn(`  (sale) no ${missing}: the checkout page is built without Paddle`);
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
