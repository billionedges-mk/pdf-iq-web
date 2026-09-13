/**
 * The checkout origin: the only place Paddle's script runs (tools/paddle-config.mjs explains why).
 *
 * Built by tools/build-checkout.mjs into its own Cloudflare Pages project, so it is a different origin
 * from pdf-iq.com and cannot read that origin's storage, and Paddle's script loaded here cannot either.
 *
 * It is a blank, transparent page that pdf-iq.com /pro/buy/ puts in a frame over itself. It:
 *   - accepts one message, from the site origin only, carrying a uid and an email;
 *   - loads Paddle.js, keeps Retain analytics out, and opens the checkout for that buyer;
 *   - reports what happens back to the site origin only;
 *   - stores nothing. There is no localStorage, sessionStorage, cookie or IndexedDB use in this file,
 *     and tools/build-checkout.mjs refuses to write a bundle that uses one.
 */

export {};

interface PaddleEvent { name?: string; data?: { transaction_id?: string } }
interface PaddleGlobal {
  Environment: { set(env: string): void };
  Initialize(options: { token: string; eventCallback: (e: PaddleEvent) => void }): void;
  Checkout: { open(options: unknown): void };
}
declare global {
  interface Window { Paddle?: PaddleGlobal; profitwell?: { isLoaded?: boolean } }
}

const SITE = __CHECKOUT_SITE_ORIGIN__;

function tell(type: string, extra: Record<string, string> = {}): void {
  // Addressed to the site origin: if anything else has framed this page, it hears nothing.
  window.parent.postMessage({ type, ...extra }, SITE);
}

function loadPaddle(): Promise<PaddleGlobal> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = __CHECKOUT_PADDLE_SCRIPT__;
    s.onload = () => (window.Paddle ? resolve(window.Paddle) : reject(new Error('Paddle.js loaded without defining Paddle')));
    s.onerror = () => reject(new Error('Paddle.js did not load'));
    document.head.append(s);
  });
}

let started = false;

async function open(uid: string, email: string): Promise<void> {
  if (started) return;
  started = true;
  let Paddle: PaddleGlobal;
  try {
    Paddle = await loadPaddle();
  } catch {
    tell('pdfiq-checkout-failed');
    return;
  }
  // Paddle.js 2.9.7 injects Retain analytics (public.profitwell.com) at the end of Initialize() in every
  // environment except sandbox, unless this is already set. This page's policy also names no
  // ProfitWell host, so the browser refuses the script if a future Paddle.js ignores the flag.
  window.profitwell = { ...(window.profitwell ?? {}), isLoaded: true };
  if (__CHECKOUT_PADDLE_ENV__ === 'sandbox') Paddle.Environment.set('sandbox');
  Paddle.Initialize({
    token: __CHECKOUT_PADDLE_TOKEN__,
    eventCallback: (e) => {
      if (e.name === 'checkout.loaded') tell('pdfiq-checkout-loaded');
      else if (e.name === 'checkout.failed') tell('pdfiq-checkout-failed');
      else if (e.name === 'checkout.completed') tell('pdfiq-checkout-completed', { transactionId: e.data?.transaction_id ?? '' });
      else if (e.name === 'checkout.closed') tell('pdfiq-checkout-closed');
    },
  });
  Paddle.Checkout.open({
    items: [{ priceId: __CHECKOUT_PADDLE_PRICE__, quantity: 1 }],
    customer: { email },
    // Whose purchase this is. The webhook records it against this uid (server/paddle.js).
    customData: { uid, email },
    settings: { displayMode: 'overlay', allowLogout: false },
  });
}

window.addEventListener('message', (e: MessageEvent) => {
  if (e.origin !== SITE || e.source !== window.parent) return;
  const data = e.data as { type?: string; uid?: unknown; email?: unknown } | null;
  if (data?.type !== 'pdfiq-checkout-open') return;
  const uid = typeof data.uid === 'string' && data.uid.length > 0 && data.uid.length <= 128 ? data.uid : '';
  const email = typeof data.email === 'string' && /^[^\s@]+@[^\s@]+$/.test(data.email) && data.email.length <= 254 ? data.email : '';
  if (!uid || !email) {
    tell('pdfiq-checkout-failed');
    return;
  }
  void open(uid, email);
});

if (window.parent !== window && __CHECKOUT_PADDLE_TOKEN__) {
  tell('pdfiq-checkout-ready');
} else if (__CHECKOUT_PADDLE_TOKEN__ && new URLSearchParams(location.search).has('_ptxn')) {
  // Opened directly from a Paddle payment link (this origin is Paddle's default payment link, which
  // Paddle requires to run Paddle.js). Paddle.js opens the transaction named in the URL by itself once
  // initialised; nothing from pdf-iq.com is involved, and the Retain guard applies all the same.
  void loadPaddle().then((Paddle) => {
    window.profitwell = { ...(window.profitwell ?? {}), isLoaded: true };
    if (__CHECKOUT_PADDLE_ENV__ === 'sandbox') Paddle.Environment.set('sandbox');
    Paddle.Initialize({ token: __CHECKOUT_PADDLE_TOKEN__, eventCallback: () => {} });
  }).catch(() => {});
}
// Opened on its own with neither, it has nobody to talk to and does nothing.
