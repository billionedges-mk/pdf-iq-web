/**
 * Claims this site used to make and no longer may, with the reason each was retired.
 *
 * A removed claim comes back. It comes back in a page nobody was editing, in a meta description
 * nobody reads, or in copy written from memory of how the site used to describe itself — and the
 * only reliable way to catch that is to make the phrase itself fail the build.
 *
 * `tools/verify-retired.mjs` searches every built page for these, **including `<title>` and
 * `<meta name="description">`**, which is where the last one hid: the scanner was claimed in three
 * visible places and in `/app/`'s description tag, and the description is the copy Google indexes
 * and shows in results while being invisible to anyone reading the page.
 *
 * To retire a claim: remove it from the copy, add it here with what replaced it, and the build
 * will refuse it from then on. To bring one back — the scanner, when it merges — delete its entry
 * in the same commit that restores the copy, so the two cannot drift apart.
 */
export const RETIRED = [
  {
    phrase: 'camera scanning',
    why: 'The Android scanner is not built. Returns when it merges, after the closed test and '
      + 'before launch, as a reason to install the app and never as a web feature.',
    instead: 'photos into a multi-page PDF',
  },
  {
    phrase: 'scanning several pages',
    why: 'Same claim, in /app/’s opening paragraph.',
    instead: 'photographing several pages in a row — each becomes a page, in the order you add them',
  },
  {
    phrase: 'Multi-page camera scanning',
    why: 'Same claim, in the app feature list.',
    instead: 'Photograph several pages in a row',
  },
  {
    phrase: 'scanning hands the job',
    why: 'Same claim, in /privacy’s explanation of why no camera permission is needed.',
    instead: 'taking a photograph hands the job',
  },
  {
    phrase: 'AI summaries, the heavier OCR work',
    why: 'Read as though Pro includes summaries. It does not, in any quantity: ten a month for '
      + 'everyone, Pro or not, and credit packs beyond that.',
    instead: 'the heavier OCR work, and keeping this maintained — with summaries named separately',
  },
];
