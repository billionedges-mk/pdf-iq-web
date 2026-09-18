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
 * Visiting the page loads nothing from anyone else. The frame is created only when Pay is pressed, or at once when
 * an Unlock button sent the buyer here. Signing in starts and finishes here too (a second registered redirect
 * URI): leaving for Google is a navigation, and finishing contacts Google's Identity Toolkit, as /account/ does.
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
import { confirmPurchase, confirmEndWords, afterConfirm, type ConfirmEnding } from './confirm.js';
import { peekUnlock, latestUnlockKey, type UnlockIntent } from '../lib/handoff.js';
import { startSignIn, completeSignIn, AuthError, type AuthErrorKind } from './auth.js';
import { WORDS } from './auth-words.js';
import { settleSellingMarks, settleAccountControl } from './strip.js';
import { refreshEntitlement } from './entitlement.js';

/**
 * The pages an Unlock button can send a buyer from, and so the only places this page will send them back to. A
 * path from storage is still only ever one of these: nothing here navigates to an address it was handed.
 */
const RETURN_PAGES: Record<string, string> = {
  '/compress/': 'Compress',
  '/ocr/': 'OCR',
  '/password/': 'Password',
  '/batch/': 'Batch',
};

/** Set when this page was opened by an Unlock button (src/pro/unlock.ts). */
let unlock: { key: string; intent: UnlockIntent; page: string; name: string; file: boolean; expired: boolean } | null = null;

async function readUnlock(backFromGoogle: boolean): Promise<void> {
  // Back from Google the address carries no key (the redirect must match the registered URI exactly), so the
  // Unlock that sent the buyer to sign in is the newest one still inside its ten minutes.
  const key = new URLSearchParams(location.search).get('unlock') ?? (backFromGoogle ? await latestUnlockKey() : null);
  if (!key) return;
  const found = await peekUnlock(key);
  if (!found || !RETURN_PAGES[found.intent.path]) return;
  unlock = { key, intent: found.intent, page: RETURN_PAGES[found.intent.path], name: found.name, file: found.file, expired: found.expired };
  // Put it back in the address, so a reload still knows where the buyer came from.
  if (backFromGoogle) history.replaceState(null, '', `${location.pathname}?unlock=${encodeURIComponent(key)}`);
}

/**
 * The way back to where Unlock was pressed, with the file, on every view a buyer can stop at without buying:
 * ready (the checkout closed), signed out, and a sign-in that did not finish.
 */
function offerWayBack(): void {
  if (!unlock) return;
  for (const back of document.querySelectorAll<HTMLElement>('[data-buy-back]')) {
    const a = Object.assign(document.createElement('a'), { href: backHref(unlock.file), textContent: `Back to ${unlock.page}` });
    back.replaceChildren(a, unlock.file ? ` with ${unlock.name}, without buying.` : ', without buying.');
    back.hidden = false;
  }
}

/** Leave for Google's sign-in, which returns to this page. */
function signIn(): void {
  try {
    startSignIn();
  } catch (e) {
    signInFailed(e);
  }
}

/** The account page's words for the same failure, so both pages say the same true thing. */
function signInFailed(e: unknown): void {
  const kind: AuthErrorKind = e instanceof AuthError ? e.kind : 'unknown';
  const code = e instanceof AuthError ? e.code : e instanceof Error ? e.message : String(e);
  const words = WORDS[kind];
  $('[data-buy-signin-title]')!.textContent = words.title;
  $('[data-buy-signin-body]')!.textContent = words.body;
  $('[data-buy-signin-code]')!.textContent = `${kind} · ${code}`;
  $<HTMLButtonElement>('[data-buy-signin-retry]')!.hidden = !words.again;
  show('signin-failed');
}

/** A first arrival, not a reload or a return through the back button: only then does this page act by itself. */
function firstArrival(): boolean {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return nav?.type !== 'reload' && nav?.type !== 'back_forward';
}

/** The link back to where Unlock was pressed, carrying the file when it is still there. */
function backHref(withFile: boolean): string {
  return withFile ? `${unlock!.intent.path}?from=${encodeURIComponent(unlock!.key)}` : unlock!.intent.path;
}

