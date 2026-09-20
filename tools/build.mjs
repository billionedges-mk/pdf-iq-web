// Static site generator. Deliberately tiny and deliberately not a framework:
// each route is written to disk as a complete HTML document, because the whole
// commercial argument is that a search engine can read these pages.
//
// The CSS is inlined and the fonts are self-hosted. Nothing on any page requests
// a third-party origin, so the tools keep working with the network disconnected
// and the footer readout can honestly say zero.

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync, readdirSync, statSync, watch } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import * as esbuild from 'esbuild';
import { applyProBlocks, applySaleBlocks } from './pro-blocks.mjs';
import { TOOLS, PAGES, ALL, PRO_PAGES, HOME_TOOLS, HOME_APP_CARD, APP_FEATURES, TOKENS, href, ORIGIN, PRO as PRO_OFFER } from './site.mjs';
import { AUTH } from './auth-config.mjs';
import { PADDLE } from './paddle-config.mjs';
import { faqBlock } from './faq.mjs';
import { PRO_COPY, PRO_FEATURES, proState, proStrip, proPanel, proSheet, proSurfaces, proWhere, lockedPanelStatic } from './pro-copy.mjs';
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
/**
 * --watch: rebuild on every change under src/, public/ and tools/.
 *
 * For a while it did not. The flag existed and was read in exactly three places — whether to
 * minify whitespace, whether to minify identifiers, whether to emit a sourcemap — and nothing
 * watched anything. `npm run dev` built once and then served dist/ as it was for the rest of
 * the session. On 12 September 2026 two source files were edited with the dev server running
 * and a grep of dist/assets/*.js for the new strings found nothing: the server log had one
 * build line, from startup. A browser check at that moment would have passed, against code
 * that no longer existed in src/. That is the failure this flag now actually prevents.
 *
 * A rebuild reruns build() whole. Not esbuild on its own: this file also substitutes tokens
 * into src/pages/*.html, resolves the Pro blocks, content-hashes the bundles and writes the
 * HTML that points at those hashes, generates the share images, and runs the self-checks.
 * Rerunning only the bundler would leave dist/ holding hashed assets no page references.
 */
const WATCH = process.argv.includes('--watch');
const SERVE = process.argv.includes('--serve');

/**
 * The Pro flag: sign-in and the Pro features, on only in a preview build.
 *
 * A build constant, not a runtime setting, because the JavaScript this site ships is its
 * source — a runtime flag would put Pro in every visitor's download and let the console turn
 * it on. The same problem the Android app solved with a source-set split. See CLAUDE.md,
 * "The Pro flag", and src/pro/core.ts.
 *
 * On production it is allowed only alongside PDFIQ_SALE, and that pairing is the whole rule.
 *
 * Until 20 September 2026 the flag was refused on production outright, for a reason that is still true of the flag
 * on its own: **without PDFIQ_SALE, Pro belongs to whoever signs in.** src/pro/gate.ts, proAccount():
 * `if (!__PDFIQ_SALE__) return session;` — no entitlement is consulted, because in a preview build there is nothing
 * to have bought. The locked panel even says "Sign in to use it in this preview build". On pdf-iq.com that is Pro
 * given away to any Google account, over copy calling the live site a preview.
 *
 * So the refusal is not lifted here, it is narrowed to the state that was actually forbidden. The two flags go on in
 * ONE deploy. Setting PDFIQ_PRO first and PDFIQ_SALE afterwards — the order the launch checklist used to imply —
 * opens a window, however short, in which signing in is free Pro on the production site; a build in that state now
 * refuses rather than publishing.
 *
 * A Cloudflare build that does not say which branch it is still counts as production.
 */
const PRO = /^(1|true|on)$/i.test(process.env.PDFIQ_PRO ?? '');
const ON_CLOUDFLARE = Boolean(process.env.CF_PAGES);
const PRODUCTION = ON_CLOUDFLARE && (process.env.CF_PAGES_BRANCH ?? 'main') === 'main';
const SELLING = /^(1|true|on)$/i.test(process.env.PDFIQ_SALE ?? '');
if (PRO && PRODUCTION && !SELLING) {
  throw new Error(
    'PDFIQ_PRO is set on a production build (Cloudflare Pages, branch ' +
    `${process.env.CF_PAGES_BRANCH ?? 'unknown, treated as main'}) without PDFIQ_SALE. Without the sale flag, Pro ` +
    'belongs to anyone who signs in (src/pro/gate.ts, proAccount) and the locked panels call this a preview build. ' +
    'Set both flags in the same deploy, or neither: docs/sale-go-live.md step 5.'
  );
}
/** Every module under src/pro/ carries a string with this prefix; see src/pro/core.ts. */
const PRO_SENTINEL_PREFIX = 'pdfiq-pro:';
/**
 * The routes this build emits. Pro-only pages (site.mjs PRO_PAGES) join only when the flag is on:
 * in any other build they are absent — no page, no bundle, no link — not hidden.
 */
// A `sale` page (/pro/buy/) joins only a build that can actually sell: tools/paddle-config.mjs.
const ROUTES = PRO ? [...ALL, ...PRO_PAGES.filter((p) => !p.sale || PADDLE?.page)] : ALL;
if (PRO && !AUTH.apiKey) {
  console.warn('  (pro) no PDFIQ_FIREBASE_WEB_KEY: /account/ will say signing in is not set up, and make no request');
}
/**
 * The local Pro stub.
 *
 * Pro needs a sign-in, and signing in needs a Firebase key a build served from a developer machine
 * does not have — so without this, a local preview cannot reach any Pro feature at all. The stub
 * is not a sign-in: it is a flag in the browser that src/pro/gate.ts accepts in place of a session.
 * It grants nothing that a session would not, because there is no entitlement check yet either way.
 *
 * It must not exist in a deployed build. A Cloudflare build that asks for it refuses by name, and
 * every build without it defines the constant false — esbuild then drops the code, its storage key
 * and its words out of the bundle entirely. tools/verify-pro-gate.mjs proves both halves.
 */
