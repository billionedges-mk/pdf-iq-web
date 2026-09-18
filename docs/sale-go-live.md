# Switching the Pro sale on — the checklist

The sale is off in production, and a production build with `PDFIQ_SALE` set refuses by name
(`tools/paddle-config.mjs`). Turning it on is a code change. This file is what that change must
satisfy, in order. The refusal's error message points here.

**There are two refusals, not one.** `tools/paddle-config.mjs` refuses `PDFIQ_SALE` on a production build, and
`tools/build.mjs` refuses `PDFIQ_PRO` on one ("Pro and sign-in are preview-only until payment is live"). Lifting the
first alone leaves the build failing on the second. Both go in the same commit, with this file's conditions met first.

**The order is the safety property.** Everything below exists before `PDFIQ_SALE` becomes true, and `PDFIQ_SALE` is the
last thing switched: with a purchase page live and no database, no schema or no notification destination, someone can pay
and never receive Pro, and the only record is Paddle's.

1. Production D1 exists, with the schema applied (§2).
2. The live notification destination exists, with its secret set (§2).
3. The production entitlement key pair exists; the public half is committed (§2).
4. Sign-in works for pdf-iq.com: OAuth origins, redirect URIs, authorised domain, web key (§2).
5. Paddle domain approval for both hosts (§2).
6. The build flags: `PDFIQ_PRO=1` and the Paddle variables (§2).
7. **Then** `PDFIQ_SALE=true`, and a first real purchase and refund walked the same day (§3, and "Walking a refund").

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

**Two Cloudflare Pages projects.** pdf-iq-web is the site; pdf-iq-checkout is the checkout origin, the only
place Paddle.js runs (CLAIMS 38). Each has its own Production variables.

- pdf-iq-checkout: the custom domain `checkout.pdf-iq.com`; `PDFIQ_SALE`, `PDFIQ_PADDLE_ENV=production`,
  the `live_` token, the live price id, `PDFIQ_SITE_ORIGIN=https://pdf-iq.com`,
  `PDFIQ_CHECKOUT_ORIGIN=https://checkout.pdf-iq.com`.
- pdf-iq-web: `PDFIQ_CHECKOUT_ORIGIN=https://checkout.pdf-iq.com` (and no client token: the site never uses it).
- **Paddle live domain approval** (Paddle → Website approval → Domain approval, /request-domain-approval; separate
  from the default payment link). Paddle's own note: "Subdomains are not approved by default and must be submitted and
  approved individually." So checkout.pdf-iq.com needs its own approval; it does not inherit pdf-iq.com's. In sandbox
  both Preview hosts were approved instantly on 13 September 2026. Live may be reviewed.
- **The approval requirement** is that the website links to terms of service, privacy notice and refund policy.
  pdf-iq.com does. The checkout origin, opened directly, shows a short statement of what the address is, with links to
  the site's terms, privacy (the checkout section) and refunds (tools/build-checkout.mjs), in case a reviewer visits it.
  Whether live review accepts a checkout-only subdomain is unknown until it is submitted: submit it well before the
  day, not on it.
- Paddle live: approve **both** pdf-iq.com and checkout.pdf-iq.com. Paddle's checkout frame sends a
  report-only frame-ancestors policy naming its approved domain; with the checkout origin framed by the site,
  both are ancestors. It only reports today; if Paddle enforces it, an unapproved ancestor breaks checkout.
- The live default payment link is https://checkout.pdf-iq.com/ (the page that runs Paddle.js), not /pro/buy/.


- `PDFIQ_PADDLE_ENV=production`, the `live_` client token, the live price id.
- A live notification destination at `https://pdf-iq.com/api/paddle/webhook` for exactly
  `transaction.completed`, `adjustment.created`, `adjustment.updated`; its secret as `PADDLE_WEBHOOK_SECRET`.
- `PDFIQ_PRO=1` on pdf-iq-web Production. Without it the build emits no Pro pages at all, so a "sale" build would
  deploy with no /pro/buy/ to sell from. The Preview build failed on exactly this omission on 13 September 2026.
