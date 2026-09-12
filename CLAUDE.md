# pdf-iq

Strategy and pricing live in `docs/pdfiq-strategy-locked.md`. Read it before proposing
anything about pricing, tiers, paywalls or monetisation — those are decided.

## Standing rules for this site

- **Nothing may be claimed that isn't true of the current build.** This project has removed
  ~26 false or unmeasured claims already. If you cannot verify a number, ask rather than
  write a plausible one.
- **The site's whole position is that nothing leaves the device.** Never add analytics,
  tracking, telemetry, or anything requiring a cookie or consent banner.
- **Every tool must keep working with the network off.**
- **No tool page ever sends anything.** Only `/for-professionals` does, and `/account/` in a
  Pro-flag build — it exists in no other. Nothing else may.

## How this is enforced

`CLAIMS.md` holds the checks, each written after a specific failure and naming it.
Its index is generated (`node tools/claims-index.mjs`) and verified in `prebuild`, so there is
no count written down anywhere to go stale. Read it
before writing copy or adding a control — most of them are about the gap between what a
thing claims and what it does. The ones that come up most:

- **Check 14** — an offer must be able to work, and must carry the code that fulfils it.
  A rendered control that cannot act has been this project's most repeated defect.
- **Check 15** — a false citation is worse than no citation, because it stops the next
  person checking. When the artefact a comment cites is missing, build it.
- **Check 16** — an instrument needs a check that makes an impossible reading refuse.
- **Check 18** — a status list goes stale in the direction that flatters. Anything settled
  in conversation is unrecorded by default; write it down or the next reader inherits the
  old answer.
- **Check 26** — when you write a page, grep for every other place asserting the same fact
  and compare rather than proofread. Two sentences about one fact is where the stale one
  shows. Writing the refunds page found two defects in files nobody was editing.
- **Check 27** — a check that cannot fail the build is a comment. `contrast` printed FAIL
  and exited 0 for months; the noise was hiding a real failure of the same kind.

`TECH_DEBT.md` is the open list. Re-verify anything cheap before reporting from it.

## Verifying

- **Grep the built output, not the source.** A replace that matches nothing returns
  success; that has happened ten times here. `dist/` is what ships.
- **Run a regression test against the broken code first** and watch it fail. A test that
  passes before the fix proves nothing.
- `npm run verify:states` — a CSS rule keyed on a runtime state class must target something
  that exists. Catches a state that can be entered and can no longer be seen.
- `npm run verify:crypto` — every locked-file case in the app repo's PASSWORD_RULE.md, run
  through the real `openPdf` against MuPDF-written fixtures in `tools/fixtures/crypto/`, with
  every output read back by MuPDF and pypdf. Needs python with PyMuPDF and pypdf. Until it existed the only
  encrypted fixture was our own RC4 file, the one case the code handled correctly.
- `npm run verify:password` — the Pro password page's writer (`src/pro/encrypt.ts`, AES-256 V5 R6):
  protect keeps an author's `/P`, the kept-limits copy opens with no password and carries the
  original bits under a random owner password, and an edited `/P` is ignored in favour of `/Perms`.
  Every output is read back by MuPDF and pypdf. Needs python with PyMuPDF and pypdf.
- `npm run verify:auth` — web sign-in in Node against a scripted Google and Firebase: the
  sign-in URL, state and nonce, the exact storage shape /privacy describes, refresh, and every
  error code sorted into a kind. It cannot prove a real sign-in, Cloudflare honouring the
  account page's CSP, or what Firebase returns when App Check is enforced — see TECH_DEBT.
- **Read a failed Node process's `Error:` line, never its tail.** Node prints the message first,
  then the stack trace and its version banner, so the last lines of a failed build are never the
  reason. The Pro gate failed a correct build twice by matching against the tail.
- Suites: `npm run typecheck`, `npm run build`, `npm run selftest` then open
  `/selftest.html`, `/tools-selftest.html`, `/ocr-text-probe.html`, `/e2e-selftest.html`
  in a browser; `npm run verify:interest`, `npm run verify:pdflib`, `npm run contrast`.
- `/memory-probe/` measures the file ceiling. It refuses to report a figure from a run that
  cannot be true.

## Deploying

