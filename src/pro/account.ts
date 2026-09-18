/**
 * /account/ — present only in a Pro-flag build.
 *
 * The words for each failure are chosen for one test: are they true about what the person can
 * do? "Sign in again" appears only where signing in again fixes it. Where nothing the person
 * does can help — sign-in not set up, App Check enforced on our side, an account switched off —
 * the page says so plainly and offers no button, because a button that cannot work is advice
 * that cannot work.
 */
import { startSignIn, completeSignIn, freshSession, signOut, AuthError, AUTH_SENTINEL, type AuthErrorKind } from './auth.js';
import { SESSION_SENTINEL } from './session.js';
import { WORDS } from './auth-words.js';
import { settleSellingMarks, settleAccountControl } from './strip.js';
import { localStub, setLocalStub } from './gate.js';
import { refreshEntitlement, clearEntitlement, storedPaymentReference, type RefreshResult } from './entitlement.js';
import { readPendingPurchase, clearPendingPurchase } from './pending.js';
import { confirmPurchase as waitForConfirmation, confirmEndWords } from './confirm.js';

export const ACCOUNT_SENTINEL = 'pdfiq-pro:account';

type View = 'working' | 'out' | 'in' | 'error';

function el<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`the account page is missing ${selector}`);
  return found;
}

function show(view: View): void {
  for (const section of document.querySelectorAll<HTMLElement>('[data-account]')) {
    section.hidden = section.dataset.account !== view;
  }
}

function signedIn(email: string): void {
  settleAccountControl();
  el('[data-account-email]').textContent = email || 'your Google account';
  show('in');
}

function failed(e: unknown): void {
  const kind: AuthErrorKind = e instanceof AuthError ? e.kind : 'unknown';
  const code = e instanceof AuthError ? e.code : e instanceof Error ? e.message : String(e);
  const words = WORDS[kind];
  el('[data-account-error-title]').textContent = words.title;
  el('[data-account-error-body]').textContent = words.body;
  el('[data-account-error-code]').textContent = `${kind} · ${code}`;
  el<HTMLButtonElement>('[data-account-retry]').hidden = !words.again;
  show('error');
}

function go(): void {
  try {
    startSignIn();
  } catch (e) {
    failed(e);
  }
}

/**
 * Local builds only: a switch for the Pro gate, offered because signing in here is impossible —
 * the key is not in this build. Written in JavaScript rather than in account.html because the page
 * markers are PRO/FREE only, and this must vanish from a deployed preview as well as production.
 * `__PDFIQ_LOCAL__` is false there, so esbuild drops this function and everything it says.
 */
function localStubCard(): void {
  const host = document.querySelector('[data-account="out"]')?.parentElement;
  if (!host) return;

  const card = document.createElement('section');
  card.className = 'card';
  card.style.cssText = 'margin-top: 22px; max-width: 700px;';

  const kicker = document.createElement('p');
  kicker.className = 'kicker';
  kicker.textContent = 'This build is served from your own machine';

  const body = document.createElement('p');
  body.style.cssText = 'margin: 10px 0 0; font-size: 15.5px; line-height: 1.6;';
  body.textContent =
    'Signing in with Google needs a key a local build does not carry, so no Pro feature could be '
    + 'reached here at all. This switches the Pro gate on in this browser instead. It is not a '
    + 'sign-in: no account exists, nothing is sent anywhere, and it grants nothing a real sign-in '
    + (__PDFIQ_SALE__ ? 'would not, except that in this build it also stands in for owning Pro. ' : 'would not. ') + 'It exists in no deployed build.';

  const button = document.createElement('button');
  button.type = 'button';
  const state = document.createElement('p');
  state.className = 'hint';

  const paint = (): void => {
    const on = localStub();
    button.className = on ? 'btn-quiet' : 'btn';
    button.textContent = on ? 'Turn the local stub off' : 'Turn the local stub on';
    state.textContent = on
      ? 'On. Pro features in this browser act as though someone is signed in.'
      : 'Off. Pro features show their sign-in prompt.';
  };
  button.addEventListener('click', () => {
    setLocalStub(!localStub());
    paint();
  });
  paint();

  const row = document.createElement('p');
  row.style.marginTop = '18px';
  row.append(button);
  card.append(kicker, body, row, state);
  host.append(card);
}

/**
 * Sale builds: the Pro card above the account row (owner's layout, pdf-iq-final.html 04). Its words are only what the page
 * can know (approved 17 September 2026):
 *
 *  - owning Pro, from the server on this visit, or from the signed token already in this browser when the server could
 *    not be asked, and it says which;
 *  - Paddle's payment reference, from that token: the one thing support can act on;
 *  - that Pro here does not unlock anything in the Android app (BILLING_ENABLED is not split).
 *
 * Not said, because the page cannot know them: a purchase date (the server keeps when the record last changed, which a
 * refund or a re-link also moves), whether the app knows, and any Summaries count (an app feature; the web has none).
 */
