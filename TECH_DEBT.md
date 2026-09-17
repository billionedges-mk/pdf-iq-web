# Tech debt

Known, deliberate, and deferred. Each item says what is owed and what unblocks it.

---

## App-side domain migration — deferred until pdf-iq.com is live

The website now uses `pdf-iq.com` and `support@pdf-iq.com` throughout. **The Android app has
deliberately not been touched.** Its privacy policy URL is registered in Play Console and in the
Data Safety declaration, and repointing it at a domain that does not yet resolve would break a
live compliance link — which is the failure this project has spent its time avoiding.

The published policy at `billionedges.com/pdfiq/privacy.html` stays authoritative for the app
until every item below is done.

| # | Change | Where | Needs a build? |
|---|--------|-------|----------------|
| 1 | Privacy policy URL → `https://pdf-iq.com/privacy` | Play Console → App content | no |
| 2 | Data safety deletion URL → `https://pdf-iq.com/privacy` | Play Console → Data safety | no |
| 3 | Privacy and terms links → new domain | App Settings screen | **yes** |
| 4 | Support email → `support@pdf-iq.com` | App Settings / contact action | **yes** |
| 5 | ~~Redirect `billionedges.com/pdfiq/*` → `pdf-iq.com/*`~~ **Done**, per-file not wildcard | billionedges VPS nginx | no |

**Ordering.** Item 5 first, so the old URL keeps resolving before anything points away from it.
Then 1 and 2, which are console-only. Items 3 and 4 need an APK, so they ride with **1.1**
rather than justifying a release of their own.

**Precondition for all five:** `pdf-iq.com/privacy` returns 200 in a browser, not just in DNS.

### Also waiting on the app, unrelated to the domain

- ~~**`billionedges.com/pdfiq/privacy.html` is a stale duplicate.**~~ Closed. The redirect is live and
  verified single-hop: `/pdfiq/privacy.html` → `/privacy/`, `/pdfiq/terms.html` → `/terms/`, anything
  else under `/pdfiq` → the homepage, `billionedges.com/` untouched. Each ends 200 and the
  destination serves the corrected policy.

  **This closes the wrong-pricing exposure without an APK.** The app still links to the old
  billionedges URL in code, but that URL now resolves to the corrected page, so items 3 and 4 of the
  table above are no longer urgent — they can ride with 1.1 as planned rather than forcing a release.

  The wildcard in item 5 as originally specified would have 404'd the Play Console URL: the two
  sites do not share a URL shape. See CLAIMS.md check 20.
- **Data Safety re-check, with the app owner.** The declarations the pricing change touches:
  Financial info / Purchase history should now be *not collected*, because purchases happen on the
  website and outside the app; any Google Play billing or RevenueCat recipient should go; OCR adds
  nothing, being on-device with no new data type. Everything else is unchanged.


- **Controls that render and cannot act.** Two were found on the website (see CLAIMS.md
  check 14) and the same shape has now been seen three times on the app side: `onSubscribe`,
  "Try smaller", and these. Worth a sweep of the app for offers whose precondition is
  already computed nearby, and for click targets with no listener bound.


- **Locked PDFs.** On the app side a password-protected file used to disable the Compress button
  with no explanation. The website's handling — detect structurally, prompt, accept **either** the
  user or the owner password, refuse rather than emit something corrupt — should be carried across.
  The owner-password case matters specifically: the first real locked file tested here carried a
  correct owner password and the website rejected it, so any app-side implementation that checks
  only the user password has the same defect waiting in it.

---

## Unverified claims on the website

These are stated carefully on the site precisely because they are not yet measured. Each one is
worded so that it stays true if the measurement comes back badly.

