// Static site generator. Deliberately tiny and deliberately not a framework:
// each route is written to disk as a complete HTML document, because the whole
// commercial argument is that a search engine can read these pages.
//
// The CSS is inlined and the fonts are self-hosted. Nothing on any page requests
// a third-party origin, so the tools keep working with the network disconnected
// and the footer readout can honestly say zero.

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import * as esbuild from 'esbuild';
import { TOOLS, PAGES, ALL, HOME_TOOLS, HOME_APP_CARD, APP_FEATURES, TOKENS, href, ORIGIN } from './site.mjs';
import { LANGUAGES } from './langs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist');
const WATCH = process.argv.includes('--watch');
const SERVE = process.argv.includes('--serve');

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- shell

function header(activeSlug) {
  const links = TOOLS.map((t) => {
    const cur = t.slug === activeSlug ? ' aria-current="page"' : '';
    return `        <a href="${href(t.slug)}"${cur}>${t.nav}</a>`;
  }).join('\n');
  return `  <header class="site-header">
    <div class="site-header__inner">
      <a class="brand" href="/"${activeSlug === '' ? ' aria-current="page"' : ''}>
        <span class="brand__mark" aria-hidden="true"></span>
        <span class="brand__word">pdf-iq</span>
      </a>
      <nav class="toolnav" aria-label="PDF tools">
${links}
      </nav>
    </div>
  </header>`;
}

function footer() {
  return `  <footer class="site-footer">
    <div class="site-footer__inner">
      <p class="netreadout" data-netreadout>
        <span class="netreadout__dot" aria-hidden="true"></span>
        <span data-netreadout-text>0 requests &middot; 0 bytes sent since this page loaded</span>
      </p>
      <nav class="footer-nav" aria-label="Site">
        <a href="/privacy/">Privacy</a>
        <a href="/terms/">Terms</a>
        <a href="/support/">Support</a>
        <a href="/app/">Android app</a>
      </nav>
    </div>
  </footer>`;
}

// Fonts are preloaded rather than left to `font-display: swap` to fetch on first use.
// Two reasons, and the second is the important one: a late font fetch lands *after* the
// load event, which is exactly what the footer readout counts, so an untouched page
// would sit there reporting "2 requests" for its own typography. Preloading moves them
// into the initial load where they belong, and the readout can honestly say zero.
const FONT_PRELOADS = [
  'public-sans-400.woff2', 'public-sans-700.woff2', 'public-sans-800.woff2',
  'ibm-plex-mono-400.woff2', 'ibm-plex-mono-500.woff2',
].map((f) => `<link rel="preload" href="/fonts/${f}" as="font" type="font/woff2" crossorigin>`).join('\n');

// The homepage tool grid is generated from TOOLS rather than written out by hand.
// It was duplicated once — in site.mjs and again in index.html — and the two drifted
// within a day, which is exactly how a corrected claim comes back.
function toolGrid() {
  const card = (t) => `      <a class="toolcard${t.outline ? ' toolcard--outline' : ''}" href="${href(t.slug)}">
        <span class="toolcard__mark" aria-hidden="true"></span>
        <span class="toolcard__name">${esc(t.cardName ?? t.name)}</span>
        <span class="toolcard__note">${esc(t.card)}</span>
      </a>`;
  return [...HOME_TOOLS, HOME_APP_CARD].map(card).join('\n');
}

/**
 * Replace {{token}} with the value derived in site.mjs.
 *
 * Both failure modes throw rather than passing through. An unknown token would ship a
 * literal `{{appOfWeb}}` onto the page; a token that quietly stayed put is the same
 * silent no-op as a replace that matches nothing, which is the failure this whole
 * mechanism exists to prevent.
 */
function substituteTokens(body, file) {
  const out = body.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (!(name in TOKENS)) throw new Error(`unknown token {{${name}}} in ${file}`);
    return TOKENS[name];
  });
  const leftover = /\{\{(\w+)\}\}/.exec(out);
  if (leftover) throw new Error(`token ${leftover[0]} survived substitution in ${file}`);
  return out;
}

