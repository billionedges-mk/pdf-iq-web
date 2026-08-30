# Claim review

Every design bundle gets read against this list *before* any code is written, and every
conflict is reported before implementation starts. The first bundle went through it and produced
fourteen corrections; none of them would have been caught by building the design as drawn.

The governing rule: **if a number cannot be measured, it does not ship.** Not softened, not
hedged, not reworded into an approximation. Cut, or replaced by a figure the code produces after
the work is done.

---

## The checklist

### 1. Numbers the code cannot back
Any figure stated before the work runs — a size, a duration, a count. If the value depends on
the document, it cannot be known in advance and must not be printed.

### 2. Predicted output sizes
"≈ 2.9 MB", "2.6 MB anyway". A projected size that turns out wrong is worse than no projection.
Describe what a setting *does*; report what it *produced*.

### 3. Timing claims
"about a second a page", "about 40 seconds", "under 2 seconds". Measure on a real fixture. Quote
the measured figure or nothing.

### 4. Technology claims
"compiled to WebAssembly" when it is JavaScript. Check what the shipped bundle actually contains.

### 5. Platform-support claims
HEIC, codecs, formats. Verify per-browser rather than per-spec. "Supported" in a standard is not
supported in Chrome.

### 6. Cross-surface claims
Anything the page says about the Android app: metering, permissions, features that have not
shipped. Check against the app's actual state and its Data Safety declaration.

### 7. Price and date claims
Any figure or date for Pro. Nothing may imply a purchase that cannot be made.

### 8. Stage-cost claims — *added after the merge finding*
"X is fast; Y is the slow part." These read as insider knowledge and are almost never measured.
The merge page claimed bookmarks were the slow part; measured over a 300-page merge it was
**0.0%** against a file write at **76.5%**. Backwards, not approximate.

### 9. Relative-speed claims — *added after the OCR finding*
"the slowest tool here", "the fast one". These decay silently when an unrelated tool gets faster
or slower. OCR was described as slowest at 1.2 s/page while compress ran at 1.18 s/page. Any
comparison between two things needs both measured, and re-checked when either changes.


### 10. Permanence claims — *added after the account-language sweep*
"Forever", "ever", "always", "never". A claim that **binds a future decision** rather than
describing a current one. "No account needed" is true and strong; "no account, ever" is a promise
that may want breaking the day a Pro subscriber opens the site expecting to be recognised.

The test is not the word, it is what the word governs:

- **Architectural facts keep their absolutes.** "Your file never leaves this tab", "we never
  receive them", "never on our disk" describe how the thing is built. They are not pledges, and
  softening them would weaken a claim that is simply true.
- **Business and product pledges get described, not promised.** "No ads, ever" becomes "No ads,
  and no advertising SDK in the build" — checkable today, and it does not mortgage a decision
  nobody has had to make yet.
- **A deliberate strategic commitment keeps its absolute** when it is one the business has
  actually made and will be held to. "The seven web tools are never behind Pro" stays, because
  that is the stated position and walking it back is exactly what the sentence exists to prevent.

Same reasoning as cutting "and will stay that way" from the store listing: describe what is true,
do not pledge what might change.

---

## Method

**Grep the built output. Never trust that a replace succeeded.**

A text replace that matches nothing returns success. Across this project and the Android one that
has now silently failed nine times. The most recent: a correction to the OCR section of
`support.html` searched for *"come back"* where the source said *"came back"* — one word, no
match, no error, and the obsolete copy shipped into the next commit.

Verify a copy change by grepping `dist/`, not `src/`, and not by the exit status of the edit.

**Keep every claim in one place.** Card copy lived in both `tools/site.mjs` and
`src/pages/index.html` and drifted within a day, which is how an already-corrected claim came
back. The homepage grid is now generated from `site.mjs`, with a build-time guard that throws if
`HOME_ORDER` does not name every tool exactly once.

