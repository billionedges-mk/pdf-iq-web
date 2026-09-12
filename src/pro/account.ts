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
import { localStub, setLocalStub } from './gate.js';

export const ACCOUNT_SENTINEL = 'pdfiq-pro:account';

const WORDS: Record<AuthErrorKind, { title: string; body: string; again: boolean }> = {
  cancelled: {
    title: 'You came back without signing in.',
    body: 'Nothing was kept. Nothing on this site needs an account except Pro, so there is no need to try again unless you want to.',
    again: true,
  },
  forged: {
    title: 'That sign-in did not start on this page, so it was ignored.',
    body: 'Google sent back an answer that does not match a sign-in this browser began — from another tab, perhaps, or an old link. Nothing was kept. Starting again from here fixes it.',
    again: true,
  },
  offline: {
    title: 'You are offline.',
    body: 'Signing in needs a connection to Google. The tools do not: they keep working without one.',
    again: true,
  },
  'not-configured': {
    title: 'Signing in is not set up correctly on our side.',
    body: 'Nothing you can do here will fix it, and nothing on your device is wrong. The tools work as normal without an account.',
    again: false,
  },
  'app-check': {
    title: 'Signing in from the website is switched off on our side.',
    body: 'Nothing on your device is wrong, and signing in again will not help. The tools work as normal without an account; anything in Pro that needs one will not work until this is back.',
    again: false,
  },
  ended: {
    title: 'The sign-in kept in this browser has ended.',
    body: 'Google no longer accepts it. Signing in again fixes that.',
    again: true,
  },
  disabled: {
    title: 'This account has been switched off.',
    body: 'Signing in again will not change that. Write to support@pdf-iq.com if you think it is a mistake.',
    again: false,
  },
  storage: {
    title: 'This browser is not letting the site keep anything, so a sign-in cannot be remembered.',
    body: 'Private browsing does this, and so does blocking site data. In a normal window it works; the tools work either way.',
    again: false,
  },
  unknown: {
    title: 'Signing in did not work, and we could not tell why.',
    body: 'The line below is what came back. Trying again may work; if it does not, that line is what to send to support@pdf-iq.com.',
    again: true,
  },
};

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
    + 'would not — there is no purchase check on either path yet. It exists in no deployed build.';

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

async function mount(): Promise<void> {
  // Marks the page and keeps each Pro module's sentinel in the bundle, where the build's own
  // check looks for it.
  document.documentElement.dataset.pdfiqAccount = [ACCOUNT_SENTINEL, AUTH_SENTINEL, SESSION_SENTINEL].join(' ');
  if (__PDFIQ_LOCAL__) localStubCard();
  el('[data-signin]').addEventListener('click', go);
  el('[data-account-retry]').addEventListener('click', go);
  el('[data-signout]').addEventListener('click', () => {
    signOut();
    show('out');
  });

  show('working');
  try {
    const completed = await completeSignIn(location.hash);
    if (completed) return signedIn(completed.email);
    const session = await freshSession();
    if (session) return signedIn(session.email);
    show('out');
  } catch (e) {
    failed(e);
  }
}

void mount();
