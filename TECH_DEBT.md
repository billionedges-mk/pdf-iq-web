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
| 5 | Redirect `billionedges.com/pdfiq/*` → `pdf-iq.com/*` | billionedges VPS nginx | no |

**Ordering.** Item 5 first, so the old URL keeps resolving before anything points away from it.
Then 1 and 2, which are console-only. Items 3 and 4 need an APK, so they ride with **1.1**
rather than justifying a release of their own.

**Precondition for all five:** `pdf-iq.com/privacy` returns 200 in a browser, not just in DNS.

### Also waiting on the app, unrelated to the domain

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

- **File size ceiling — measured and set.** `MAX_BYTES` in `src/lib/ui.ts` is **60 MB**, down from
  a 200 MB placeholder. Measured with `/memory-probe/` on Chrome 148, 8 cores, 16 GB, 4096 MB heap
  limit. "work" excludes building the fixture:

  | file | work | of which `save()` | heap |
  |------|------|-------------------|------|
  | 10 MB | 1.4s | 0.1s | 52 MB |
  | 25 MB | 2.8s | 0.3s | 99 MB |
  | 50 MB | 9.4s | 1.3s | 200 MB |
  | 60 MB | 2.5s | 0.5s | 238 MB |
  | 70 MB | 9.9s | 1.5s | 276 MB |
  | 80 MB | 13.0s | 4.2s | 315 MB |
  | 85 MB | **172s** | **163.3s** | 340 MB |
  | 100 MB | 336s | — | 397 MB |

  **The tab does not die, and the stage that fails is serialisation.** `save()` goes from 4.2s to
  163.3s between 80 and 85 MB — 39x for 6% more data — while parse and recompression stay flat
  across the same step. The tab stays alive and answers nothing throughout.

  Death is far higher and irrelevant: heap runs at four to six times the file, so against a 4 GB
  limit a crash is near 800 MB, and an iPhone completed 400 MB and was killed only at 600 MB.
  **Measuring for death would have justified raising this ceiling to 600 MB.**

  60 MB is the last rung where the whole operation stayed under three seconds — 25% below the last
  usable size and 29% below the collapse. `MEASURED_COLLAPSE_BYTES` is exported alongside it and a
  test asserts the ceiling stays meaningfully under it, so raising the number past the evidence
  fails rather than acquiring a comment.

  Caveats. The recompression stage is capped at six images, so these describe holding and writing a
  large document rather than recompressing every image in one. Times are noisy at the low end
  (60 MB measured faster than 50 MB, across different runs). And this is one strong desktop:
  weaker machines will collapse lower, which is the reason for the margin.

  **Outstanding: there is still no valid phone measurement.** The 60 MB ceiling rests on desktop
  evidence alone.

  The first iPhone run reported survival to 400 MB and a kill at 600 MB during fixture
  *generation* — but with a summary that carried no times, which is the distinction this whole
  exercise exists to draw. The re-run with times reported **0.4 seconds of work at 30, 50, 60 and
  80 MB**: flat, impossible, and printed as a ceiling because nothing checked it. The same ladder
  on desktop produces 1.9s / 9.1s / 8.5s / 14.0s with correct fixture sizes, so the `?ladder=`
  path is sound and the fault is iOS-specific.

  The first cause was the canvas. A re-run built correct fixtures — six distinct ~2,495 KB source
  images, files at 9.8 / 29.3 / 51.2 / 80.5 MB — and **still reported 0.2s / 0.4s / 0.4s / 0.4s**.
  So generation works on iOS and the fault is downstream, in the pipeline. The probe now records
  what the pipeline observed — pages parsed, images found, bytes written back out — and prints all
  three on every line, which is the signal that should name it.

  `validate()` did not fire on that run. Its growth check compared only the fastest rung to the
  slowest, so a single quick 10 MB rung supplied 2x apparent growth against a flat 1.5x threshold
  while 30, 50 and 80 MB sat identical. Growth is now measured against the ladder's span, a second
  detector looks for consecutive rungs at the same time while the file grows, and the structural
  checks never consult a clock. See CLAIMS.md check 16.

  `validate()` in `src/lib/probe-validity.ts` now refuses to report a ceiling from a run whose
  work does not grow with the file, whose fixture came out more than 25% under the size asked
  for, whose six source images are all identical, or whose work took under 50ms. See CLAIMS.md
  check 16.

  **Superseded note — the phone figures carry no timings.** The iPhone run reported survival to 400 MB
  and a kill at 600 MB during fixture *generation*, not during the work — but the first version of
  the probe's summary reported only completion and death, which is the distinction this whole
  exercise established is the wrong one. 400 MB "completing" says nothing about whether it took
  20 seconds or 20 minutes. The summary now leads with the largest size whose work stayed under
  30 seconds; a re-run would say whether a phone collapses below 60 MB.
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

- **Chrome only.** No Safari or Firefox has run any of this. Safari matters most: it is the one
  browser that decodes HEIC, and it has its own history with `OffscreenCanvas` and
  `createImageBitmap`, both of which the compressor depends on.

## Website operational

- **Cloudflare log retention** is described on `/privacy` without a retention period, because the
  setting has not been confirmed. Confirm it and state the real figure.
- **`support@pdf-iq.com` must exist** before launch. It is referenced 12 times across the site.
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
