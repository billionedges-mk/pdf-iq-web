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
import { localStub, setLocalStub } from './gate.js';
import { refreshEntitlement, clearEntitlement, type RefreshResult } from './entitlement.js';
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
  el('[data-account-email]').textContent = email || 'your Google account';
  // The way to /pro/buy/, which otherwise nothing links to. Built here rather than hidden in the
  // page, so a build that is not selling carries no trace of it: __PDFIQ_SALE__ is false there and
  // the branch is dropped.
  if (__PDFIQ_SALE__ && !document.querySelector('[data-account-buy]')) {
    const p = document.createElement('p');
    p.dataset.accountBuy = '';
    p.style.margin = '16px 0 0';
    const a = document.createElement('a');
    a.className = 'btn';
    a.href = '/pro/buy/';
    a.textContent = 'Buy Pro';
    p.append(a);
    if (__PDFIQ_PADDLE_ENV__ === 'sandbox') p.append(' Paddle sandbox: test payments only, no real card is charged.');
    el('[data-signout]').closest('p')!.before(p);
  }
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
 * Sale builds: what the account page learned about Pro on this visit. Written for what the person can do:
 * an offline or failed check changes nothing already on this browser, and says so.
 */
function proState(result: RefreshResult): void {
  const host = el('[data-signout]').closest('p')!;
  for (const old of Array.from(document.querySelectorAll('[data-account-pro]'))) old.remove();
  const p = document.createElement('p');
  p.dataset.accountPro = '';
  p.style.cssText = 'margin: 16px 0 0; font-size: 15.5px; line-height: 1.6;';
  const words: Record<RefreshResult['state'], string> = {
    owned: 'Pro is yours, and this browser now knows it. A Pro feature in a page that is already open keeps working with no connection; opening a page still needs one.',
    'not-owned': 'This account does not own Pro.',
    revoked: 'This account’s Pro purchase was refunded, so Pro has been taken off this browser.',
    offline: 'You are offline, so Pro could not be checked. Nothing on this browser changed.',
    unavailable: 'Pro could not be checked just now. Nothing on this browser changed; opening this page again later will try again.',
  };
  p.textContent = words[result.state];
  host.before(p);
  if (result.state === 'owned') {
    // Where Pro is, so owning it is a click away rather than a search.
    const where = document.createElement('p');
    where.dataset.accountPro = '';
    where.style.cssText = 'margin: 8px 0 0; font-size: 15.5px; line-height: 1.6;';
    where.append('Try it: ');
    const links: [string, string][] = [['/batch/', 'Batch'], ['/password/', 'Password'], ['/compress/', 'Compress to a size'], ['/ocr/', 'Searchable PDF']];
    links.forEach(([href, text], i) => {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = text;
      where.append(a, i < links.length - 1 ? ' · ' : '');
    });
    host.before(where);
  }
  // Owning Pro, the Buy link has nothing left to offer.
  if (result.state === 'owned') document.querySelector('[data-account-buy]')?.remove();
}

/** A purchase just made, or one pending on this browser: confirm it here, saying so as it goes. */
async function confirmPurchase(reference: string): Promise<void> {
  const txn = /^txn_[a-z0-9]{26}$/.test(reference) ? reference : '';
  const host = el('[data-signout]').closest('p')!;
  const status = document.createElement('p');
  status.dataset.accountPro = '';
  status.setAttribute('role', 'status');
  status.style.cssText = 'margin: 16px 0 0; font-size: 15.5px; line-height: 1.6;';
  host.before(status);
  const outcome = await waitForConfirmation(txn, (text) => { status.textContent = text; });
  if (outcome.kind === 'owned') {
    status.remove();
    return proState({ state: 'owned' });
  }
  if (outcome.kind === 'revoked') {
    status.remove();
    return proState({ state: 'revoked' });
  }
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
    // Signing out of this browser takes Pro off it too: the token belongs to the account that signed out.
    if (__PDFIQ_SALE__) {
      clearEntitlement();
      clearPendingPurchase();
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
      if (purchased || pending) return confirmPurchase(pending?.txn ?? purchased ?? '');
      proState(await refreshEntitlement(session.idToken, session.uid));
    }
  } catch (e) {
    failed(e);
  }
}

void mount();
