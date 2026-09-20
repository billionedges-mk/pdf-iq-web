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
tax inclusive, balance currency USD, product `pro_01m2bs6r5twekf0y2a722stgmh`, price
`pri_01m2bsgrhqggk3rmrzvefhcgb9`, and — 20 September 2026 — the **notification destination**
`https://pdf-iq.com/api/paddle/webhook`, Active, carrying exactly `transaction.completed`, `adjustment.created`
and `adjustment.updated`. It did not exist before that: a real purchase would have reached nothing, and the row the
entitlement reads is written by that delivery and by nothing else. The **default payment link** is
`https://checkout.pdf-iq.com/` (changed from `https://pdf-iq.com/pro/` the same day — Paddle's generated links need
a page that can take a payment on its own; /pro/ cannot).

**Domain approval is NOT done, and is a gate rather than a step — see "The approval gate" below.** pdf-iq.com is
approved; **checkout.pdf-iq.com is PENDING**, and the sale cannot open while it is.

**0. The code change, first, because the variables alone cannot work.** Without it, setting `PDFIQ_SALE` and
`PDFIQ_PRO` on Production makes the **build fail**: the result is a site that does not deploy, not a site that sells.

**Written ahead of the day and waiting on branch `sale-step-0`** (20 September 2026), so the day is spent reviewing a
change rather than writing one. Two things it turned up that this section had wrong:

- **There are three refusals, not two.** The third lives in tools/build.mjs, not paddle-config.mjs, and refuses
  `PDFIQ_PRO` on a production build. It was missing from this list for the ordinary reason: the list was written from
  the file somebody was looking at. Setting the variables against the old text would have failed the deploy after the
  variables were already set.
- **None of §4's copy belongs in step 0.** Every "not on sale yet" sentence is already inside a `<!--NOSALE-->` /
  `<!--SALE-->` block and changes with the flag, on /pro/, /app/, /terms, /support, /privacy and the homepage panel —
  that was built on 17 September and this section was not updated. What is left is /privacy's checkout section, whose
  italic line says the live checkout has not been measured yet: that is **step 1's** output, not step 0's, and cannot
  be written before the measurement. The Android sentences wait for vc18 (§4).

**Each refusal is narrowed, not deleted.** Deleting a guard leaves nothing where a reason used to be:

1. `PDFIQ_SALE` on a production build → **a production sale build that is INCOMPLETE**. Off production, a missing
   checkout origin, entitlement key, token, price id or site origin still warns and leaves /pro/buy/ out, which is
   right where every preview branch shares one set of variables. On production that silence would publish a site
   naming $14.99 with nothing behind the button, so it refuses to build.
2. `PDFIQ_PRO` on a production build → **`PDFIQ_PRO` on production WITHOUT `PDFIQ_SALE`**. This one matters more
   than it looks: without the sale flag, Pro belongs to whoever signs in (`src/pro/gate.ts`, `proAccount()`:
   `if (!__PDFIQ_SALE__) return session;` — no entitlement is consulted, because in a preview there is nothing to
   have bought), and the locked panels say "Sign in to use it in this preview build". On pdf-iq.com that is Pro given
   away to any Google account. **So the two flags go on in one deploy — see step 5.**
3. The `live_` token guard is **not touched**. A live token in any build that is not production still refuses, and
   must keep refusing.

**What the commit does not do: it does not turn the sale on.** The flags do that. Merged with no variables set, the
site builds byte-for-byte what it builds today — checked by hashing the whole of `dist/` before and after.

**1. Google Cloud first — it propagates for up to a few hours.** OAuth client
`340733500005-e6guq4vuc37drr1sor6uvqcop4kplpdo`: add redirect URI `https://pdf-iq.com/pro/buy/`, confirm
`https://pdf-iq.com/account/` is there. Firebase → Authentication → Authorised domains: confirm `pdf-iq.com`.

