# Switching the Pro sale on — the checklist

Turning the sale on is a code change plus two variables. This file is what that change must satisfy, in order, and
the build's refusals point here by name.

**Two rules, three call sites, and this file named both rules correctly before the change** — `tools/paddle-config.mjs`
refused `PDFIQ_SALE` on a production build (from `resolveSite` and from `resolveCheckout`, hence three), and
`tools/build.mjs` refused `PDFIQ_PRO` on one. Step 0 narrows each rather than removing it; what each becomes is under
step 0 below.

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
change rather than writing one. What it turned up:

- **Correction to an earlier version of this section, 20 September 2026.** It said the checklist had listed two
  refusals and missed a third in `tools/build.mjs`. That was wrong. This file's header named both rules, and the
  `PDFIQ_PRO` one by file and by its message. What actually happened: the change was written from
  `paddle-config.mjs` without re-reading the header above it, and the build then refused for a reason this document
  had already stated. The lesson survives but belongs to the person and not the checklist — **an inventory written
  from what is in view is not an inventory** — and the fix is the one this repo keeps reaching for: read the record,
  or search, rather than enumerate what is open. The wrong claim is left visible rather than quietly deleted, because
  a document that silently drops a wrong sentence teaches nobody why it was wrong.
- **None of §4's copy belongs in step 0.** Every "not on sale yet" sentence is already inside a `<!--NOSALE-->` /
  `<!--SALE-->` block and changes with the flag, on /pro/, /app/, /terms, /support, /privacy and the homepage panel —
  that was built on 17 September and this section was not updated. What is left is /privacy's checkout section, whose
  italic line says the live checkout has not been measured yet: that is **step 1's** output, not step 0's, and cannot
  be written before the measurement. The Android sentences wait for vc18 (§4).

**Each rule is narrowed, not deleted.** Deleting a guard leaves nothing where a reason used to be:

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
4. **`PDFIQ_SALE` must be the exact string `true`.** The Functions that grant Pro compare it that way and
   nothing else — `functions/api/entitlement.js` and `functions/api/paddle/webhook.js` both open with
   `if (env.PDFIQ_SALE !== 'true') return 404` — while the build accepted `1` and `on` as well. That pairing
   publishes a site that sells, with a purchase page, over an entitlement endpoint and a webhook that both answer
   "not found": money taken, Pro never granted, and the only record of it at Paddle. This file already said
   `PDFIQ_SALE=true`, which is why it was never hit; the build now refuses any other spelling by name rather than
   depending on the variable being typed the way the document spells it.
5. **Found by the refusal table rather than by thinking:** a production build must use
   `PDFIQ_PADDLE_ENV=production`. The old table had a row setting sandbox on branch `main` and expecting the blanket
   refusal; with that gone, the combination BUILT — a production site selling through Paddle's sandbox, taking no real
   money and signing entitlements with the sandbox key, which the released app rejects. It would have looked like a
   working sale until someone tried to pay. Nothing else on the site would have said so.

**What the commit does not do: it does not turn the sale on.** The flags do that. Merged with no variables set, the
site builds byte-for-byte what it builds today — checked by building the tree with the change and without it **at the
same commit** (`git stash`) and hashing the whole of `dist/`: identical.

**Do not compare across commits and expect the same number.** `__PDFIQ_BUILD__` is the commit id, it is bundled into
`net-*.js`, and that bundle's filename is a content hash — so every page's `<script src>` changes with every commit
and nothing else does. With the id scrubbed, that one filename is the only difference between this branch's build and
its branch point. A reviewer hashing `dist/` on two commits would otherwise read a real difference where there is
none.

The four production variables that are not flags — `PURCHASES`, `PADDLE_WEBHOOK_SECRET`, `PDFIQ_PADDLE_PRICE_ID`,
`PDFIQ_PADDLE_ENV` — were measured the same way with `CF_PAGES_BRANCH=main` and no `PDFIQ_SALE`: identical output.
They are inert at build time, and at runtime both Functions answer 404 before reading any of them
(`if (env.PDFIQ_SALE !== 'true')`). Setting them early is therefore a walked state, not an unknown one.