async function proState(result: RefreshResult, uid: string): Promise<void> {
  const host = el('[data-account-pro-host]');
  host.replaceChildren();
  const forgets = el('[data-account-forgets]');
  forgets.hidden = true;

  // The server could not be asked, but this browser may already hold Pro: say what it knows, and that it was not checked.
  let owned = result.state === 'owned';
  let unchecked = '';
  if (result.state === 'offline' || result.state === 'unavailable') {
    const reference = await storedPaymentReference(uid);
    if (reference) {
      owned = true;
      unchecked = result.state === 'offline'
        ? 'You are offline, so this is what this browser already knew. It is checked again the next time this page opens with a connection.'
        : 'Pro could not be checked just now, so this is what this browser already knew. Opening this page again later checks again.';
    }
  }

  if (owned) {
    host.append(ownedCard(await storedPaymentReference(uid), unchecked));
    forgets.hidden = false;
    // Owning Pro, nothing on the site sells to this browser any more, the nav's Pro labels included.
    settleSellingMarks(true);
    return;
  }

  const words: Record<Exclude<RefreshResult['state'], 'owned'>, string> = {
    'not-owned': 'This account does not own Pro.',
    revoked: 'That purchase was refunded, so this account does not have Pro, and it has been taken off this browser. '
      + 'You can buy it again below.',
    offline: 'You are offline, so Pro could not be checked. Nothing on this browser changed.',
    unavailable: 'Pro could not be checked just now. Nothing on this browser changed; opening this page again later will try again.',
  };
  const card = document.createElement('section');
  card.className = 'acct-row';
  const p = document.createElement('p');
  p.className = 'acct-row__body';
  p.textContent = words[result.state as Exclude<RefreshResult['state'], 'owned'>];
  card.append(p, buyLine());
  host.append(card);
}

function ownedCard(reference: string | null, unchecked: string): HTMLElement {
  const card = document.createElement('section');
  card.className = 'acct-owned';
  const head = document.createElement('div');
  head.className = 'acct-owned__head';
  const title = document.createElement('h2');
  title.className = 'acct-owned__title';
  title.textContent = 'Pro is yours';
  const tag = document.createElement('span');
  tag.className = 'pro-tag';
  tag.textContent = 'ACTIVE';
  head.append(title, tag);

  const body = document.createElement('p');
  body.className = 'acct-owned__body';
  body.textContent = 'This browser knows it, so a Pro feature in a page that is already open keeps working with no connection; '
    + 'opening a page still needs one. Pro on this website does not unlock anything in the Android app.';
  card.append(head, body);
  if (unchecked) {
    const note = document.createElement('p');
    note.className = 'acct-owned__body';
    note.textContent = unchecked;
    card.append(note);
  }

  // Where Pro is, so owning it is a click away rather than a search.
  const links = document.createElement('div');
  links.className = 'acct-owned__links';
  for (const [href, text] of [['/batch/', 'Batch'], ['/password/', 'Password'], ['/ocr/', 'Searchable PDFs'], ['/compress/', 'Compress to a size']]) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = `${text} →`;
    links.append(a);
  }
  card.append(links);

  if (reference) {
    const ref = document.createElement('p');
    ref.className = 'acct-owned__ref';
    const code = document.createElement('code');
    code.textContent = reference;
    ref.append('Payment reference ', code, ' — quote it if Pro is not working or you need to ask about this purchase.');
    card.append(ref);
  }
  return card;
}

/** The way to /pro/buy/ for an account without Pro. Nothing else on this page links there. */
function buyLine(): HTMLElement {
  const p = document.createElement('p');
  p.style.margin = '14px 0 0';
  const a = document.createElement('a');
  a.className = 'btn';
  a.href = '/pro/buy/';
  a.textContent = 'Buy Pro';
  p.append(a);
  if (__PDFIQ_PADDLE_ENV__ === 'sandbox') p.append(' Paddle sandbox: test payments only, no real card is charged.');
  return p;
}

/** A purchase just made, or one pending on this browser: confirm it here, saying so as it goes. */
async function confirmPurchase(reference: string, uid: string): Promise<void> {
  const txn = /^txn_[a-z0-9]{26}$/.test(reference) ? reference : '';
  const host = el('[data-account-pro-host]');
  const card = document.createElement('section');
  card.className = 'acct-row';
  const status = document.createElement('p');
  status.className = 'acct-row__body';
  status.setAttribute('role', 'status');
  card.append(status);
  host.replaceChildren(card);
  const outcome = await waitForConfirmation(txn, (text) => { status.textContent = text; });
  if (outcome.kind === 'owned') return proState({ state: 'owned' }, uid);
  if (outcome.kind === 'revoked') return proState({ state: 'revoked' }, uid);
  if (outcome.kind === 'signed-out') return show('out');
  status.textContent = confirmEndWords(outcome, txn);
}

async function mount(): Promise<void> {
  // Marks the page and keeps each Pro module's sentinel in the bundle, where the build's own
  // check looks for it.
  document.documentElement.dataset.pdfiqAccount = [ACCOUNT_SENTINEL, AUTH_SENTINEL, SESSION_SENTINEL].join(' ');
  if (__PDFIQ_LOCAL__) localStubCard();
  el('[data-signin]').addEventListener('click', go);
  el('[data-account-retry]').addEventListener('click', go);
  el('[data-signout]').addEventListener('click', () => {
    signOut();
    // The bar says signed out, and the Pro tags return: this browser no longer holds Pro.
    queueMicrotask(() => settleSellingMarks());
    // Signing out of this browser takes Pro off it too: the token belongs to the account that signed out.
    if (__PDFIQ_SALE__) {
      clearEntitlement();
      clearPendingPurchase();
      el('[data-account-pro-host]').replaceChildren();
      el('[data-account-forgets]').hidden = true;
    }
    show('out');
  });

  show('working');
  try {
    const completed = await completeSignIn(location.hash);
    const session = completed ?? (await freshSession());
    if (!session) return show('out');
    signedIn(session.email);
    if (__PDFIQ_SALE__) {
      const purchased = new URLSearchParams(location.search).get('purchased');
      if (purchased) history.replaceState(null, '', location.pathname);
      const pending = readPendingPurchase(session.uid);
      if (purchased || pending) return confirmPurchase(pending?.txn ?? purchased ?? '', session.uid);
      await proState(await refreshEntitlement(session.idToken, session.uid), session.uid);
    }
  } catch (e) {
    failed(e);
  }
}

void mount();