const LOCAL_ASKED = /^(1|true|on)$/i.test(process.env.PDFIQ_LOCAL ?? '');
if (LOCAL_ASKED && ON_CLOUDFLARE) {
  throw new Error(
    'PDFIQ_LOCAL is set on a Cloudflare build (branch ' +
    `${process.env.CF_PAGES_BRANCH ?? 'unknown'}). The local Pro stub exists only in a build served ` +
    'from a developer machine. Remove PDFIQ_LOCAL from the environment variables.'
  );
}
const LOCAL = PRO && !ON_CLOUDFLARE && (LOCAL_ASKED || SERVE);
if (LOCAL) {
  console.warn('  (pro) local stub: /account/ can switch Pro on in this browser without Google');
}
const PREVIEW_BANNER =
  '<div data-pdfiq-pro="pdfiq-pro:preview" role="note" style="background:#1E2A38;color:#FAF8F4;' +
  'font:600 14px/1.45 system-ui,sans-serif;padding:9px 16px;text-align:center">' +
  (PADDLE?.page
    ? 'Preview build with the Pro flag on, selling through the Paddle SANDBOX \u2014 test payments only; no real card is charged.</div>'
    : 'Preview build with the Pro flag on \u2014 not the live site, and nothing here is for sale.</div>');

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

/**
 * The bar (redesign stage 1, pdf-iq-final.html): the free tools; in a Pro build a divider, then the Pro group in gold
 * with its PRO label, then the account control. Three states, settled in the page by src/pro/strip.ts:
 *
 *   signed out            "Sign in" pill      Pro group with PRO label
 *   signed in, no Pro     avatar + name       Pro group with PRO label
 *   signed in, owns Pro   avatar + name       Pro group, no label (it marks a category, not a lock)
 *
 * The label and the control are written hidden and shown once settled, so an owner never sees the label flash and a
 * signed-in person never sees "Sign in". A build without the Pro flag has neither: no Pro pages, no sign-in.
 */
/**
 * A page "sells" when it carries one of the three things that offer Pro: the strip under a tool's heading, the homepage
 * panel, or a price card. Read from the built body rather than from a list of pages, so a page that starts or stops
 * selling takes its phone Pro button with it (tools/verify-price-offers.mjs checks the two agree).
 */
const SELLS = /data-pro-strip|class="price__amount"/;

function header(activeSlug, sells) {
  const link = (t) => `<a href="${href(t.slug)}"${t.slug === activeSlug ? ' aria-current="page"' : ''}>${t.nav}</a>`;
  const free = TOOLS.map((t) => `        ${link(t)}`).join('\n');
  const proPages = PRO ? PRO_PAGES.filter((p) => p.nav) : [];
  // The Pro group is written twice: inside the scrolling bar for wider screens, and on the top row beside the account
  // control for phones, where inside the bar it started past the right edge (owner, 13 September 2026: "a redesign that
  // fixes it on desktop and not on mobile has fixed nothing"). CSS shows exactly one; the other is display: none, which
  // also takes it out of the accessibility tree, so nobody hears the links twice.
  const group = (where, indent) => `<span class="toolnav__pro toolnav__pro--${where}" role="group" aria-label="Pro">
${indent}  <span class="pro-tag" data-pro-label hidden>PRO</span>
${proPages.map((t) => `${indent}  ${link(t)}`).join('\n')}
${indent}</span>`;
  const pro = proPages.length ? `\n        ${group('bar', '        ')}` : '';
  const proTop = proPages.length ? `\n      ${group('top', '      ')}` : '';
  // The account control is the one bar item that never goes: an owner loses the Pro button, and on a phone the footer is
  // the furthest thing on the page (owner, 17 September 2026 — the third purchase-path hole of this shape).
  const account = PRO
    ? `\n      <a class="acct" href="/account/" data-account-control hidden${activeSlug === 'account' ? ' aria-current="page"' : ''}>Sign in</a>`
    : '';
  // Phones: two buttons instead of a scrolling strip that showed four of seven tools at 375px (measured, 17 September
  // 2026). Both open a sheet, so the pattern is learned once. The Pro button goes when Pro is owned; the account control
  // does not. CSS shows these only where the strip is hidden.
  const bars = `
      <button class="barbtn" type="button" data-sheet-open="tools" aria-controls="sheet-tools" aria-expanded="false">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>Tools
      </button>
${sells ? `
      <button class="barbtn barbtn--pro" type="button" data-sheet-open="pro" aria-controls="sheet-pro" aria-expanded="false" data-pro-strip${PRO ? ' hidden' : ''}>Pro</button>` : ''}`;
  const here = [...TOOLS, ...proPages].find((t) => t.slug === activeSlug);
  const where = here ? `\n      <p class="wherenow">You are on <b>${esc(here.nav)}</b></p>` : '';
  return `  <header class="site-header">
    <div class="site-header__inner">
      <a class="brand" href="/"${activeSlug === '' ? ' aria-current="page"' : ''}>
        <span class="brand__mark" aria-hidden="true"></span>
        <span class="brand__word">pdf-iq</span>
      </a>
      <nav class="toolnav" aria-label="PDF tools">
${free}${pro}
      </nav>${proTop}${bars}${account}${where}
    </div>
  </header>`;
}

