# pdf-iq.com

Seven PDF tools that run inside the browser tab. No upload, no account, no server-side
processing — not as a policy, as an architecture. The file is opened by the browser, changed on
the device, and saved back to disk.

The footer of every page carries a live readout of bytes sent and third-party requests. It is
real instrumentation (`src/entries/net.ts`), not decoration.

One page sends something: `/for-professionals`, which asks firms what to build and stores three
answers and an email. It says so before you press anything, and the counter moving is the point.
Everywhere else, bytes sent should read zero, and third-party requests should read zero on every
page including that one. If either is non-zero anywhere else, that is a bug worth chasing.

---

## Running it

```bash
npm install
npm run build      # -> dist/
npm run dev        # build, watch, and serve on http://localhost:4321
```

Gates, all of which should pass before a deploy:

```bash
npm run typecheck  # tsc --noEmit
npm run licenses   # fails on any AGPL/GPL/SSPL anywhere in the tree
node tools/contrast.mjs   # WCAG contrast for every colour pair the design uses
```

In-browser verification, which is where anything involving canvas, codecs or pdf.js has to be
checked, because none of it exists in Node:

```bash
node tools/selftest.mjs    # then open /selftest.html and /tools-selftest.html
```

---

## Layout

```
src/pages/*.html     page bodies; the shell is added at build time
src/entries/*.ts     one bundle per page
src/lib/             the actual work: compress, outline, textlayer, ocr-pool, ...
src/test/            in-browser self-tests
tools/build.mjs      the static site generator
tools/site.mjs       routes, nav order and page metadata — single source of truth
functions/api/       the one server endpoint: /for-professionals' form, on Cloudflare D1
vendor-tessdata/     OCR language models, committed (~49 MB, see TECH_DEBT.md)
```

Every route is written to disk as a complete HTML document. There is no client-side router,
because a search engine reading these pages is the entire commercial argument.

---

## Deployment — Cloudflare Pages

### Why Pages rather than the existing VPS

Measured footprint: **98 MB built, 255 files, largest single file 10.4 MB.** Of that, 49 MB is
OCR language models and ~24 MB is tesseract wasm core variants (only one of which any given
browser fetches). A tool page first-loads in **206 KB transferred** — measured against the live
site with brotli, counting the page, its entry bundle and every shared chunk the entry imports.
Nearly all of it is one 178 KB chunk, which is pdf-lib.

Three reasons Pages wins:

1. **Bandwidth.** The models are the whole story: 6–11 MB, once per user per language. A
   thousand OCR users is roughly 10 GB. On Pages that is free and uncapped; on a metered VPS the
   failure mode is a surprise bill or throttling at exactly the moment the site starts working.
2. **Distance.** The models are the one large download, and a single origin serving them
   worldwide is the weak point. A CDN edge turns a 20-second wait into a 2-second one.
3. **The architecture argument is structural, not rhetorical.** "We cannot process your file" is
   a much stronger claim from a host with no compute than from a box that also runs nginx and
   PHP for another site. It also means there is no origin to compromise, and pdf-iq is isolated
   from billionedges.com rather than sharing its blast radius.

The VPS would win if we needed server-side logic. We do not, and deliberately never will.

Both limits are comfortable: Pages caps at 25 MiB per file (we peak at 10.9 MB) and 20,000 files
(we have 245).

### Build settings

| Setting | Value |
|---|---|
| Framework preset | **None** |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | *(repo root, leave blank)* |
| Environment variable | `NODE_VERSION` = `22` |

`public/_headers` is picked up automatically and carries the CSP, the cache policy, and the
`Content-Type: application/gzip` rule for the language models. **That last one matters:** the
models are gzip streams that tesseract.js inflates itself, so if the CDN applied its own
`Content-Encoding` on top, the browser would silently decode one layer and hand tesseract data it
cannot inflate.

### DNS

Simplest path is to move `pdf-iq.com`'s nameservers to Cloudflare; Pages then creates the apex
and `www` records itself when you add the custom domain (CNAME flattening handles the apex).

