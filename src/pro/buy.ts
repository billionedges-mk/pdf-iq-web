/**
 * /pro/buy/ — present only in a sale build (tools/paddle-config.mjs).
 *
 * This page never runs Paddle's script. It cannot: Paddle.js running here could read this origin's
 * localStorage, where the Pro sign-in keeps a refresh token that can act as the account, and /privacy
 * promises only this site's own code can read that. So pressing Pay embeds the checkout, which lives
 * on a different origin (__PDFIQ_CHECKOUT_ORIGIN__), in a frame covering the page, and hands it only
 * the uid and email, by postMessage, addressed to that exact origin. The browser keeps each origin's
 * storage to itself; nothing here has to be careful for that to hold.
 *
 * Visiting the page loads nothing from anyone else. The frame is created only when Pay is pressed.
 *
 * Messages are accepted only from the checkout origin, and only these shapes:
 *   { type: 'pdfiq-checkout-ready' }                     the frame is listening; send it the buyer
 *   { type: 'pdfiq-checkout-loaded' }                    Paddle's checkout is showing
 *   { type: 'pdfiq-checkout-failed' }                    Paddle.js did not load, or Paddle refused
 *   { type: 'pdfiq-checkout-closed' }                    the buyer closed the checkout
 *   { type: 'pdfiq-checkout-completed', transactionId }  paid
 */
import { signedIn, proAccount } from './gate.js';
import { writePendingPurchase, readPendingPurchase } from './pending.js';
import { confirmPurchase, confirmEndWords } from './confirm.js';

export const BUY_SENTINEL = 'pdfiq-pro:buy';

type View = 'working' | 'out' | 'owned' | 'ready' | 'loading' | 'confirming' | 'done' | 'failed';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);

function show(view: View): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-buy]')) el.hidden = el.dataset.buy !== view;
  document.body.dataset.pdfiqBuy = BUY_SENTINEL;
  // Read by the closed handler: closing the checkout after paying must not put the page back to
  // "ready", as if nothing had happened.
  document.body.dataset.pdfiqBuyState = view;
}

/**
 * How long the checkout may take to say it is showing before the page stops saying it is opening.
 * Measured first: with a checkout Paddle refused, no event arrived at all, and the page said
 * "Opening Paddle's checkout" indefinitely.
 */
const OPEN_TIMEOUT_MS = 25000;
let opening: ReturnType<typeof setTimeout> | undefined;
let frame: HTMLIFrameElement | null = null;
let cover: HTMLElement | null = null;

/**
 * A full-page status shown the instant Pay is pressed, beneath the checkout frame. The checkout is a separate
 * origin that takes seconds to load, and before this the page showed nothing in that time: Maneesh's walk
 * (13 September 2026) timed four to five seconds of an unchanged screen. The frame is transparent until
 * Paddle's overlay paints, so this shows through it until then.
 */
function coverWith(words: string): void {
  if (!cover) {
    cover = document.createElement('div');
    cover.setAttribute('role', 'status');
    cover.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;'
      + 'background:rgba(30,42,56,.55);color:#FAF8F4;font:600 18px/1.5 system-ui,sans-serif;padding:24px;text-align:center';
    document.body.append(cover);
  }
  cover.textContent = words;
}

function removeCover(): void {
  cover?.remove();
  cover = null;
}

function removeFrame(): void {
  frame?.remove();
  frame = null;
  removeCover();
}

function pay(): void {
  const session = signedIn();
  if (!__PDFIQ_SALE__ || !session) {
    show('out');
    return;
  }
  removeFrame();
  show('loading');
  coverWith("Opening Paddle's secure checkout…");

  frame = document.createElement('iframe');
  frame.src = `${__PDFIQ_CHECKOUT_ORIGIN__}/`;
  frame.title = "Paddle's checkout";
  // Paddle's checkout offers wallet payments; the frame may ask for them, nothing else.
  frame.allow = 'payment';
  frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;background:transparent;z-index:2147483647;color-scheme:normal';
  document.body.append(frame);

  clearTimeout(opening);
  opening = setTimeout(() => {
    if (document.body.dataset.pdfiqBuyState === 'loading') {
      removeFrame();
      show('failed');
    }
  }, OPEN_TIMEOUT_MS);
}