/**
 * The two phone sheets (owner's phone design, 17 September 2026). Written into every page, hidden, and opened by the bar
 * buttons; src/entries/net.ts does the opening. The list is the nav's list, from the same TOOLS and PRO_PAGES, so a tool
 * cannot appear in one and not the other. The sheet scrolls: nine rows at 45px do not fit a 360x640 phone with browser
 * chrome (Password measured off-screen at 493-539), and shorter rows would break the 44px touch target.
 */
function sheets(activeSlug, sells) {
  const row = (t, cls) => {
    const current = t.slug === activeSlug;
    return `        <a class="sheetrow${cls}" href="${href(t.slug)}"${current ? ' aria-current="page"' : ''}>`
      + `<span class="sheetrow__mark" aria-hidden="true">${icon(t.slug).replace('class="toolcard__mark"', 'class="sheetrow__glyph"').replace('width="24" height="24"', 'width="19" height="19"')}</span>`
      + `<span class="sheetrow__name">${esc(t.nav)}</span>`
      + `${current ? '<span class="sheetrow__here">you are here</span>' : ''}</a>`;
  };
  const proPages = PRO ? PRO_PAGES.filter((p) => p.nav) : [];
  const proRows = proPages.length
    ? `\n        <p class="sheetsep"><span class="pro-tag" data-pro-label hidden>PRO</span><span class="sheetsep__line" aria-hidden="true"></span></p>\n`
      + proPages.map((t) => row(t, ' sheetrow--pro')).join('\n')
    : '';
  const proSheetMarkup = sells ? proSheet({ selling: Boolean(PADDLE?.page) || PRO_OFFER.onSale, hidden: PRO }) : '';
  return `  <div class="scrim" data-sheet="tools" id="sheet-tools" hidden>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Tools">
      <span class="sheet__grab" aria-hidden="true"></span>
      <nav class="sheet__list" aria-label="Tools">
${[...TOOLS.map((t) => row(t, '')), proRows].filter(Boolean).join('\n')}
      </nav>
      <button class="btn-quiet sheet__close" type="button" data-sheet-close>Close</button>
    </div>
  </div>
${sells ? `
  <div class="scrim" data-sheet="pro" id="sheet-pro" hidden>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Pro">
      <span class="sheet__grab" aria-hidden="true"></span>
${proSheetMarkup}
      <button class="btn-quiet sheet__close" type="button" data-sheet-close>Close</button>
    </div>
  </div>` : ''}`;
}

