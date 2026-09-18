# Switching the Pro sale on — the checklist

The sale is off in production, and a production build with `PDFIQ_SALE` set refuses by name
(`tools/paddle-config.mjs`). Turning it on is a code change. This file is what that change must
satisfy, in order. The refusal's error message points here.

**There are two refusals, not one.** `tools/paddle-config.mjs` refuses `PDFIQ_SALE` on a production build, and
`tools/build.mjs` refuses `PDFIQ_PRO` on one ("Pro and sign-in are preview-only until payment is live"). Lifting the
first alone leaves the build failing on the second. Both go in the same commit, with this file's conditions met first.

**The order is the safety property.** Everything exists before `PDFIQ_SALE` becomes true, and `PDFIQ_SALE` is the last
thing switched: with a purchase page live and no database, no schema or no notification destination, someone can pay and
never receive Pro, and the only record of it is Paddle's.

## The day, in order

The owner's plan of 18 September 2026, with what the code requires folded into it. **Sandbox is untouched throughout.**

**Already done on the live Paddle account:** verification, payout (ICICI, USD, $100 threshold), payment methods, sales
tax inclusive, balance currency USD, domain approval for **both** pdf-iq.com and checkout.pdf-iq.com, product
`pro_01m2bs6r5twekf0y2a722stgmh`, price `pri_01m2bsgrhqggk3rmrzvefhcgb9`.

**0. The code change, first, because the variables alone cannot work.** Both refusals are lifted in one commit (see
above), and the copy that must change goes in the same one (§4, and the sentences about the Android app once the app
release that honours a purchase is live on Play — under-promising is the safe side until then). Without this commit,
setting `PDFIQ_SALE` and `PDFIQ_PRO` on Production makes the **build fail**: the result is a site that does not deploy,
not a site that sells.

**1. Google Cloud first — it propagates for up to a few hours.** OAuth client
`340733500005-e6guq4vuc37drr1sor6uvqcop4kplpdo`: add redirect URI `https://pdf-iq.com/pro/buy/`, confirm
`https://pdf-iq.com/account/` is there. Firebase → Authentication → Authorised domains: confirm `pdf-iq.com`.

**2. Paddle live account.**
- 2.1 Client-side token: one exists (`live_4de37e2d…`, never used). Reuse or recreate — it belongs **only** in the
  pdf-iq-checkout project (step 4). The site never uses it (tools/paddle-config.mjs validates a token if one is present
  and otherwise does not want one), so putting it on pdf-iq-web leaves a live credential where nothing reads it.
- 2.2 Default payment link. **Open question, decide before the day:** this file has recorded since 13 September that it
  should be `https://checkout.pdf-iq.com/` — the page that actually runs Paddle.js and can complete a payment on its
  own. The owner's plan says `/pro/buy/`, which cannot complete a payment without the checkout origin and a signed-in
  account. Pick one deliberately.
- 2.3 **Notification destination — does not exist on live.** Webhook, `https://pdf-iq.com/api/paddle/webhook`, usage
  Both, exactly `transaction.completed`, `adjustment.created`, `adjustment.updated`. Keep the `pdl_ntfset_` secret for
  step 3. Without it a real purchase never reaches the database.

**3. Cloudflare → pdf-iq-web → Production only.** One variable per save: the dialog hangs on two.
- Text: `PDFIQ_SALE=true`, `PDFIQ_PRO=1`, `PDFIQ_PADDLE_ENV=production`,
  `PDFIQ_PADDLE_PRICE_ID=pri_01m2bsgrhqggk3rmrzvefhcgb9` (the webhook reads it at runtime to ignore anything else),
  `PDFIQ_CHECKOUT_ORIGIN=https://checkout.pdf-iq.com`.
- Secret: `PADDLE_WEBHOOK_SECRET=pdl_ntfset_…`, and **`PDFIQ_FIREBASE_WEB_KEY`** — missing from the owner's list and a
  blocker: without it /account/ says signing in is not set up and makes no request, so nobody signs in and nobody buys.
  Restricted to Identity Toolkit and Token Service.
