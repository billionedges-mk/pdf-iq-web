/**
 * The marks that depend on who is here, settled once the page has loaded (Pro builds only; src/entries/net.ts runs this
 * on every page, because the bar is on every page).
 *
 * 1. Selling marks. After someone buys, the site stops selling (owner, 13 September 2026): nothing mentioning Pro,
 *    nothing naming the price. The build writes them hidden: the strip under a tool's heading ([data-pro-strip]) and
 *    the PRO tags ([data-pro-label]: the bar's Pro group, the OCR card kickers). Owned, they are removed. Otherwise,
 *    shown. Hidden-first means an owner never sees them flash.
 *
 * 2. The account control in the bar ([data-account-control], redesign stage 1): "Sign in" in a pill when nobody is
 *    signed in on this browser, otherwise the person's initial and the name part of their email address. Before this
 *    a signed-in person could not tell they were signed in, and nothing linked to /account/ but the footer.
 *
 * Both answer from this browser alone: the stored sign-in and the gate's verified token. No request.
 */
import { proAccount, signedIn } from './gate.js';

export const STRIP_SENTINEL = 'pdfiq-pro:strip';

/**
 * `ownedNow` is for the two pages that learn ownership after loading (/account/ and /pro/buy/, once a purchase is
 * confirmed): the gate's answer was taken when the page loaded, before this browser held the token.
 */
export function settleSellingMarks(ownedNow = false): void {
  const owned = ownedNow || proAccount() !== null;
  document.documentElement.dataset.pdfiqProMarks = `${STRIP_SENTINEL}:${owned ? 'owned' : 'shown'}`;
  for (const el of document.querySelectorAll<HTMLElement>('[data-pro-strip], [data-pro-label]')) {
    // Hidden rather than removed, so signing out on a page that stays open can show them again.
    el.hidden = owned;
  }
  settleAccountControl();
}

/** Call again after signing in or out on a page that stays open (/account/, /pro/buy/). */
export function settleAccountControl(): void {
  const control = document.querySelector<HTMLAnchorElement>('[data-account-control]');
  if (!control) return;
  const session = signedIn();
  if (!session) {
    control.className = 'acct acct--out';
    control.replaceChildren('Sign in');
    control.removeAttribute('aria-label');
  } else {
    const name = session.email.split('@')[0] || 'Your account';
    const initial = document.createElement('span');
    initial.className = 'acct__av';
    initial.setAttribute('aria-hidden', 'true');
    initial.textContent = name.charAt(0).toUpperCase();
    const label = document.createElement('span');
    label.className = 'acct__name';
    label.textContent = name;
    control.className = 'acct';
    control.replaceChildren(initial, label);
    control.setAttribute('aria-label', `Your account, signed in as ${session.email || 'this Google account'}`);
  }
  control.hidden = false;
}
