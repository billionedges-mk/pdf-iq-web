// Static site generator. Deliberately tiny and deliberately not a framework:
// each route is written to disk as a complete HTML document, because the whole
// commercial argument is that a search engine can read these pages.
//
// The CSS is inlined and the fonts are self-hosted. Nothing on any page requests
// a third-party origin, so the tools keep working with the network disconnected
// and the footer readout can honestly say zero.

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import * as esbuild from 'esbuild';
import { TOOLS, PAGES, ALL, HOME_TOOLS, HOME_APP_CARD, APP_FEATURES, PRO_FEATURES, TOKENS, href, ORIGIN } from './site.mjs';
import { faqBlock } from './faq.mjs';
import { icon } from './icons.mjs';
import { ogImage } from './og-images.mjs';
import { LANGUAGES } from './langs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NL = String.fromCharCode(10);

/**
 * The file ceiling, read out of the constant that enforces it.
 *
 * Copy that states a limit and code that applies one are the same claim in two places, and
 * this project has watched that drift twice. Parsing it means the FAQ and the drop zone
 * cannot say 60 MB while ui.ts refuses at something else.
 */
function maxFileSizeMb() {
  const ui = readFileSync(join(ROOT, 'src/lib/ui.ts'), 'utf8');
  const m = ui.match(/export const MAX_BYTES = (\d+) \* 1024 \* 1024;/);
  if (!m) throw new Error('could not read MAX_BYTES from src/lib/ui.ts — the size claims would go stale silently');
  return Number(m[1]);
}
const OUT = join(ROOT, 'dist');
const WATCH = process.argv.includes('--watch');
const SERVE = process.argv.includes('--serve');

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/**
 * An identifier for this build, stamped into both the HTML and the bundle so the running
 * page can tell whether the two came from the same deploy.
 *
 * This exists because they can disagree. Cloudflare Pages keeps assets from previous
 * deployments reachable, so a browser holding stale HTML fetches the old, unhashed asset
 * path, gets pre-fix code served `immutable`, and runs it — showing a readout the current
 * build cannot produce, with nothing on the wire to explain it. Nothing local can detect
 * that; only the page itself can, by comparing what it was compiled as against what the
 * document says it should be.
 */
