// Single source of truth for routes, nav order and page metadata.
// Every entry here becomes a real HTML document at its own URL — people arrive on a
// specific tool from search, so there is no client-side router anywhere on this site.

import { AUTH } from './auth-config.mjs';

export const ORIGIN = 'https://pdf-iq.com';

/** The seven tools, in nav order. `nav` is the short label in the header. */
export const TOOLS = [
  {
    slug: 'merge', nav: 'Merge', name: 'Merge PDF', entry: 'merge',
    title: 'Merge PDF free — no upload, no signup, works offline',
    description:
      'Merge PDF files free, without uploading them. Combine PDFs into one file in the order you set — it runs in your browser, so they never leave your device.',
    faqAction: 'merge',
    needsFirstRunDownload: false,
    inApp: true,
    cardName: 'Merge',
    card: 'Several files into one, in the order you set.',
    ogSubject: 'Merge PDFs',
    ogLine: 'Your files never leave your device',
  },
  {
    slug: 'split', nav: 'Split', name: 'Split PDF', entry: 'split',
    title: 'Split PDF free — no upload, no signup, works offline',
    description:
      'Split a PDF free, without uploading it. Pull out a page range or cut one file into several — it runs in your browser, so the file stays on your device.',
    faqAction: 'split',
    needsFirstRunDownload: false,
    inApp: true,
    cardName: 'Split',
    card: 'Pull out a page range, or cut one file into parts.',
    ogSubject: 'Split a PDF',
    ogLine: 'Your files never leave your device',
  },
  {
    slug: 'compress', nav: 'Compress', name: 'Compress PDF', entry: 'compress',
    title: 'Compress PDF free — no upload, no signup, works offline',
    description:
      'Compress a PDF free, without uploading it — for email or a filing. It runs in your browser, and we say so plainly when a file will not get any smaller.',
    faqAction: 'compress',
    needsFirstRunDownload: false,
    inApp: true,
    cardName: 'Compress',
    card: 'Smaller for email, with the real before and after.',
    ogSubject: 'Compress a PDF',
    ogLine: 'Your files never leave your device',
  },
  {
    slug: 'images-to-pdf', nav: 'Images to PDF', name: 'Images to PDF', entry: 'images-to-pdf',
    title: 'Images to PDF free — no upload, no signup, offline',
    description:
      'Turn photos or scans into a PDF free, without uploading them. It runs in your browser, so the images never leave your device.',
    faqAction: 'turn images into',
    needsFirstRunDownload: false,
    inApp: true,
    cardName: 'Images to PDF',
    card: 'Phone photos and scans into one document.',
    ogSubject: 'Images to PDF',
    ogLine: 'Your files never leave your device',
  },
  {
    slug: 'rotate', nav: 'Rotate', name: 'Rotate PDF', entry: 'rotate',
    title: 'Rotate PDF free — no upload, no signup, works offline',
    description:
      'Rotate PDF pages free, without uploading the file. Turn sideways scans the right way up in your browser — nothing leaves your device.',
    faqAction: 'rotate',
    needsFirstRunDownload: false,
    inApp: true,
    cardName: 'Rotate',
    card: 'Fix sideways scans without re-encoding them.',
    ogSubject: 'Rotate pages',
    ogLine: 'Your files never leave your device',
  },
  {
    slug: 'reorder', nav: 'Reorder', name: 'Reorder Pages', entry: 'reorder',
    title: 'Reorder PDF pages free — no upload, no account',
    description:
      'Reorder or delete PDF pages free, without uploading the file. Move pages on a grid of the real pages, in your browser — nothing leaves your device.',
    faqAction: 'reorder',
    needsFirstRunDownload: false,
    inApp: true,
    cardName: 'Reorder',
    card: 'Move or drop pages on a grid of real pages.',
    ogSubject: 'Reorder pages',
    ogLine: 'Your files never leave your device',
  },
  {
    slug: 'ocr', nav: 'OCR', name: 'OCR PDF', entry: 'ocr',
    title: 'OCR PDF free — read the text off a scan, no upload',
    description:
      'OCR a PDF free, without uploading it. Read the text in a scanned document so you can search and copy it — it runs in your browser, on your own device.',
    faqAction: 'read the text off',
    needsFirstRunDownload: true,
    inApp: true,
    cardName: 'OCR',
    card: 'Read the text off a scan, free and unlimited.',
    ogSubject: 'Read a scan',
    ogLine: 'Your files never leave your device',
  },
];