**`git push origin main` is the deploy.** Cloudflare Pages builds from the repository; there
is no workflow file in this repo because the build command and output directory are set in
the Cloudflare dashboard, not here.

`npx wrangler pages deploy` does not work from this machine. There is no `CLOUDFLARE_API_TOKEN`
in the environment and no `wrangler.toml`, so wrangler stops with a non-interactive-environment
error before it does anything. Do not spend time on it; push instead.

Then **verify from the served files, not from `dist/`** — a 200 is not proof the right page is
there. Fetch the URL, grep it for a sentence you just wrote, and fetch a path that should not
exist to confirm 404s are still 404s and the 200 means something.

## The Pro flag

Sign-in and the Pro features sit behind one build-time flag, `PDFIQ_PRO`. It turns Pro on for
everyone — there is no entitlement check yet, which is acceptable only because nothing is for sale.

- **Absent, not hidden.** With the flag off, Pro is not in the build: not greyed, not stubbed, not in
  the HTML or the JavaScript. The JavaScript this site ships is its source, so a runtime flag would
  put Pro in every visitor's download and let the console switch it on.
- **How code reaches Pro:** only through `if (__PDFIQ_PRO__) await import('../pro/…')`, with the Pro
  code under `src/pro/`. The build replaces the constant with `false`; esbuild drops the branch and
  never writes the chunk. Page markup uses `<!--PRO-->…<!--/PRO-->`. A claim that is true only while
  sign-in does not exist goes in `<!--FREE-->…<!--/FREE-->` beside its replacement, so the copy and
  the build cannot disagree (`tools/pro-blocks.mjs`; malformed markers fail the build).
- **Sentinels.** Every module under `src/pro/` exports a string starting `pdfiq-pro:` and uses it.
  Every build checks its own output: a sentinel in a flag-off build fails it, and so does a flag-on
  build with no Pro module in the bundle.
- **Pro code, wording included, lives under `src/pro/`.** A Pro branch inside a shared `src/lib`
  function ships in every production bundle, unreachable. Neither the sentinel nor tree-shaking can
  see it, because the module is free code. The searchable-PDF sentence did exactly that, from
  `describeOcr`, until 12 September 2026; grepping the live bundle found it. `verify:pro-gate` now
  carries a tripwire of Pro-only phrases: absent from every flag-off bundle, and present in a Pro
  build only in bundles that carry a sentinel. Add a phrase when a Pro feature adds a sentence.
- **Preview only.** A Cloudflare build of `main` with the flag set throws by name, and so does a
  Cloudflare build that reports no branch. Set `PDFIQ_PRO=1` in the Cloudflare **Preview**
  environment only. Locally: `PDFIQ_PRO=1 npm run build`. A flag-on build is noindex on every page,
  disallows crawling in robots.txt, and carries a preview banner.
- **`npm run verify:pro-gate`** builds with the flag off, on, and on-for-production, and proves each.

## Things that are not what they look like

- **Firebase App Check's Authentication metrics are not a signal.** They show roughly 85% of Auth
  calls unverified. The app's backend checks every request with `verifyIdToken(token, true)`, whose
  revocation check is a server-side call to Auth that carries no App Check token, and debug builds
  add their own. So the split says nothing about whether real installs attest — do not read it as
  one. Deliberately not confirmed against the console; it is harmless either way. What matters is
  that App Check on Auth is monitoring, not enforced: if it is ever enforced, web sign-in must fail
  with its own named error, not a generic one.

- `src/lib/textlayer.ts` is unreachable from the free UI on purpose — it is the Pro deliverable,
  reached only in a Pro-flag build through `src/pro/searchable.ts` (which was `writeLayer()` in
  `src/entries/ocr.ts` until 12 September 2026). A production build never calls it. Its header
  says what covers it. Do not delete it, or its test, as dead code.
- The served `robots.txt` is not the repo file. Cloudflare prepends a managed block ahead
  of it that blocks several AI crawlers; editing the repo file only changes the tail.
- **`--watch` does not watch.** In `tools/build.mjs` it only turns off whitespace and identifier
  minification and turns on sourcemaps; the dev server builds once at start and then serves that.
  Restart the server after every source edit, and grep `dist/` for the change before a browser
  check — otherwise the check runs the old code and passes. (Found 12 September 2026, when a
  fixed string was in no built bundle.)
