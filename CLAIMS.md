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