function footer() {
  return `  <footer class="site-footer">
    <div class="site-footer__inner">
      <p class="netreadout" data-netreadout>
        <span class="netreadout__dot" aria-hidden="true"></span>
        <span data-netreadout-text>0 bytes sent &middot; 0 third-party requests</span>
      </p>
      <nav class="footer-nav" aria-label="Site">
        <a href="/for-professionals/">Using this at work?</a>${PRO ? '\n        <a href="/account/">Account</a>' : ''}
        <a href="/privacy/">Privacy</a>
        <a href="/terms/">Terms</a>
        <a href="/refunds/">Refunds</a>
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
  'inter-tight-400.woff2', 'inter-tight-500.woff2', 'inter-tight-600.woff2', 'inter-tight-700.woff2',
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
  // {{proStrip}} is generated from tools/pro-copy.mjs, which site.mjs cannot import (pro-copy imports site).
  // A sale build names the price. A Pro build writes the strip hidden: src/pro/strip.ts shows it only to someone who
  // does not own Pro, so an owner never sees it, not even for a moment. Production writes it visible, and has no owners.
  const selling = Boolean(PADDLE?.page) || PRO_OFFER.onSale;
  // {{proFeatureCountCap}} and {{proSurfaces}} count and name PRO_COPY's entries, so a fifth feature — or one that
  // reaches the app — changes every page that mentions them without a page being edited.
  const COUNTS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  const tokens = {
    ...TOKENS,
    proStrip: proStrip({ selling, hidden: PRO }),
    proPanel: proPanel({ selling, hidden: PRO }),
    searchableLocked: lockedPanelStatic('searchable', 'Searchable PDF'),
    proFeatureCountCap: COUNTS[PRO_COPY.length] ?? String(PRO_COPY.length),
    proSurfaces: proSurfaces(),
    proWhere: proWhere(),
  };
  const out = body.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (!(name in tokens)) throw new Error(`unknown token {{${name}}} in ${file}`);
    return tokens[name];
  });
  const leftover = /\{\{(\w+)\}\}/.exec(out);
  if (leftover) throw new Error(`token ${leftover[0]} survived substitution in ${file}`);
  return out;
}

/**
 * Which routes get a share image. Used both by the <head> and by the loop that writes the
 * files, because they were separate: the head emitted an og:image for every route and the
 * loop skipped noindex ones, so /memory-probe advertised a card that 404s. One predicate,
 * and an assertion at the end of the build that every advertised card exists on disk.
 */
const hasShareImage = (page) => !page.noindex;

function document_({ page, body, css, assets }) {
  const url = ORIGIN + href(page.slug);
  const sells = SELLS.test(body);
  // Titles and descriptions go through the same substitution as the body, and the same
  // leftover assertion. Without this a {{token}} in page metadata shipped verbatim into
  // <meta name="description"> — which it just did, because the check only ran on the body.
  const title = substituteTokens(page.title, `${page.slug || "index"} title`);
  // A build that sells uses a route's saleDescription where it has one: a description is copy too, and /pro/'s said "Not on
  // sale yet." in a sale build, where no reader of the page could see it (tools/verify-price-offers.mjs reads metadata).
  const selling = Boolean(PADDLE?.page) || PRO_OFFER.onSale;
  const description = substituteTokens((selling && page.saleDescription) || page.description, `${page.slug || "index"} description`);
  const shell = page.shell ? ` style="--shell: ${page.shell}"` : '';
  const script = page.entry ? `\n  <script type="module" src="/assets/${assets.get(page.entry)}"></script>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">${page.noindex || PRO ? '\n<meta name="robots" content="noindex, nofollow">' : ''}
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${hasShareImage(page) ? `<meta property="og:image" content="${ORIGIN}/og/${page.slug || 'home'}.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">` : ''}
<meta property="og:site_name" content="pdf-iq">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${ORIGIN}/og/${page.slug || 'home'}.png">
<meta name="theme-color" content="#FFFFFF">
<meta name="pdfiq-build" content="${BUILD_ID}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${FONT_PRELOADS}
<style>${css}</style>
</head>
<body${shell}>
${PRO ? PREVIEW_BANNER + '\n' : ''}<a class="skip-link" href="#main">${TOOLS.some((t) => t.slug === page.slug) ? 'Skip to the tool' : 'Skip to content'}</a>
${header(page.slug, sells)}
  <main class="site-main${page.slug === '' ? ' site-main--home' : ''}" id="main">
${body}
  </main>
${sheets(page.slug, sells)}
${footer()}
  <script type="module" src="/assets/${assets.get('net')}"></script>${LOCAL ? `\n  <script type="module" src="/assets/${assets.get('local-badge')}"></script>` : ''}${script}
</body>
</html>
`;
}

// ---------------------------------------------------------------- fonts

// Self-hosted so that no page ever touches a third-party origin. Google Fonts would
// break the offline test and would put two cross-origin requests behind a readout
// that claims zero.
const FONT_FILES = [
  // Inter Tight: the redesign's type (owner's brief, 13 September 2026). Share images use it too (og-images.mjs).
  ['@fontsource/inter-tight/files/inter-tight-latin-400-normal.woff2', 'inter-tight-400.woff2'],
  ['@fontsource/inter-tight/files/inter-tight-latin-500-normal.woff2', 'inter-tight-500.woff2'],
  ['@fontsource/inter-tight/files/inter-tight-latin-600-normal.woff2', 'inter-tight-600.woff2'],
  ['@fontsource/inter-tight/files/inter-tight-latin-700-normal.woff2', 'inter-tight-700.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-400.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', 'ibm-plex-mono-500.woff2'],
];

function fontCss() {
  const face = (family, weight, file) => `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:swap;src:url("/fonts/${file}") format("woff2");}`;
  return [
    face('Inter Tight', 400, 'inter-tight-400.woff2'),
    face('Inter Tight', 500, 'inter-tight-500.woff2'),
    face('Inter Tight', 600, 'inter-tight-600.woff2'),
    face('Inter Tight', 700, 'inter-tight-700.woff2'),
    face('IBM Plex Mono', 400, 'ibm-plex-mono-400.woff2'),
    face('IBM Plex Mono', 500, 'ibm-plex-mono-500.woff2'),
  ].join('');
}

/**
 * Drop CSS comments on the way into the page.
 *
 * app.css is inlined in a <style> block on every page, comments and all, so 4.4 KB of
 * commentary shipped 16 times for a reader who cannot see it. The comments are worth
 * keeping — they explain why there are two ambers and why the repeated seam went. They are
 * worth keeping in the source. Dropping them on the way out is what a build is for.
 *
 * A scan rather than a regex, because a comment delimiter is legal inside a string or a
 * url(), and a regex that ate one would silently emit broken CSS that still reads fine in a
 * diff. Nothing in app.css does that today. The point is that it may, and this is the file
 * that would not notice.
 *
 * The assertion at the bottom went through two versions and the first one was worthless.
 * It compared brace and semicolon counts, which a scan that swallows one character past
 * every comment leaves untouched — so a deliberately broken stripper passed it. Counting
 * proxies cannot see a character disappear unless it happens to be punctuation the proxy
 * counts. This version records the spans it removed and reconstructs the input without
 * them, then requires the reconstruction and the output to agree character for character
 * once whitespace is normalised. Anything the scan ate that was not a comment shows up.
 *
 * Whitespace-insensitive on purpose, and that was checked rather than assumed: whitespace
 * outside a string is not significant in CSS, so a scan that swallows the newline after a
 * comment is not a defect and this does not fire on one. Butt a comment against a selector
 * so the swallowed character is significant, and it does. Both directions were run.
 */
function stripCssComments(css) {
  const removed = [];
  let out = '';
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '"' || c === "'") {
      const quote = c;                       // copy the string whole, escapes included
      out += c; i++;
      while (i < css.length && css[i] !== quote) {
        if (css[i] === '\\') { out += css[i]; i++; }
        if (i < css.length) { out += css[i]; i++; }
      }
      if (i < css.length) { out += css[i]; i++; }
      continue;
    }
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      if (end === -1) throw new Error('unterminated comment in app.css');
      removed.push([i, end + 2]);
      i = end + 2;
      if (out && !out.endsWith('\n')) out += '\n';   // keep rules from running together
      continue;
    }
    out += c; i++;
  }
  out = out.replace(/\n{3,}/g, '\n\n');

  // Stripping must remove the comments and nothing else. Rebuild the input with exactly the
  // spans the scan claims it removed, and require the two to match once whitespace is
  // normalised — so any other character it consumed is a failure, wherever it was.
  let rebuilt = '';
  let at = 0;
  for (const [a, b] of removed) { rebuilt += css.slice(at, a); at = b; }
  rebuilt += css.slice(at);
  const bare = (t) => t.replace(/\s+/g, ' ').trim();
  if (bare(rebuilt) !== bare(out)) {
    throw new Error(
      'stripping CSS comments changed the stylesheet, not just its size — ' +
      `${removed.length} comment(s) removed, but the remainder does not match`
    );
  }
  return out;
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
  if (PRO) writeFileSync(join(OUT, '_headers'), readFileSync(join(OUT, '_headers'), 'utf8') + accountHeaders() + (PADDLE?.page ? buyHeaders() : ''));
}

/**
 * The account page is the one page that talks to Google, so it alone gets a policy that adds
 * exactly the hosts in tools/auth-config.mjs to connect-src. Derived from the site-wide policy
 * rather than written out a second time, so the two cannot drift apart; everything else in it is
 * identical. Two CSP headers intersect rather than widen, so the site-wide one is detached for this
 * path first (`! Content-Security-Policy`). Appended only in a Pro-flag build: production's
 * _headers is public/_headers, byte for byte.
 */
function accountHeaders() {
  const site = readFileSync(join(ROOT, 'public/_headers'), 'utf8');
  const m = site.match(/^\s*Content-Security-Policy: (.+)$/m);
  if (!m) throw new Error('public/_headers has no Content-Security-Policy to derive the account policy from');
  const policy = m[1].replace(/connect-src ([^;]+)/, (_, v) => `connect-src ${v} ${AUTH.hosts.join(' ')}`);
  if (policy === m[1]) throw new Error('the site-wide CSP has no connect-src to extend for /account/');
  return [
    '',
    `# Pro-flag build only: the account page may reach the Google sign-in hosts${PADDLE?.page ? ' (and the purchase page, below)' : ', and nothing else'}.`,
    '/account/*',
    '  ! Content-Security-Policy',
    `  Content-Security-Policy: ${policy}`,
    '',
  ].join(NL);
}