- **File size ceiling — measured and set at 60 MB.** `MAX_BYTES` in `src/lib/ui.ts`, down from a
  200 MB placeholder. Two costs, and only one is a reason to refuse a file.

  **Time is linear in image count and is not the ceiling's job.** With every image recompressed,
  as the tool really does (Chrome 148, 8 cores, 16 GB):

  | file | images | work | of which recompress |
  |------|--------|------|---------------------|
  | 10 MB | 6 | 1.3s | 1.1s |
  | 20 MB | 13 | 11.4s | 11.1s |
  | 30 MB | 19 | 22.8s | 22.4s |
  | 40 MB | 25 | 29.7s | 29.1s |

  About 1.17s per image here, 98% of the runtime. That work reports progress and checks for
  cancellation once per image, so it is a visible, stoppable operation rather than a hang. And the
  per-image cost varies by roughly **23x** between the two devices measured — an iPhone at about
  50ms against this desktop's 1170ms. A single byte limit cannot express "will finish in reasonable
  time" across that spread.

  **Memory is what the ceiling is for**, because its failure mode is the one the interface cannot
  rescue. Heap runs at four to six times the file. Past roughly 85 MB the collector thrashes and
  `save()` — one uninterruptible call, no progress, no cancel — went from 4.2s to 163.3s for 6%
  more data: three minutes of a live tab answering nothing. A crash is near 800 MB, and an iPhone
  completed 400 MB, so measuring for death would have justified *raising* this to 600 MB.

  60 MB is 29% below the collapse, measured on one strong desktop.

  **Worth revisiting: file size is a poor proxy for cost.** A 60 MB file with four large images is
  trivial; a 20 MB file with 500 small ones is not. The image count is known immediately after
  `analyse()`, before any work starts, so a cost estimate is available at the point the file is
  accepted. Not built — the byte ceiling is the memory backstop and the progress bar handles the
  rest — but it is the honest axis.

  **Corrections on the record.** The comment originally justifying 200 MB cited a probe file and
  README figures, neither of which existed (CLAIMS.md check 15). And this probe's first figures
  capped recompression at six images regardless of file size, so the heaviest stage did not scale;
  every stage timing taken before that cap was removed understated the work, and four runs were
  diagnosed against it (CLAIMS.md check 16).

  **Outstanding:** no phone figure yet with the cap removed. The iPhone's earlier flat ladder was
  the cap, not the device — decoding works there, and works fast.
- **Encrypted PDFs — resolved, with two gaps.** A real locked file first proved detection and the
  pdf.js route wrong; both were fixed against a generated RC4 40-bit fixture. That fixture was the
  only one, and it was the one case the code got right. `npm run verify:crypto` now runs RC4
  40/128, AES-128 and AES-256 R6 against MuPDF-written files (`tools/fixtures/crypto/`, from the app
  repo) with every output read back by MuPDF and pypdf. Its first run found AES-128 output silently corrupt,
  AES-256 unusable — three defects — and TECH_DEBT 27 in the app repo's list: restricted files
  stripped of their limits. All fixed 11 September 2026; CLAIMS 30. **Gaps:** AES-256 **R5**
  (deprecated Adobe extension level 3) is implemented and has no fixture. ~~And the *kept-limits copy* PASSWORD_RULE.md allows — open
  password removed, limits kept — is not written here.~~ **Closed 12 September 2026:**
  `src/pro/encrypt.ts` writes AES-256 V5 R6, and the Pro password page writes the kept-limits copy;
  the free tools still refuse that case, because they write unencrypted copies. `verify:password`
  covers it, with every output read by MuPDF and pypdf.
- **Merge shows a password field that does nothing.** `merge.html` carries the shared password
  form, and a locked file there raises an error with `password: true`, but `merge.ts` passes no
  password to `openPdf` and binds no submit handler — the other five PDF tools each do. Typing a
  password and pressing Unlock does nothing: CLAIMS 14's dead-control class. Found while fixing
  TECH_DEBT 27, left for its own change: Merge's tray needs a decision on how a locked file joins.
- **Recovering the readable pages of a damaged PDF.** The damaged-file error used to render
  "Continue with the N readable pages". Nothing was ever bound to that button, so it did
  nothing at all; the offer has been withdrawn rather than left as a lie. Salvaging the
  readable pages is a real feature and a reasonable one — it is simply not built. If it is
  built, `ToolError.action` now requires the handler alongside the label.
- **Hopping an image straight to Images to PDF.** The wrong-format error carried
  `action: isImage ? undefined : undefined`, a dead ternary where this was stubbed and
  abandoned. The body copy already points the reader at Images to PDF, and `handoff.ts`
  could carry the file across, so this is small if it is wanted.