- A production D1 purchases database bound as `PURCHASES`, in the same region as the others,
  **with the schema applied to it**: a fresh D1 has no `purchases` table, and the webhook's write would throw, answer
  Paddle 500, and be retried for three days while the buyer has no Pro. The file is in this repo:

  ```
  npx wrangler d1 execute <production-db-name> --remote --file functions/purchases-schema.sql
  ```

  Then prove it before any money moves: `SELECT name FROM sqlite_master WHERE type='table';` lists `purchases`.
- The webhook reads three things at runtime and answers 503 without any of them: `PURCHASES`,
  `PADDLE_WEBHOOK_SECRET`, `PDFIQ_PADDLE_PRICE_ID` (the live price id, so a purchase of anything else is ignored).
  **Read replication must stay off** on it, and on the sandbox one: /privacy says the database runs where the Asia-Pacific
  location hint places it, and read replication copies it to every region (Cloudflare D1 data-location docs).
- `npm run entitlement:keys -- production`; private key into Production, public key committed.
- The sandbox database (`pdf-iq-purchases-sandbox`) holds only test walks: rows from 13 September 2026 are Maneesh's
  sandbox payments, not sales. Nothing that counts purchases may read it, and it is never copied into production.
- (Superseded by the checkout origin above: the default payment link is https://checkout.pdf-iq.com/.)
- Cloudflare Bot Fight Mode checked for the webhook path (Paddle asks for bot checks to be bypassed there).

**Web sign-in for production** (the same three settings made for Preview, for pdf-iq.com):
- Google Cloud, OAuth web client 340733500005-e6guq4…: JavaScript origin `https://pdf-iq.com`, redirect URIs
  `https://pdf-iq.com/account/` **and `https://pdf-iq.com/pro/buy/`** (signing in from the purchase page returns there;
  both with the trailing slash). Check from outside afterwards: an authorisation URL with each redirect goes to
  Google's sign-in page, not `/signin/oauth/error`.
- Firebase Authentication, Authorized domains: `pdf-iq.com`.
- The web API key (restricted to Identity Toolkit and Token Service) as `PDFIQ_FIREBASE_WEB_KEY` in pdf-iq-web Production.
- And `npm run entitlement:keys -- production`: a production sale build leaves /pro/buy/ out without its public key.

## 3. The price, against the production price id

The pages say $14.99. That is the total in most of the world and **not** in the United States or Canada, where Paddle
adds sales tax on top of a tax-inclusive price. Measured on the sandbox price on 17 September 2026 (TECH_DEBT.md has the
table): New York $16.32, Texas $16.23, Ontario $16.94; UAE, Germany, the UK, India, Australia and Japan all $14.99.

**Run the same measurement against the production price before the sale is announced**, because it is a different price
id in a different Paddle account, and the pages' wording depends on the answer:

1. Open a page that is not this site (the site's own policy blocks Paddle), load `https://cdn.paddle.com/paddle/v2/paddle.js`,
   then `Paddle.Environment.set('production')` and `Paddle.Initialize({ token: <the live client token> })`.
2. For each of UAE, Germany, the UK, India, Australia, Japan, US-NY, US-TX, US-CA and Canada-ON, call
   `Paddle.PricePreview({ items: [{ priceId: <live price id>, quantity: 1 }], address: { countryCode, postalCode } })`
   and read `data.details.lineItems[0].formattedTotals`.
   `scratchpad/pricecheck/index.html` is the sandbox version of exactly this.
3. If any total outside the US and Canada is not $14.99, the price is **not** tax-inclusive there and every page that
   names $14.99 is wrong: stop and change the copy before announcing.
4. If the pattern holds, the sentence already on /pro/, /app/, /terms and /pro/buy/ is correct as it stands, and
   `verify:price-offers` keeps it on the purchase page.

**Answered in sandbox, to confirm on the first live refund.** A sandbox refund on 18 September 2026 returned the whole
$14.99 including its $0.71 of VAT: the tax came off our side, and Paddle kept the $1.25 transaction fee. /refunds now
says "A refund returns the full amount you paid, the tax included." Read the first real refund the same way and check
that sentence still holds.

**And read the webhook line for that refund.** The same sandbox refund did not revoke Pro (TECH_DEBT: our rule required
the payload to name the refund "full"). The rule is fixed and the log now carries the adjustment's action, status and
type, so the first live refund should show a revocation — and the entitlement endpoint should answer `pro:false` on the
next check. Watch it rather than assume it.

## Walking a refund, in sandbox or live

A merchant refund is **requested, then approved, with a gap** — four minutes on 18 September 2026, and it is Paddle's
to decide, not ours. Only the approved event revokes, so between the two the purchase is still `granted`, the
entitlement endpoint still answers `pro:true`, and a device still has Pro. That is correct behaviour and it looks
exactly like the defect this section exists because of. Do not read a "still granted" in that window as a failure.

1. Refund in Paddle. The transaction reads **Full refund requested**.
2. Watch Paddle's own notification log rather than ours: it records our response body per delivery. The revoking one is
   `adjustment.updated` with `{"applied": true, "reason": "revoked"}`. An `adjustment.created` carrying
   `status: "pending_approval"` answers `{"applied": false, …}` first, and that is the gap, not a fault.
3. Then the row:

   ```
   npx wrangler d1 execute pdf-iq-purchases-sandbox --remote --command "SELECT transaction_id, status, changed_at, last_event_id FROM purchases WHERE transaction_id = '<txn>';"
   ```

   `status` **revoked**, and `last_event_id` the **adjustment's** event id. If it still holds the
   `transaction.completed` id, the approved event has not arrived yet — wait, rather than debug.
4. Only then the device: `/api/entitlement` answers `pro:false` on its next check, and Pro clears. The app re-checks
   about once a day, so a walk forces the check rather than waiting for it.

**Walked end to end on 18 September 2026** (txn_01m2te5r5vs7pyrk5368ewv86j): refunded, approved four minutes later,
`ntf_01m2tes8b66s3cq5y14qp57k5b` answered `{"applied": true, "reason": "revoked"}` on first delivery.

## 4. Copy that must change in the same release

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

- **Completing a sandbox payment** (13 September 2026, uid measure-1789292745404, txn_01m2d2hercp5bhwww21rs529yw):
  the webhook recorded the purchase as granted to that uid. The first run of Paddle itself sending our price and
  custom_data end to end. New at payment, absent from the open phase in three runs: **r.stripe.com**
  (five requests to /b) and **www.gstatic.com** (five requests for /instantbuy/svg/transparent_square.svg).
  Also new: card-brand icons from buy.paddle.com (the production host, even in sandbox) and more Stripe
  scripts. No new cookie names: still m on m.stripe.com (until 2027-10-18) and __cf_bm on .paddle.com. The
  footer counter stayed at 3 third-party requests. ProfitWell requested: no, as expected in sandbox.

- **The two-origin checkout on Preview** (3d796a5, 13 September 2026): the stored sign-in was readable by no frame
  outside the site: not the checkout origin, Paddle's or Stripe's. The checkout origin stores nothing and
  received one message, keys email, type and uid. **One consequence of nesting:** Paddle's checkout frame has a
  report-only frame-ancestors policy naming only its default payment link's origin, so the site above it is a
  violation, and the browser posts a report about our page to Paddle's Sentry
  (o522631.ingest.sentry.io/api/5637177/security/). The footer counter counts that as a third-party request but
  shows 0 bytes sent, because it cannot see bodies the browser posts itself. Approving the site's domain in
  Paddle should remove the violation, and with it the report. Measure again after approving, before the
  /privacy wording names or omits it.

- **Approval does not remove the Sentry report** (re-measured 13 September 2026 after both Preview hosts were
  approved). Paddle's report-only frame-ancestors still names only the checkout origin, so the site above it is still a
  violation. The report's URL fields name only Paddle's frame (document-uri and blocked-uri are
  sandbox-buy.paddle.com), and its referrer field is not a URL. /privacy names the report as a result.
