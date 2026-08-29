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

Two further corrections came from the brief rather than from measurement: the privacy page's
claim of "no advertising or analytics SDK" (the app contains Firebase Analytics and Crashlytics,
declared to Google), and its claim that the app requests camera permission (it does not).

One claim went false and then true again inside a day: **"you can leave this tab in the
background."** pdf.js paces display rendering with `requestAnimationFrame`, which browsers stop
in a hidden tab — measured at not settling in 12 s, against 407 ms once visible. Switching to
`intent: 'print'` made the original copy correct again. A claim that flips twice is worth
re-testing on every change to the code beneath it, not just once.