/**
 * The purchase page is the one page that may load a third-party script, Paddle's, so it alone
 * gets a policy naming Paddle's hosts for this build's environment. Derived from the site-wide
 * policy like the account page's. Not the Retain analytics host: Paddle.js injects
 * public.profitwell.com outside sandbox, and this policy is the second of two things that stop it
 * (src/pro/buy.ts is the first).
 */
function buyHeaders() {
  const site = readFileSync(join(ROOT, 'public/_headers'), 'utf8');
  const policy = site.match(/^\s*Content-Security-Policy: (.+)$/m)?.[1];
  if (!policy) throw new Error('public/_headers has no Content-Security-Policy to derive the purchase page policy from');
  // One addition: the checkout origin, as a frame. No Paddle host at all — Paddle.js runs on that origin,
  // never on this one, so it cannot read this origin's storage (tools/paddle-config.mjs explains why).
  let p = /frame-src ([^;]+)/.test(policy)
    ? policy.replace(/frame-src ([^;]+)/, (_, v) => `frame-src ${v} ${PADDLE.checkoutOrigin}`)
    : `${policy}; frame-src ${PADDLE.checkoutOrigin}`;
  // It confirms a purchase itself, which can mean renewing a sign-in older than an hour (Google's token host), and
  // a sign-in can start and finish here (Identity Toolkit): the same two hosts /account/'s policy has, from the
  // same list. Approved by the owner on 13 September 2026, this page only.
  p = p.replace(/connect-src ([^;]+)/, (_, v) => `connect-src ${v} ${AUTH.hosts.join(' ')}`);
  if (/paddle\.com|profitwell/i.test(p)) throw new Error('the purchase page policy names a Paddle or ProfitWell host; Paddle.js must never run on this origin');
  return [
    '',
    `# Sale build only (Paddle ${PADDLE.env}): the purchase page may frame the checkout origin and reach the Google sign-in hosts, and nothing else changes.`,
    '/pro/buy/*',
    '  ! Content-Security-Policy',
    `  Content-Security-Policy: ${p}`,
    '',
  ].join(NL);
}

// ---------------------------------------------------------------- scripts