function buildId() {
  const fromCI = process.env.CF_PAGES_COMMIT_SHA;
  if (fromCI) return fromCI.slice(0, 12);
  try {
    return execSync('git rev-parse --short=12 HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    // No git and no CI: hash the sources so the id still changes when the code does.
    const h = createHash('sha256');
    for (const f of ['src/styles/app.css', 'src/entries/net.ts']) h.update(read(f));
    return h.digest('hex').slice(0, 12);
  }
}
const BUILD_ID = buildId();
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
        <span data-netreadout-text>0 bytes sent &middot; 0 third-party requests</span>
      </p>
      <nav class="footer-nav" aria-label="Site">
        <a href="/for-professionals/">Using this at work?</a>
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
        ${icon(t.slug)}
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

function document_({ page, body, css, assets }) {
  const url = ORIGIN + href(page.slug);
  // Titles and descriptions go through the same substitution as the body, and the same
  // leftover assertion. Without this a {{token}} in page metadata shipped verbatim into
  // <meta name="description"> — which it just did, because the check only ran on the body.
  const title = substituteTokens(page.title, `${page.slug || "index"} title`);
  const description = substituteTokens(page.description, `${page.slug || "index"} description`);
  const shell = page.shell ? ` style="--shell: ${page.shell}"` : '';
  const script = page.entry ? `\n  <script type="module" src="/assets/${assets.get(page.entry)}"></script>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">${page.noindex ? '\n<meta name="robots" content="noindex, nofollow">' : ''}
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${ORIGIN}/og/${page.slug || 'home'}.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="pdf-iq">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${ORIGIN}/og/${page.slug || 'home'}.png">
<meta name="theme-color" content="#FAF8F4">
<meta name="pdfiq-build" content="${BUILD_ID}">
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
  <script type="module" src="/assets/${assets.get('net')}"></script>${script}
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
  // The script tag and the bundle must come from the same fact. They did not: the tag was
  // emitted from `page.entry` unconditionally while bundling silently skipped any entry
  // whose file was missing. The homepage declared `entry: 'home'` from the first scaffold
  // and src/entries/home.ts was never written, so every build shipped a page pointing at a
  // bundle that did not exist. Locally that 404s; on Cloudflare Pages it returns 200 with
  // the HTML index, cached immutable for a year, and the footer readout counted it.
  for (const page of ALL) {
    if (!page.entry) continue;
    const file = join(ROOT, `src/entries/${page.entry}.ts`);
    if (!existsSync(file)) {
      throw new Error(`/${page.slug} declares entry '${page.entry}' but ${file} does not exist`);
    }
  }

  const entries = [
    join(ROOT, 'src/entries/net.ts'),
    ...ALL.filter((p) => p.entry).map((p) => join(ROOT, `src/entries/${p.entry}.ts`)),
  ];

  // Entry filenames carry a content hash. Without one, `immutable` on /assets/* is a
  // lie: it tells the browser this URL's bytes will never change, and they change every
  // deploy. A visitor who had loaded the old net.js was pinned to it for a year and kept
  // seeing a readout the live code could not produce. esbuild already hashed the shared
  // chunks; the entry points were the ones still on a stable name.
  const result = await esbuild.build({
    entryPoints: entries,
    bundle: true,
    splitting: true,
    format: 'esm',
    target: ['es2022'],
    entryNames: '[name]-[hash]',
    outdir: join(OUT, 'assets'),
    minify: !WATCH,
    sourcemap: WATCH,
    logLevel: 'warning',
    metafile: true,
    define: { 'process.env.NODE_ENV': '"production"', __PDFIQ_BUILD__: JSON.stringify(BUILD_ID) },
  });

  const hashed = new Map();
  for (const [outPath, meta] of Object.entries(result.metafile.outputs)) {
    if (!meta.entryPoint) continue;
    const name = meta.entryPoint.replace(/^.*[\/]/, '').replace(/\.ts$/, '');
    hashed.set(name, outPath.replace(/^.*[\/]/, ''));
  }
  for (const page of ALL) {
    const need = page.entry ?? null;
    if (need && !hashed.has(need)) throw new Error(`no bundle emitted for entry '${need}'`);
  }
  if (!hashed.has('net')) throw new Error('no bundle emitted for net.ts');
  return hashed;
}

// ---------------------------------------------------------------- pages

/**
 * robots.txt — and what this file can and cannot do.
 *
 * WHAT SHIPS WAS NOT WHAT WAS SERVED, until the dashboard setting behind it was turned off.
 *
 * RESOLVED 30 August 2026: Cloudflare's "Managed robots.txt" toggle was prepending a block
 * ahead of this content, so the live file was its block first and this file's text second.
 * With the toggle off, the served file is now byte-for-byte this one — verified from the
 * served file rather than the repo: 237 bytes, no managed block, no Disallow anywhere.
 *
 * Kept because the shape recurs and the next person to edit this file should know the
 * served copy can differ from the built one. What the managed block had carried:
 *
 *     User-agent: *   Content-Signal: search=yes,ai-train=no,use=reference
 *     Disallow: /     for Amazonbot, Applebot-Extended, Bytespider, CCBot, ClaudeBot,
 *                     CloudflareBrowserRenderingCrawler, Google-Extended, GPTBot,
 *                     meta-externalagent
 *
 * Those Disallows could not be lifted from here, which was the point worth recording: a
 * named group is more specific than `*`, so Cloudflare's `ClaudeBot: Disallow` beat anything
 * this file said through the wildcard, and a competing `ClaudeBot: Allow` group would have
 * left two rules of equal path length whose resolution differs between parsers. It was a
 * dashboard change, and no amount of editing here would have substituted for it.
 *
 * What this file usefully does is name the *search* crawlers, which the managed block does
 * not mention at all: OAI-SearchBot, Claude-SearchBot and PerplexityBot are not blocked
 * today, and naming them means a future managed-rule change cannot quietly remove them
 * through the wildcard.
 *
 * The cost of a named group, worth knowing before adding a Disallow anywhere: a crawler
 * with its own group obeys only that group and ignores `*` entirely. There are no Disallow
 * rules here today — /memory-probe/ is kept out of search with a noindex meta and is absent
 * from the sitemap — but any Disallow added to `*` later must be repeated into every named
 * group below, or those crawlers will not see it.
 *
 * The live file is served with Cache-Control: max-age=14400, so a change takes up to four
 * hours to reach a crawler that has already fetched it.
 */
const SEARCH_CRAWLERS = ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot'];

function robots() {
  const groups = [...SEARCH_CRAWLERS, '*']
    .map((agent) => `User-agent: ${agent}` + NL + 'Allow: /')
    .join(NL + NL);
  return groups + NL + NL + `Sitemap: ${ORIGIN}/sitemap.xml` + NL;
}


function sitemap() {
  // noindex pages are not listed: a sitemap entry is a request to index, so listing one
  // while telling robots not to index it sends two opposite instructions.
  const urls = ALL.filter((p) => !p.noindex).map(
    (p) => `  <url><loc>${ORIGIN}${href(p.slug)}</loc><changefreq>monthly</changefreq></url>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

async function build() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const css = fontCss() + '\n' + read('src/styles/app.css');
  const sizeMb = maxFileSizeMb();
  // Not a literal in site.mjs: the number is read from the constant that enforces it, so
  // the copy and the gate cannot disagree.
  TOKENS.maxFileSize = `${sizeMb} MB`;

  // Bundle first: the pages need the content-hashed filenames to point at.
  const assets = await bundle();

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
    // The homepage describes the application itself. Not added elsewhere: a tool page is a
    // page about one feature, and claiming each is a separate application would be untrue.
    if (page.slug === '') {
      const app = {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'pdf-iq',
        url: ORIGIN + '/',
        applicationCategory: 'UtilitiesApplication',
        operatingSystem: 'Any browser',
        description: page.description,
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        featureList: HOME_TOOLS.map((t) => t.cardName ?? t.name),
      };
      body += `
      <script type="application/ld+json">${JSON.stringify(app).replace(/</g, '\\u003c')}</script>`;
    }
    if (body.includes('<!--FAQ-->')) {
      const tool = TOOLS.find((t) => t.slug === page.slug);
      if (!tool) throw new Error(`${page.slug} has a FAQ marker but is not a tool`);
      body = body.replace(/[ \t]*<!--FAQ-->/, faqBlock(tool, sizeMb));
      if (body.includes('<!--FAQ-->')) throw new Error(`FAQ marker survived substitution in ${file}`);
    }
    if (body.includes('<!--PRO_FEATURES-->')) {
      const items = PRO_FEATURES.map((f) => `            <li>${esc(f)}</li>`).join('\n');
      body = body.replace(/[ \t]*<!--PRO_FEATURES-->/, `          <ul class=\"price__list\">\n${items}\n          </ul>`);
      if (body.includes('<!--PRO_FEATURES-->')) {
        throw new Error(`PRO_FEATURES marker survived substitution in ${file}`);
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
    writeFileSync(join(dir, 'index.html'), document_({ page, body, css, assets }));
  }

  // Cloudflare Pages serves this, with a real 404 status, for any path that matches no
  // file. Without it every unknown URL returned 200 with the homepage — a typo, a dead
  // link and an invented address all answered "here is the site", which is a soft 404: it
  // asks Google to index unlimited duplicates of the homepage under arbitrary URLs, on a
  // site whose whole commercial argument is search. It is also what returned 200 for
  // /assets/home.js when that bundle did not exist, and the readout counted it.
  {
    const file = join(ROOT, 'src/pages/404.html');
    if (!existsSync(file)) throw new Error('src/pages/404.html is missing — every unknown URL would fall back to the homepage');
    let body = readFileSync(file, 'utf8');
    body = body.replace(/[ 	]*<!--TOOL_GRID-->/, toolGrid());
    if (body.includes('<!--TOOL_GRID-->')) throw new Error('TOOL_GRID marker survived substitution in 404.html');
    body = substituteTokens(body, file);
    const page = {
      slug: '404', entry: null, noindex: true,
      title: 'Page not found — pdf-iq',
      description: 'Nothing at this address.',
    };
    writeFileSync(join(OUT, '404.html'), document_({ page, body, css, assets }));
  }

  copyFonts();
  copyVendor();
  copyStatic();

  writeFileSync(join(OUT, 'sitemap.xml'), sitemap());
  // Share images, drawn straight to PNG. Every indexed route gets one; a route that
  // somehow produced nothing would ship a bare grey link, so it throws instead.
  mkdirSync(join(OUT, 'og'), { recursive: true });
  for (const page of ALL.filter((p) => !p.noindex)) {
    const png = ogImage(page.slug);
    if (!png || png.length < 500) throw new Error(`share image for /${page.slug} came out empty`);
    writeFileSync(join(OUT, 'og', `${page.slug || 'home'}.png`), png);
  }

  writeFileSync(join(OUT, 'robots.txt'), robots());

  console.log(`built ${ALL.length} routes -> dist/  (build ${BUILD_ID})`);
}

await build();

if (SERVE) {
  const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain',
    '.json': 'application/json', '.traineddata': 'application/octet-stream',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
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