**0b. Merge the release to `main` and deploy it, before any variable is touched.** Step 0's commit lives on
`pro-sale` with the rest of the sale — the purchase page, the entitlement client, the account screen. The flags are
set on the pdf-iq-web **Production** environment, which builds `main`, so until that merge lands, `main` still
contains the old refusals and setting the flags **fails the build**.

**This step was missing from the sequence until 20 September 2026**, and the way it would have failed is worth keeping:
the old refusal would have fired on launch day, correctly, saying "PDFIQ_SALE is set on a production build… the sale is
not switched on". Read at speed, with the variables already entered, that is "something is broken" rather than "you
skipped a step". **A refusal that does not say what was skipped is a gate that produces a guess** (owner).

So: merge, deploy, and run `npm run verify:live` **before** setting anything. Production is still not selling at that
point, and the check's not-selling branch asserts that no Pro code reaches any bundle — `pdfiq-pro:`, the Pro wording,
the sign-in hosts, none of them. **If that passes, the release is provably invisible**, which is the whole argument for
landing it separately rather than together with the flags: two changes, each with its own evidence, instead of one
change with a compound failure mode.

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
- Secret: `PADDLE_WEBHOOK_SECRET=pdl_ntfset_…`, and **`PDFIQ_FIREBASE_WEB_KEY`** — a blocker: without it /account/
  says signing in is not set up and makes no request, so nobody signs in and nobody buys. Restricted to Identity
  Toolkit and Token Service. **Since `sale-step-0` a production build that sells refuses without it** rather than
  warning, so this can no longer be the thing discovered by a buyer.

**Two of these are inert until the flags go on, and both were missing from the batch set on 20 September 2026**:
`PDFIQ_CHECKOUT_ORIGIN` on pdf-iq-web (without it a production sale build refuses — `resolveSite`) and
`PDFIQ_FIREBASE_WEB_KEY` (same, now). Neither does anything while `PDFIQ_SALE` is unset, so both can go in early with
the rest; what they must not do is wait until the flip, when their absence is a failed deploy in the middle of the
sequence.
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
/api/entitlement answers 401 unauthenticated; `npm run verify:live` passes.

**`verify:live` follows the site's state since 20 September 2026** (branch `live-state-aware`). It asked /pro/buy/ and
/api/entitlement which state production is in, and asserts the matching set: before the sale, no Pro code anywhere, as
before; after it, Pro code expected and the things that would mean the wrong build reached production forbidden — the
preview banner, the local Pro stub, Paddle's sandbox hosts, a `test_` token, Paddle.js on this origin. It also checks
what it never read before: robots.txt and the sitemap.

**Dry-run the selling half before the flip**, against the Preview, so its first run is not on the day:

```
node tools/verify-live.mjs --site https://pro-sale.pdf-iq-web.pages.dev --no-wait
```

48 assertions pass there today. Run it again after any change to the check itself. Then §1's measurement, which sandbox cannot
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

**What is still open after 24 September 2026, and all four ride on one clean repurchase** — signed in BEFORE pressing
Pay, so the sign-in cannot be confused with the checkout:

1. **Is Paddle's one-page email field editable?** The page sends `customer: { email }` from the Google sign-in and
   the buyer types nothing. This decides /refunds' wording, which currently says "write from the address you bought
   with" — an instruction nobody can follow if they signed in with one account and write from another (CLAIMS 63).
2. **The receipt's contents and where its buyer-portal link goes.** The first purchase's receipt went to the
   measurement address, which does not exist, so this is still untested after a completed purchase.
3. **The page state after Pay**, `ready → confirming → owned`, and how long from payment to "Pro is yours". The
   confirm loop says "not reached us yet" after **90 seconds**; production's webhook latency against that threshold
   has never been measured. The first run ended at `undefined`, which by the code only a document replacement can
   produce — the mid-payment sign-in redirect explains it, and this run falsifies or confirms that.
