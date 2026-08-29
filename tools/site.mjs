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
    cardName: 'Merge',
    card: 'Several files into one, in the order you set.',
  },
  {
    slug: 'split', nav: 'Split', name: 'Split PDF', entry: 'split',
    title: 'Split PDF — extract pages in your browser, nothing uploaded',
    description:
      'Pull out a page range or cut one PDF into several. Runs entirely in your browser: the file never leaves your device.',
    cardName: 'Split',
    card: 'Pull out a page range, or cut one file into parts.',
  },
  {
    slug: 'compress', nav: 'Compress', name: 'Compress PDF', entry: 'compress',
    title: 'Compress PDF — make a PDF smaller in your browser, nothing uploaded',
    description:
      'Make a PDF smaller for email or a filing. Runs entirely in your browser: the file never leaves your device, and we say so when it cannot get smaller.',
    cardName: 'Compress',
    card: 'Smaller for email, with the real before and after.',
  },
  {
    slug: 'images-to-pdf', nav: 'Images to PDF', name: 'Images to PDF', entry: 'images-to-pdf',
    title: 'Images to PDF — photos and scans into one document, nothing uploaded',
    description:
      'Turn photos or scans into one PDF. Runs entirely in your browser: the images never leave your device.',
    cardName: 'Images to PDF',
    card: 'Phone photos and scans into one document.',
  },
  {
    slug: 'rotate', nav: 'Rotate', name: 'Rotate PDF', entry: 'rotate',
    title: 'Rotate PDF — fix sideways scans in your browser, nothing uploaded',
    description:
      'Turn PDF pages the right way up. Runs entirely in your browser: the file never leaves your device.',
    cardName: 'Rotate',
    card: 'Fix sideways scans without re-encoding them.',
  },
  {
    slug: 'reorder', nav: 'Reorder', name: 'Reorder Pages', entry: 'reorder',
    title: 'Reorder PDF pages — move and delete pages in your browser, nothing uploaded',
    description:
      'Move or delete PDF pages on a grid of the real pages. Runs entirely in your browser: the file never leaves your device.',
    cardName: 'Reorder',
    card: 'Move or drop pages on a grid of real pages.',
  },
  {
    slug: 'ocr', nav: 'OCR', name: 'OCR PDF', entry: 'ocr',
    title: 'OCR PDF — make a scan searchable in your browser, nothing uploaded',
    description:
      'Read the text in a scanned PDF so you can search and copy it. Runs entirely in your browser: the file never leaves your device.',
    cardName: 'OCR',
    card: 'Make a scan searchable. Unlimited, free here.',
  },
];

/** Everything else. */
export const PAGES = [
  {
    slug: '', name: 'Home', entry: 'home', shell: '1120px',
    title: 'pdf-iq — seven PDF tools that run inside your browser tab',
    description:
      'Compress, merge, split, rotate, reorder, convert and OCR PDFs without uploading them. The work happens on your device, so there is no upload step and nothing to delete.',
  },
  {
    slug: 'app', name: 'Android App', entry: null,
    title: 'pdf-iq for Android — the same tools, offline, on your phone',
    description:
      'The pdf-iq Android app runs the same tools on your device, with share-sheet support and camera scanning. Free while we are new.',
  },
  {
    slug: 'privacy', name: 'Privacy', entry: null,
    title: 'Privacy — pdf-iq',
    description:
      'What the pdf-iq website and Android app do and do not collect, stated precisely, including the app’s server-side features.',
  },
  {
    slug: 'terms', name: 'Terms', entry: null,
    title: 'Terms — pdf-iq',
    description: 'The terms covering use of the pdf-iq website and tools.',
  },
  {
    slug: 'support', name: 'Support', entry: null,
    title: 'Support — pdf-iq',
    description: 'Answers to what goes wrong, and how to reach a person about the pdf-iq tools and Android app.',
  },
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
