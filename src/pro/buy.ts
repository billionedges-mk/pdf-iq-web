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
import { signedIn } from './gate.js';

export const BUY_SENTINEL = 'pdfiq-pro:buy';

type View = 'working' | 'out' | 'ready' | 'loading' | 'done' | 'failed';

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

function removeFrame(): void {
  frame?.remove();
  frame = null;
}

function pay(): void {
  const session = signedIn();
  if (!__PDFIQ_SALE__ || !session) {
    show('out');
    return;
  }
  removeFrame();
  show('loading');

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
      break;
    case 'pdfiq-checkout-failed':
      clearTimeout(opening);
      removeFrame();
      show('failed');
      break;
    case 'pdfiq-checkout-completed':
      clearTimeout(opening);
      $('[data-buy-reference]')!.textContent = typeof data.transactionId === 'string' ? data.transactionId : 'not given';
      show('done');
      break;
    case 'pdfiq-checkout-closed':
      clearTimeout(opening);
      removeFrame();
      if (document.body.dataset.pdfiqBuyState !== 'done') show('ready');
      break;
  }
});

function start(): void {
  const session = signedIn();
  if (!__PDFIQ_SALE__ || !session) {
    show('out');
    return;
  }
  $('[data-buy-email]')!.textContent = session.email;
  $<HTMLButtonElement>('[data-buy-pay]')!.addEventListener('click', pay);
  $<HTMLButtonElement>('[data-buy-retry]')?.addEventListener('click', pay);
  show('ready');
}

start();
