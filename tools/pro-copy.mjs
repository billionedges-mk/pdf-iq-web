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

const NL = '\n';

/**
 * `feature` must match its line in PRO.features exactly: that is the tie between the list the
 * homepage prints and the thing each mark describes, and verify-pro-copy asserts the two sets are
 * the same. A fifth Pro feature with no entry here, or an entry for something Pro does not
 * include, fails the build.
 */
export const PRO_COPY = [
  {
    key: 'batch',
    // The free half of the page lede (proLede). Shorter than `instead`, because it answers the question someone
    // arrived with rather than describing the free path in full.
    lede: 'The free tools do one file at a time, unlimited, with no account.',
    // In the app as Batch, on the same entitlement (Feature.BATCH).
    inApp: true,
    short: 'Batch',
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
    // In the app as its searchable-PDF output (MakeSearchableViewModel).
    inApp: true,
    short: 'searchable PDFs',
    strip: 'searchable PDFs',
    panel: ['Searchable PDFs', 'OCR written back into the file, not just to text'],
    title: 'Searchable PDF',
    feature: 'Searchable-PDF output from OCR',
    route: '/ocr/',
    // One short line (owner, 17 September 2026: the disabled button explains it). "In any reader" went with the long
    // version: it was universal, and the output is read back by two readers (tools/verify-pro-features.mjs).
    what: 'Writes the recognised words into the PDF as an invisible layer, so the file itself can be searched.',
    onDevice: 'The scan is not changed and nothing is redrawn: the words sit behind the picture, '
      + 'written on your device like the recognition itself.',
    instead: 'Reading the text off a scan is free and unlimited. You get the words to copy or save '
      + 'as a .txt file — just not written back into the PDF.',
  },
  {
    key: 'target',
    // Web only today: the app's advanced compression is its three presets, and target mode is a planned port
    // (docs/compress-to-target.md, "Nothing here exists on Android today"). Flip this when it ships and every page
    // that lists the features re-renders itself.
    inApp: false,
    short: 'compressing to a size',
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
    lede: 'Every free tool here already opens a password-protected file if you have its password.',
    // In the app as Protect and Remove password (Feature.PROTECT, Feature.REMOVE_PASSWORD).
    inApp: true,
    short: 'passwords',
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

/**
 * The features, long form, for a page that lists them (/app/'s price card). This was a second copy in site.mjs, word
 * for word the same four strings; two lists of one fact is how a corrected list comes back (owner, 19 September 2026).
 */
export const PRO_FEATURES = PRO_COPY.map((c) => c.feature);

/**
 * Which of them the Android app has, generated from `inApp` rather than written into each page.
 *
 * A sentence naming today's gap would have to be found and rewritten the day the app catches up, on every page that
 * lists the features — the shape this repo keeps removing. This says what each surface does now, leads with what the
 * buyer gets, and stops being a caveat the moment the last flag flips: with all four in the app it reads "All four are
 * in the Android app as well", and nothing else changes. A feature that ships web-first is covered without anyone
 * writing a new sentence, because the count and the names come from the list.
 *
 * Buying still happens on the website whatever this says: that is the Play constraint, and /terms carries it.
 */
export function proSurfaces() {
  const WORDS = ['none', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  const inApp = PRO_COPY.filter((c) => c.inApp);
  const webOnly = PRO_COPY.filter((c) => !c.inApp);
  const list = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '');
  const up = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  if (!inApp.length) return `These are on the website. The Android app has ${PRO_COPY.length === 1 ? 'it' : 'none of them'}.`;
  if (!webOnly.length) return `All ${(WORDS[PRO_COPY.length] ?? PRO_COPY.length).toString().toLowerCase()} are in the Android app as well.`;
  return `${WORDS[inApp.length]} of these are in the Android app as well: ${list(inApp.map((c) => c.short))}. `
    + `${up(list(webOnly.map((c) => c.short)))} ${webOnly.length > 1 ? 'are' : 'is'} on the website.`;
}

/**
 * Where an owner finds what they bought: every feature, linked to the tool it is part of, from PRO_COPY's own routes.
 * /pro/buy/ typed this list by hand — four names and four hrefs — which is the shape a fifth feature breaks silently.
 */
export function proWhere() {
  const links = PRO_COPY.map((c) => `<a href="${c.route}">${c.short}</a>`);
  return links.length > 1 ? `${links.slice(0, -1).join(', ')} and ${links.at(-1)}` : links[0] ?? '';
}

/**
 * One sentence under the heading of a page whose whole tool is Pro — /batch/ and /password/ — before the drop zone.
 *
 * The rule everywhere else is that nothing sells before a file is chosen: on a free tool someone gets a result first
 * and the offer follows the value. On a page where the entire tool is Pro there is no free value first, so the rule
 * only delays an unavoidable fact until after someone has loaded twenty files. This site's argument is that it tells
 * you things early — the real before-and-after, what it cannot do, what a purchase does not cover — and one page
 * withholding the price until you have committed is the only thing doing the opposite (owner, 24 September 2026, over
 * the counter-argument that discovering it later creates more urge to buy: overruled on consistency).
 *
 * What it is, what it costs, and what the free tools do instead. Not a strip and not a panel: the locked state after
 * files are chosen is unchanged.
 *
 * Two rules it is not exempt from, both already ours. It names a price, so the price carries a route to pay
 * (verify-price-offers, CLAIMS 14) — "Pro" is the link. And it carries `data-pro-strip`, so src/pro/strip.ts removes
 * it for someone who already bought: nobody reads a sales pitch on a tool they own.
 */
export function proLede(key, { selling = PRO.onSale, hidden = false } = {}) {
  const c = PRO_COPY.find((x) => x.key === key);
  if (!c) throw new Error(`proLede: no PRO_COPY entry for "${key}"`);
  if (!c.lede) throw new Error(`proLede: PRO_COPY entry "${key}" has no lede, and it is rendered on a Pro page`);
  const pro = selling ? `<a href="/pro/buy/">Pro</a>` : 'Pro';
  const price = selling ? `${PRO.price} ${PRO.qualifier}, not a subscription` : 'not on sale yet, on either surface';
  return `<p class="pro-lede" data-pro-strip${hidden ? ' hidden' : ''}><strong>${c.title} is part of ${pro} &mdash; ${price}.</strong> ${c.lede}</p>`;
}

/**
 * What makes a page a SELLING page — one definition, because there were two and they disagreed the moment a third
 * surface appeared.
 *
 * tools/build.mjs matched `data-pro-strip|class="price__amount"` to decide whether the phone bar gets its Pro button;
 * tools/verify-price-offers.mjs matched `pro-strip|pro-panel|price__amount` to check that button is on exactly the
 * selling pages. Both were right about the surfaces that existed. Adding the one-sentence Pro lede to /batch/ and
 * /password/ — which carries `data-pro-strip` so an owner never sees it — made the first say "sells" and the second
 * say "sells nothing", and the check failed (24 September 2026).
 *
 * The lede is deliberately NOT a selling surface: it is one sentence under a heading, with its own link to the
 * purchase, and the owner's instruction was "not a strip, not a panel". So the definition is the three real selling
 * surfaces, named once and imported by both.
 */
export const SELLING_SURFACE = /class="pro-strip"|class="pro-panel"|class="price__amount"/;

/** The state sentence, from the one flag that decides it. The wording matches the Android app's. */
export function proState(selling = PRO.onSale) {
  return selling
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
  // Selling, the price comes with the way to pay (owner, 17 September 2026): naming a price without offering the purchase is
  // a defect. The link goes to the purchase page; no checkout opens on a tool page.
  const buy = selling ? ' &middot; <a href="/pro/buy/">Buy Pro</a>' : '';
  return `<p class="pro-strip" data-pro-strip${hidden ? ' hidden' : ''}>Free and unlimited, on your device. <strong>Pro</strong> adds ${list} &mdash; ${state}. <a href="/pro/">What Pro adds</a>${buy}</p>`;
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
          <p class="pro-panel__sub">${proSurfaces()} ${terms} Everything above stays free and unlimited.</p>
          <p class="pro-panel__more">${selling ? `<a class="btn btn--sm" href="/pro/buy/">Buy Pro &mdash; ${PRO.price} ${PRO.qualifier}</a> ` : ''}<a href="/pro/">What Pro adds</a></p>
        </div>
        <ul class="pro-panel__list">
${items}
        </ul>
      </div>
    </section>`;
}

/**
 * The phone bar's Pro sheet (owner's phone design, 17 September 2026). The same facts as the homepage panel, from the
 * same PRO_COPY: the price only while Pro can be bought, the count taken from the list, what a purchase covers today
 * and plainly not the Android app, and — while selling — the way to pay beside the price, which is the rule the desktop
 * panel already follows. Never shown to someone who owns Pro: written hidden in a Pro build and settled by
 * src/pro/strip.ts, exactly as the strip and the panel are.
 *
 * The mockup's line here was "The same tools, without doing it one file at a time", which describes Batch alone. The
 * owner replaced it on the desktop panel; the panel's line ships in both.
 *
 * proSurfaces() comes before the terms sentence here and on the panel: what exists where, then what the payment buys.
 * The other order read as a contradiction — "does not unlock anything in the Android app" followed by "three of these
 * are in the Android app as well" — though both are true: the app's three are free in the app, and a web purchase buys
 * none of them.
 */
export function proSheet({ selling = PRO.onSale, hidden = false } = {}) {
  const tick = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12 5 5L20 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
  const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  const count = WORDS[PRO_COPY.length] ?? String(PRO_COPY.length);
  const items = PRO_COPY.map((c) => `        <li>${tick}<span><b>${c.panel[0]}</b> &mdash; ${c.panel[1]}</span></li>`).join(NL);
  const terms = selling
    ? `Bought once, not a subscription. It covers ${PRO.coversToday}, and does not unlock anything in the Android app.`
    : `When it goes on sale: bought once, not a subscription, covering ${PRO.coversToday}. It will not unlock anything in the Android app.`;
  const action = selling
    ? `      <a class="btn sheet__buy" href="/pro/buy/">Buy Pro &mdash; ${PRO.price} ${PRO.qualifier}</a>` + NL
    : '';
  const amount = selling ? `${PRO.price} ${PRO.qualifier}` : 'not on sale yet';
  return [
    `      <div class="prosheet" data-pro-strip${hidden ? ' hidden' : ''}>`,
    `        <p class="prosheet__who"><span class="prosheet__k">Pro</span> <span class="prosheet__amt">${amount}</span></p>`,
    `        <p class="prosheet__line">${count} ${PRO_COPY.length === 1 ? 'thing' : 'things'} the free tools don&rsquo;t do.</p>`,
    '        <ul class="prosheet__list">',
    items,
    '        </ul>',
    `        <p class="prosheet__sub">${proSurfaces()} ${terms} Everything free stays free and unlimited.</p>`,
    action + `        <p class="prosheet__more"><a href="/pro/">What Pro adds, and what stays free</a></p>`,
    '      </div>',
  ].join(NL);
}

/**
 * The locked panel as static HTML, for a build with no Pro code (production). Same classes and order as the runtime one
 * (src/pro/gate.ts lockedPanel): heading and PRO tag, what it does, the state, the free alternative. No control: the real
 * control's words are Pro wording (tools/pro-wording.mjs), which a flag-off build must not carry, and "not on sale yet"
 * offers nothing to press. One treatment for locked Pro everywhere (owner, 17 September 2026).
 */
export function lockedPanelStatic(key, title) {
  const c = PRO_COPY.find((x) => x.key === key);
  if (!c) throw new Error(`lockedPanelStatic: no Pro copy for "${key}"`);
  return `<div class="lock">
        <div class="lock__head"><p class="lock__title">${title}</p><span class="pro-label">PRO</span></div>
        <p class="lock__what">${c.what}</p>
        <p class="lock__state">Part of Pro, not on sale yet.</p>
        <p class="lock__alt">Free instead: ${c.instead}</p>
      </div>`;
}