- `PDFIQ_ENTITLEMENT_PRIVATE_KEY` is already set. Do not touch it, and never re-run `entitlement:keys` for production:
  it would invalidate every token already issued.
- **No client token here.**
- **Binding `PURCHASES` → a new production D1. It does not exist.** Create `pdf-iq-purchases`, Asia Pacific, read
  replication **Disabled**, bound to Production only. The sandbox database must never be reused: it holds test rows.
  Apply the schema and prove it, before any money moves:

  ```
  npx wrangler d1 execute pdf-iq-purchases --remote --file functions/purchases-schema.sql
  npx wrangler d1 execute pdf-iq-purchases --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
  ```

**4. Cloudflare → pdf-iq-checkout → Production.** A production deployment at `checkout.pdf-iq.com` with the custom
domain added, and its own variables: `PDFIQ_SALE=true`, `PDFIQ_PADDLE_ENV=production`, the `live_`
`PDFIQ_PADDLE_CLIENT_TOKEN`, `PDFIQ_PADDLE_PRICE_ID`, `PDFIQ_SITE_ORIGIN=https://pdf-iq.com`,
`PDFIQ_CHECKOUT_ORIGIN=https://checkout.pdf-iq.com`. The two origins must differ; the build refuses them equal.

**5. Deploy, then check.** /pro/ shows the price and a Buy button; /pro/buy/ loads; the webhook answers 401 unsigned;
/api/entitlement answers 401 unauthenticated; `npm run verify:live` passes. Then §1's measurement, which sandbox cannot
perform: `npm run measure:paddle -- --url https://pdf-iq.com/pro/buy/`, expecting **ProfitWell / Retain requested: no** —
stop if it is yes.

**Expect this too:** `PDFIQ_PRO=1` publishes the Pro pages on pdf-iq.com for the first time — /batch/, /password/ and
/account/ become public, and the phone Tools sheet grows from seven rows to nine. That is the sale, not a mistake, but it
is the first time those pages face the public and they deserve a look.

**6. One real purchase, by the owner.** The only way to check what sandbox cannot: the production price table (§3), the
statement descriptor (sandbox said `PADDLE.NET* BILLIONEDG`), what the receipt email actually contains, and the
production entitlement path end to end with the released app. Then refund it: the whole $14.99 back including tax, Pro
clearing on web and app. **Remember the gap** — requested → approved is a delay Paddle owns, and the row staying granted
in between is correct ("Walking a refund", below).

**7. Only then** announce, and apply for Play production access.

**Must not happen:** reusing the sandbox D1 for production; `PDFIQ_SALE` before the live notification destination
exists; touching sandbox; re-running `entitlement:keys` for production; a `live_` token anywhere but the checkout
project's Production.

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
- /refunds: the device sentence needs **no** change — it was written device-neutral on 18 September and already
  covers a phone that stays offline. Its other sentence, "a one-time unlock covering … it does not unlock anything in
  the Android app", does.
- /terms "Buying Pro", /support "Billing and Pro", /pro/, /app/, the homepage Pro card: "not on sale yet"
  becomes true-to-the-day wording.
- **The Android sentences, all of them, when the app release that honours a purchase is live on Play** — not when it is
  built and not when it is walked (owner, 18 September 2026: "doesn't unlock" errs toward under-promising, which is the
  safe side). It is **11 occurrences in 7 files**, found by searching for `proCoversToday` and "unlock anything in the
  Android app", never from a list: /pro/ ×4, /app/ ×3, /pro/buy/, /terms ×2, /refunds, and the generated panel and sheet
  in tools/pro-copy.mjs. `PRO.coversToday` retires in favour of `PRO.covers`; each trailing exclusion becomes "Signing in
  to the Android app with the same account unlocks it there too"; and **"buying happens on this website rather than
  inside the Android app" stays exactly as it is** — that is the Play constraint, not a temporary state. Four
  retired-claims entries are deleted in the same commit, or the build refuses the new wording.

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
