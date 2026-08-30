// Single source of truth for routes, nav order and page metadata.
// Every entry here becomes a real HTML document at its own URL — people arrive on a
// specific tool from search, so there is no client-side router anywhere on this site.

export const ORIGIN = 'https://pdf-iq.com';

/** The seven tools, in nav order. `nav` is the short label in the header. */
export const TOOLS = [
  {
    slug: 'merge', nav: 'Merge', name: 'Merge PDF', entry: 'merge',
    title: 'Merge PDF — combine files in your browser, nothing uploaded',
    description:
      'Combine PDFs into one file, in the order you set. Runs entirely in your browser: the files never leave your device.',
    inApp: true,
    cardName: 'Merge',
    card: 'Several files into one, in the order you set.',
  },
  {
    slug: 'split', nav: 'Split', name: 'Split PDF', entry: 'split',
    title: 'Split PDF — extract pages in your browser, nothing uploaded',
    description:
      'Pull out a page range or cut one PDF into several. Runs entirely in your browser: the file never leaves your device.',
    inApp: true,
    cardName: 'Split',
    card: 'Pull out a page range, or cut one file into parts.',
  },
  {
    slug: 'compress', nav: 'Compress', name: 'Compress PDF', entry: 'compress',
    title: 'Compress PDF — make a PDF smaller in your browser, nothing uploaded',
    description:
      'Make a PDF smaller for email or a filing. Runs entirely in your browser: the file never leaves your device, and we say so when it cannot get smaller.',
    inApp: true,
    cardName: 'Compress',
    card: 'Smaller for email, with the real before and after.',
  },
  {
    slug: 'images-to-pdf', nav: 'Images to PDF', name: 'Images to PDF', entry: 'images-to-pdf',
    title: 'Images to PDF — photos and scans into one document, nothing uploaded',
    description:
      'Turn photos or scans into one PDF. Runs entirely in your browser: the images never leave your device.',
    inApp: true,
    cardName: 'Images to PDF',
    card: 'Phone photos and scans into one document.',
  },
  {
    slug: 'rotate', nav: 'Rotate', name: 'Rotate PDF', entry: 'rotate',
    title: 'Rotate PDF — fix sideways scans in your browser, nothing uploaded',
    description:
      'Turn PDF pages the right way up. Runs entirely in your browser: the file never leaves your device.',
    inApp: true,
    cardName: 'Rotate',
    card: 'Fix sideways scans without re-encoding them.',
  },
  {
    slug: 'reorder', nav: 'Reorder', name: 'Reorder Pages', entry: 'reorder',
    title: 'Reorder PDF pages in your browser — nothing uploaded',
    description:
      'Move or delete PDF pages on a grid of the real pages. Runs entirely in your browser: the file never leaves your device.',
    inApp: true,
    cardName: 'Reorder',
    card: 'Move or drop pages on a grid of real pages.',
  },
  {
    slug: 'ocr', nav: 'OCR', name: 'OCR PDF', entry: 'ocr',
    title: 'OCR PDF — make a scan searchable in your browser, nothing uploaded',
    description:
      'Read the text in a scanned PDF so you can search and copy it. Runs entirely in your browser: the file never leaves your device.',
    inApp: false,
    cardName: 'OCR',
    card: 'Make a scan searchable. Unlimited, free here.',
  },
];

/** Everything else. */
export const PAGES = [
  {
    // No page-specific bundle: the homepage is static, and net.js ships on every page.
    slug: '', name: 'Home', entry: null, shell: '1120px',
    title: 'pdf-iq — seven PDF tools that run inside your browser tab',
    description:
      'Compress, merge, split, rotate, reorder, convert and OCR PDFs without uploading them. The work happens on your device, so there is nothing to delete.',
  },
  {
    slug: 'app', name: 'Android App', entry: null,
    title: 'pdf-iq for Android — the same tools, offline, on your phone',
    description:
      'The pdf-iq Android app runs the same tools on your device, with share-sheet support and camera scanning. Free while we are new.',
  },
  {
    slug: 'privacy', name: 'Privacy', entry: null,
    title: 'Privacy — what pdf-iq and the PDFiq app collect',
    description:
      'What the pdf-iq website and Android app do and do not collect, stated precisely, including the app’s server-side features.',
  },
  {
    slug: 'terms', name: 'Terms', entry: null,
    title: 'Terms of use — pdf-iq PDF tools',
    description: 'The terms covering use of the pdf-iq website, the seven browser tools, and the PDFiq Android app, including subscriptions and liability.',
  },
  {
    slug: 'support', name: 'Support', entry: null,
    title: 'Support — help with the pdf-iq PDF tools',
    description: 'Answers to what goes wrong, and how to reach a person about the pdf-iq tools and Android app.',
  },
  {
    // A real route rather than a test-harness page, because it has to be reachable from a
    // phone to be worth anything, and Cloudflare only deploys what `npm run build` emits.
    // noindex keeps it out of the sitemap and out of search; nothing links to it.
    slug: 'memory-probe', name: 'Memory probe', entry: 'memory-probe', noindex: true,
    title: 'Memory probe — measuring the file ceiling',
    description: 'An internal probe that finds the largest PDF this device can actually process.',
  },
];