4. **Where the refunded tax comes from.** The buyer should receive the whole $14.99 including the $2.29. Whether our
   balance moves by $12.70 or by $14.99 is the difference between "Paddle returns the tax" and "we do", and /refunds
   promises the amount without saying which.

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

## 1. The measurement that cannot be run until the day itself — **ANSWERED 24 September 2026: no**

**ProfitWell / Retain was not requested.** Measured on the live checkout, on production, with the live token, during a
real payment: `profitwellSeen: false`. Both defences held. This is the one question sandbox structurally could not
answer, and it is now closed.

**How it was measured is its own warning, recorded in full under "The measurement that charged a real card" below.**
The run was `measure:paddle` pointed at production, and the tool plants a fake sign-in so the page offers its Pay
button. It re-plants on every document load, so it overwrote the real sign-in mid-payment: a real card was charged and
Pro was granted to an address that does not exist. The tool now refuses production outright and never writes over an
existing session (`tools/measure-paddle.mjs`). **The measurement is valid; the method is forbidden.**

**What that run could NOT attribute, and /privacy still waits on.** The sign-in happened during the payment, so the
hosts and cookies it saw cannot be split between Google sign-in and Google Pay inside Paddle's frame —
`pay.google.com`, `play.google.com`, and the `NID`, `__Host-GAPS` and `OTZ` cookies on Google's domains. Writing
those into /privacy from this run would repeat the sandbox table's error: a faithful measurement of the wrong thing.
The clean repurchase, signed in before Pay, separates them.

Clean from the same run, and safe to use: `__cf_bm` on .paddle.com ~30 minutes, `m` on m.stripe.com to October 2027,
`vault.paddle.com`, `api.stripe.com`, `merchant-ui-api.stripe.com`, `checkout-analytics.paddle.com`, the footer
counter reading 0 / 2 / 1 by phase, and one report-only CSP report from buy.paddle.com naming Paddle's own frame, as
sandbox showed.

## 1a. The original plan, kept for the reasoning

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

## The measurement that charged a real card (24 September 2026)

The live-checkout measurement in §1 was made by running `npm run measure:paddle -- --url https://pdf-iq.com/pro/buy/`.
It produced the right answer and should never have been possible.

That tool plants a fake session in the page's storage so /pro/buy/ offers its Pay button, because Preview has no
sign-in configured. The planting is a `Page.addScriptToEvaluateOnNewDocument`, so it re-runs on **every document
load**. On production the buyer signed in with Google during the payment, the page navigated, and the fake session
overwrote the real one. The checkout carried the fake uid and email in `custom_data`; a real card was charged; and
production's purchases table recorded Pro as granted to `pdfiq-sandbox-measure@example.com`. **The person who paid
did not own what he paid for.**

The trace shows the sequence rather than inferring it: at *arrival*, `local=[pdfiq.session]` on pdf-iq.com before any
sign-in; at *pay*, `accounts.google.com`, `securetoken.googleapis.com` and `pdfiq.signin` in session storage.

**Fixed the same day, with two independent refusals** (`tools/measure-paddle.mjs`): the tool refuses any production
origin outright — pdf-iq.com, www, and checkout.pdf-iq.com — and the planting refuses to overwrite a session that
already exists, so even off production it cannot change who is using the page. Deliberately no override flag: a flag
is what someone passes to make an error message go away, and this measurement is worth less than one wrong charge.

**It cost, and it also paid.** The charge was refunded the same hour and the row revoked correctly, which proved the
whole revocation path on production. The invoice closed §3. But receipt delivery is still untested, because the
receipt went to an address that does not exist — see the open items under step 7.

**The shape, for the next tool.** This is the checkout-origin guard again: a tool behaving correctly for the
environment it was written for, in an environment nobody had pointed it at. Before running any tool against
production, the question is not "will it work here" but "what does it write, and to whom".

## Which project reads which variable