async function bundle() {
  // The script tag and the bundle must come from the same fact. They did not: the tag was
  // emitted from `page.entry` unconditionally while bundling silently skipped any entry
  // whose file was missing. The homepage declared `entry: 'home'` from the first scaffold
  // and src/entries/home.ts was never written, so every build shipped a page pointing at a
  // bundle that did not exist. Locally that 404s; on Cloudflare Pages it returns 200 with
  // the HTML index, cached immutable for a year, and the footer readout counted it.
  for (const page of ROUTES) {
    if (!page.entry) continue;
    const file = join(ROOT, `src/${page.entryDir ?? 'entries'}/${page.entry}.ts`);
    if (!existsSync(file)) {
      throw new Error(`/${page.slug} declares entry '${page.entry}' but ${file} does not exist`);
    }
  }

  const entries = [
    join(ROOT, 'src/entries/net.ts'),
    // Local builds only: the badge that says whether this browser is in a Pro session. Not an
    // entry of any route — it loads on every page, like net.ts, because the question it answers
    // follows you between tools.
    ...(LOCAL ? [join(ROOT, 'src/pro/local-badge.ts')] : []),
    ...ROUTES.filter((p) => p.entry).map((p) => join(ROOT, `src/${p.entryDir ?? 'entries'}/${p.entry}.ts`)),
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
    // Syntax minification stays on in every mode: it is what folds `if (false)` away, and
    // with it the dynamic import of a Pro module. Only whitespace and names follow WATCH.
    minifySyntax: true,
    minifyWhitespace: !WATCH,
    minifyIdentifiers: !WATCH,
    sourcemap: WATCH,
    logLevel: 'warning',
    metafile: true,
    define: { 'process.env.NODE_ENV': '"production"', __PDFIQ_BUILD__: JSON.stringify(BUILD_ID), __PDFIQ_PRO__: PRO ? 'true' : 'false', __PDFIQ_LOCAL__: LOCAL ? 'true' : 'false', __PDFIQ_AUTH__: PRO ? JSON.stringify(AUTH) : 'null', __PDFIQ_SALE__: PADDLE?.page ? 'true' : 'false', __PDFIQ_PADDLE_ENV__: JSON.stringify(PADDLE?.page ? PADDLE.env : ''), __PDFIQ_CHECKOUT_ORIGIN__: JSON.stringify(PADDLE?.page ? PADDLE.checkoutOrigin : ''), __PDFIQ_PRO_PRICE__: JSON.stringify(PRO_OFFER.price), __PDFIQ_PRO_COPY__: JSON.stringify(PRO ? JSON.stringify(Object.fromEntries(PRO_COPY.map((c) => [c.key, { what: c.what, instead: c.instead }]))) : '{}') },
    // Scalars, not one object: esbuild hoists an object-valued define into a shared module, and the
    // first version put the token, price and Paddle.js URL into a chunk every Pro page loads.
  });

  const hashed = new Map();
  for (const [outPath, meta] of Object.entries(result.metafile.outputs)) {
    if (!meta.entryPoint) continue;
    const name = meta.entryPoint.replace(/^.*[\/]/, '').replace(/\.ts$/, '');
    hashed.set(name, outPath.replace(/^.*[\/]/, ''));
  }
  for (const page of ROUTES) {
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
  // A preview build is not for search engines. Its pages are noindex as well; this stops the crawl.
  if (PRO) return 'User-agent: *' + NL + 'Disallow: /' + NL;
  const groups = [...SEARCH_CRAWLERS, '*']
    .map((agent) => `User-agent: ${agent}` + NL + 'Allow: /')
    .join(NL + NL);
  return groups + NL + NL + `Sitemap: ${ORIGIN}/sitemap.xml` + NL;
}


