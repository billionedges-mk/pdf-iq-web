# pdf-iq.com

Seven PDF tools that run inside the browser tab. No upload, no account, no server-side
processing — not as a policy, as an architecture. The file is opened by the browser, changed on
the device, and saved back to disk.

The footer of every page carries a live readout of requests made and bytes sent since load. It is
real instrumentation (`src/entries/net.ts`), not decoration. If it ever shows bytes sent, that is
a bug worth chasing.

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
vendor-tessdata/     OCR language models, committed (~49 MB, see TECH_DEBT.md)
```

Every route is written to disk as a complete HTML document. There is no client-side router,
because a search engine reading these pages is the entire commercial argument.

---

## Deployment — Cloudflare Pages

### Why Pages rather than the existing VPS

Measured footprint: **98 MB built, 245 files, largest single file 10.9 MB.** Of that, 49 MB is
OCR language models and ~24 MB is tesseract wasm core variants (only one of which any given
browser fetches). A tool page first-loads in **131 KB**.

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

Current tree: 27 packages, zero copyleft. pdf-lib (MIT), pdfjs-dist (Apache-2.0), tesseract.js
(Apache-2.0), fonts OFL-1.1. The bundled OCR language models are Apache-2.0 from the Tesseract
project.

---

## Known gaps

See `TECH_DEBT.md`. The short version: the 200 MB file ceiling is a placeholder, encrypted PDFs
are written but untested, the CMYK/JPX/JBIG2/CCITT skip paths have never met a real file of those
kinds, and OCR accuracy is measured only against clean synthetic type.
