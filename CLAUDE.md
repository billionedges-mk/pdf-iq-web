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
- `npm run verify:handoff` — every "next, with this file" link lands on a page that calls
  `claimIncoming()`. A page that does not claim opens empty having consumed the handoff, so the
  link is an offer that cannot work (check 14). Six tools offered "Protect it" for an hour while
  /password/ listened for nothing.
- `npm run verify:stages` — the stage list a tool shows while it works is the one its code runs.
  The labels used to be typed into each page and declared again in its entry, so `/ocr/` announced
  "Writing the text behind the scan" long after the free path stopped writing anything into it.
  `src/lib/ui.ts` now writes the labels from the array at run time; this checks the markup too.
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

**A push is not evidence that the ref moved.** `git push origin main` exits 0 when local `main`
has not moved — including when the commit you just made is on some other branch. Read the remote
back with `git ls-remote origin main` and compare it against the commit you meant to send;
`git status -sb` names the branch you are actually on. On 12 September 2026 a commit sat on a
task branch for twenty minutes while a Cloudflare build was assumed to be queued or failing
(CLAIMS 32).

**When a deploy misbehaves, reproduce the build from the pushed commit**, not from the tree you
have: `git worktree add <dir> <commit>`, link `node_modules` into it (the build resolves fonts by
path from its own root), then `CF_PAGES=1 CF_PAGES_BRANCH=main npm run build`. A clean checkout is
not the build you have been running — that is how the line-ending failure in the claims index was
found, on a file nobody had edited.

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
- **The local stub.** Pro needs a sign-in and a local build has no Firebase key, so a local preview
  could reach no Pro feature at all. `PDFIQ_PRO=1 npm run dev` therefore defines `__PDFIQ_LOCAL__`,
  and `/account/` offers a switch that makes `src/pro/gate.ts` accept a stub in place of a session.
  It is not a sign-in and grants nothing a session would not. A Cloudflare build with `PDFIQ_LOCAL`
  set **refuses by name**; every other build defines the constant false, so the code, its storage
  key `pdfiq.local-pro` and its words are dropped. `verify:pro-gate` proves present-in-local,
  absent-everywhere-else, and the refusal — an absence check whose subject exists nowhere would
  prove nothing, so the local build is built and searched too.
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
- **`--watch` watches `src/`, `public/` and `tools/`, and reloads only the first two.** A change
  under `src/` or `public/` reruns the whole of `build()` — tokens, Pro blocks, hashed bundles,
  the HTML that points at those hashes, share images, self-checks — and logs one timestamped
  line per rebuild, so the server log is the proof a rebuild happened. A change to a
  `tools/*.mjs` file does not: this process imported them once at startup and their exports are
  module-level constants, so a rebuild would read `src/` fresh and `site.mjs` from memory. The
  watcher says so and asks for a restart instead of rebuilding. A failed rebuild keeps the
  server up, logs its `Error:` line, and puts a red band on every HTML response naming the
  failure — `dist/` was emptied before the build threw, so what is served is incomplete, not
  merely old. (Until 12 September 2026 the flag watched nothing at all: it turned off whitespace
  and identifier minification, turned on sourcemaps, and the dev server served the startup
  build for the rest of the session. Two edited files were in no built bundle and a browser
  check at that moment would have passed against code that no longer existed.)
