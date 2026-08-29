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
    card: 'Combine files into one, in the order you set. Drag to reorder before you save.',
  },
  {
    slug: 'split', nav: 'Split', name: 'Split PDF', entry: 'split',
    title: 'Split PDF — extract pages in your browser, nothing uploaded',
    description:
      'Pull out a page range or cut one PDF into several. Runs entirely in your browser: the file never leaves your device.',
    card: 'Pull out a page range, or cut one document into several. Page count has no limit here.',
  },
  {
    slug: 'compress', nav: 'Compress', name: 'Compress PDF', entry: 'compress',
    title: 'Compress PDF — make a PDF smaller in your browser, nothing uploaded',
    description:
      'Make a PDF smaller for email or a filing. Runs entirely in your browser: the file never leaves your device, and we say so when it cannot get smaller.',
    card: 'Make a file smaller for email or a filing. We tell you the real before and after, and say so when it cannot get smaller.',
  },
  {
    slug: 'images-to-pdf', nav: 'Images to PDF', name: 'Images to PDF', entry: 'images-to-pdf',
    title: 'Images to PDF — photos and scans into one document, nothing uploaded',
    description:
      'Turn photos or scans into one PDF. Runs entirely in your browser: the images never leave your device.',
    card: 'Turn photos or scans into one document. Phone photos of receipts are the usual case.',
  },
  {
    slug: 'rotate', nav: 'Rotate', name: 'Rotate PDF', entry: 'rotate',
    title: 'Rotate PDF — fix sideways scans in your browser, nothing uploaded',
    description:
      'Turn PDF pages the right way up. Runs entirely in your browser: the file never leaves your device.',
    card: 'Fix sideways scans. Turn every page at once or only the ones that are wrong.',
  },
  {
    slug: 'reorder', nav: 'Reorder', name: 'Reorder Pages', entry: 'reorder',
    title: 'Reorder PDF pages — move and delete pages in your browser, nothing uploaded',
    description:
      'Move or delete PDF pages on a grid of the real pages. Runs entirely in your browser: the file never leaves your device.',
    card: 'Move or delete pages on a grid of the real pages, then save the new order.',
  },
  {
    slug: 'ocr', nav: 'OCR', name: 'OCR PDF', entry: 'ocr',
    title: 'OCR PDF — make a scan searchable in your browser, nothing uploaded',
    description:
      'Read the text in a scanned PDF so you can search and copy it. Runs entirely in your browser: the file never leaves your device.',
    card: 'Read the text in a scan so you can search and copy it. Slowest tool here, and worth the wait.',
  },
];

/** Everything else. */
export const PAGES = [
  {
    slug: '', name: 'Home', entry: 'home',
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

export const href = (slug) => (slug === '' ? '/' : `/${slug}/`);