| Record | Name | Value | Notes |
|---|---|---|---|
| CNAME | `pdf-iq.com` | `<project>.pages.dev` | created by Pages |
| CNAME | `www` | `<project>.pages.dev` | created by Pages |
| MX | `pdf-iq.com` | *your mail provider's* | **must be re-created after the nameserver move** |
| TXT | `pdf-iq.com` | SPF | from the mail provider |
| TXT | `<selector>._domainkey` | DKIM | from the mail provider |
| TXT | `_dmarc` | DMARC policy | start at `p=none` |

### Lead-time items — start these before deploy day

1. **Nameserver change: up to 24–48 hours to propagate.** Everything else waits on it. Start it
   first.
2. **The mailbox.** Set `support@pdf-iq.com` up *before* moving nameservers, then copy the MX,
   SPF and DKIM records into Cloudflare as part of the move. Moving nameservers without carrying
   the mail records across silently breaks email — and the address appears 12 times across the
   site.
3. **The GitHub repo must exist and be connected** before Pages can build from it.
4. **Do not repoint anything on the app side until `pdf-iq.com/privacy` returns 200 in a
   browser.** That URL is registered in Play Console and in the Data Safety declaration. See
   `TECH_DEBT.md`.

---

## Licensing

`npm run licenses` walks the whole transitive tree and fails on anything copyleft. This is a
build gate, not a courtesy: Ghostscript, MuPDF and CoherentPDF are all AGPL-3.0, and WebAssembly
is *conveyed* to the visitor's browser, which would put this entire site under source-disclosure
obligations. Compression is therefore an object-level image walk with pdf-lib rather than a port
of any of them.

This project is MIT licensed — see `LICENSE`. The bundled OCR language models are Apache-2.0
from the Tesseract project and the fonts are OFL-1.1; both carry their own terms.

Current tree: 27 packages, zero copyleft. pdf-lib (MIT), pdfjs-dist (Apache-2.0), tesseract.js
(Apache-2.0), fonts OFL-1.1. The bundled OCR language models are Apache-2.0 from the Tesseract
project.

---

## Limitations

The full list is `TECH_DEBT.md`. These are the ones worth knowing before you trust it with
anything:

**Files over 60 MB are refused.** The ceiling is measured, not guessed, and it is set from the
point where the work stops being *usable* rather than where the tab crashes — those are far apart.
On the machine it was measured on, `save()` went from 4.2s at 80 MB to 163s at 85 MB while the tab
stayed alive and answered nothing; an actual crash is nearer 800 MB, and an iPhone completed 400 MB.
Measuring for the crash would have justified raising the limit to 600 MB. Reproduce it at
`/memory-probe/`, which refuses to report a figure from a run that cannot be true.

Two caveats on that number, both real: it comes from one desktop, and no valid phone measurement
was ever obtained — three attempts produced impossible readings, and the probe now rejects them
rather than printing them.

**Encrypted PDFs: RC4 40-bit is the only handler tested against a real file.** RC4 128-bit,
AES-128 and AES-256 are implemented from the specification and have never met a document. Both the
user and owner password paths work; the owner path exists because the first real locked file to
arrive carried a correct owner password and was rejected.

**CMYK, JPEG 2000, JBIG2 and CCITT images are detected and skipped**, with a specific reason given
to the user. That logic is tested; it has never run against a real file of any of those kinds.

**OCR accuracy is measured only against clean synthetic type** — 95% mean confidence there, which
says nothing about a phone photo of a contract. Pages that already carry a text layer are read
rather than recognised, which is both faster and exact.

**Browsers:** everything is exercised in Chrome, and Safari on iPhone has been walked through the
four things most likely to break there. Desktop Safari and Firefox have not been tested.

## Claim review

`CLAIMS.md` holds twenty-one checks, each written after a specific failure and naming it. It is
worth reading before the code: most of the interesting bugs in this project were not crashes but
gaps between what something claimed and what it did — a button that ran and discarded its result,
a comment citing a probe file that did not exist, a measuring tool that reported an impossible
number four times.

The governing rule is that a number which cannot be measured does not ship — cut, not softened.