That fix covered the homepage grid. It did not cover the app page, which restated the tool
count in its own lede and feature list — and the next correction landed everywhere except
there. Twice is a pattern, so the surface split now lives in `site.mjs` too: every tool
declares `inApp`, the counts derive from it, and page bodies carry `{{tokens}}` and an
`<!--APP_FEATURES-->` marker instead of numbers.

Three build-time guards, each negative-tested by breaking it on purpose:

- a tool without `inApp` throws, so adding one forces the question rather than inheriting a
  claim of parity;
- an unknown `{{token}}` throws, so a typo cannot ship a literal brace onto the page;
- a token or marker that survives substitution throws, because a replace that quietly matches
  nothing is the original failure wearing a new costume.

Flipping `ocr.inApp` to true and rebuilding moves every count on every page, which is the only
real proof that a claim now lives in one place. It also exposed a degenerate case the
hand-written version never had: with nothing web-only, the derived line rendered as " are not in
the app yet" with an empty subject. That is the cost of deriving, and it is worth paying once.


---

## Record — first bundle

| # | Claim as drawn | Measured | Action |
|---|---|---|---|
| 1 | "tools are compiled to WebAssembly" | pdf-lib and pdf.js are JavaScript; only OCR uses wasm | rewritten |
| 2 | "The compressor is WebAssembly" | no wasm in the compress path at all | rewritten |
| 3 | Preset estimates ≈2.9 / 2.1 / 1.4 MB | depends entirely on the document | cut |
| 4 | "Compress hard anyway — 2.6 MB" | a predicted size | cut; runs it and reports the real result |
| 5 | "4 worker threads" | one thread yielding between images | cut |
| 6 | "about 40 seconds" for 62 pages | ~72 s at 1.155 s/page | cut |
| 7 | Compress "about a second a page" | 1.155–1.178 s/page | **verified, kept** |
| 8 | Split "under 2 seconds" | unknowable before the work | cut |
| 9 | Rotate "within a few bytes" | −838 bytes on 386 KB | cut; reports measured delta |
| 10 | OCR "about a second a page" | 7.3 s/page as first built | cut; now 1.2 s/page measured |
| 11 | OCR model "12 MB" | 6.0–10.4 MB, varies by language | per-language figure from the file |
| 12 | HEIC supported | Safari only | detected by magic bytes, named specifically |
| 13 | App meters OCR at 10/month | the app has no OCR yet | moved to future tense |
| 14 | Merge "bookmarks are the slow part" | 0.0% vs file write 76.5% | rewritten |
| 15 | "Slowest tool here" | 1.2 s/page vs compress 1.18 | "heaviest" |

---

## Record — homepage redesign

Only `Homepage.dc.html` changed; the other twelve artboards are byte-identical to the first
bundle, and `Homepage v1.dc.html` preserves what was already implemented.

| # | Claim as drawn | Finding | Action |
|---|---|---|---|
| 16 | "tools are compiled to WebAssembly" | **regression** — this was corrected in v1 and came back verbatim | rewritten again |
| 17 | "Same tools on a phone" (grid card) | app has six of seven; its OCR package is committed and DI-wired but has no route in `Screen.kt`, no entry in `PdfiqNavHost`, no home tile | "Six of these seven, on a phone" |
| 18 | "the same tools with no tab open" (price card) | same, and this one was **already shipped** in the v1 implementation | "six of these seven tools" |
| 19 | "Same tools, offline, on Android" (footer) | same, on all twelve pages — the redesign's footer change removes it | replaced by a plain "Android app" link |
| 20 | "Unlimited files of any page count, forever" | conflicts with the 200 MB ceiling the tools actually enforce | "As many files as you like, for as long as we run this" |
| 21 | "Pro — later this year" | a dated commitment that ages into being wrong | "Pro — not yet" |

Passed cleanly: no predicted sizes, no stage-cost claims, and — an improvement on v1 — no
relative-speed claim at all. "Test it in ten seconds" describes the reader's own test, not
processing, and stands.

Two implementation-level findings that were not claims:

- The design carries the readout **twice** (hero and footer). The instrumentation addressed a
  single `id`, so the second would have rendered a hardcoded zero — a decorative readout beside
  a real one. Now keyed on `[data-netreadout]`, all of them.
- Building it surfaced a bug in the instrumentation itself: request counting was gated on a flag
  set in the `load` handler, but `PerformanceObserver` delivers callbacks asynchronously, so
  fonts that started at 9ms were handed to the callback after a `loadEventEnd` of 21ms and
  counted as post-load traffic. The homepage read **"2 requests"** under a panel whose entire job
  is to read zero. Counting now compares each entry's own `startTime` against `loadEventEnd`.


---

## Record — permanence sweep, all twelve pages

| # | Claim | Why it binds | Now reads |
|---|---|---|---|
| 22 | "no account — that does not change when Pro arrives" | mortgages sign-in on the day a Pro subscriber opens the site expecting to be recognised | "They need no account today. If sign-in ever appears here it will be so a Pro subscriber is recognised, not a condition of using these seven." |
| 23 | "adding an account, which is the one thing we are not going to do" | an explicit never, about the same decision | "we would rather not put that in front of a free tool" |
| 24 | "No ads, ever." | a promise where a checkable fact was available | "No ads, and no advertising SDK in the build." |
| 25 | "Pro — later this year" (app page) | a dated commitment; softened on the homepage but missed here | "Pro — not yet" |
| 26 | "The same seven tools, on your phone" / "All seven tools, offline" | the app has six; found while reading context for the sweep, not by the sweep | "Six of the seven", plus a line saying OCR is web-only for now |

Kept deliberately: every architectural absolute ("never leaves this tab", "never on our disk",
"never receive them"), which describes how the thing is built rather than what we promise; "the
seven web tools are never behind Pro", the stated strategy that the sentence exists to stop being
walked back; and "the scan is kept, always" on OCR, the design decision from correction C with
its reason stated beside it.



---

### 11. Platform-injected claims — *added after the Cloudflare beacon*

**The host can add third-party scripts we did not write, in production only.** Cloudflare Pages
injected its Web Analytics beacon on the custom domain. Nothing in the repo referenced it, every
local check passed, and the privacy page's "no analytics SDK, no tag manager, no pixel and no
third-party script of any kind" was true of the source and false of the served page.

This is a category the other ten checks do not reach, because all of them read what we wrote. A
claim about what a page *contains* has to be verified against what the origin *serves*.

Two things caught it, and it is worth being exact about which:

- **The CSP blocked it.** `default-src 'none'` with `script-src 'self'` meant the beacon could not
  execute. That was luck as much as design — the CSP was written for XSS, not for the host.
- **The readout surfaced the symptom**, a request count that no local build explained.

The readout would *not* have caught the beacon on its own as it was then written: an injected
script loads during page load, and the counting rule at the time only counted requests after
`loadEventEnd`. It would have reported zero with a third-party script on the page. That is why
the metric was replaced — see below.

**Verify on the origin, not in the repo:** after any deploy to a new host or domain, fetch the
served HTML and enumerate `<script>` tags and external URLs. Grep for the vendor's name in the
*markup*, not in the prose — a first pass here returned nine hits for "analytics" on the privacy
page, all of which were that page's own description of Firebase Analytics.

---

## Record — the readout, rebuilt

The element carrying the site's central claim was wrong three times on its own page:

| | Failure | Caught by |
|---|---|---|
| 1 | updated one element by id, so the homepage's second readout rendered a hardcoded zero | review, before shipping |
| 2 | gated counting on a flag set in the load handler; PerformanceObserver delivers asynchronously, so preloaded fonts starting at 9ms were counted after a loadEventEnd of 21ms | the homepage reading "2 requests" |
| 3 | compared startTime to loadEventEnd, which is a correct implementation of the wrong rule: browsers fetch the favicon lazily, genuinely after load | production reading "1 request" with nothing on the wire |

Each fix was right about the bug and wrong about the metric. "Requests since the load event" is a
proxy for nothing a visitor cares about, and its boundary has an open-ended supply of edge cases.

