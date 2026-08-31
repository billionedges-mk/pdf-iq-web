/**
 * The FAQ block: a closed accordion, and the same answers again as JSON-LD.
 *
 * Closed on purpose. These are tool pages, not articles — a page that reads like a blog post
 * gets absorbed by an answer box, and six prose questions below the tool would push the tool
 * up and the page toward article shape. Collapsed it costs one line, the tool stays above the
 * fold, and both the query language and the structured data are still in the HTML.
 *
 * On the JSON-LD, because the reason matters and the usual one is wrong: FAQ rich results
 * were retired from Google Search on 7 May 2026, so this earns no rich result and never will.
 * FAQPage is still a valid Schema.org type, Google still parses it, and answer engines still
 * read it. That is why it ships. See CLAIMS.md check 21 — both the original justification for
 * adding it and the correction offered to that justification were stale.
 *
 * Every answer is generated from one source in site.mjs. Seven hand-written copies is how a
 * correction lands in six of them.
 */

import { FAQ } from './site.mjs';

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function faqBlock(tool, sizeMb) {
  const filled = FAQ.map((item) => ({
    q: item.q.replace('{action}', tool.faqAction),
    a: (tool.slug === 'ocr' && item.ocr ? item.ocr : item.a).replace('{size}', `${sizeMb} MB`),
  }));

  const rows = filled
    .map(
      (f) =>
        `          <details class="faq__item">\n` +
        `            <summary>${esc(f.q)}</summary>\n` +
        `            <p>${esc(f.a)}</p>\n` +
        `          </details>`
    )
    .join('\n');

  // `<` is escaped inside the script element so a future answer containing markup cannot
  // close it early.
  const jsonld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: filled.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }).replace(/</g, '\\u003c');

  return (
    `      <section class="faq" aria-label="Questions">\n` +
    `        <h2 class="faq__title">Questions</h2>\n` +
    `${rows}\n` +
    `      </section>\n` +
    `      <script type="application/ld+json">${jsonld}</script>`
  );
}