/** Everything else. */
export const PAGES = [
  {
    // No page-specific bundle: the homepage is static, and net.js ships on every page.
    slug: '', name: 'Home', entry: null, shell: '1120px',
    title: 'Free PDF tools run in your browser — no upload, no signup',
    description:
      'Free PDF tools that work without uploading anything — compress, merge, split, rotate, reorder, convert and OCR. The work happens on your own device.',
    ogLine: 'Your files never leave your device',
  },
  {
    slug: 'app', name: 'Android App', entry: null,
    title: 'pdf-iq for Android — the same tools, offline, on your phone',
    description:
      'The pdf-iq Android app runs {{appOfWeb}} tools on your device, offline, with share-sheet support and camera scanning. In testing, not yet on Play.',
    ogSubject: 'Android app',
    ogLine: 'The same tools, on your phone',
  },
  {
    slug: 'privacy', name: 'Privacy', entry: null,
    title: 'Privacy — what pdf-iq and the PDFiq app collect',
    description:
      'What the pdf-iq website and Android app do and do not collect, stated precisely, including the app’s server-side features.',
    ogSubject: 'Privacy',
    ogLine: 'Your files never leave your device',
  },
  {
    slug: 'terms', name: 'Terms', entry: null,
    title: 'Terms of use — pdf-iq PDF tools',
    description: 'The terms covering use of the pdf-iq website, the seven browser tools, and the PDFiq Android app, including how Pro is bought and liability.',
    ogSubject: 'Terms',
    ogLine: 'Your files never leave your device',
  },
  {
    // Paddle requires a seller's site to carry terms, a privacy notice and a refund policy.
    // Ours is a real page rather than a line in the terms, because a buyer looking for it
    // looks for a page called Refunds.
    slug: 'refunds', name: 'Refunds', entry: null,
    title: 'Refunds — pdf-iq Pro',
    description: 'Thirty days from purchase, for any reason. Paddle is the merchant of record and issues the refund. The seven web tools are free and unaffected.',
    ogSubject: 'Refunds',
    ogLine: 'Your files never leave your device',
  },
  {
    slug: 'support', name: 'Support', entry: null,
    title: 'Support — help with the pdf-iq PDF tools',
    description: 'Answers to what goes wrong, and how to reach a person about the pdf-iq tools and Android app.',
    ogSubject: 'Support',
    ogLine: 'Your files never leave your device',
  },
  {
    slug: 'for-professionals', name: 'For firms', entry: 'for-professionals',
    title: 'PDF tools for law firms and accountants — nothing uploaded',
    description:
      'We build PDF tools that run on your own device and we are asking firms what to build next, before building it. Nothing is on sale; two questions and an email.',
    ogSubject: 'For firms',
    ogLine: 'Two questions, and an email',
  },
  {
    // A real route rather than a test-harness page, because it has to be reachable from a
    // phone to be worth anything, and Cloudflare only deploys what `npm run build` emits.
    // noindex keeps it out of the sitemap and out of search; nothing links to it.
    slug: 'memory-probe', name: 'Memory probe', entry: 'memory-probe', noindex: true,
    title: 'Memory probe — measuring the file ceiling',
    description: 'An internal probe that finds the largest PDF this device can actually process.',
    ogSubject: 'Memory probe',
    ogLine: 'Internal',
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
  if (typeof t.faqAction !== 'string') {
    throw new Error(`${t.slug} does not declare faqAction — the FAQ asks "is it safe to <verb> a PDF online?"`);
  }
  if (typeof t.needsFirstRunDownload !== 'boolean') {
    throw new Error(`${t.slug} does not declare needsFirstRunDownload — say whether it works offline on first use`);
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
/**
 * Pro: the price, and what it buys.
 *
 * One source, because this was written by hand into the homepage price card and again into
 * the app page's, and a pricing change has to land in both or the site quotes two prices.
 * The tool count and the app feature list are single-sourced here for the same reason and
 * for the same past failure.
 *
 * A one-time price is the position, not an implementation detail: a PDF utility gets used a
 * few times a year and every competitor rents. It is stated plainly wherever price appears.
 */
export const PRO = {
  price: '$14.99',
  cadence: 'one-time',
  /** Rendered next to the amount. Not "/mo" — there is no recurring charge to describe. */
  qualifier: 'once',
  covers: 'both the web tools and the Android app',
  features: [
    'Batch processing across every tool',
    'Searchable-PDF output from OCR',
    'Advanced compression — target a file size or a dpi',
    'Password protect and password remove',
  ],
  /**
   * The team tier, priced per user per year rather than once.
   *
   * The recurrence is the whole point and is not a contradiction of the one-time individual
   * price: one-time revenue does not compound, and a firm renewing annually is the only
   * compounding line in the plan. It is also not on sale — /for-professionals is a test of
   * whether the demand exists, with nothing behind the button but a record of who asked.
   */
  teamPrice: '$99',
  /**
   * The cadence is a question, not a decision, and deliberately has no value here.
   *
   * NOTE, and it stands: one-time revenue does not compound, and this tier was meant to be
   * the compounding line — sixty firms at $99 once is $5,940, once. "Bought once" removes
   * exactly the property that justified building the page.
   *
   * It is not being reversed to per-year either, because we no longer know what we are
   * selling. If the answers describe a tool, one-time is honest and a subscription would be
   * rent for something that needs no maintaining. If they describe something ongoing,
   * per-year fits. Asking is the only way to find out, so the page asks.
   *
   * If the answers point at a tool rather than a service, the compounding problem stays
   * open. That is better known than papered over with a cadence nobody asked for.
   */
  teamCadenceIsAsked: true,
  /** Kept prominent: it is not on sale, on either surface. */
  onSale: false,
};

export const PRO_FEATURES = PRO.features;

const OFFLINE_NOW = WEB_TOOLS.filter((t) => !t.needsFirstRunDownload);

/**
 * The questions people actually type, answered in the site's own voice.
 *
 * One source for all seven tool pages: the answers are claims about the build, and seven
 * hand-written copies is how a correction lands in six of them. `{action}` is the tool's own
 * verb and `{size}` is read from MAX_BYTES at build time.
 *
 * Every answer here has to be true of the shipping build. The size answer is deliberately
 * specific about the failure mode — a tab that stops being usable is not a tab that crashes,
 * and saying so is what makes the rest of the page worth believing.
 */
export const FAQ = [
  {
    q: 'Is it safe to {action} a PDF online?',
    a: 'Nothing is uploaded, so there is no copy on a server to trust. The counter at the foot of this page shows bytes sent, and it stays at zero.',
  },
  {
    q: 'Does this work offline?',
    a: 'Yes. Turn off your wifi and reload the page — it keeps working.',
    ocr: 'After the first run, yes. The language model is downloaded once, and then it works with the network off like everything else here.',
  },
  {
    q: 'Is there a file size limit?',
    a: '{size}. Past that a browser tab stops being able to write the finished file out and sits unresponsive for minutes — it does not crash, it stops being usable — so we refuse rather than hang.',
  },
  {
    q: 'Do I need an account?',
    a: 'No. It needs no account to use, and there is no limit on how many files you run through it.',
  },
  {
    q: 'Is there a watermark?',
    a: 'No. Nothing is added to the file.',
  },
  {
    q: 'What happens to my file?',
    a: 'It stays on your device. The counter at the foot of every page shows bytes sent and third-party requests, so you can check that rather than take our word for it.',
  },
];

export const TOKENS = {
  proPrice: PRO.price,
  proTeamPrice: PRO.teamPrice,

  proQualifier: PRO.qualifier,
  proCadence: PRO.cadence,
  proCovers: PRO.covers,
  webToolCount: word(WEB_TOOLS.length),
  webToolCountCap: cap(word(WEB_TOOLS.length)),
  appToolCount: word(APP_TOOLS.length),
  appToolCountCap: cap(word(APP_TOOLS.length)),
  // "all seven" when the app has every tool. Flipping ocr.inApp would otherwise have put
  // "Seven of the seven tools" on the /app lede, the homepage card and the meta description.
  appOfWeb: APP_TOOLS.length === WEB_TOOLS.length
    ? `all ${word(WEB_TOOLS.length)}`
    : `${word(APP_TOOLS.length)} of the ${word(WEB_TOOLS.length)}`,
  appOfWebCap: APP_TOOLS.length === WEB_TOOLS.length
    ? `All ${word(WEB_TOOLS.length)}`
    : `${cap(word(APP_TOOLS.length))} of the ${word(WEB_TOOLS.length)}`,
  webOnlyTools: list(WEB_ONLY_TOOLS.map((t) => t.cardName)),
  webOnlyVerb: WEB_ONLY_TOOLS.length === 1 ? 'is' : 'are',
  webOnlyPronoun: WEB_ONLY_TOOLS.length === 1 ? 'it' : 'they',
  /**
   * How many tools work with the network off from the very first use.
   *
   * Six, because OCR fetches a language model once before it can run. It used to equal the
   * app's count too, six of seven, for an unrelated reason. Deriving one from the other would
   * have broken when Read a scan shipped in the app in vc14 — which it would have, silently —
   * so this has its own source.
   */
  offlineNow: `${word(OFFLINE_NOW.length)} of the ${word(WEB_TOOLS.length)}`,
  // Sign-in, from tools/auth-config.mjs: the same object the code stores by. /privacy and
  // /account/ are written with these, so neither can name a key, field or host the code does not use.
  authSessionKey: `<code>${AUTH.sessionKey}</code>`,
  authPendingKey: `<code>${AUTH.pendingKey}</code>`,
  authSessionFields: AUTH.sessionFields.map((f) => `<code>${f}</code>`).join(', '),
  authPendingFields: AUTH.pendingFields.map((f) => `<code>${f}</code>`).join(', '),
  authIdentityHost: new URL(AUTH.identityToolkit).host,
  authTokenHost: new URL(AUTH.secureToken).host,
  authScope: `<code>${AUTH.scope}</code>`,
};

// The homepage card says how many tools there are, counted rather than written. Three
// hand-written counts have already drifted from WEB_TOOLS on this site; a share image is
// the worst place for the fourth, because it travels and cannot be corrected in place.
PAGES.find((p) => p.slug === '').ogSubject = `${TOKENS.webToolCountCap} PDF tools`;


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
  // Text only. The searchable-PDF writer and batch OCR are Pro and in no shipped release;
  // TEST_MATRIX SG1 in the app repo confirms the writer is stripped from the free build.
  'Read a scan puts the text on screen, to copy or save as a .txt file. Its recogniser downloads once, through Google Play services.',
  'Opens PDFs from the share sheet and from chat apps.',
  'Multi-page camera scanning straight to PDF.',
  'No ads, and no advertising SDK in the build.',
];

export const ALL = [...PAGES, ...TOOLS];

/**
 * Routes that exist only in a Pro-flag build. tools/build.mjs adds them when the flag is on; in
 * every other build they are absent. Their entry scripts live under src/pro/.
 */
export const PRO_PAGES = [
  {
    slug: 'account', name: 'Account', entry: 'account', entryDir: 'pro', noindex: true,
    title: 'Your account — pdf-iq',
    description: 'Sign in for Pro. None of the tools needs an account.',
    ogSubject: 'Your account',
    ogLine: 'Only for Pro',
  },
  {
    slug: 'password', name: 'Password', entry: 'password', entryDir: 'pro', noindex: true,
    title: 'Password protect a PDF, or remove one — pdf-iq',
    description: 'Add a password to a PDF, or take one off, on your device. Part of Pro.',
    ogSubject: 'Password',
    ogLine: 'Nothing leaves your device',
  },
];

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
  // Derived. This was the one app count on the site written by hand — "Six of these
  // seven" — so flipping ocr.inApp when Read a scan shipped in vc14 would have moved every
  // other count and left this one saying six.
  card: APP_TOOLS.length === WEB_TOOLS.length
    ? `All ${word(WEB_TOOLS.length)} of these, on a phone. In testing, not yet on Play.`
    : `${cap(word(APP_TOOLS.length))} of these ${word(WEB_TOOLS.length)}, on a phone. In testing, not yet on Play.`,
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