The decisive argument was what it would have *missed*: the injected beacon loads during page
load, so the rule skipped it. A counter that reads zero through the exact event it exists to
detect is worse than no counter.

It now reports **bytes sent** and **third-party requests** — the claim itself, and the corroboration
— with no timing boundary, so it has no boundary bugs and catches the beacon class by construction.

### The test, and why "reads zero" is not enough

`src/test/readout-selftest.ts` loads all twelve routes in same-origin iframes, settles, and
asserts on the *rendered text* rather than internals. It was validated by mutation, not by
passing:

- **Mutation A — count our own assets** (the shape of failures 2 and 3): 13 groups fail, with the
  real bug's exact wording, `"0 bytes sent · 6 third-party requests"`.
- **Mutation B — make `render()` a no-op**, the decorative-readout failure: **the clean-page group
  still passes**, because the HTML default already contains the clean string. Only the cases that
  force a non-zero state catch it.

Mutation B is the reason the test asserts in both directions. A readout stuck at zero is
indistinguishable from a correct one until something makes it move, so the test makes a real
cross-origin request and sends a real 4096-byte body and requires it to notice both.

---

## Record — first production deploy

The footer readout showed **1 request** on a clean load of `pdf-iq-web.pages.dev`. The first
thing it caught in production was production itself.

It was not Cloudflare Web Analytics, which was the reasonable first suspicion and would have made
the privacy page's "no third-party script of any kind" false in production while true in the
source. Verified: the only script on any served page is `/assets/net.js` plus the tool bundle, and
the only external URLs anywhere are the canonical and og:url tags. No beacon is injected.

It was ours. The homepage emitted `<script src="/assets/home.js">` for a bundle that has never
existed: `site.mjs` declared `entry: 'home'` in the first scaffold and `src/entries/home.ts` was
never written. The script tag came from `page.entry`; the bundling silently skipped any entry
whose file was missing. Two facts, one source needed — the same shape as every drift in this file.

Locally that 404s and went unnoticed. On Cloudflare Pages a missing `/assets/*` path returns
**200 with the HTML index**, typed `text/html`, and my own `immutable` rule then told browsers to
cache that wrong answer for a year. A 404 would have been the kinder failure.

The build now throws when a page declares an entry whose file is absent, negative-tested by
restoring the broken declaration and watching it fail.

Production checks passed at the same time: language models serve as `application/gzip` with no
`Content-Encoding` layered on top, so tesseract can still inflate them; `_headers` is applied,
with HTML `must-revalidate` and assets `immutable`.

---

Two further corrections came from the brief rather than from measurement: the privacy page's
claim of "no advertising or analytics SDK" (the app contains Firebase Analytics and Crashlytics,
declared to Google), and its claim that the app requests camera permission (it does not).

One claim went false and then true again inside a day: **"you can leave this tab in the
background."** pdf.js paces display rendering with `requestAnimationFrame`, which browsers stop
in a hidden tab — measured at not settling in 12 s, against 407 ms once visible. Switching to
`intent: 'print'` made the original copy correct again. A claim that flips twice is worth
re-testing on every change to the code beneath it, not just once.


### A fourth failure, of a different kind

After all of that, the readout still showed the *old* string in a browser — text the live code
could no longer produce. Production was already serving the new bundle; the browser was not
running it.

`/assets/*` was served `Cache-Control: immutable, max-age=31536000` while the entry filenames
were stable: `net.js`, `compress.js`. `immutable` is a promise that the bytes at that URL will
never change, and they changed on every deploy. Anyone who had loaded the old bundle was pinned
to it for a year. esbuild was already hashing the shared chunks; only the entry points, the ones
that change most, were on stable names.

Entry filenames now carry a content hash, so `immutable` is true rather than convenient. The
build asserts every declared entry produced a bundle, and every asset a page references exists.