/** Owned now, and this page was opened by Unlock: take the buyer back, with the file if it is still kept. */
async function returnFromUnlock(): Promise<void> {
  if (!unlock) return;
  const line = $('[data-buy-return]')!;
  line.hidden = false;
  // Asked again: the confirmation may have taken long enough for the ten minutes to pass.
  const now = await peekUnlock(unlock.key);
  const withFile = Boolean(now?.file);
  if (withFile) {
    line.textContent = `Pro is yours. Taking you back to ${unlock.page} with ${unlock.name}…`;
    setTimeout(() => { location.href = backHref(true); }, 1500);
    return;
  }
  const a = Object.assign(document.createElement('a'), { href: backHref(false), textContent: `Back to ${unlock.page}` });
  const why = !unlock.name
    ? '.'
    // Expired on arrival (that read deleted it), expired since, or gone since it was seen with its file.
    : unlock.expired || now?.expired || (!now && unlock.file)
      ? ` — ${unlock.name} was kept on this device for ten minutes only, so choose it again there.`
      : ` — ${unlock.name} could not be brought along, so choose it again there.`;
  line.replaceChildren('Pro is yours. ', a, why);
}

export const BUY_SENTINEL = 'pdfiq-pro:buy';

type View = 'working' | 'out' | 'signin-failed' | 'owned' | 'ready' | 'loading' | 'confirming' | 'done' | 'failed';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);

function show(view: View): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-buy]')) el.hidden = el.dataset.buy !== view;
  document.body.dataset.pdfiqBuy = BUY_SENTINEL;
  // Read by the closed handler: closing the checkout after paying must not put the page back to
  // "ready", as if nothing had happened.
  document.body.dataset.pdfiqBuyState = view;
  // Owned: the nav's Pro labels go at once, not on the next page (src/pro/strip.ts).
  if (view === 'owned') settleSellingMarks(true);
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

function pay(lead = ''): void {
  const session = signedIn();
  if (!__PDFIQ_SALE__ || !session) {
    show('out');
    return;
  }
  removeFrame();
  show('loading');
  coverWith(`${lead}Opening Paddle's secure checkout…`);

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
      // Buy, and Pro arrived only if the buyer thought to open /account/ (the walk of 13 September 2026). So the
      // purchase is confirmed here, and this browser learns it owns Pro without going anywhere.
      // Remembered before anything else, so a tab closed from here on still knows it paid (src/pro/pending.ts).
      const who = signedIn();
      if (who) writePendingPurchase({ txn: txn || 'not given', uid: who.uid, at: Date.now() });
      removeFrame();
      // A refund confirmed here (a refunded account paying again, whose old record answered first) puts the buyer back
      // on the checkout rather than at a dead end.
      void confirmHere(txn, true).then((ending) => { if (ending.mayBuy) readyToBuy(ending.words); });
      break;
    }
    case 'pdfiq-checkout-closed':
      clearTimeout(opening);
      removeFrame();
      if (document.body.dataset.pdfiqBuyState !== 'done') show('ready');
      break;
  }
});

/** Confirm on this page, in words, then say what the buyer can do next. Returns the ending, so the caller knows
 * whether the checkout may still be offered. */
async function confirmHere(txn: string, justPaid = false): Promise<ConfirmEnding> {
  show('confirming');
  const line = $('[data-buy-confirm]')!;
  const next = $('[data-buy-confirm-next]')!;
  next.hidden = true;
  const outcome = await confirmPurchase(txn, (text) => { line.textContent = text; }, { justPaid });
  const ending = afterConfirm(outcome, txn);
  line.textContent = ending.words;
  if (outcome.kind === 'owned') {
    show('owned');
    await returnFromUnlock();
    return ending;
  }
  if (ending.accountNote) {
    next.replaceChildren('Your ', Object.assign(document.createElement('a'), { href: '/account/', textContent: 'account page' }), ' checks again whenever it is opened.');
    next.hidden = false;
  }
  return ending;
}