window.addEventListener('message', (e: MessageEvent) => {
  // Anything not from the checkout origin, or not from the frame this page made, is ignored.
  if (e.origin !== __PDFIQ_CHECKOUT_ORIGIN__ || !frame || e.source !== frame.contentWindow) return;
  const data = e.data as { type?: string; transactionId?: string } | null;
  const session = signedIn();
  switch (data?.type) {
    case 'pdfiq-checkout-ready':
      if (!session) { removeFrame(); show('out'); return; }
      // The uid and email only: never the ID token or the refresh token.
      frame.contentWindow!.postMessage({ type: 'pdfiq-checkout-open', uid: session.uid, email: session.email }, __PDFIQ_CHECKOUT_ORIGIN__);
      break;
    case 'pdfiq-checkout-loaded':
      clearTimeout(opening);
      // Paddle's own overlay is showing now; ours would only sit behind it.
      removeCover();
      // The checkout is showing over the page. Behind it, the page reads "ready", so closing the checkout
      // returns to the same place. Found on Preview: without this it stayed on "Opening Paddle's checkout".
      show('ready');
      break;
    case 'pdfiq-checkout-failed':
      clearTimeout(opening);
      removeFrame();
      show('failed');
      break;
    case 'pdfiq-checkout-completed': {
      clearTimeout(opening);
      const txn = typeof data.transactionId === 'string' && /^txn_[a-z0-9]{26}$/.test(data.transactionId) ? data.transactionId : '';
      $('[data-buy-reference]')!.textContent = txn || 'not given';
      show('done');
      // Paid. Before this the page stopped at Paddle's success message: closing it and reloading still offered
      // Buy, and Pro arrived only if the buyer thought to open /account/ (the walk of 13 September 2026). So go
      // there now, where the purchase is confirmed and this browser learns it owns Pro.
      // Remembered before anything else, so a tab closed from here on still knows it paid (src/pro/pending.ts).
      const who = signedIn();
      if (who) writePendingPurchase({ txn: txn || 'not given', uid: who.uid, at: Date.now() });
      removeFrame();
      void confirmHere(txn);
      break;
    }
    case 'pdfiq-checkout-closed':
      clearTimeout(opening);
      removeFrame();
      if (document.body.dataset.pdfiqBuyState !== 'done') show('ready');
      break;
  }
});

/** Confirm on this page, in words, then say what the buyer can do next. */
async function confirmHere(txn: string): Promise<void> {
  show('confirming');
  const line = $('[data-buy-confirm]')!;
  const next = $('[data-buy-confirm-next]')!;
  next.hidden = true;
  const outcome = await confirmPurchase(txn, (text) => { line.textContent = text; });
  line.textContent = confirmEndWords(outcome, txn);
  if (outcome.kind === 'owned') {
    show('owned');
    return;
  }
  if (outcome.kind === 'signed-out' || outcome.kind === 'slow') {
    next.replaceChildren('Your ', Object.assign(document.createElement('a'), { href: '/account/', textContent: 'account page' }), ' checks again whenever it is opened.');
    next.hidden = false;
  }
}

function start(): void {
  const session = signedIn();
  if (!__PDFIQ_SALE__ || !session) {
    show('out');
    return;
  }
  // Already owned on this browser: nothing to buy, and nothing should suggest otherwise.
  if (proAccount()) {
    show('owned');
    return;
  }
  // Paid on this browser but not confirmed yet (the tab was closed, say): confirm, never offer a second checkout.
  const pending = readPendingPurchase(session.uid);
  if (pending) {
    void confirmHere(pending.txn === 'not given' ? '' : pending.txn);
    return;
  }
  $('[data-buy-email]')!.textContent = session.email;
  $<HTMLButtonElement>('[data-buy-pay]')!.addEventListener('click', pay);
  $<HTMLButtonElement>('[data-buy-retry]')?.addEventListener('click', pay);
  show('ready');
}

start();
