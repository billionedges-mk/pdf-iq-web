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
    phrase: 'a download to you, not an upload from you',
    why: 'Said of the text recogniser on /privacy. The document really is never sent, but ML Kit '
      + 'reports its own usage to Google after a scan is read — measured on vc16, 7 events and '
      + '1,099 bytes for one document. See docs/ml-kit-metrics.md.',
    instead: 'the paragraph now points at Diagnostics and analytics, which says what is sent',
  },
  {
    phrase: 'AI summaries, the heavier OCR work',
    why: 'Read as though Pro includes summaries. It does not, in any quantity: ten a month for '
      + 'everyone, Pro or not, and credit packs beyond that.',
    instead: 'the heavier OCR work, and keeping this maintained — with summaries named separately',
  },
  {
    phrase: 'Make it searchable',
    why: 'An onward link to /ocr/ from Compress and Merge. The free OCR reads the text out; writing a '
      + 'searchable PDF is Pro, so the link promised what the page it opens does not do (content review, '
      + '12 September 2026, item 2).',
    instead: 'Read the text from it',
  },
  {
    phrase: 'Make searchable',
    why: 'The same link on Split and Rotate.',
    instead: 'Read the text from it',
  },
  {
    phrase: 'Make the text searchable',
    why: 'The same link on Images to PDF.',
    instead: 'Read the text in it',
  },
  {
    phrase: 'are not re-encoded, so nothing is lost',
    why: 'Said of every image on /images-to-pdf/. HEIC, WebP, AVIF, GIF and mirrored JPEGs are decoded '
      + 'and re-encoded (src/lib/image.ts), and the result panel already counted them as converted '
      + '(content review item 14).',
    instead: 'JPEG and PNG go in without being re-encoded; the kinds that must be converted are named',
  },
  {
    phrase: 'written invisibly behind the original image',
    why: 'The free /ocr/ writes nothing into the file; that sentence described the Pro searchable PDF (content review, 12 September 2026, item 1).',
    instead: 'Your scan is never changed',
  },
  {
    phrase: 'reload the page — it keeps working',
    why: 'No service worker, and HTML is served must-revalidate. Walked in Chrome with DevTools offline: location.reload() and re-entering the URL both land on the offline error page (content review, 12 September 2026, item 3).',
    instead: 'Once the page has loaded, turn off your wifi and use it',
  },
  {
    phrase: 'Handwriting: not attempted',
    why: 'Every page is attempted; low-confidence pages are reported by name (src/entries/ocr.ts) (content review, 12 September 2026, item 4).',
    instead: 'usually comes back too uncertain to trust',
  },
  {
    phrase: 'Handwriting is not attempted',
    why: 'The same claim on /support/.',
    instead: 'Handwriting and very noisy scans usually come back too uncertain to trust',
  },
  {
    phrase: 'Batch processing across every tool',
    why: 'Batch does compress, OCR and rotate (content review, 12 September 2026, item 5).',
    instead: 'Batch: compress, read or rotate many files at once',
  },
  {
    phrase: 'two questions and an email',
    why: 'The firms form asks three questions (content review, 12 September 2026, item 7).',
    instead: 'three questions and an email',
  },
  {
    phrase: 'no upload limit because there is no upload',
    why: 'The same page states a 60 MB limit (content review, 12 September 2026, item 8).',
    instead: 'the ceiling is what a browser tab can write out',
  },
  {
    phrase: 'before we publish a number',
    why: 'Every tool page already publishes the limit (content review, 12 September 2026, item 9).',
    instead: 'Each tool refuses files over the limit',
  },
  {
    phrase: 'beside the one you opened',
    why: 'Saving is a browser download; it lands where downloads go (content review, 12 September 2026, item 10).',
    instead: 'your browser saves them as downloads',
  },
  {
    phrase: 'new one beside it',
    why: 'The same claim on /rotate/.',
    instead: 'a new file through your browser’s download',
  },
  {
    phrase: 'buttons below are placeholders',
    why: '/app/ has no store buttons at all (content review, 12 September 2026, item 11).',
    instead: 'There are no store links here yet',
  },
  {
    phrase: 'What Pro will pay for',
    why: 'Pro features run on the device and cost nothing per use, and the site does describe Pro (content review, 12 September 2026, item 12).',
    instead: 'What Pro pays for',
  },
  {
    phrase: 'so you can search and copy it',
    why: 'Searching is the Pro output; free OCR gives text to copy or save (content review, 12 September 2026, item 15).',
    instead: 'so you can copy it or save it as text',
  },
  {
    phrase: 'Everyone else rents theirs',
    why: 'Unchecked absolute about competitors (content review, 12 September 2026, item 16).',
    instead: 'Subscription is the usual model',
  },
  {
    phrase: 'every competitor bills monthly',
    why: 'The same, on /app/.',
    instead: 'removed',
  },
  {
    phrase: 'every tool gets it wrong',
    why: 'The same, on /merge/.',
    instead: 'removed',
  },
  {
    phrase: 'nothing behind the button',
    why: 'Searchable PDF exists behind the flag; what is missing is a way to buy it (content review, 12 September 2026, item 17).',
    instead: 'It is part of Pro, which is not on sale yet',
  },
  {
    phrase: 'payment placeholder',
    why: 'Scaffolding label shown to readers (content review, 12 September 2026, item 29).',
    instead: 'Nothing to pay for yet / Nothing to buy on this page today',
  },
  {
    phrase: 'typically up to 14 months',
    why: 'One number for two settings, never checked: event data is kept 2 months and user data 14 months with reset on new activity (read from the property, 13 September 2026), and it called our own property settings Firebase defaults. Crashlytics is 90 days, from Firebase\'s privacy page.',
    instead: 'three entries under How long we keep things, each with its source',
  },
  {
    phrase: 'notify you in the app',
    why: 'There is no mechanism to notify anyone in the app, and the policy changed three times in the week of 8 September 2026 without it. A promise that cannot be kept (content review item 23).',
    instead: 'When this policy changes, the effective date above changes with it.',
  },
  {
    phrase: 'fourteen-day right to cancel',
    why: 'A statement of law that may be wrong: the statutory right to cancel generally ends once digital supply begins with the buyer\'s consent. The thirty-day policy is more generous and is a promise we control (content review item 25).',
    instead: 'the general statement that the policy adds to your rights and reduces none of them',
  },
];