Derived from the code on 23 September 2026, not remembered — two people had the same variable in different places and
both were partly right. `tools/paddle-config.mjs` is shared, but the two builds call different halves of it:
`tools/build.mjs` (pdf-iq-web) calls `resolveSite()`; `tools/build-checkout.mjs` (pdf-iq-checkout) sets
`PDFIQ_CHECKOUT_BUILD` and calls `resolveCheckout()`.

| Variable | pdf-iq-web | pdf-iq-checkout |
|---|---|---|
| `PDFIQ_SALE` | build **and** all three Functions | build |
| `PDFIQ_PADDLE_ENV` | build, and `/api/entitlement` at runtime | build |
| `PDFIQ_CHECKOUT_ORIGIN` | build — the origin /pro/buy/ frames | build — only for the same-origin refusal |
| `PDFIQ_PADDLE_CLIENT_TOKEN` | **validated and then discarded — nothing uses it** | **build — this is what opens a checkout** |
| `PDFIQ_PADDLE_PRICE_ID` | **`/api/paddle/webhook` at runtime** — not the build | build |
| `PDFIQ_SITE_ORIGIN` | nothing reads it — and setting it is now meaningful, see below | build — who may frame the checkout |
| `PURCHASES`, `PADDLE_WEBHOOK_SECRET`, `PDFIQ_ENTITLEMENT_PRIVATE_KEY` | Functions only | nothing |
| `PDFIQ_FIREBASE_WEB_KEY` | build | nothing |

**A variable can be dead to the build and live to the deployment, and those are different questions** (owner,
23 September 2026). Both of the day's confusions were this:

- `PDFIQ_PADDLE_CLIENT_TOKEN` on pdf-iq-web is read by `checkToken()`, validated, and the return thrown away — the
  site never holds a payment credential, which is the point of the two-origin split. Building the Preview shape with
  and without it gives a **byte-identical `dist/`**, and /pro/buy/ builds either way. It came off pdf-iq-web Preview
  on 23 September. It was not inert while it sat there: a `live_` value, or a prefix disagreeing with
  `PDFIQ_PADDLE_ENV`, makes the site build throw — a tripwire on a value nothing reads.
- `PDFIQ_PADDLE_PRICE_ID` on pdf-iq-web **stays**. The build ignores it — same experiment, identical `dist/` — but
  `functions/api/paddle/webhook.js` reads it at runtime to ignore transactions for any other price. Remove it and
  Preview's sandbox webhook answers 503.

"The build doesn't use it" and "nothing reads it" are not the same sentence. Ask which runtime.

## Both projects serve `functions/`, and only one of them should

Pages deploys the repo's `functions/` directory with **each** project, so pdf-iq-checkout serves `/api/entitlement`
and `/api/paddle/webhook` as well — which nobody reading that project would expect, because nothing in it mentions
them. Measured before the sale: the checkout Preview answered **503** on the first and **405** on the second, both
already past the `PDFIQ_SALE` gate.

With `PDFIQ_SALE=true` on the checkout project's Production, `checkout.pdf-iq.com/api/paddle/webhook` would have
become a second live webhook: it accepts a POST and writes nowhere, because that project has no `PURCHASES` binding
and no signing secret. Nothing points at it — the risk is the obvious future mistake, someone repointing Paddle at
"checkout.pdf-iq.com" because that is what the checkout is called.

**Closed on 23 September 2026** (`server/origin.js`): both Functions answer 404 — the same 404 as the not-selling
refusal, so the two are one answer from outside — when `PDFIQ_SITE_ORIGIN` names an origin that is not the one
answering. That variable is set on the checkout project and nowhere else, so the signal already existed. It is written
as a **comparison** rather than "the variable is present" deliberately: presence alone would silently 404 the real
webhook if the variable were ever set on pdf-iq-web by mistake, which is a worse failure than the one being fixed.
Measured without the guard, the checkout origin's webhook answered **200**.

## 2. Credentials and configuration, Production environment only