/** The checkout, offered. `note` is shown above it when there is a reason the buyer is here (a refund, say). */
function readyToBuy(note: string): void {
  const session = signedIn();
  if (session) $('[data-buy-email]')!.textContent = session.email;
  const pay$ = $<HTMLButtonElement>('[data-buy-pay]')!;
  if (!pay$.dataset.wired) {
    pay$.dataset.wired = 'yes';
    pay$.addEventListener('click', () => pay());
    $<HTMLButtonElement>('[data-buy-retry]')?.addEventListener('click', () => pay());
  }
  const noteEl = $('[data-buy-note]')!;
  noteEl.textContent = note;
  noteEl.hidden = !note;
  show('ready');
}

async function start(): Promise<void> {
  if (!__PDFIQ_SALE__) {
    show('out');
    return;
  }
  $<HTMLButtonElement>('[data-buy-signin]')!.addEventListener('click', signIn);
  $<HTMLButtonElement>('[data-buy-signin-retry]')!.addEventListener('click', signIn);

  // Back from Google's sign-in, which returns here (src/pro/auth.ts): finish it on this page.
  let session = signedIn();
  let backFromGoogle = false;
  if (/(^#|&)(id_token|error)=/.test(location.hash)) {
    show('working');
    try {
      const completed = await completeSignIn(location.hash);
      if (completed) {
        session = completed;
        backFromGoogle = true;
        settleAccountControl();
      }
    } catch (e) {
      await readUnlock(true);
      offerWayBack();
      signInFailed(e);
      return;
    }
  }
  await readUnlock(backFromGoogle);
  offerWayBack();

  if (!session) {
    show('out');
    // Unlock was the decision to buy, and buying needs an account: go straight to Google, once.
    if (unlock && firstArrival()) {
      $('[data-buy-out-note]')!.textContent = 'Taking you to Google to sign in. You come straight back here.';
      $('[data-buy-out-note]')!.hidden = false;
      signIn();
    }
    return;
  }

  // Just signed in: this browser has no word yet on whether the account owns Pro (bought on another
  // browser). Ask before offering to sell it again.
  let owned = proAccount() !== null;
  // Whether this page may open the checkout by itself. Not after a sign-in whose ownership check got no clear
  // answer (offline, a server error): the account might already own Pro, and an automatic checkout would invite
  // paying twice. Pay stays on the page, with the reason.
  let mayOpen = true;
  if (backFromGoogle && !owned) {
    show('working');
    const checked = await refreshEntitlement(session.idToken, session.uid);
    owned = checked.state === 'owned';
    if (checked.state === 'offline' || checked.state === 'unavailable') {
      mayOpen = false;
      const note = $('[data-buy-note]')!;
      note.textContent = checked.state === 'offline'
        ? 'You are offline, so whether this account already owns Pro could not be checked. If you bought it before, open your account page with a connection instead of paying again.'
        : 'Whether this account already owns Pro could not be checked just now. If you bought it before, open your account page later instead of paying again.';
      note.hidden = false;
    }
  }

  // Already owned on this browser: nothing to buy, and nothing should suggest otherwise.
  if (owned) {
    show('owned');
    await returnFromUnlock();
    return;
  }
  // Paid on this browser but not confirmed yet (the tab was closed, say): confirm, never offer a second checkout —
  // unless the answer is that the purchase was refunded, which leaves the account owning nothing and free to buy.
  const pending = readPendingPurchase(session.uid);
  if (pending) {
    // A note written minutes ago is a payment we are still waiting on; an old one is a purchase whose fate is known.
    const fresh = Date.now() - pending.at < 5 * 60_000;
    const ending = await confirmHere(pending.txn === 'not given' ? '' : pending.txn, fresh);
    if (!ending.mayBuy) return;
    readyToBuy(ending.words);
    return;
  }
  readyToBuy('');
  if (unlock) {
    // Unlock was the decision to buy: open the checkout now rather than asking for a second press. Not on a
    // reload, so closing the checkout and reloading does not throw it open again. Arriving back from Google counts
    // as a first arrival: that journey started with Unlock too.
    if (firstArrival() && mayOpen) pay(backFromGoogle ? `Signed in as ${session.email}. ` : '');
  }
}

void start();