function document_({ page, body, css }) {
  const url = ORIGIN + href(page.slug);
  const shell = page.shell ? ` style="--shell: ${page.shell}"` : '';
  const script = page.entry ? `\n  <script type="module" src="/assets/${page.entry}.js"></script>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta name="theme-color" content="#FAF8F4">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${FONT_PRELOADS}
<style>${css}</style>
</head>
<body${shell}>
<a class="skip-link" href="#main">Skip to the tool</a>
${header(page.slug)}
  <main class="site-main${page.slug === '' ? ' site-main--home' : ''}" id="main">
${body}
  </main>
${footer()}
  <script type="module" src="/assets/net.js"></script>${script}
</body>
</html>
`;
}

// ---------------------------------------------------------------- fonts

// Self-hosted so that no page ever touches a third-party origin. Google Fonts would
// break the offline test and would put two cross-origin requests behind a readout
// that claims zero.
const FONT_FILES = [
  ['@fontsource/public-sans/files/public-sans-latin-400-normal.woff2', 'public-sans-400.woff2'],
  ['@fontsource/public-sans/files/public-sans-latin-700-normal.woff2', 'public-sans-700.woff2'],
  ['@fontsource/public-sans/files/public-sans-latin-800-normal.woff2', 'public-sans-800.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-400.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', 'ibm-plex-mono-500.woff2'],
];

function fontCss() {
  const face = (family, weight, file) => `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:swap;src:url("/fonts/${file}") format("woff2");}`;
  return [
    face('Public Sans', 400, 'public-sans-400.woff2'),
    face('Public Sans', 700, 'public-sans-700.woff2'),
    face('Public Sans', 800, 'public-sans-800.woff2'),
    face('IBM Plex Mono', 400, 'ibm-plex-mono-400.woff2'),
    face('IBM Plex Mono', 500, 'ibm-plex-mono-500.woff2'),
  ].join('');
}

function copyFonts() {
  mkdirSync(join(OUT, 'fonts'), { recursive: true });
  for (const [from, to] of FONT_FILES) {
    const src = join(ROOT, 'node_modules', from);
    if (!existsSync(src)) throw new Error(`font missing: ${from} — run npm install`);
    cpSync(src, join(OUT, 'fonts', to));
  }
}

// ---------------------------------------------------------------- assets