**2. Paddle live account.**
- 2.1 Client-side token: one exists (`live_4de37e2d…`, never used). Reuse or recreate — it belongs **only** in the
  pdf-iq-checkout project (step 4). The site never uses it (tools/paddle-config.mjs validates a token if one is present
  and otherwise does not want one), so putting it on pdf-iq-web leaves a live credential where nothing reads it.
- 2.2 Default payment link: **`https://checkout.pdf-iq.com/`** (settled, owner 18 September 2026).

  **Why, so nobody corrects it back:** the default payment link is for links **Paddle** generates — a "complete your
  payment" email, an invoice — and those want a page that can take a payment on its own. `checkout.pdf-iq.com` is that
  page: it runs Paddle.js and needs nothing from us first. `/pro/buy/` cannot: it needs a signed-in account and the
  checkout origin, so a buyer arriving from Paddle's own email would start the purchase again, at the moment they had
  already decided to pay. Our purchase flow and Paddle's generated links want different pages, and this setting is
  Paddle's, not ours.
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

**Set `PDFIQ_PRO` and `PDFIQ_SALE` in the SAME deploy.** Not PRO first and SALE afterwards: in between, Pro
belongs to anyone who signs in on pdf-iq.com (step 0, refusal 2). Since `sale-step-0` a build in that state refuses
rather than publishing, so the mistake costs a failed deploy instead of an unknown number of free accounts — but the
order is the point, and the refusal is only the backstop.

**And look at the Pro pages before any money moves.** `PDFIQ_PRO=1` publishes them on pdf-iq.com for the first time:
/batch/, /password/ and /account/ become public, and the phone Tools sheet grows from seven rows to nine. They have been
walked only on the Preview, by us. Open each one at desktop and at 375px wide, signed out, and check: the pages render,
the Tools sheet lists nine and scrolls to Password, /account/ offers Sign in, and the nav's Pro group is there. That is
the sale working, not a mistake — but it is the first time a stranger could arrive on them, and it costs five minutes
here against an unknown number afterwards.

**6. One real purchase, by the owner.** The only way to check what sandbox cannot: the production price table (§3), the
statement descriptor (sandbox said `PADDLE.NET* BILLIONEDG`), what the receipt email actually contains, and the
production entitlement path end to end with the released app. Then refund it: the whole $14.99 back including tax, Pro
clearing on web and app. **Remember the gap** — requested → approved is a delay Paddle owns, and the row staying granted
in between is correct ("Walking a refund", below).

**7. Only then** announce, and apply for Play production access.

**Switching the sale on and announcing it are not the same day.** Steps 0–6 put Pro on sale on pdf-iq.com; step 7 tells
people. Nothing forces them together, and separating them is what closes the four measurements that need a real charge
(§1) in the configuration that will actually serve customers, without inventing a test environment to do it in (owner,
20 September 2026: "the calendar gap is the only change, and it costs nothing"). Sell quietly, measure, then announce.

**What that window looks like to a buyer**, because it is a real consequence and not a detail. Pro is live on the
website while the app release that honours a purchase is still in Play review:

- The website gives them Pro immediately. The app they have does not, and **the pages say so** — "it covers Pro in the
  web tools on this site. It does not unlock anything in the Android app" is exactly true for the length of this
  window. That wording was chosen to under-promise (§4), and this is the situation it under-promises for.
- When the app release goes live and they update, their next entitlement check turns Pro on there too, and the pages
  flip in the same commit (§4). Nobody who bought in the window is worse off than someone who buys after it: they get
  more than they were told, later.
- If Play **rejects** the release, the window simply continues. There is no wrong sentence on the site while it does,
  which is the property that makes selling first safe.
- The one thing to watch is a support question in the shape "I paid and the app still says free". The answer is on
  /refunds and /terms already; it stops being the answer the day the flip lands, so do not paste it into a canned reply.

