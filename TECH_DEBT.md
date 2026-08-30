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
- **Encrypted PDFs — resolved, with one gap.** A real locked file proved both halves wrong:
  detection never fired, and the pdf.js `saveDocument()` route does not decrypt at all. Both are
  fixed and tested end to end against a generated RC4 40-bit fixture. Remaining gap: **only RC4
  40-bit has been exercised against a real file.** `src/lib/decrypt.ts` also implements RC4
  128-bit, AES-128 (/AESV2) and AES-256 (/AESV3, R5 and R6), and those paths are written from the
  specification but have never met a document. `tools/encrypt-fixture.mjs` only emits RC4 40-bit;
  extending it to AES would close this. The owner-password route (Algorithm 7), added after the
  same real file was rejected while carrying a *correct* owner password, is exercised for RC4 by
  the fixture; its AES-256 equivalent shares the same untested status as the rest of V5.
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
