# PDFiq — locked strategy

Pricing, tiers and monetisation are decided. Read this before proposing anything about
them; they are not open questions and they are not to be re-litigated.

Everything here was decided explicitly and is reflected in code. Where something is still
open it says so, and says what it is waiting on. Anything not written here is not decided
— ask rather than assume.

Last updated 30 August 2026.

---

## The locked position — never walked back

**The seven web tools are free forever.** Unlimited, one file at a time, no account,
nothing uploaded. This does not change when Pro arrives, and no tool that is free today
moves behind a paywall.

The free/paid line is **capability, not quantity**. Not "ten files a month then pay" —
"read the text" versus "get a file you can search". A limit on volume would make the free
tier a trial; a limit on capability leaves it a complete tool.

**Nothing leaves the device.** No analytics, no tracking, no telemetry, no cookies, no
consent banner, no third-party script of any kind. The footer readout makes this checkable
on every page, and it is the site's whole argument. See `src/entries/net.ts`.

**Every tool works with the network off.** The one exception is the first OCR run, which
fetches a language model once and then works offline.

---

## Individual Pro — $14.99, one time

Not a subscription. Covers both the web tools and the Android app. **Not on sale yet, on
either surface**, and both price cards say so.

The one-time position is deliberate and is stated rather than implied: a PDF utility gets
used a few times a year, and every competitor rents theirs by the month.

What Pro adds:

- Batch processing across every tool
- Searchable-PDF output from OCR
- Advanced compression — target a file size or a dpi
- Password protect and password remove

Single-sourced in `tools/site.mjs` as `PRO`. Both price cards render from it, because the
price was hand-written in two places and drifted twice.

**Gated on Paddle approval** (C4). Four features behind one seller application.

---

## OCR free/Pro split

Free gives the reader **the text**: on screen to read and copy, and downloadable as `.txt`.
The **searchable PDF** — those words written back into the file as an invisible layer — is
the Pro output.

A page that already carries a text layer is read rather than recognised: instant, and the
document's own characters instead of a guess at a picture of them.

`src/lib/textlayer.ts` is deliberately unreachable from the UI while Pro is unbuilt. Its
header explains what covers it and what breaks if that test is deleted as dead code.

**Open, and carried to the app session:** the Android engine only produces the searchable
PDF, so the free text-only path does not exist there. The split cannot be drawn the same
way on the app without engine work.

---

## Firms — $99, cadence undecided

`/for-professionals` is **a demand test, not a product**. Nothing is purchasable; the
button records what someone spends too long on, what they do, their email, and whether
they would expect to pay once or yearly. All free text, no dropdowns — a list only returns
the answers we already thought of.

**The cadence is deliberately an open question, not a value.** If the answers describe a
tool, one-time is honest and a subscription would be rent for something that needs no
maintaining. If they describe something ongoing, per-year fits.

**The unresolved problem, kept in view:** one-time revenue does not compound. This tier was
meant to be the compounding line — sixty firms at $99 once is $5,940, once. If the answers
point at a tool rather than a service, that problem stays open. Better known than papered
over with a cadence nobody asked for.

What the tier would include, if built:

- **Self-hosting** — a firm's IT runs the whole site internally, documents never leave the
  building. Nearly free to offer: the site is already static and works with its server off.
- **Redaction that removes rather than covers** — not built, and the expensive item. The
  page says so in those words rather than promising it and costing it later.
- Bates numbering, seats on one invoice, a written data-handling statement for procurement.

---

## AI summaries — app only, permanently

Not a roadmap gap. Summarising sends document text to Gemini and needs an account to meter.
Both are fine in an app someone chose to install. Neither is fine on a website whose whole
argument is that nothing leaves the device, and which prints a live byte count at the foot
of every page.

Putting summaries on the web would break the one promise the site makes checkable, in the
exact place it is checkable, and would need sign-in on a site whose position is that it has
none.

---

## Deliberately ruled out

- **Analytics of any kind**, including "privacy-friendly" analytics. Cloudflare Web
  Analytics was enabled once and disabled on 29 August: it injected a third-party script
  that made the privacy page false in production while true in source.
- **Email capture on tool pages.** `/for-professionals` is the only page that sends
  anything, and its own copy says so. Seven forms would make that false.
- **AGPL/GPL/SSPL dependencies** — Ghostscript, MuPDF, CoherentPDF. WebAssembly is
  *conveyed* to the browser, so the copyleft obligation attaches.
- **llms.txt**, a how-to blog, paid acquisition, iOS, Product Hunt, TikTok, Discord.

---

## Waiting on

| | |
|---|---|
| Paddle seller approval | The whole Pro tier |
| Twelve testers, fourteen continuous days | The app going public, and everything dated |
| `/for-professionals` answers | Whether the firms tier is built at all, and its cadence |
