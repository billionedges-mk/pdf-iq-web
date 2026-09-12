/**
 * What each Pro feature is, in one place, for every surface that mentions it.
 *
 * Three consumers read this: the /pro/ page, the marks beside the features on the tool pages, and
 * tools/verify-pro-copy.mjs. One source because the alternative is what this project keeps
 * finding — the same fact written twice, corrected once.
 *
 * ### Every entry must carry `instead`, and that is enforced
 *
 * A mark on a feature nobody can buy is only useful if it leaves the reader better off than not
 * clicking. `instead` is the free thing that gets closest, in the site's own voice, and the check
 * refuses an entry without one. It is the difference between information and a wall, and it is the
 * field most likely to be dropped by someone in a hurry — which is why it is a required field
 * rather than a convention.
 *
 * ### Nothing here may offer a purchase while PRO.onSale is false
 *
 * There is nothing to buy, so a control that offers to sell it is the dead-control defect wearing
 * a price tag (CLAIMS 14). The check greps this file for purchase verbs and fails while the flag
 * is false. When it flips, the buy path is added in one place — the /pro/ page — and the marks
 * still only link to it.
 */
import { PRO } from './site.mjs';

/**
 * `feature` must match its line in PRO.features exactly: that is the tie between the list the
 * homepage prints and the thing each mark describes, and verify-pro-copy asserts the two sets are
 * the same. A fifth Pro feature with no entry here, or an entry for something Pro does not
 * include, fails the build.
 */
export const PRO_COPY = [
  {
    key: 'batch',
    title: 'Batch',
    feature: 'Batch: compress, read or rotate many files at once',
    route: '/batch/',
    what: 'One operation across many files at once — compress them, read the text out of them, or '
      + 'rotate them — with a single zip back at the end.',
    onDevice: 'Every file is worked on in your own browser, one after another, and the zip is built '
      + 'there too. Nothing is uploaded, which is the reason the tab has to stay open.',
    instead: 'Each tool here does one file at a time, free and unlimited — and the result of one '
      + 'carries into the next, so compressing a scan and then reading the text off it needs no saving '
      + 'in between.',
  },
  {
    key: 'searchable',
    title: 'Searchable PDF',
    feature: 'Searchable-PDF output from OCR',
    route: '/ocr/',
    what: 'The words recognised in a scan, written back into the file as an invisible layer, so the '
      + 'document itself can be searched and copied from in any reader.',
    onDevice: 'The scan is not changed and nothing is redrawn: the words sit behind the picture, '
      + 'written on your device like the recognition itself.',
    instead: 'Reading the text off a scan is free and unlimited. You get the words to copy or save '
      + 'as a .txt file — just not written back into the PDF.',
  },
  {
    key: 'target',
    title: 'Compress to a target',
    feature: 'Advanced compression — target a file size or a dpi',
    route: '/compress/',
    what: 'Ask for “no larger than 5 MB”, or “no image above 150 dpi”, and it tries settings and '
      + 'measures what they produced rather than leaving you to guess between presets.',
    onDevice: 'Each attempt is a real compression run in your browser, measured, and what you keep '
      + 'is the mildest setting that actually met the target — or a plain answer that it cannot be met.',
    instead: 'The three presets are free and report the real before and after, so trying Balanced '
      + 'and then Smaller costs two clicks and tells you the truth about both.',
  },
  {
    key: 'password',
    title: 'Password',
    feature: 'Password protect and password remove',
    route: '/password/',
    what: 'Add a password to a copy of a PDF, or take one off, written AES-256.',
    onDevice: 'The password never leaves the tab: your own browser uses it to derive the file’s key, '
      + 'and it is not stored anywhere or written into the file you save.',
    instead: 'Every tool here already opens a password-protected file if you have its password, and '
      + 'says plainly when it cannot — an author’s limits are never stripped without the owner password.',
  },
];

/** The state sentence, from the one flag that decides it. The wording matches the Android app's. */
export function proState() {
  return PRO.onSale
    ? 'Part of Pro.'
    : 'Part of Pro, which is not on sale yet, on either surface.';
}
