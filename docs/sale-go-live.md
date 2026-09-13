# Switching the Pro sale on — the checklist

The sale is off in production, and a production build with `PDFIQ_SALE` set refuses by name
(`tools/paddle-config.mjs`). Turning it on is a code change. This file is what that change must
satisfy, in order. The refusal's error message points here.

## 1. The measurement that cannot be run until the day itself

**Sandbox cannot show it.** Paddle.js 2.9.7 ends `Paddle.Initialize()` by injecting Paddle Retain's
analytics script, `public.profitwell.com/js/profitwell.js?auth=paddletoken_<token>`, whenever the
environment is **not** sandbox (read from the library's source on 13 September 2026). Every
measurement so far was sandbox, so none of them could have seen it.

/pro/buy/ has two defences, neither proven in production:
- it sets `window.profitwell.isLoaded` before `Initialize`, which is the loader's own skip condition;
- its content security policy names no ProfitWell host.

**Before the sale is announced**, on a production build with the live token, run:

```
npm run measure:paddle -- --url https://pdf-iq.com/pro/buy/
```

It opens the checkout and does not pay. Expect `ProfitWell / Retain requested: no`. If it says yes, or the
console shows a policy refusal for profitwell, **stop**: the first defence failed, and possibly the
second. Also re-read Paddle.js's version, because `cdn.paddle.com/paddle/v2/paddle.js` is not pinned and can
change without a commit here (CLAIMS 37).

Then compare the production host list with the sandbox measurement below. The /privacy wording names
production hosts, so it is corrected from this run before the sale is announced.

## 2. Credentials and configuration, Production environment only

- `PDFIQ_PADDLE_ENV=production`, the `live_` client token, the live price id.
- A live notification destination at `https://pdf-iq.com/api/paddle/webhook` for exactly
  `transaction.completed`, `adjustment.created`, `adjustment.updated`; its secret as `PADDLE_WEBHOOK_SECRET`.
- A production D1 purchases database bound as `PURCHASES`, in the same region as the others.
- `npm run entitlement:keys -- production`; private key into Production, public key committed.
- The live default payment link repointed from /pro/ to https://pdf-iq.com/pro/buy/.
- Cloudflare Bot Fight Mode checked for the webhook path (Paddle asks for bot checks to be bypassed there).

## 3. Copy that must change in the same release

- /privacy: the checkout section, from the production measurement.
- /refunds: when a refund takes effect on a device.
- /terms "Buying Pro", /support "Billing and Pro", /pro/, /app/, the homepage Pro card: "not on sale yet"
  becomes true-to-the-day wording.
- The app must honour a web purchase first: `BILLING_ENABLED` split in the app (TECH_DEBT).

## Sandbox measurement, for comparison (Preview f3c2dbf, 13 September 2026)

- **Arrival:** 11 requests, all first-party; nothing stored beyond what the page itself keeps. The footer
  counter read 0 bytes sent · 0 third-party requests.
- **After pressing Pay**, before paying:
  - Paddle.js (cdn.paddle.com), its stylesheet (sandbox-cdn.paddle.com) and the checkout frame
    (sandbox-buy.paddle.com). The footer counter read 3 third-party requests: it sees these three and
    nothing inside the frame.
  - Inside the frame: Stripe (js.stripe.com, m.stripe.network, m.stripe.com), which sets cookie `m` on
    m.stripe.com, about 13 months, httpOnly.
  - Localize (global.localizecdn.com), Sentry (o522631.ingest.sentry.io), Google Fonts, Paddle checkout
    analytics and event pings.
  - Cloudflare `__cf_bm` on .paddle.com, about 30 minutes.