function copyVendor() {
  mkdirSync(join(OUT, 'vendor'), { recursive: true });
  // pdf.js ships its worker as a separate file and refuses to render without it.
  const worker = join(ROOT, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs');
  if (!existsSync(worker)) throw new Error('pdfjs worker missing — run npm install');
  cpSync(worker, join(OUT, 'vendor', 'pdf.worker.min.mjs'));

  // pdf.js needs its CMap and standard-font tables for documents that use them.
  const cmaps = join(ROOT, 'node_modules/pdfjs-dist/cmaps');
  if (existsSync(cmaps)) cpSync(cmaps, join(OUT, 'vendor', 'cmaps'), { recursive: true });
  const stdFonts = join(ROOT, 'node_modules/pdfjs-dist/standard_fonts');
  if (existsSync(stdFonts)) cpSync(stdFonts, join(OUT, 'vendor', 'standard_fonts'), { recursive: true });

  // Language models, served from this origin. tesseract.js defaults to a CDN, which
  // would mean the OCR page silently contacting a third party the moment it is used.
  // Missing models must fail the build, not skip quietly. A deploy that silently omits them
  // ships an OCR page that looks fine and cannot work — the exact class of failure this
  // project keeps finding late.
  const tessdata = join(ROOT, 'vendor-tessdata');
  if (!existsSync(tessdata)) {
    throw new Error('vendor-tessdata/ is missing — OCR language models are not vendored');
  }
  mkdirSync(join(OUT, 'vendor', 'tessdata'), { recursive: true });
  const models = readdirSync(tessdata).filter((f) => f.endsWith('.traineddata.gz'));
  for (const f of models) cpSync(join(tessdata, f), join(OUT, 'vendor', 'tessdata', f));

  const expected = LANGUAGES.map((l) => `${l.code}.traineddata.gz`);
  const absent = expected.filter((f) => !models.includes(f));
  if (absent.length) {
    throw new Error(
      `language models missing for languages the OCR page offers: ${absent.join(', ')}`
    );
  }

  // tesseract.js worker + wasm core, so OCR never reaches for a CDN.
  const tw = join(ROOT, 'node_modules/tesseract.js/dist/worker.min.js');
  if (existsSync(tw)) cpSync(tw, join(OUT, 'vendor', 'tesseract-worker.min.js'));
  const coreDir = join(ROOT, 'node_modules/tesseract.js-core');
  if (existsSync(coreDir)) {
    mkdirSync(join(OUT, 'vendor', 'tesseract-core'), { recursive: true });
    for (const f of readdirSync(coreDir)) {
      if (/\.(js|wasm)$/.test(f)) cpSync(join(coreDir, f), join(OUT, 'vendor', 'tesseract-core', f));
    }
  }
}

function copyStatic() {
  const pub = join(ROOT, 'public');
  if (existsSync(pub)) cpSync(pub, OUT, { recursive: true });
}

// ---------------------------------------------------------------- scripts

async function bundle() {
  const entries = [
    join(ROOT, 'src/entries/net.ts'),
    ...ALL.filter((p) => p.entry).map((p) => join(ROOT, `src/entries/${p.entry}.ts`)),
  ].filter((p) => existsSync(p));

  await esbuild.build({
    entryPoints: entries,
    bundle: true,
    splitting: true,
    format: 'esm',
    target: ['es2022'],
    outdir: join(OUT, 'assets'),
    minify: !WATCH,
    sourcemap: WATCH,
    logLevel: 'warning',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
}

// ---------------------------------------------------------------- pages

function sitemap() {
  const urls = ALL.map(
    (p) => `  <url><loc>${ORIGIN}${href(p.slug)}</loc><changefreq>monthly</changefreq></url>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.w3.org/2000/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

async function build() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const css = fontCss() + '\n' + read('src/styles/app.css');

  for (const page of ALL) {
    const file = join(ROOT, 'src/pages', `${page.slug || 'index'}.html`);
    if (!existsSync(file)) {
      console.warn(`  (skip) no page body for /${page.slug} — expected src/pages/${page.slug || 'index'}.html`);
      continue;
    }
    let body = readFileSync(file, 'utf8');
    // The page supplies the grid container; this fills it. Asserting the marker was
    // actually consumed, rather than assuming replace() matched, is the same discipline
    // as grepping the built output — a replace that hits nothing returns success.
    if (body.includes('<!--TOOL_GRID-->')) {
      body = body.replace(/[ \t]*<!--TOOL_GRID-->/, toolGrid());
      if (body.includes('<!--TOOL_GRID-->')) {
        throw new Error(`TOOL_GRID marker survived substitution in ${file}`);
      }
    }
    if (body.includes('<!--APP_FEATURES-->')) {
      const items = APP_FEATURES.map((f) => `            <li>${esc(f)}</li>`).join('\n');
      body = body.replace(/[ \t]*<!--APP_FEATURES-->/, items);
      if (body.includes('<!--APP_FEATURES-->')) {
        throw new Error(`APP_FEATURES marker survived substitution in ${file}`);
      }
    }
    body = substituteTokens(body, file);
    const dir = page.slug === '' ? OUT : join(OUT, page.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), document_({ page, body, css }));
  }

  copyFonts();
  copyVendor();
  copyStatic();
  await bundle();

  writeFileSync(join(OUT, 'sitemap.xml'), sitemap());
  writeFileSync(
    join(OUT, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`
  );

  console.log(`built ${ALL.length} routes -> dist/`);
}

await build();

if (SERVE) {
  const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain',
    '.json': 'application/json', '.traineddata': 'application/octet-stream',
    '.gz': 'application/gzip', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream',
  };
  createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = join(OUT, p);
    if (p.endsWith('/')) file = join(file, 'index.html');
    if (!existsSync(file)) {
      // Cloudflare Pages serves /compress and /compress/ alike; match that locally.
      const alt = join(OUT, p, 'index.html');
      if (existsSync(alt)) file = alt;
      else { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    }
    const ext = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
    res.end(readFileSync(file));
  }).listen(4321, () => console.log('serving http://localhost:4321'));
}
