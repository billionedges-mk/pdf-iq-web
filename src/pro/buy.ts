/**
 * /pro/buy/ — present only in a sale build (tools/paddle-config.mjs).
 *
 * The one page on the site that loads a third-party script, and it does so only when someone
 * presses the button. Visiting the page loads nothing from Paddle; the footer readout stays at zero
 * until a person chooses to pay.
 *
 * Two things this page must never do:
 *   - Load Paddle Retain's analytics. Paddle.js 2.9.7 ends Paddle.Initialize() by injecting
 *     public.profitwell.com/js/profitwell.js whenever the environment is not sandbox, unless
 *     `window.profitwell.isLoaded` is already set (read from the library's source, not its docs).
 *     It is set before Initialize, and the page's content security policy does not allow that host
 *     either, so if a future Paddle.js ignores the first guard the browser still refuses the script.
 *   - Take payment for someone who is not signed in. The purchase is recorded against the Firebase
 *     account in custom_data; without one, a payment would belong to nobody we can find again.
 */
import { signedIn } from './gate.js';

export const BUY_SENTINEL = 'pdfiq-pro:buy';

type View = 'working' | 'out' | 'ready' | 'loading' | 'done' | 'failed';

interface PaddleEvent { name?: string; data?: { transaction_id?: string } }
interface PaddleGlobal {
  Environment: { set(env: string): void };
  Initialize(options: { token: string; eventCallback: (e: PaddleEvent) => void }): void;
  Checkout: { open(options: unknown): void };
}
declare global {
  interface Window { Paddle?: PaddleGlobal; profitwell?: { isLoaded?: boolean } }
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);

function show(view: View): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-buy]')) el.hidden = el.dataset.buy !== view;
  document.body.dataset.pdfiqBuy = BUY_SENTINEL;
  // Read by the checkout.closed handler: closing Paddle's overlay after paying must not put the
  // page back to "ready", as if nothing had happened.
  document.body.dataset.pdfiqBuyState = view;
}

function loadPaddle(src: string): Promise<PaddleGlobal> {
  if (window.Paddle) return Promise.resolve(window.Paddle);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => (window.Paddle ? resolve(window.Paddle) : reject(new Error('Paddle.js loaded without defining Paddle')));
    s.onerror = () => reject(new Error('Paddle.js did not load'));
    document.head.appendChild(s);
  });
}

let initialized = false;

/**
 * How long Paddle's checkout may take to report itself loaded before the page stops saying it is
 * opening. Measured first: with a checkout Paddle refused, neither checkout.loaded nor checkout.failed
 * arrived, and the page said "Opening Paddle's checkout" indefinitely.
 */
const OPEN_TIMEOUT_MS = 25000;
let opening: ReturnType<typeof setTimeout> | undefined;

async function pay(): Promise<void> {
  const session = signedIn();
  if (!__PDFIQ_SALE__ || !session) {
    show('out');
    return;
  }
  show('loading');
  let Paddle: PaddleGlobal;
  try {
    Paddle = await loadPaddle(__PDFIQ_PADDLE_SCRIPT__);
  } catch {
    show('failed');
    return;
  }
  if (!initialized) {
    // First guard against Retain analytics; the page's CSP is the second.
    window.profitwell = { ...(window.profitwell ?? {}), isLoaded: true };
    if (__PDFIQ_PADDLE_ENV__ === 'sandbox') Paddle.Environment.set('sandbox');
    Paddle.Initialize({
      token: __PDFIQ_PADDLE_TOKEN__,
      eventCallback: (e) => {
        if (e.name === 'checkout.loaded') {
          clearTimeout(opening);
          show('ready');
        } else if (e.name === 'checkout.failed') {
          clearTimeout(opening);
          show('failed');
        } else if (e.name === 'checkout.completed') {
          $('[data-buy-reference]')!.textContent = e.data?.transaction_id ?? 'not given';
          show('done');
        } else if (e.name === 'checkout.closed' && document.body.dataset.pdfiqBuyState !== 'done') {
          show('ready');
        }
      },
    });
    initialized = true;
  }
  clearTimeout(opening);
  opening = setTimeout(() => {
    if (document.body.dataset.pdfiqBuyState === 'loading') show('failed');
  }, OPEN_TIMEOUT_MS);
  Paddle.Checkout.open({
    items: [{ priceId: __PDFIQ_PADDLE_PRICE__, quantity: 1 }],
    customer: { email: session.email },
    // Whose purchase this is. The webhook records it against this uid (server/paddle.js).
    customData: { uid: session.uid, email: session.email },
    settings: { displayMode: 'overlay', allowLogout: false },
  });
}

function start(): void {
  const session = signedIn();
  if (!__PDFIQ_SALE__ || !session) {
    show('out');
    return;
  }
  $('[data-buy-email]')!.textContent = session.email;
  $<HTMLButtonElement>('[data-buy-pay]')!.addEventListener('click', () => void pay());
  $<HTMLButtonElement>('[data-buy-retry]')?.addEventListener('click', () => void pay());
  show('ready');
}

start();