**Two Cloudflare Pages projects.** pdf-iq-web is the site; pdf-iq-checkout is the checkout origin, the only
place Paddle.js runs (CLAIMS 38). Each has its own Production variables.

- pdf-iq-checkout: the custom domain `checkout.pdf-iq.com`; `PDFIQ_SALE=true` (the exact string — the build
  refuses any other spelling, and the site's Functions answer 404 to one), `PDFIQ_PADDLE_ENV=production`,
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

## 3. The price, against the production price id — **CLOSED 24 September 2026, on the invoice**

The production price table was measured on 20 September with Paddle's price preview, and **confirmed on 24 September
by a real invoice**: India, 18% — subtotal **$12.70**, tax **$2.29**, total **$14.99**. Exactly what the preview said.
Paddle's fee was $1.25 and the tax withheld $2.29, so the net was $11.45; invoice 48239-10001.

A preview is Paddle answering about its own configuration. The invoice is what was charged, and it outranks it. So
every page that says **"$14.99 is the total. Any VAT, GST or sales tax is already included in it, not added at the
checkout"** is correct, measured against the thing a buyer receives.

## 3a. How the table was produced, kept for the method

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

## The revocation path, proven on production with a real charge (24 September 2026)

`txn_01m3a5ws3rp5v75nk9qey9zjgj`, a real card:

| | |
|---|---|
| 17:04:30 | `transaction.completed` → row written, `granted` |
| 17:22 | full refund requested at Paddle |
| 17:22 – 17:25 | row still `granted`, `changed_at` unchanged — **the approval gap, exactly as documented** |
| 17:25:17 | `adjustment.updated` applied → `revoked`, `last_event_id evt_01m3a76fzeenwe901506grsw4t` |

About three minutes, against roughly four in sandbox. Two things this proves that nothing else could:

- **The webhook applied the adjustment event, not the transaction.completed one** — the items-level rule
  (`server/paddle.js`, written from a real sandbox payload after a partial/full mismatch cost a launch blocker)
  worked first time on a real charge.
- **The gap reads as a failure and is not.** Between request and approval the row is correctly still granted. Anyone
  watching D1 in that window sees a refund that "did nothing".

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

- **The Android line on the purchase confirmation.** `/pro/buy/`'s `paid` card and `/account/`'s owned card gain one
  sentence telling a buyer the app now honours what they just bought, and where to get it:

  > **On Android:** install pdf-iq from Google Play and sign in with the same Google account. Pro is there too —
  > nothing to enter, and nothing more to pay.

  A plain text link, not a store badge: that is how the rest of the site links out, and it sidesteps the badge
  question entirely. Two placements and no more — the confirmation is a moment, and `/account/` is where a buyer
  comes back to. Not /pro/'s owned card, not the tool panels: an install prompt on every Pro surface turns the site
  into an advert for the app. The Play-constraint sentence above stays exactly as it is.

  **Unblocks when:** the same moment as the sentences above — vc18 **live on Play** — because the link and the claim
  become true together. There is nothing to say before then: a purchase does not unlock the app, and there is no
  listing to link to.

  **Why it was nearly missed, which is the part worth keeping.** This entry did not exist until 25 September 2026,
  and the card it belongs on did not exist until the 24th. **An inventory built for removals cannot notice an
  addition**: every instrument here — the fourteen-place search, `verify:purchase-scope`, verify-retired — asks
  whether a sentence that IS somewhere should still be there. None of them can ask whether a sentence that is nowhere
  ought to exist. The agreement was made in the /app/ conversation and written down in neither record (CLAIMS 54).

- **Re-compare the app icon.** `public/app-icon.svg` is a redraw of the Android launcher icon
  (`app/src/main/res/drawable/ic_launcher_foreground.xml` and `ic_launcher_background.xml` in the app repo, copied
  25 September 2026). Two copies of one mark in two repositories drift. No build-time check is possible — Cloudflare
  has no sibling repo, and a check that silently skips is worse than none — so it is compared by eye against the
  built app on the day the icon becomes public.

  **Unblocks when:** the listing is live, which is the first moment the two are seen side by side by anyone else.

  **Two copies on this side, and the re-compare must read both.** The icon came off the /app/ hero and the homepage
  tile on 25 September — at 96px the amber gap is 4.6px and at 24px about one pixel, so it read as a stripe on a
  square rather than two masses pulled apart, and beside the site's own mark it read as the site's mark twice. What
  is left is:

  - `public/app-icon.svg` — **nothing on the site renders it.** It is the human-readable reference, and that is a
    new way for it to go stale: nobody will notice it is wrong, because nobody sees it. An unrendered file whose only
    reader is the check that reads it is the shape this document already distrusts.
  - `Bitmap.appIcon()` in `tools/png.mjs` — what actually draws, on /app/'s share card. It no longer holds
    constants of its own: `appIconGeometry()` in tools/og-images.mjs parses the crop, the corner radius and the two
    hypotenuses out of the SVG and hands them over, refusing to draw if the file is not the shape it reads. So the
    unrendered reference now has one reader that fails loudly, which is most of what made it dangerous.

  So the re-compare is three artefacts, not two: the app repo's XML, the SVG, and the rasteriser's numbers. If that
  is one too many, the way to collapse it is to derive the rasteriser's constants from the SVG — or to delete the SVG
  and let the rasteriser be the only copy, accepting that the comparable artefact is then a page of arithmetic.

  **Decided 25 September 2026, applied on the 26th: derive the rasteriser's constants from the SVG.** It keeps a comparable
  artefact — someone can open the SVG and see the mark — and turns three copies into two with a real dependency
  between them. Deleting the SVG instead would leave the only readable form of the mark as arithmetic in a build
  tool, which is worse to inherit (owner).

  **The condition fired the next morning.** The app side widened the cut — 3.43dp of perpendicular separation to
  6.85, doubled — and applying it by hand would have meant editing the same two numbers in two files on the same
  afternoon. That is what the deferral was waiting for. Measured after: the share card's amber chord is 27px at a
  200px mark against 26.9 predicted from the new paths.

  **What is left to compare on listing day is two artefacts, not three:** the app repo's XML and this site's
  `public/app-icon.svg`. Everything the site draws comes from the second.

  **And their finding, which outranks the widening.** No seam width makes the mark read as two masses pulled apart
  at web sizes — the masses bleed past the mask by design, so it is a dark square with an amber diagonal however
  wide the cut (app session, 26 September, recorded in their drawable). The icon therefore stays off the /app/ hero
  and off the homepage tile; a wider cut is not a reason to put it back.

  **`npm run verify:purchase-scope` refuses a half-done flip**, so the list above is a convenience and not the
  safeguard. It builds free, Pro and selling, reads the HTML **and the bundles**, and holds the two sentences to each
  other: while the site says a purchase covers the web tools, every page naming the scope must also exclude the app;
  the moment it says "both", no file may still exclude it. Run against the revert with the sentences left alone, it
  names all fourteen files including `assets/account-*.js`. In both states it asserts the Play constraint is still
  there, and that every mention of buying inside the app is one of the wordings it knows — a fifth phrasing fails
  loudly rather than passing unseen.

## Play production access was refused, 25 September 2026

"More testing required": testers not engaged during the closed test, and no updates showing feedback acted on.
Another 14 days of closed testing before reapplying, so **roughly 9 October at the earliest**.

**Nothing on the site changes.** Every Android sentence was written to under-promise — "it does not unlock anything
in the Android app" is true of vc16 and stays true for as long as this takes (owner, 18 September 2026). They now
hold for longer than anyone expected, which is what under-promising is for.

**What it moves is §4's unblock, and only in date.** "vc18 live on Play" was chosen over "vc18 is built" or "vc18 is
walked" because a buyer whose app has not updated gets nothing. A refusal that adds two weeks between built and
listed is precisely the gap that condition was written for, arrived at from a direction nobody predicted.

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