The lesson is narrower than the others and worth stating plainly: **a cache header is a claim
too.** `immutable` on a mutable URL is the same category of error as any other unverified
assertion on this site, and it fails in the one place nothing local can see — someone else's
browser, holding a copy of a file that no longer exists.


### A fifth failure — and the first the page can catch itself

The readout showed the *old* string again, on pdf-iq.com, after the content-hash fix. The apex
was serving the current build: correct HTML, correct hashed bundle, `clean: true`, six files
loaded and all same-origin. The string could not come from the deployed code.

`/assets/net.js` — the old, unhashed path — still returned **200** with the pre-fix bundle,
marked `immutable`:

    var s={requests:[],sentBytes:0,sends:[],crossOrigin:[],loaded:!1}

Cloudflare Pages keeps assets from earlier deployments reachable. A browser holding stale HTML
asks for the old path, is handed old code with a year-long immutable lifetime, and runs it.
Content hashing prevents this recurring, but only once a visitor has received new HTML at least
once — the last generation of unhashed markup still points at the old file.

No local test can see this. It is not a property of the build; it is a property of what one
particular browser is holding. The page is the only thing positioned to notice, so now it does:
the build id is stamped into both the HTML and the bundle, and if they disagree the readout
stops showing a figure and says **"reload this page — it is running an old copy"** instead.

That is the general principle worth keeping. Where a claim can be wrong for reasons no test can
reach, the honest move is not a better number — it is for the thing to detect that it cannot
stand behind the number, and say so.


### "Next, with this same file" was not true

Reported from use: after Images to PDF, following "Compress it" opened an empty drop zone and
the file just produced had to be found on disk and picked again.

The compress result said **"Next, with this same file"** and merge said **"Next, with this
merged file"**. Both were plain links. The sentence promised the one thing that did not happen,
which puts it in the same category as every other claim in this file — it was checkable, and
nobody checked it.

Implemented rather than reworded, because the chain is the point: compress then split, or OCR
then compress. Each page is a separate document by design, so the bytes are handed over through
IndexedDB on this origin — never a request, never off the device — claimed and deleted in the
same transaction, with anything abandoned swept after ten minutes.

That is the first time a document of the user's is written to storage rather than only held in
memory, so the privacy page now declares it as a third item alongside the OCR model and its
flag, and says plainly that it only happens if one of those links is clicked.

All seven tools now hand off and six accept. Images to PDF only hands off, because a PDF is not
an input it takes. Split hands on the first part, and says so.


### 12. Library error identity — *added after a real encrypted file*

**Do not assume a library's error classes survive its own build.** `errors.ts` dispatched on
`err instanceof EncryptedPDFError`, following the rule that types beat message text. pdf-lib's
published bundle is ES5, and `class X extends Error` transpiled to ES5 loses its prototype
chain. Measured:

    EncryptedPDFError      instanceof self: false | .name: Error
    MissingPDFHeaderError  instanceof self: false | .name: Error
    PDFParsingError        instanceof self: false | .name: Error

Every pdf-lib error arrived as a plain `Error`. The dispatch could never fire, so **the entire
pdf-lib branch of the taxonomy was dead code** and every failure — locked, damaged, headerless —
fell through to "unexpected failure". A real password-protected file is what exposed it.

pdf.js, by contrast, keeps `.name` intact: `PasswordException` with `code` 1 or 2. So the rule is
right, and the check is whether a given library honours it.

Two consequences worth keeping:

- **Prefer a structural fact to an error.** Encryption is now read from `doc.isEncrypted`, a
  property of the document, not from something thrown. It cannot be broken by a transpiler.
- **When only a fragile signal exists, put a tripwire on it.** Message matching is still the only
  option for pdf-lib's other failures, so `tools/verify-pdflib-errors.mjs` provokes each error and
  asserts the fragments still match. An upgrade that rewords them fails loudly rather than quietly
  degrading the copy. It also reports if the classes ever become identifiable again.

### A route that was written, reviewed, and could never have worked