function sitemap() {
  // noindex pages are not listed: a sitemap entry is a request to index, so listing one
  // while telling robots not to index it sends two opposite instructions.
  const urls = ROUTES.filter((p) => !p.noindex).map(
    (p) => `  <url><loc>${ORIGIN}${href(p.slug)}</loc><changefreq>monthly</changefreq></url>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

async function build() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const css = fontCss() + '\n' + stripCssComments(read('src/styles/app.css'));
  const sizeMb = maxFileSizeMb();
  // Not a literal in site.mjs: the number is read from the constant that enforces it, so
  // the copy and the gate cannot disagree.
  TOKENS.maxFileSize = `${sizeMb} MB`;

  // Bundle first: the pages need the content-hashed filenames to point at.
  const assets = await bundle();

  for (const page of ROUTES) {
    const file = join(ROOT, 'src/pages', `${page.slug || 'index'}.html`);
    if (!existsSync(file)) {
      console.warn(`  (skip) no page body for /${page.slug} — expected src/pages/${page.slug || 'index'}.html`);
      continue;
    }
    let body = applyProBlocks(applySaleBlocks(readFileSync(file, 'utf8'), Boolean(PADDLE?.page), file), PRO, file);
    // The page supplies the grid container; this fills it. Asserting the marker was
    // actually consumed, rather than assuming replace() matched, is the same discipline
    // as grepping the built output — a replace that hits nothing returns success.
    if (body.includes('<!--TOOL_GRID-->')) {
      body = body.replace(/[ \t]*<!--TOOL_GRID-->/, toolGrid());
      if (body.includes('<!--TOOL_GRID-->')) {
        throw new Error(`TOOL_GRID marker survived substitution in ${file}`);
      }
    }
    // The drop zone carries the tool's own mark (redesign stage 2; finding #3: every tool had a distinct icon on the
    // homepage and the same brand square in every drop zone, so the specificity vanished at the moment someone checks
    // they are in the right place). The same shapes as the homepage tile, in plain ink, at 42px.
    const ZONE_MARK = '<span class="dropzone__mark" aria-hidden="true"></span>';
    if (body.includes(ZONE_MARK)) {
      body = body.replace(ZONE_MARK, `<span class="dropzone__mark" aria-hidden="true">${icon(page.slug).replace('class="toolcard__mark"', 'class="dropzone__glyph"').replace('width="24" height="24"', 'width="42" height="42"')}</span>`);
      if (body.includes(ZONE_MARK)) throw new Error(`the drop zone mark was not replaced in ${file}`);
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
    if (body.includes('<!--PRO_COPY-->')) {
      // One section per Pro feature, from tools/pro-copy.mjs — the same data the marks beside the
      // features are written from, so a page and a mark cannot describe the same feature
      // differently.
      const sections = PRO_COPY.map((c) => [
        '      <section class="card" style="margin-top: 18px; max-width: 760px;">',
        `        <h2 class="kicker">${esc(c.title)}</h2>`,
        `        <p class="outcome__body" style="margin-top: 10px;">${esc(c.what)}</p>`,
        `        <p class="outcome__body" style="margin-top: 10px;">${esc(c.onDevice)}</p>`,
        `        <p class="hint" style="margin-top: 12px;"><strong>Instead, today:</strong> ${esc(c.instead)}</p>`,
        `        <p class="outcome__mono" style="margin-top: 10px;">${esc(proState(Boolean(PADDLE?.page) || PRO_OFFER.onSale))}</p>`,
        '      </section>',
      ].join(NL)).join(NL);
      body = body.replace(/[ 	]*<!--PRO_COPY-->/, sections);
      if (body.includes('<!--PRO_COPY-->')) {
        throw new Error(`PRO_COPY marker survived substitution in ${file}`);
      }
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
    let body = applyProBlocks(applySaleBlocks(readFileSync(file, 'utf8'), Boolean(PADDLE?.page), file), PRO, file);
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
  for (const page of ROUTES.filter(hasShareImage)) {
    const png = ogImage(page);
    if (!png || png.length < 500) throw new Error(`share image for /${page.slug} came out empty`);
    writeFileSync(join(OUT, 'og', `${page.slug || 'home'}.png`), png);
  }

  writeFileSync(join(OUT, 'robots.txt'), robots());

  // Grep what shipped: every og:image a page advertises must be a file that exists. The two
  // used to be decided in different places and one route advertised a card that was never
  // written.
  let advertised = 0;
  for (const page of ROUTES) {
    const html = readFileSync(join(OUT, page.slug, 'index.html'), 'utf8');
    for (const m of html.matchAll(/property="og:image" content="([^"]+)"/g)) {
      advertised++;
      const file = join(OUT, m[1].replace(ORIGIN, ''));
      if (!existsSync(file)) {
        throw new Error(`/${page.slug} advertises ${m[1]} and no such file was written`);
      }
    }
  }
  const written = readdirSync(join(OUT, 'og')).length;
  if (advertised !== written) {
    throw new Error(`${advertised} share images advertised but ${written} written — one is orphaned`);
  }

  // The Pro flag, checked against what was written rather than against intentions. With the
  // flag off, no Pro sentinel may appear anywhere in dist — that is what "absent, not hidden"
  // means, and a guarded import that esbuild failed to drop would show up here. With it on, a
  // Pro module must actually have reached the bundle.
  const TEXTLIKE = /\.(html|js|css|txt|xml|json|svg)$/;
  const carrying = [];
  for (const rel of readdirSync(OUT, { recursive: true })) {
    const name = String(rel);
    if (!TEXTLIKE.test(name)) continue;
    if (readFileSync(join(OUT, name), 'utf8').includes(PRO_SENTINEL_PREFIX)) carrying.push(name.split(/[\\/]/).join('/'));
  }
  if (!PRO && carrying.length) {
    throw new Error(`Pro code reached a flag-off build: ${carrying.slice(0, 8).join(', ')}`);
  }
  if (PRO && !carrying.some((f) => f.startsWith('assets/'))) {
    throw new Error('the Pro flag is on, but no Pro module reached the bundle');
  }

  // Paddle.js never runs on this origin, sale build or not (tools/paddle-config.mjs). No file this build
  // writes may call Paddle or carry a client token; only the /pro/buy/ header may name the checkout origin.
  for (const rel of readdirSync(OUT, { recursive: true })) {
    const name = String(rel);
    if (!TEXTLIKE.test(name)) continue;
    const text = readFileSync(join(OUT, name), 'utf8');
    // What can run: script files, and script tags in pages. Prose may name Paddle's hosts (/privacy does,
    // describing the checkout); the first version of this guard refused the privacy page for saying so.
    const runnable = name.endsWith('.js') ? text : [...text.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>|<script\b[^>]*>/g)].map((m) => m[0]).join('\n');
    if (/cdn\.paddle\.com|Paddle\.Initialize|Paddle\.Checkout/.test(runnable) || /test_[0-9a-f]{20}|live_[0-9a-f]{20}/.test(text)) {
      throw new Error(`Paddle reached the site's own origin in ${name.split(/[\\/]/).join('/')}; it belongs on the checkout origin only`);
    }
  }

  // The sale, checked the same way. A build that cannot sell may carry no purchase path at all:
  // no Paddle host, no client token, no checkout call, in any file it wrote (check 14).
  if (!PADDLE?.page) {
    const selling = [];
    for (const rel of readdirSync(OUT, { recursive: true })) {
      const name = String(rel);
      if (!TEXTLIKE.test(name) && !name.endsWith('_headers')) continue;
      const text = readFileSync(join(OUT, name), 'utf8');
      if (/paddle\.com|Paddle\.Checkout|Paddle\.Initialize|test_[0-9a-f]{20}|live_[0-9a-f]{20}|pdfiq-checkout-open/.test(text)) selling.push(name.split(/[\\/]/).join('/'));
    }
    if (selling.length) throw new Error(`a purchase path reached a build that is not selling: ${selling.slice(0, 8).join(', ')}`);
  }

  console.log(`built ${ROUTES.length} routes -> dist/  (build ${BUILD_ID}), ${written} share images${PRO ? '  — PRO PREVIEW' : ''}`);
}

// ---------------------------------------------------------------- dev loop

const stamp = () => new Date().toTimeString().slice(0, 8);

/** The `Error:` line of the last failed rebuild, or null when dist/ is current. */
let buildError = null;
/**
 * The tools/*.mjs file edited since startup, or null.
 *
 * This process imported site.mjs, faq.mjs, og-images.mjs and the rest once, at startup. Their
 * exports are module-level constants; rerunning build() reads src/ again but reads those from
 * memory. So a rebuild after a tools/ edit would write output that does not match the source —
 * the same lie the missing watcher told, in a narrower place. The watcher does not rebuild on
 * those; it says so and asks for a restart, and the notice below repeats it in the browser.
 */
