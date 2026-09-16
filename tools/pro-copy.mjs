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
    strip: 'batch',
    panel: ['Batch', 'one operation across many files, a single zip back'],
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
    strip: 'searchable PDFs',
    panel: ['Searchable PDFs', 'OCR written back into the file, not just to text'],
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
    strip: 'compress-to-a-size',
    panel: ['Compress to a size', 'ask for 5 MB; it tries settings and measures'],
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
    strip: 'passwords',
    panel: ['Passwords', 'add one to a copy, or take one off'],
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

/**
 * The one line under every free tool's lede (approved by the owner, 13 September 2026): the tools are free, what Pro
 * adds, and whether it can be bought. Built from `strip` above, in PRO_COPY's order, so a fifth feature reaches every
 * tool page at once. It names a price only while Pro is on sale, and until then says so. Never shown to someone who
 * owns Pro: after buying, the site stops selling (a Pro build removes it; production has no owners).
 */
export function proStrip({ selling = PRO.onSale, hidden = false } = {}) {
  const names = PRO_COPY.map((c) => c.strip);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  const state = selling ? `${PRO.price} ${PRO.qualifier}` : 'not on sale yet';
  return `<p class="pro-strip" data-pro-strip${hidden ? ' hidden' : ''}>Free and unlimited, on your device. <strong>Pro</strong> adds ${list} &mdash; ${state}. <a href="/pro/">What Pro adds</a></p>`;
}

/**
 * The homepage's Pro panel (redesign stage 4, pdf-iq-final.html 01): one panel, not a grid, because Pro is a tier and
 * not four more tools. Price and reason on the left; the four capabilities as a checked list on the right, from
 * PRO_COPY in its order. Built here, beside the strip, so the two cannot name different features or prices.
 *
 * What it says is what is true of the build (owner, 13 and 16 September 2026):
 *  - a price only while Pro can be bought; until then "not on sale yet";
 *  - what a purchase covers today, the web tools, and plainly not the Android app (TECH_DEBT.md, "The purchase page says
 *    web tools only": this panel is one of the five places that change back together);
 *  - never shown to someone who owns Pro. A Pro build writes it hidden and src/pro/strip.ts shows it only to someone who
 *    does not own Pro, as with the strip. Production writes it visible, and has no owners.
 */
export function proPanel({ selling = PRO.onSale, hidden = false } = {}) {
  const tick = '<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12 5 5L20 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const items = PRO_COPY.map((c) => `          <li>${tick}<span><b>${c.panel[0]}</b> &mdash; ${c.panel[1]}</span></li>`).join('\n');
  const amount = selling ? `${PRO.price} ${PRO.qualifier}` : 'not on sale yet';
  // What all of them share, and only that: each is something the free tools do not do, not more of what they do. The
  // mockup's "The same tools — without doing it one file at a time" described Batch alone (owner, 17 September 2026).
  // The count is PRO_COPY's, so a fifth feature cannot leave it saying four.
  const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  const count = WORDS[PRO_COPY.length] ?? String(PRO_COPY.length);
  const line = `${count} ${PRO_COPY.length === 1 ? 'thing' : 'things'} the free tools don&rsquo;t do.`;
  const terms = selling
    ? `Bought once, not a subscription. It covers ${PRO.coversToday}, and does not unlock anything in the Android app.`
    : `When it goes on sale: bought once, not a subscription, covering ${PRO.coversToday}. It will not unlock anything in the Android app.`;
  return `<section class="pro-panel" aria-label="Pro" data-pro-strip${hidden ? ' hidden' : ''}>
      <div class="pro-panel__in">
        <div>
          <p class="pro-panel__who"><span class="pro-panel__k">Pro</span> <span class="pro-panel__amt">${amount}</span></p>
          <p class="pro-panel__line">${line}</p>
          <p class="pro-panel__sub">${terms} Everything above stays free and unlimited.</p>
          <p class="pro-panel__more"><a href="/pro/">What Pro adds</a></p>
        </div>
        <ul class="pro-panel__list">
${items}
        </ul>
      </div>
    </section>`;
}