The unlock path went: open in pdf.js with the password, call `saveDocument()`, hand the result to
pdf-lib. It was typechecked, guarded, and wrong. `saveDocument()` writes back annotation and form
edits; it preserves encryption. Measured on a 1,679-byte fixture: output 1,679 bytes, `/Encrypt`
still present, pdf-lib refused it.

The guard did fire correctly and refused rather than emitting a corrupt file — the honest-failure
design working on a case it was not designed for. But the feature could never have succeeded, and
nothing short of running it would have shown that. It sat in TECH_DEBT as "written but untested"
for the whole project, which was the right label and not a substitute for running it.

### 13. Two ways to satisfy a check means both get tested

When a specification says a thing can be satisfied more than one way, testing one way and
shipping is a coin flip. Implement and test every branch the spec allows, or say in the
copy which branch is supported.

**Found by:** a real password-protected PDF. A PDF carries two passwords — user and owner
— and either opens it. `decrypt.ts` implemented only the user path (Algorithms 2/4/5) and
never Algorithm 7, so the owner password was rejected as wrong. pdf.js opened the same
file with the same password, which is what proved it was our bug and not the file.

It went further than a rejection: the "password not accepted" copy told the user the owner
password "only restricts printing and copying" and to try a different one. The product
argued with a correct credential.

The fixture generator had produced a distinct owner password since the day it was written.
No test had ever tried it.

**The check:** for every spec branch — cipher, revision, credential, filter — either a
test drives it or the limitation is stated to the user. A branch with no test is not
implemented, it is asserted.

### 14. An offer must be able to work, and must carry the code that fulfils it

Two separate failures, one shape: a control that renders and cannot act.

**Found by:** the nothing-to-gain card. "Try the Smallest setting anyway" sat three lines
under a sentence reading *"Its one image is already JPEG at quality 94 and 72 dpi"*, while
its own note said *"Smallest drops scans to 72 dpi"* — the card stated, in two places, that
the setting it was offering would do nothing. Pressing it ran a real compression, produced
a file 58.8% smaller, and threw it away: the result gate applied a fixed 50 KB absolute
floor to a pass the user had explicitly asked for, so on any file under 50 KB the button
was provably dead. The card then read "58.8% smaller" and "Nothing worth saving" at once,
offering only "Keep my original".

The audit for the same shape found a second one: `ui.ts` rendered `[data-err-action]` and
**no click handler for it existed anywhere in the codebase**. A damaged file offered
"Continue with the 3 readable pages" and did nothing at all when pressed. Alongside it,
`action: isImage ? undefined : undefined` — a dead ternary where a third offer had been
stubbed and abandoned.

**The checks:**

- **If you already compute the precondition, use it.** Both numbers that prove Smallest
  could not help — the median quality and the median dpi — were already computed, to write
  the sentence directly above the button. An offer contradicted by the paragraph above it
  is worse than no offer.
- **An explicit request is not the same as an unprompted one.** A threshold that stops us
  *offering* trivial work must not be reused to withhold a result someone asked for by
  name. Ours was, and it made the button dead.
- **A label is not an offer.** `ToolError.action` is now `{ label, run }`, so a rendered
  action cannot exist without the behaviour that fulfils it. If it is not implemented, it
  is not offered.
- **The closing sentence must match the buttons under it.** "We could hand you a visibly
  worse file" is only true when a worse file is actually on offer.

The same rule applies to the two prior instances of this defect on the app side —
`onSubscribe` and "Try smaller" — which is what makes it a class rather than a bug.

### 15. A false citation is worse than no citation

A number with no stated provenance invites checking. A number citing evidence that does
not exist stops the checking, because the next reader believes the work was already done.

**Found by:** the 200 MB file ceiling. Its comment in `src/lib/ui.ts` read: *"`tools/memory-probe.html`
is what it was measured with; see the README for the figures it produced."* There was no
`tools/memory-probe.html`, and the README carried no figures. The same comment also called
the value a guess, two sentences earlier — so the file contradicted itself, and the half a
reader would act on was the false half.