- **CMYK, JPEG 2000, JBIG2 and CCITT images.** `judge()` in `src/lib/pdf-inspect.ts` detects and
  skips these with specific reasons. The *logic* is tested; it has never been run against a real
  file of any of those kinds.
- **OCR on real documents.** Measured at 95% mean confidence on clean synthetic type only. The
  "faxes and photocopies: good" and "handwriting: not attempted" claims on `/ocr` are untested
  against real faxes, photocopies or handwriting.
- **OCR resolution.** Held at 300 dpi. 150 and 200 dpi scored identically on the synthetic
  fixture, which proves nothing about small print on a fax. Do not lower it on that evidence.

---

## Test coverage

- **OCR free/Pro split.** Free OCR now gives the reader the text: on screen to read and copy, and
  downloadable as `.txt`. The searchable PDF — those words written back into the file as an
  invisible layer — is the Pro output, and Pro is not on sale. There is no control for it on the
  free screen, only a statement of what it is, because a control that cannot act is this project's
  most repeated defect (CLAIMS.md check 14).

  `src/lib/textlayer.ts` is therefore unreachable from the UI, deliberately, and its header says so
  in detail. `src/entries/ocr.ts` keeps `writeLayer()` uncalled for the same reason: it is the
  finished call site, and rewriting it later against a library nothing had run in months is the
  failure being avoided. **The round-trip test in `tools-selftest.ts` is the whole safety net** —
  it drives `textlayer.ts` directly rather than through the page, so it survives the feature being
  behind Pro. Deleting it as "covering an unused feature" would leave the Pro path unverified with
  nothing to say so.

  A page that already carries a text layer is now **read rather than recognised** — instant, and
  the document's own characters instead of a guess at a picture of them. That case used to be an
  amber warning ("running OCR anyway will add a second layer"), which was correct when the output
  was a layer and backwards once the output became text.
- **OCR is not in the automated pass.** `e2e-selftest.ts` drives the other six tools end to
  end; OCR is excluded because a run needs a 6–11 MB language model fetch and roughly ten
  seconds, which would make every local test run slow enough that people stop running it. It
  has been verified by hand (8 pages, 9.9s, 1.2s a page, 95% mean confidence) but nothing
  guards it against regression.

  Three ways to make it feasible, cheapest first:
  1. **A separate slow suite, run on demand.** `npm run selftest:slow`, not part of the default
     pass, run before a release rather than on every change. Least work, and it keeps the fast
     suite fast — the property that makes people actually run it.
  2. **Warm the model cache once.** tesseract.js caches the model in IndexedDB, so the fetch
     costs ten seconds on the first run of a browser profile and nothing afterwards. A suite
     that tolerates one slow first run is close to free thereafter, but it is fragile on CI,
     where the profile is fresh every time.
  3. **A smaller language.** The `tessdata_fast` variants are roughly 2 MB against 10 MB. That
     changes what is being tested, though — accuracy is the thing OCR is judged on, and testing
     a model we do not ship proves less than it appears to.

  Preference is (1) with (2) as a side effect. Do not do (3) without also measuring accuracy
  against the model that actually ships.