/**
 * Which surface has which tool.
 *
 * The number of tools the Android app has was written by hand into the app page's lede,
 * its feature list and the homepage price card — and a correction landed in some of them
 * and not others, twice. Everything that states a count now derives from here.
 *
 * `inApp` is required on every tool rather than defaulted, so adding one forces the
 * question instead of inheriting a claim of parity.
 */
for (const t of TOOLS) {
  if (typeof t.inApp !== 'boolean') {
    throw new Error(`${t.slug} does not declare inApp — say whether the Android app has it`);
  }
}

export const WEB_TOOLS = TOOLS;
export const APP_TOOLS = TOOLS.filter((t) => t.inApp);
export const WEB_ONLY_TOOLS = TOOLS.filter((t) => !t.inApp);

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n) => WORDS[n] ?? String(n);
const cap = (s) => s.replace(/^./, (c) => c.toUpperCase());
const list = (items) =>
  items.length <= 1
    ? items[0] ?? ''
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/**
 * Substituted into page bodies at build time. An unknown token, or one left behind,
 * fails the build — a count that silently stays literal is the failure this replaces.
 */
export const TOKENS = {
  webToolCount: word(WEB_TOOLS.length),
  webToolCountCap: cap(word(WEB_TOOLS.length)),
  appToolCount: word(APP_TOOLS.length),
  appToolCountCap: cap(word(APP_TOOLS.length)),
  appOfWeb: `${word(APP_TOOLS.length)} of the ${word(WEB_TOOLS.length)}`,
  appOfWebCap: `${cap(word(APP_TOOLS.length))} of the ${word(WEB_TOOLS.length)}`,
  webOnlyTools: list(WEB_ONLY_TOOLS.map((t) => t.cardName)),
  webOnlyVerb: WEB_ONLY_TOOLS.length === 1 ? 'is' : 'are',
  webOnlyPronoun: WEB_ONLY_TOOLS.length === 1 ? 'it' : 'they',
};

/**
 * The app's feature list, so the page cannot restate the split by hand.
 *
 * The web-only line is dropped entirely when nothing is web-only, rather than rendered
 * with an empty subject. Flipping ocr.inApp to true produced " are not in the app yet"
 * on the built page — the degenerate case a derived string has and a hand-written one
 * does not, which is the cost of deriving and worth paying once here.
 */
export const APP_FEATURES = [
  APP_TOOLS.length === WEB_TOOLS.length
    ? `All ${word(WEB_TOOLS.length)} web tools, offline, no account.`
    : `${cap(word(APP_TOOLS.length))} of the ${word(WEB_TOOLS.length)} web tools, offline, no account.`,
  ...(WEB_ONLY_TOOLS.length
    ? [`${list(WEB_ONLY_TOOLS.map((t) => t.cardName))} ${WEB_ONLY_TOOLS.length === 1 ? 'is' : 'are'} not in the app yet — on the web ${WEB_ONLY_TOOLS.length === 1 ? 'it is' : 'they are'} unlimited.`]
    : []),
  'Opens PDFs from the share sheet and from chat apps.',
  'Multi-page camera scanning straight to PDF.',
  'No ads, and no advertising SDK in the build.',
];

export const ALL = [...PAGES, ...TOOLS];

/**
 * Order of the tool grid on the homepage, which is not the nav order.
 * Compress leads because it is the tool people arrive for and the one that carries the
 * argument — it reports a real before and after, and says so when it can do nothing.
 */
export const HOME_ORDER = ['compress', 'merge', 'split', 'images-to-pdf', 'rotate', 'reorder', 'ocr'];

/**
 * The eighth card in the homepage grid. It is not a tool — it links to /app and is drawn
 * as an outline rather than a filled card — so it lives here rather than in TOOLS, which
 * feeds the tool nav and the sitemap.
 */
export const HOME_APP_CARD = {
  slug: 'app',
  cardName: 'Android app',
  // Not "the same tools": the app has six of the seven. Its OCR package is committed and
  // wired into DI but has no route in Screen.kt, no entry in PdfiqNavHost and no home
  // tile, so no user can reach it. See CLAIMS.md.
  card: "Six of these seven, on a phone. Free while we're new.",
  outline: true,
};

export const HOME_TOOLS = HOME_ORDER.map((slug) => {
  const tool = TOOLS.find((t) => t.slug === slug);
  if (!tool) throw new Error(`HOME_ORDER names a tool that does not exist: ${slug}`);
  return tool;
});
if (HOME_TOOLS.length !== TOOLS.length) {
  throw new Error('HOME_ORDER must list every tool exactly once');
}

export const href = (slug) => (slug === '' ? '/' : `/${slug}/`);
