/**
 * After someone buys, the site stops selling (owner, 13 September 2026): nothing mentioning Pro, nothing naming the
 * price. The features simply work.
 *
 * In a Pro build the build writes every selling mark hidden: the strip under a tool's heading ([data-pro-strip]) and
 * the small "Pro" labels ([data-pro-label]: the nav's Batch and Password, the OCR card kickers). This runs on every
 * page (src/entries/net.ts) and settles them against the one question the gate answers with no request: does this
 * browser hold Pro for the signed-in account? Owned, they are removed. Otherwise, shown. Hidden-first means an owner
 * never sees them flash; someone who does not own Pro sees them a moment after the page draws.
 *
 * Production has none of this: the strip is static there, and there are no owners.
 */
import { proAccount } from './gate.js';

export const STRIP_SENTINEL = 'pdfiq-pro:strip';

/**
 * `ownedNow` is for the two pages that learn ownership after loading (/account/ and /pro/buy/, once a purchase is
 * confirmed): the gate's answer was taken when the page loaded, before this browser held the token.
 */
export function settleSellingMarks(ownedNow = false): void {
  const owned = ownedNow || proAccount() !== null;
  document.documentElement.dataset.pdfiqProMarks = `${STRIP_SENTINEL}:${owned ? 'owned' : 'shown'}`;
  for (const el of document.querySelectorAll<HTMLElement>('[data-pro-strip], [data-pro-label]')) {
    if (owned) el.remove();
    else el.hidden = false;
  }
}