- **Safari on iPhone — walked and passed.** Four checks run on a real device: HEIC straight from
  the camera roll, Compress producing a genuine before/after, the footer readout clean, and Save
  opening the share sheet. Save was the one that would have made every tool useless on iPhone, and
  it works. The memory probe has since run there too, confirming `createImageBitmap` decodes our
  images fast (about 50ms each against this desktop's 1170ms).

  Still unrun: **desktop Safari and Firefox.** Lower risk than iOS was, and iOS was the one that
  mattered.

- **`/for-professionals` is a demand test, not a product.** $99 per user per year, nothing purchasable,
  and the button records an email and a free-text profession to a Cloudflare D1 table through a
  same-origin Pages Function. Of the four things the page describes, **redaction that removes rather
  than covers is not built and is the expensive one** — the page says so in those words rather than
  promising it and costing it later. Self-hosting, Bates numbering and seats-on-one-invoice are the
  other three; self-hosting is nearly free because the site is already static and proven working with
  its server off.

  Same-origin is not a preference: the CSP is `connect-src 'self'`, so a hosted form service is
  blocked by the browser, and using one would put a third party in the path of the only thing that
  ever leaves a visitor's device. No Turnstile for the same reason — it loads a third-party script on
  the one page where the footer readout matters most. Abuse is a honeypot, length caps and a unique
  index, with edge rate limiting left to a WAF rule.

  **The IP is deliberately not stored.** Cloudflare hands it to the Function on every request and the
  schema has no column for it; `tools/verify-interest.mjs` asserts both. `/privacy` describes the
  table in the same three terms, scoped explicitly to the website, because that page is the app's
  registered Play policy and an unscoped "we collect email addresses" would be out of step with the
  Data Safety declaration.

## Website operational

- **Share images carry no text.** The 1200x630 images are drawn straight to PNG by
  `tools/png.mjs`, a small encoder written for the purpose, because rasterising SVG in Node
  needs a native dependency and both the licence gate and the README's "27 packages, zero
  copyleft" argue against adding one for a decorative asset. Rasterising through the browser
  was tried and abandoned: the images come back at 53-85 KB each and the only route to disk
  is a tool result. A font rasteriser is the part that genuinely needs a library, so the
  images are the brand seam and the tool's own mark, and og:title and og:description carry
  the words. Five non-tool routes share the same wordless card. If a text renderer is ever
  worth a dependency, `tools/og-images.mjs` is where it goes.


- ~~**Cloudflare log retention.**~~ Closed. Observability is a separate Cloudflare product and is
  not enabled on this project, so nothing retains request logs. The privacy page's wording stands
  as written — there is no retention period to state because there is no retention.
- ~~**`support@pdf-iq.com` must exist.**~~ Closed. Created before the nameserver move and tested in
  both directions afterwards — which is also how the MX carry-across was confirmed, the one step in
  the DNS sequence that fails silently.
- **`/app` store buttons are inert placeholders**, clearly labelled, because the app has no public
  Play listing yet. Replace with the real link when it is published.
- **Language models are committed to the repo** (~49 MB across six files). The alternative — a
  build-time fetch — makes the build depend on a third-party CDN staying up, which is a worse
  failure mode for a site whose whole argument is self-containment. Revisit only if repo size
  becomes a problem.

---

## Deliberate non-goals

Recorded so they are not repeatedly rediscovered as gaps.

- **No HEIC decoder.** Only Safari decodes HEIC. Shipping one costs megabytes on a page whose
  argument is that it loads fast. Detected by magic bytes and named specifically instead.
- **No Ghostscript / MuPDF / CoherentPDF.** All AGPL-3.0. WebAssembly is *conveyed* to the
  visitor's browser, which would put the whole site under source-disclosure obligations.
  `npm run licenses` fails the build if anything copyleft enters the tree.
- **No analytics on the website.** Not "anonymised analytics" — none. It is the only way the
  zero-requests readout can be honest.

## Web sign-in (Pro preview): what only a real preview can prove

`npm run verify:auth` covers what Node can show. Three things it cannot, all to be checked on the
preview deployment before Pro ships, and each stated as unverified until then:

- **The same account on both surfaces.** /privacy says a web sign-in reaches the same account as the
  Android app. That follows from the design — the same OAuth web client, the same Firebase project —
  and has not been observed. Check: sign in on the preview and in the app with one Google account and
  compare the Firebase uid (`localId` on the web, `FirebaseAuth.currentUser.uid` in the app).
- **Cloudflare honouring the account page's CSP.** `/account/*` detaches the site-wide policy
  (`! Content-Security-Policy`) and sets one that adds the two Google hosts to connect-src. Two CSP
  headers intersect rather than widen, so if the detach is not honoured, sign-in fails with the
  `unknown` kind ("the request did not reach Google"). Check the response headers on the preview.
- **The named App Check error.** App Check on Firebase Auth is monitoring, not enforced. The
  `app-check` kind matches any error that mentions App Check, because the real response to enforcement
  has never been seen. If it is ever enforced, confirm the wording that comes back is caught.

## Closed: the searchable layer's font is embedded (12 September 2026)

`src/lib/textlayer.ts` used to write the invisible layer with a Type0 / Identity-H font and no
font program. Readers extracted the words correctly, the glyphs were never drawn, and the page
rendered unchanged — but MuPDF warned `non-embedded font using identity encoding` on every file
this project wrote, and a preflight or PDF/A check would have refused a document people keep and
forward.

It now embeds `src/lib/glyphless-font.ts`: a TrueType font with one empty glyph, 364 bytes measured,
with every CID mapped to it through a /CIDToGIDMap stream of zeros. `npm run verify:pro-features`
was tightened first — no MuPDF warning is accepted at all, which failed against the old output —
and then asserts what replaced it: MuPDF lists the font as `ttf` with an xref of its own, both
readers still extract the words, and the page still renders pixel for pixel as it did.

## Passwords outside ASCII: UTF-8, but not SASLprep'd

AES-256 (V5) passwords are the UTF-8 encoding of the password, after SASLprep (PDF 32000-2,
7.6.4.3). `src/lib/decrypt.ts` and `src/pro/encrypt.ts` do the UTF-8 half and not SASLprep, so a
password differing only by Unicode normalisation or by the treatment of a non-breaking space may
be written here and rejected by a conforming reader, or the reverse. Every ASCII password is
unaffected. Latin-1 was used until 12 September 2026, which was wrong for every non-ASCII
password and invisible because every fixture is ASCII; MuPDF opening a file our own reader
refused is what exposed it.

**pypdf cannot be the second reader for this case.** pypdf 5.9.0 encodes a V5 password Latin-1,
so it refuses a correctly written file — including one MuPDF wrote with the same password.
`npm run verify:password` states that, and proves the file is right by handing pypdf the UTF-8
bytes the way it encodes them. If that check starts failing, pypdf has been fixed and the case
should require it like MuPDF.

## The scanner: three claims removed, to come back when it merges

The Android scanner is not built, and the site said it was in three places plus a meta
description: /app/'s opening paragraph ("scanning several pages in a row with the camera"), the
app feature list ("Multi-page camera scanning straight to PDF"), the homepage Android card
("camera scanning"), and /app/'s own description tag. All four now describe what the app does
today — photographing several pages in a row, each becoming a page — which is true and keeps the
multi-page part that was never in doubt.

**They come back when the scanner merges: after the closed test, before launch.** When it does,
it belongs on this site as a reason to install the app, alongside the share sheet and offline
working, and **never as a web feature** — a browser has no camera worth scanning with, and nobody
photographs a document at a desk.

**One sentence is left for the owner to decide.** `/privacy` says the app "does not request camera
permission: scanning hands the job to your existing camera app, which returns the picture". That
describes the scanner too, and that page is the one Play Console will point at, so it is not being
edited here. Proposed replacement, for review: *"It also does not request camera permission: taking
a photograph hands the job to your existing camera app, which returns the picture, and that needs
no permission of its own."*

## Wanted: OCR in more languages (requested 12 September 2026, not built)

`/ocr/` offers six, all Latin-script European: Dutch, English, French, German, Polish, Spanish
(`src/lib/langs.generated.ts`, generated by `tools/langs.mjs`). The request is coverage around the
twenty most-spoken languages, which means the scripts that are missing rather than more of the
same one.

Not started, and not a matter of adding rows to a list. What has to be worked out first:

- **Model size.** Each language model downloads once and is then cached for offline use, and the
  page states its size from a build-time measurement rather than a guess. Some of the missing
  languages have far larger models than any currently offered. Every figure the page prints stays
  measured; none is estimated to make a list longer.
- **Scripts that are not left-to-right Latin.** Arabic and Hebrew are right-to-left; Chinese,
  Japanese and Korean have their own segmentation, and Japanese can be vertical. The searchable-PDF
  writer places one invisible run per recognised word from its bounding box, which is an assumption
  about word-shaped text that these scripts break. It needs testing per script, with a reader that
  did not write the file, before any of them is offered.
- **What the page may claim.** Accuracy differs sharply by script and by scan quality. The page
  says nothing about accuracy today, and adding languages must not become the moment it starts.


## Merge's "larger than its inputs" message: its trigger has never been observed

`src/lib/size-report.ts` tells a person when a merged file is larger than the files they gave it.
The case was reported from the Android app's testing, where merging uses PdfBox. Here merging uses
pdf-lib, and on 40 files (the app's test corpus, the OCR and crypto fixtures, and font-heavy PDFs
generated for the purpose) every merged file came out 0–40% smaller than its inputs.

So the sentence is proven by `verify:size-claims` and by nothing else. No browser has shown it and
no person has read it in place, and a message whose trigger has never been seen is a message nobody
has seen. The guard stays because the comparison is correct to make whatever the engine. If a
real file ever produces it, walk the result screen with that file and record the file here.

## Limit, not defect: Images to PDF adds a container

A PDF holding one JPEG is about a kilobyte larger than the image data (948 bytes measured on three
JPEGs through pdf-lib with the save settings the page uses, not through the page itself, 12 September
2026). EXIF stripping, on by default, removes bytes too, so the net difference depends on the photo;
that part is not measured. The page says both in one sentence; there is nothing to fix.

## "Nothing is purchasable inside the app": a claim about the artefact, not the repo

/terms, /refunds, /privacy and /support say nothing can be bought inside the Android app. The app
repository does contain billing code (RevenueCat, a Play pricing catalogue, a paywall), so reading
the repo suggests the opposite. The claim is true of the shipped build because `BILLING_ENABLED`
gates both the UI and the SDK, the release artefact contains no Pro classes, and a dex gate with
presence controls proves it (owner, 13 September 2026, content review item 24).

The repo containing billing code and the artefact containing it are different claims, and the gate
is what makes the second checkable. When Pro ships, these four pages change in the same release
that turns the gate on. Until then, check the artefact rather than the source.

## Deliberately not used: the app backend's Firestore `tier` and `revenueCatWebhook`

The Android app's Firebase backend (app repo, `functions/src/index.ts`, region asia-south1) has
entitlement infrastructure that looks live and is not:

- a `tier` field (`free` | `pro`) on each user's Firestore record;
- `revenueCatWebhook`, which writes `tier` from RevenueCat events, with event-time ordering and a
  constant-time shared-secret check;
- `entitlement` and `usageSync` endpoints that return `isPro` from that field.

It was built for Play billing through RevenueCat, which `BILLING_ENABLED` keeps off in the shipped
app. Nothing server-side reads `tier` for a limit any more: summaries are ten a month for everyone.

**Pro bought on the web does not use it** (decided 13 September 2026). Paddle purchases are
recorded by a Cloudflare Pages Function in D1 (`functions/api/paddle/webhook.js`,
`functions/purchases-schema.sql`), and the entitlement both surfaces read is
`GET https://pdf-iq.com/api/entitlement`. The reasons:

- Paddle's five-second response deadline against a Firebase cold start;
- one repo owning checkout, webhook and refunds;
- no Google service-account key stored in Cloudflare.

So a Firestore record showing `tier: free` for someone who bought Pro on the web is correct, not a
bug. If Play billing is ever switched on, the two stores must be reconciled deliberately, not
discovered to disagree. Until then, treat the Firestore tier as dormant.

## What a Pro entitlement unlocks must be the same on both surfaces

A web purchase is meant to cover the Android app, and /pro/, /terms and /refunds say it will. **Today it does not**
(see "The purchase page says web tools only" below). The entitlement token from
`GET /api/entitlement` says only `pro: true` for a uid; each surface decides what that unlocks. So
the two feature lists must be kept in agreement deliberately.

**The app cannot honour a web purchase yet** (app session, 13 September 2026). `BILLING_ENABLED`
does two jobs there: it compiles the Pro features in, and it turns on the Play purchase path. A
Paddle buyer needs the first and must never get the second. The flag has to be split before the app
reads this entitlement. That is app work, recorded here because a web sale that says "covers both"
depends on it.

## Paddle's checkout frame talks to hosts this site's policy cannot govern

Measured with `npm run measure:paddle` on the Preview deployment f3c2dbf with the real sandbox token
(13 September 2026), through opening the checkout, before any payment. Arrival alone: nothing third-party.
After pressing Pay, Paddle.js loaded from cdn.paddle.com and opened its checkout frame (sandbox-buy.paddle.com),
and inside that frame:

- **Stripe:** js.stripe.com/v3, a frame from m.stripe.network, and m.stripe.com, which sets a cookie `m` on
  m.stripe.com lasting about 13 months (httpOnly). Stripe's frame also writes sessionStorage keys `_ab`,
  `_mf`, `1` and `id`.
- **Localize** (global.localizecdn.com), Paddle's translation service: a tl.gif image request plus XHRs, and
  localStorage keys in Paddle's frame including `ljs-visits` and `ljs-cache`.
- **Sentry** (o522631.ingest.sentry.io): five envelopes.
- **Google Fonts:** fonts.googleapis.com and fonts.gstatic.com.
- **Paddle's own analytics and checkout events:** sandbox-checkout-analytics.paddle.com, and pings to
  sandbox-checkout-service.paddle.com.
- **Cloudflare bot management:** a `__cf_bm` cookie on .paddle.com, about 30 minutes.

None of this is governed by /pro/buy/'s policy. It belongs to Paddle's frame, and once the frame is
allowed our policy has no say over what it loads. /privacy's wording for the purchase page has to
describe this from the measurement. The standing rule against anything needing a cookie or consent banner
needs a decision on the Stripe `m` and `__cf_bm` cookies, which arrive only after someone presses Pay.

Paddle.js 2.9.7 also injects Retain analytics (public.profitwell.com) outside sandbox. /pro/buy/
pre-sets the loader's own skip check and leaves that host out of its policy. Only a production
measurement can confirm both hold, so measure again on the day the sale opens.

## Limit, accepted: Unlock from Batch loses the chosen files (13 September 2026)

Unlock carries the open file to the checkout and back through the IndexedDB handoff (src/lib/handoff.ts), which
holds one file per key. Batch works on many, so Unlock from /batch/ returns to an empty page. The prompt says so
before the button: "These files do not come with you to the checkout: after paying, you come back here and choose
them again." (src/pro/gate.ts, `manyFiles`).

Accepted by the owner for now: carrying many files is a bigger change to the store and to /privacy than it is worth
before Pro sells. **Revisit when Pro is selling.** Someone who batches twenty files and has to choose them again
after paying will say so, and that complaint is the signal. The likely shape: one row per file under a shared
Unlock key, with the same ten-minute limit and pick-up-and-delete, and a /privacy sentence saying so.

## The purchase page says "web tools only" until the app honours a web purchase (13 September 2026)

$14.99 covering both the website and the Android app was the pitch. Today a purchase covers one surface: the app cannot
honour a web purchase until `BILLING_ENABLED` is split (see "What a Pro entitlement unlocks must be the same on both
surfaces" above; approved in the app session, not built). /pro/buy/ said "covering both the web tools and the Android
app", on the page where someone hands over money, and "covers the app" is a material part of what they think they are
buying. The owner pulled it the same day.

**Now:** the pages that define the purchase say what it covers today (`PRO.coversToday` in tools/site.mjs):
- /pro/buy/: "$14.99 once, for Pro in the web tools on this site. It does not unlock anything in the Android app."
  (verify:sale-build checks it and that the page no longer carries `PRO.covers`).
- /terms: "It covers Pro in the web tools on this site. It does not unlock anything in the Android app." and "Buying
  happens on this website rather than inside the Android app." (production, 8b9273a; /terms is linked from the checkout).
- /refunds: "A Pro purchase is a one-time unlock covering Pro in the web tools on this site; it does not unlock anything
  in the Android app. A refund removes it from this website." (production, 8b9273a).
- The old phrases from /terms and /refunds are in tools/retired-claims.mjs, so verify:retired refuses them.

**The sentence comes back when the app can honour a web purchase and it has been tested on a device** (the flag split),
in one change, on all six places that made the promise: /pro/buy/, /pro/ (lede and price card), the homepage Pro panel,
/app/ (price card), /terms and /refunds. Delete the four retired-claims entries in the same commit, and restore a token for
`PRO.covers` if one is wanted (removed so it cannot be reused unlisted). /app/ was not in this list: the stage 5 sweep
found it (17 September 2026), because it took the wording through `{{proCovers}}` and nobody searched the token's uses.
On pro-sale all six now say `coversToday`. Production still carries `covers` on /pro/, the homepage and /app/ until the
redesign release.

## Split: the "Where to split" choices appear only after every thumbnail has rendered (found 16 September 2026)

**What it is.** `src/entries/split.ts` switches to the options view (`shell.show('selected')`, line 85), then awaits
`grid.load()` — rendering every page thumbnail — and only then calls `renderModes()` (line 88). Until the thumbnails are
done, the "Where to split" fieldset is empty: no Extract a page range, no Split every N pages, no bookmarks choice.

**How it showed up.** `src/test/e2e-selftest.ts`, "Split — every-N produces parts whose pages add up", counts the mode
buttons as soon as the view appears and fails "two modes offered (no bookmarks in this file)", because it counts zero.
It fails on production code (8b9273a) and after the ASCII85 change alike. Measured in an off-screen frame set up as the
harness sets it up, on the same 11-page text file: the options view was showing at 22 ms with 0 mode buttons, and the 2
buttons arrived at 54 ms. The test reads the count at the moment the view appears. So the test is racing, but the race is
a real gap: on a long document a person sees the options with no choices in them for as long as the thumbnails take.

**Fixed 17 September 2026.** `renderModes()` and `recompute()` now run before the view is shown and before `grid.load()`;
`recompute()` runs again after the grid, to mark the cells. The e2e case failed on the old order (0 buttons, recorded above)
and passes on the new one (169 checks, 0 failed). The test was deliberately left reading the count the moment the view
appears: waiting for the buttons would have passed on the broken order too. Rotate and Reorder load the grid the same way,
but every control they offer acts on the grid's cells, so nothing is shown before it can work; left as they are.
## Two /refunds sentences waiting on a real purchase (17 September 2026)

/refunds told people two things nobody here has seen:

1. **"use the receipt Paddle emailed you — it links to their buyer portal, where you can request a refund directly."**
   Walk A reached Paddle's confirmation on 13 September, but the receipt email itself was never opened, and this repo
   has no Paddle API key to read a transaction's receipt with. **Rewritten** to say only what we control (write to
   support, quote the reference). Restore a description of the receipt when a sandbox receipt has been read, and say
   what it actually links to.
2. **"Paddle is the name on your card statement."** The descriptor is set in Paddle's account and is only visible on a
   real charge. **Rewritten** to "the charge on your statement comes from Paddle rather than from pdf-iq", with the
   exact name left open. Name it after the first live purchase.

A refunds page is read by someone who is already unhappy; an instruction on it that turns out to be wrong makes that
worse (owner, 17 September 2026). Both sentences are live on production, so both were softened there rather than only in
the sale draft.

## The price is tax-inclusive except in the US and Canada (measured 17 September 2026)

Paddle's own price preview, run against the sandbox price `pri_01m2cv2xegy64zmhtxrbk0b1bf` with the checkout's public
client token, for one unit:

| Buyer | Subtotal | Tax | Total |
|---|---|---|---|
| United Arab Emirates (the walk-A invoice) | $14.28 | $0.71 (5%) | **$14.99** |
| Germany | $12.60 | $2.39 (19%) | **$14.99** |
| United Kingdom | $12.49 | $2.50 (20%) | **$14.99** |
| India | $12.70 | $2.29 (18%) | **$14.99** |
| Australia, Japan | $13.63 | $1.36 (10%) | **$14.99** |
| United States, New York | $14.99 | $1.33 (8.875%) | **$16.32** |
| United States, Texas | $14.99 | $1.24 (8.25%) | **$16.23** |
| United States, California and Florida | $14.99 | $0.00 | **$14.99** |
| Canada, Ontario | $14.99 | $1.95 (13%) | **$16.94** |

So the price setting is tax-inclusive, and Paddle adds US and Canadian sales tax on top of it regardless. "$14.99" is
the total everywhere except the US states and Canadian provinces that tax digital goods, where the buyer pays more than
the figure on the page. /pro/ and /app/ now say so beside the price; /pro/buy/ says it on the purchase page.

**Two things this does not prove.** It is the *sandbox* price, not the production one, which does not exist yet: check
the same way once it does. And the rates are Paddle's on the day, not a promise about any particular state.
