/**
 * Whether this build may sell Pro, and with which Paddle credentials. The one place that decides it.
 *
 * PDFIQ_SALE is off everywhere except a Preview build testing against the Paddle sandbox. When it is
 * off, nothing below exists in the build: no purchase page, no Paddle host in any policy, no token.
 *
 * Refusals, each by name, because each is a way to take money by accident:
 *   - a sale build without the Pro flag (nothing to sell);
 *   - a sale build of the production branch, until the sale is deliberately switched on in code;
 *   - a live_ client token in any build that is not production — a preview checkout with a live
 *     token takes real money from whoever tests it;
 *   - a token whose prefix disagrees with PDFIQ_PADDLE_ENV.
 *
 * A sale build that is missing its token or price does not fail. It warns and leaves the purchase
 * page out, the way a Pro build without a Firebase key leaves sign-in unconfigured: every preview
 * branch shares Cloudflare's Preview variables, and one missing value must not break all of them.
 *
 * Hosts are per environment and come from Paddle.js's own defaults (paddle.js 2.9.7:
 * checkoutFrontEndBase, the assets base, apiBase), not from documentation. What the page actually
 * loads is measured by tools/measure-paddle.mjs; this list is the policy, that is the evidence.
 */

const on = (v) => /^(1|true|on)$/i.test(v ?? '');

export const SALE = on(process.env.PDFIQ_SALE);
const PRO = on(process.env.PDFIQ_PRO);
const ON_CLOUDFLARE = Boolean(process.env.CF_PAGES);
const PRODUCTION = ON_CLOUDFLARE && (process.env.CF_PAGES_BRANCH ?? 'main') === 'main';

export const PADDLE_SCRIPT = 'https://cdn.paddle.com/paddle/v2/paddle.js';

export const PADDLE_HOSTS = {
  sandbox: {
    script: ['https://cdn.paddle.com'],
    frame: ['https://sandbox-buy.paddle.com'],
    style: ['https://sandbox-cdn.paddle.com'],
    img: ['https://sandbox-cdn.paddle.com'],
    connect: [],
  },
  production: {
    script: ['https://cdn.paddle.com'],
    frame: ['https://buy.paddle.com'],
    style: ['https://cdn.paddle.com'],
    img: ['https://cdn.paddle.com'],
    connect: [],
  },
};

function resolve() {
  if (!SALE) return null;
  if (!PRO) throw new Error('PDFIQ_SALE is set without PDFIQ_PRO. There is nothing to sell in a build without Pro.');
  if (PRODUCTION) {
    throw new Error(
      'PDFIQ_SALE is set on a production build (Cloudflare Pages, branch ' +
      `${process.env.CF_PAGES_BRANCH ?? 'unknown, treated as main'}). The sale is not switched on. ` +
      'Remove PDFIQ_SALE from the Production environment variables; turning it on is a code change, not a setting, ' +
      'and docs/sale-go-live.md is what that change must satisfy — starting with the production measurement ' +
      'of Paddle.js, which sandbox cannot perform.'
    );
  }
  const env = process.env.PDFIQ_PADDLE_ENV ?? '';
  const token = process.env.PDFIQ_PADDLE_CLIENT_TOKEN ?? '';
  const priceId = process.env.PDFIQ_PADDLE_PRICE_ID ?? '';
  if (!['sandbox', 'production'].includes(env)) {
    throw new Error(`PDFIQ_SALE is set but PDFIQ_PADDLE_ENV is "${env}". It must be sandbox or production.`);
  }
  if (token.startsWith('live_') && !PRODUCTION) {
    throw new Error(
      'PDFIQ_PADDLE_CLIENT_TOKEN is a live_ token in a build that is not production. A checkout here would take ' +
      'real money from whoever tests it. Use the Paddle sandbox account\'s test_ token for Preview.'
    );
  }
  if (token && !token.startsWith(env === 'sandbox' ? 'test_' : 'live_')) {
    throw new Error(`PDFIQ_PADDLE_CLIENT_TOKEN does not match PDFIQ_PADDLE_ENV=${env}: sandbox takes test_, production takes live_.`);
  }
  if (!token || !/^pri_[a-z0-9]{26}$/.test(priceId)) {
    console.warn(`  (sale) ${!token ? 'no PDFIQ_PADDLE_CLIENT_TOKEN' : 'no valid PDFIQ_PADDLE_PRICE_ID'}: /pro/buy/ is left out of this build`);
    return { env, token: '', priceId: '', page: false, hosts: PADDLE_HOSTS[env] };
  }
  return { env, token, priceId, page: true, hosts: PADDLE_HOSTS[env] };
}

/** null when not selling; otherwise the checkout configuration, with `page` false if incomplete. */
export const PADDLE = resolve();