`TECH_DEBT.md` and `README.md` both said plainly that the ceiling was a placeholder. The
only artefact claiming otherwise was the one sitting next to the constant, which is the
one anyone changing it would read first.

**The check:** every citation in a comment names something that exists, and points at a
real figure. Before shipping a comment that cites a file, open the file. Before citing
"the figures", find them. If the provenance is "guessed", the comment says guessed and
nothing else — an honest absence is checkable, an invented presence is not.

**Corollary:** when the artefact is missing, the fix is to build it, not to delete the
sentence. The probe that comment described is now real, at `/memory-probe/`, and the
figures it produced are recorded in `TECH_DEBT.md`.

### 16. An instrument needs a check that makes an impossible reading refuse

A measurement tool is not exempt from the rules it exists to enforce. It is held to them
harder, because everything downstream inherits whatever it says and nobody re-derives it.

**Found by:** the memory probe, which was wrong twice in the same investigation while the
thing it measured was wrong once.

1. Its summary reported *what completed* and *what died* — the question the investigation
   had already established was the wrong one. A rung that took five and a half minutes was
   printed as a pass.
2. Its ladder returned 0.4 seconds of work at 30, 50, 60 and 80 MB on a phone. Identical at
   every rung, on a device that reports no heap, so nothing contradicted it. A figure that
   cannot be true was printed as a ceiling.

Both were caught by a person reading the output and finding it implausible. Neither was
caught by the probe, which had no notion of an answer being impossible.

**The check:** every instrument carries an internal consistency test, and fails loudly
rather than reporting when it does not hold. The tests are about the shape of the data, not
its absolute values, so they survive a slow device as well as a fast one:

- **The output must respond to the input.** If the work does not grow with the file, the
  pipeline is not doing what it claims. This is the one that catches a flat ladder.
- **The input must be what was asked for.** Every rung reported the size it *requested*.
  A generator that silently produced something small was invisible; the built size is now
  printed on every line.
- **A second signal that does not depend on the platform.** Heap was the only cross-check
  and iOS does not report it. Six different drawings compress to six different sizes, so
  six identical sizes means the canvas drew nothing — and that works everywhere.
- **No result is instant.** A floor below which a time is not physically possible.

This is the footer readout's rule applied to a tool rather than to the product: when it
cannot stand behind a number, it says so instead of printing one. See also check 15 — an
instrument that reports confidently from a broken run is a false citation generated fresh
each time.

`validate()` lives in `src/lib/probe-validity.ts` rather than inside the probe, so it can
be driven with the runs that actually happened — including the impossible ones — instead of
being trusted by reading.

**And then the validator itself failed, which is the real lesson.** Written to reject flat
ladders, it passed one: 0.2s, 0.4s, 0.4s, 0.4s across 10 to 80 MB. It compared only the
fastest rung to the slowest, so a single quick small rung supplied 2x apparent growth and
satisfied a flat 1.5x threshold, while 30, 50 and 80 MB sat at an identical 0.4s. The check
was real, the data was exactly its target shape, and it returned ok.

Three consequences, all of them the point:

- **A check with one formula can be satisfied by one outlier.** Growth is now measured
  against how far the ladder spans, and a second detector looks directly for the shape a
  person spots instantly — consecutive rungs at the same time while the file keeps growing.
  Two independent detectors, because one that can be gamed is one that will be.
- **Prefer a signal that does not depend on the thing you suspect.** Every timing check
  trusts the clock and the scheduler. The pipeline now records what it *observed* — pages
  parsed, images found, bytes written back out — and a round trip that reads 80 MB and
  writes 0.1 MB is caught without reference to time at all.
- **Beware the shortcut taken to make the instrument fast.** The probe capped recompression
  at six images, reasoning that the memory peak depends on what is *held*, not how many
  images are processed. True of memory, false of time — and it removed the size-dependence
  of the heaviest stage. Desktop recompression measured 7.7s at 50, 75, 80 and 85 MB, the
  same six images every time; on an iPhone, where parse and save round to zero, the total
  became the cap itself and the ladder went flat. Four runs were diagnosed against numbers
  that described the sample rather than the file. Uncapped, the same desktop goes 1.3s at
  10 MB to 29.7s at 40 MB, linear in image count. **Every shortcut that makes a measurement
  cheap is a hypothesis about what does not matter, and it has to be stated and checked.**
  `validate()` now requires the quantity of work to grow with the file, not only the time.
