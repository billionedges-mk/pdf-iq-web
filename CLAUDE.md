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
- **`/for-professionals` is the only page that sends anything.** Keep it that way.

## How this is enforced

`CLAIMS.md` holds 18 checks, each written after a specific failure and naming it. Read it
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

`TECH_DEBT.md` is the open list. Re-verify anything cheap before reporting from it.

## Verifying

- **Grep the built output, not the source.** A replace that matches nothing returns
  success; that has happened ten times here. `dist/` is what ships.
- **Run a regression test against the broken code first** and watch it fail. A test that
  passes before the fix proves nothing.
- Suites: `npm run typecheck`, `npm run build`, `npm run selftest` then open
  `/selftest.html`, `/tools-selftest.html`, `/ocr-text-probe.html`, `/e2e-selftest.html`
  in a browser; `npm run verify:interest`, `npm run verify:pdflib`, `npm run contrast`.
- `/memory-probe/` measures the file ceiling. It refuses to report a figure from a run that
  cannot be true.

## Things that are not what they look like

- `src/lib/textlayer.ts` is unreachable from the UI on purpose — it is the Pro deliverable.
  Its header says what covers it. Do not delete it, or its test, as dead code.
- `writeLayer()` in `src/entries/ocr.ts` is uncalled for the same reason.
- The served `robots.txt` is not the repo file. Cloudflare prepends a managed block ahead
  of it that blocks several AI crawlers; editing the repo file only changes the tail.