let toolsStale = null;
/**
 * Resolves when no build is in flight. Deliberately never rejects: a failed rebuild is
 * recorded in buildError, so anything awaiting this (a request mid-rebuild, the next queued
 * rebuild) continues rather than taking the failure as its own.
 */
let settled = Promise.resolve();
let builds = 0;

function rebuild(why) {
  settled = settled.then(async () => {
    const started = Date.now();
    try {
      await build();
      buildError = null;
      console.log(`[${stamp()}] ${builds++ ? 'rebuilt' : 'built'} in ${Date.now() - started} ms — ${why}`);
    } catch (err) {
      builds++;
      // The Error: line, not the stack tail — that is the line that names what failed.
      buildError = `${err?.name ?? 'Error'}: ${err?.message ?? err}`;
      console.error(`[${stamp()}] BUILD FAILED — dist/ is not this source. ${buildError}`);
    }
  });
  return settled;
}

/**
 * What the browser is looking at, when it is not the source.
 *
 * A log line is not enough on its own: the log is in the other window, and the failure this
 * whole section exists to prevent is a page that looks right and is not. So while dist/ cannot
 * be trusted, every HTML response carries a band saying why. Injected into the response only —
 * dist/ is never written with it, and a clean build sends nothing.
 */
function devNotice() {
  const lines = [];
  if (buildError) lines.push(`BUILD FAILED — this page is from an incomplete build. ${buildError}`);
  if (toolsStale) lines.push(`${toolsStale} changed and cannot be reloaded — restart the dev server. This page predates that edit.`);
  if (!lines.length) return '';
  return '<div style="position:fixed;inset:0 0 auto 0;z-index:99999;background:#7F1D1D;color:#fff;' +
    'font:600 13px/1.5 system-ui,sans-serif;padding:10px 16px;text-align:center">' +
    lines.map(esc).join('<br>') + '</div>';
}

// A plain build keeps its old shape: a failure throws, Node prints it, the exit code is
// non-zero. tools/verify-pro-gate.mjs builds this file in a child process and reads both.
if (WATCH) await rebuild('startup');
else await build();

if (WATCH) {
  // Recursive fs.watch is supported on Windows and macOS, which is where this runs. Editors
  // write a file in several steps, so the events arrive in bursts; one debounce window turns
  // a burst into one rebuild.
  const DEBOUNCE_MS = 200;
  const WATCHED = ['src', 'public', 'tools'];
  const IGNORE = /(^|\/)\.|~$|\.(tmp|swp|swx)$|^\d+$/;   // editor scratch files, not sources
  let timer = null;
  let queued = new Set();

  const changed = (dir, filename) => {
    if (!filename) return;
    const rel = `${dir}/${String(filename).split(/[\\/]/).join('/')}`;
    if (IGNORE.test(rel)) return;
    if (dir === 'tools') {
      if (!rel.endsWith('.mjs')) return;                  // tools/fixtures/ is not build input
      if (toolsStale === rel) return;
      toolsStale = rel;
      console.warn(
        `[${stamp()}] ${rel} changed — tools/*.mjs are imported once at startup and cannot be ` +
        'reloaded. dist/ was NOT rebuilt. Restart the dev server (Ctrl+C, then npm run dev).'
      );
      return;
    }
    queued.add(rel);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const names = [...queued];
      queued = new Set();
      rebuild(names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : ''));
    }, DEBOUNCE_MS);
  };

  for (const dir of WATCHED) {
    watch(join(ROOT, dir), { recursive: true }, (_event, filename) => changed(dir, filename));
  }
  console.log(`watching ${WATCHED.map((d) => `${d}/`).join(', ')} — each change reruns the whole build`);
}

if (SERVE) {
  const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain',
    '.json': 'application/json', '.traineddata': 'application/octet-stream',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
    '.gz': 'application/gzip', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream',
  };
  /**
   * A path that exists is not necessarily a file. dist/fixtures is a directory, and readFileSync
   * on a directory throws EISDIR — which killed this server outright before the read below was
   * wrapped, and would now answer 500 where the right answer is that directory's index.html or a
   * 404. Found on 12 September 2026 by one request for /fixtures.
   */
  const isFile = (path) => existsSync(path) && statSync(path).isFile();
  createServer(async (req, res) => {
    // A rebuild empties dist/ and writes it again, so a request that lands in the middle of
    // one would be answered from neither build. Wait for it instead.
    await settled;
    const p = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = join(OUT, p);
    if (!isFile(file)) {
      // Cloudflare Pages serves /compress and /compress/ alike; match that locally.
      const alt = join(OUT, p, 'index.html');
      if (isFile(alt)) file = alt;
      else if (buildError) {
        // Not a 404: the build stopped before this file was written. Saying "not found" here
        // would read as a routing mistake and send the reader looking in the wrong place.
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end(`the last build failed, so ${p} was never written${NL}${NL}${buildError}${NL}`);
      }
      else { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    }
    const ext = file.slice(file.lastIndexOf('.'));
    const type = types[ext] || 'application/octet-stream';
    let body;
    try {
      body = readFileSync(file);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(`could not read ${p}: ${err?.message ?? err}${NL}`);
    }
    const notice = type.startsWith('text/html') ? devNotice() : '';
    if (notice) body = Buffer.from(body.toString('utf8').replace('</body>', notice + '</body>'), 'utf8');
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  }).listen(4321, () => console.log('serving http://localhost:4321'));
}