- **Drive the validator with the failing data before believing it.** The test that proved
  this asserts the recorded run is rejected, and it failed on first run, printing no
  problems at all. A validator is code, and untested code that returns a verdict is worse
  than no verdict.

### 17. A silent skip becomes an invented explanation downstream

Code that cannot do something and quietly moves on does not stay quiet. Something further
down reads the result, finds nothing wrong with it, and explains it — confidently, and
wrongly, because the reason was discarded at the point it was known.

**Found by:** an iPhone reporting 0.4s of work on an 80 MB file while parsing every page
and writing every byte back. The missing stage was recompression, which does this:

    const decoded = await decodeImage(doc, img);
    if (!decoded) { skipped++; continue; }

A decode failure landed in the same counter as "recompressing this would make it bigger".
So on a browser that cannot decode our images, `compress()` returned a document identical
to its input, and the nothing-to-gain card explained that the images were *"already JPEG at
quality 94 and 300 dpi — close to what our Balanced setting would produce."*

Every number in that sentence is real: they are read from the JPEG headers during analysis.
The sentence is still a fabrication, because we never opened a single one of those images.
It is the most convincing kind of false claim — accurate figures, invented conclusion.

**The check:** when a step gives up on something, the *reason* travels with the count. A
tally of "things that did not happen" merges causes that downstream copy must distinguish:
"we chose not to" and "we were unable to" produce opposite sentences, and only one of them
is honest about the browser. `imagesUndecodable` is now separate from `imagesSkipped`, and
`explainNoGain` refuses to describe the quality of images it never decoded.

**Corollary for offers, joining check 14:** a harder pass is not offered when nothing could
be opened. Retrying a decode that failed is the clearest possible case of an offer that
cannot work.

### 18. A status list is a claim, and it goes stale in the direction that flatters

Every other check here is about not asserting what was never verified. This one is the
reverse: continuing to assert a problem that has since been solved.

**Found by:** a launch assessment that named three blockers. Two were already closed, and
had been closed for a while — the support mailbox existed and had been tested in both
directions, and Safari on iPhone had been walked through four checks including the one that
would have made every tool useless there. The third had an answer nobody had written down.
The record said otherwise, so the assessment was confident, specific, and wrong about
whether the site could ship.

Stale debt fails asymmetrically. A closed item left open costs delay, rework, and — worse —
it makes every other line in the list less believable, because the reader now has to check
them all. Nobody is tempted to record a problem that does not exist; they are tempted to
stop updating.

**The mechanism, which is the part worth remembering.** Both corrections had been made, and
both were *told to me in conversation*. Neither reached the file. The next assessment read
the file, because that is what an assessment does — the conversation is gone, the file is
what remains. So the failure is not that the record was wrong; it is that there was a moment
where the truth existed only in a place with no future readers, and nobody wrote it down.

That path is always open. Anything settled in discussion — a value confirmed, a check run on
a device, a question answered from a dashboard — is unrecorded by default. `TECH_DEBT.md` is
exactly as exposed to this as any status list, and more so, because it is the file consulted
precisely when nobody remembers.

**The check:** an open item is only open if it would still fail today. Before reporting
status from a file, re-verify anything cheap enough to re-verify, and treat a stale entry as
a defect in the record rather than a note that needs tidying. Where the answer arrived in
conversation rather than in code, write it down at the time — the record is the thing that
outlives the conversation, and it is the thing the next assessment will be built on.

**Corollary:** when the record is corrected, say what closed it and how it was confirmed,
not just that it is closed. "Tested in both directions after the nameserver move" survives
scrutiny; "done" does not, and invites the same item being reopened later.