**The device walk during the window needs a Play-delivered build, not a sideloaded one.** The entitlement check itself
does not care how the APK arrived — it verifies a signed token against an embedded public key — but **Google Sign-In
does**, and Pro cannot be owned without signing in. A locally-signed release may fail sign-in if only the Play App
Signing certificate is registered against the OAuth client. Use the internal testing track: it delivers a Play-signed
build in minutes without waiting for full review, and that artefact is the one people will have. If the sideloaded
build signs in, it is fine too — but check sign-in FIRST, before concluding anything from a failed entitlement walk.

**Must not happen:** reusing the sandbox D1 for production; `PDFIQ_SALE` before **checkout.pdf-iq.com is approved
on the live account** (pending as of 20 September 2026 — "The approval gate" below) or before the live notification
destination exists (created 20 September 2026); touching sandbox; re-running `entitlement:keys` for production; a `live_` token anywhere but the checkout
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

## The approval gate: checkout.pdf-iq.com (opened 20 September 2026)

**Nothing below step 5 may set `PDFIQ_SALE` until Paddle has approved checkout.pdf-iq.com on the LIVE account.** If
it is still pending when the sale opens, Paddle.js refuses to open its checkout on an unapproved domain: the site
names a price, the button is there, and pressing it does nothing. That is the dead-control defect with a price tag
(CLAIMS 14), on the one page where someone has decided to pay.

**Why this was not on the checklist until now:** the sandbox account approved both domains instantly, which taught us
that approval was a formality. The live account reviews for real. Same shape as the price table (CLAIMS 56) — sandbox
is a different world, not a smaller one — and the second time in one week that a sandbox behaviour was read as the
system's behaviour.

### Before the approval can succeed at all: the domain has to exist — **done, 20 September 2026**

When the approval was first submitted, `checkout.pdf-iq.com` was **NXDOMAIN**: no DNS record at all, so the
reviewer reached nothing — not a blank page, no page. Paddle's own form accepted the address, the build had no
opinion, and no check on this site could have one: a payment link pointing at a domain that does not exist is invisible
to everything except a lookup. It would have surfaced on launch day as "the checkout doesn't open".

The domain was then attached to the pdf-iq-checkout Pages project and now answers:

| Address | Answers |
|---|---|
| `checkout.pdf-iq.com` | **200**, HTTPS with a valid certificate, **byte-identical** to the production deployment below |
| DNS (1.1.1.1, 8.8.8.8, Google DoH) | `A 104.21.61.184`, `A 172.67.212.199`, plus AAAA — Cloudflare flattens the CNAME at the edge, so no CNAME is published |
| `pdf-iq-checkout.pages.dev` (the project's production deployment) | 200, the standalone statement, all three links |
| `pro-sale.pdf-iq-checkout.pages.dev` (Preview) | 200, the same statement |

**Resubmit the approval rather than waiting on it.** A reviewer who reached nothing has nothing to approve, so the
pending request is most likely already decided against; resubmitting is the same action either way.

**A note on the instrument, because it lied in both directions.** The lookup that found the missing domain is the
same one that then reported it still missing after it existed: this machine's resolver held a negative cache for the
**A** record while returning AAAA normally, so `nslookup` said "Non-existent domain" and `fetch` said ENOTFOUND
while every public resolver answered. Query a public resolver (`nslookup name 1.1.1.1`) or pin the address
(`curl --resolve host:443:<ip>`) before believing a negative, and flush before believing it twice. A cached NO and a
real NO are the same sentence.

### What the reviewer will see once it resolves

The statement is **already on the production deployment**, not only on Preview — checked by fetching
`pdf-iq-checkout.pages.dev` directly:

> pdf-iq checkout — This address runs Paddle's checkout for Pro, bought on **pdf-iq**. It keeps nothing and does
> nothing on its own. **Terms · Privacy · Refunds**

with the links resolving to `https://pdf-iq.com/terms/`, `https://pdf-iq.com/privacy/#checkout` and
`https://pdf-iq.com/refunds/`, and with **no Paddle script and no token in the page** — the standalone view is
static, and the checkout only loads when the site opens it with a transaction. That is what the approval needs, and
it is live.

**`/privacy/#checkout` is left as it is** (owner, 20 September 2026). The section only exists in a sale build —
verify-sale-build asserts its absence in every other — so today the link lands on /privacy and the unknown fragment is
ignored rather than broken. It is not a gap to close now: **confirm it after the sale build ships**, as part of step 5's
look at the Pro pages, that the link lands on the payment-data section rather than the top of the page.

## Why Preview never runs against live Paddle (asked and decided, 20 September 2026)

The question was a fair one: point Preview at the live client token, the live price id and a live notification
destination, do the real purchase and refund now, and let launch day be a merge plus the flags. The answer is no, and
the reasons are structural rather than cautious, so they are written down here to stop the idea being re-litigated by
someone in a hurry on the day.

**The build refuses it, three times, each by name** (tools/paddle-config.mjs):

1. A `live_` client token in any build that is not the production branch — *"A checkout here would take real money
   from whoever tests it."*
2. A token whose prefix disagrees with `PDFIQ_PADDLE_ENV`: sandbox takes `test_`, production takes `live_`.
3. `PDFIQ_SALE` on a production build before the sale is switched on in code (step 0).

Running Preview live means deleting the first guard and remembering to restore it — a setting that was correct before
an architectural change is a claim about the old architecture (CLAIMS 52), and this would be one deliberately.

**Cloudflare Preview variables are shared by every preview branch.** This is the point that looks like a small
exception and is not: there is no per-branch scope. A live token placed in Preview is live on every branch anyone
pushes, including one created later by someone who never read this document. The repo already says so, in
paddle-config.mjs's own header — *"every preview branch shares Cloudflare's Preview variables"* — and that sentence is
why builds that lack what they need leave the purchase out rather than failing.

**The D1 split is a binding, not a column, and that was the whole idea.** functions/purchases-schema.sql:
*"Preview binds a sandbox database and Production a live one, so a sandbox test purchase cannot exist in the table
production reads. Keeping them apart by binding makes that structural rather than a column someone has to remember to
filter on."* There is no environment column, so a live test purchase written to Preview's sandbox database is granted
where production never looks, and one written to the production database is a test row indistinguishable from a
customer's — reachable from a preview deployment of any branch. The design removed this choice on purpose.

**And the decisive one: the app cannot reach Preview.** The release build fixes `WEB_BASE_URL` to
`https://pdf-iq.com` at build time and *fails to build* unless `ENTITLEMENT_ENV` is `production` (app repo,
app/build.gradle.kts), and it rejects any token whose claims say otherwise as `wrong-environment`
(EntitlementToken.kt). So the production entitlement walk on a device — the item with the most to prove — cannot be
done against Preview with the artefact anyone will install. It would need a separate build pointed elsewhere, and
proving it on a build nobody has is not proving it.

**What Preview would not have improved anyway:** the statement descriptor and what a refund returns as tax are facts
about a real charge and a real Paddle account. They come out identical whichever origin hosted the checkout.

**The webhook destination**, for completeness: Paddle allows several, so it would work — but `pro-sale.pdf-iq-web.pages.dev`
is a branch alias that stops resolving when the branch is renamed or deleted, Paddle retries for three days and then
drops the event, and the destination must be repointed before the first real buyer or their grant lands in the wrong
database. That is a manual step on a busy day with nothing in the build able to check it.

**Instead:** steps 0–6 against production, earlier, and announce later (see "The day, in order", step 7).

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
   `scratchpad/pricecheck/index.html` is the sandbox version of exactly this, and
   `scratchpad/pricecheck-prod/index.html` is the production one — same ten places, token typed into the page rather
   than written into the file.

   **A local page is not blocked from asking** (measured 20 September 2026). Paddle's production PricePreview answered
   `forbidden` from `http://127.0.0.1:8811` with a deliberately fake `live_` token — but the known-good SANDBOX
   token answered normally from the same origin on a fresh page (Germany: total $14.99, subtotal $12.60, tax $2.39,
   matching the 17 September table). So the origin is not the gate; the token is, and the measurement is one paste
   away rather than something that has to wait for the day. **One confound worth knowing**: `Paddle.Initialize` does
   not take a second time in the same page. The first attempt at this control ran sandbox after production in one
   load, got `forbidden`, and looked like proof that local origins are refused. It was not — it was the same stale
   initialisation answering. Reload between environments.
3. If any total outside the US and Canada is not $14.99, the price is **not** tax-inclusive there and every page that
   names $14.99 is wrong: stop and change the copy before announcing.

**Run on 20 September 2026, and the answer was not the one this section expected.** Every row came back $14.99,
**including New York, Texas, California and Ontario** — production takes the sales tax out of the price where sandbox
added it on top (the full table is in TECH_DEBT.md). So the branch this section used to end on, "if the pattern holds
the sentence is correct as it stands", was the wrong branch: the pattern did not hold, in the safe direction, and the
sentence written from the sandbox table is false on production. The copy change is the owner's call; what is settled
is that the sandbox table must not be used to write it.

**Re-run this after the first real purchase** against the invoice rather than the preview. A price preview is Paddle
answering about its own configuration; the invoice is what was actually charged, and it is the only evidence that
outranks it.

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
- ~~/terms "Buying Pro", /support "Billing and Pro", /pro/, /app/, the homepage Pro card: "not on sale yet" becomes
  true-to-the-day wording.~~ **Already done, 17 September 2026**: every one of those sentences sits in a
  `<!--NOSALE-->` / `<!--SALE-->` block and changes with the flag, with no commit on the day. Verified by building
  both states. The entry is struck rather than removed because a checklist that quietly loses a line reads as a line
  nobody thought of.
- **The Android sentences and `PRO.coversToday`, in one commit.** These are not two changes: reverting `coversToday`
  to `covers` is what makes every exclusion sentence false, so they move together or the site contradicts itself for as
  long as the gap lasts (owner, 20 September 2026).

  **Unblocks when:** vc18 — the app release that honours a web purchase — is **live on Play**. Not when it is built,
  not when it is walked (owner, 18 September 2026: "doesn't unlock" errs toward under-promising, which is the safe
  side), and not when the sale merely opens: a buyer whose app has not updated still gets nothing there. Today's pages
  are true of vc16 and false the moment vc18 ships, which is why this cannot lag the release.

  `PRO.coversToday` retires in favour of `PRO.covers`; each trailing exclusion becomes "Signing in to the Android app
  with the same account unlocks it there too"; and **"buying happens on this website rather than inside the Android
  app" stays exactly as it is** — that is the Play constraint, not a temporary state, and deleting it along with the
  exclusions is the obvious way to get this wrong. Four retired-claims entries are deleted in the same commit, or the
  build refuses the new wording.

  **The inventory, re-run on 20 September 2026** by searching for the claim in every wording it has, never from a
  list: **14 places in 7 files** (16 strings — the generated panel and sheet each word it twice, one branch for
  selling and one for not). /pro/ ×4, /app/ ×3 — **one of which says "in this app", not "the Android app"** —
  /pro/buy/, /terms ×2, /refunds, the panel and the sheet (tools/pro-copy.mjs), and **the account screen's owned card
  (src/pro/account.ts)**. The account screen was in no earlier list: its copy is TypeScript and reaches a reader
  through a JS bundle, so a search of the pages cannot see it. That is the same failure as /app/ the time before, and
  the reason the count moved from 11 to 14 is that the list was the instrument rather than the search.

  **`npm run verify:purchase-scope` refuses a half-done flip**, so the list above is a convenience and not the
  safeguard. It builds free, Pro and selling, reads the HTML **and the bundles**, and holds the two sentences to each
  other: while the site says a purchase covers the web tools, every page naming the scope must also exclude the app;
  the moment it says "both", no file may still exclude it. Run against the revert with the sentences left alone, it
  names all fourteen files including `assets/account-*.js`. In both states it asserts the Play constraint is still
  there, and that every mention of buying inside the app is one of the wordings it knows — a fifth phrasing fails
  loudly rather than passing unseen.

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
