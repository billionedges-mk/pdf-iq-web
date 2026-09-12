/**
 * Who may use a Pro feature in a preview build: anyone signed in on this browser.
 *
 * Read from the sign-in kept in this browser, with no request. There is no purchase check:
 * nothing is for sale, and the check that "this person paid" comes with Paddle — where it must
 * keep working offline after its first validation, so that someone who paid and has no signal is
 * not locked out. Requiring sign-in now, rather than switching Pro on for everyone, exercises
 * the path a buyer will actually take.
 *
 * A tool page never renews a sign-in. That happens on /account/ only, so tool pages never talk
 * to Google and keep their content security policy — which is what /privacy says.
 */
import { readSession, type Session } from './session.js';

export const GATE_SENTINEL = 'pdfiq-pro:gate';

/**
 * The local stub, and the reason it exists.
 *
 * A build served from a developer machine has no Firebase key, so signing in is impossible there —
 * and with Pro gated on sign-in, that makes every Pro feature unreachable in the only build a
 * person can run locally. The stub is a flag in this browser that stands in for a session. It is
 * not a sign-in: no account exists, nothing is sent, and it grants nothing a real session would
 * not, because there is no purchase check on either path yet.
 *
 * In any deployed build `__PDFIQ_LOCAL__` is false, esbuild drops everything below, and the key
 * itself appears nowhere in the bundle. A Cloudflare build that asks for the flag refuses by name.
 * tools/verify-pro-gate.mjs proves both.
 */
// Not exported. An exported binding survives as a chunk export under code splitting, which put
// this key into a deployed-shaped Pro build the first time it was written — caught by the gate.
const LOCAL_STUB_KEY = 'pdfiq.local-pro';

const LOCAL_STUB: Session = {
  uid: 'local-stub',
  email: 'local stub — not a sign-in',
  idToken: '',
  idTokenExpiresAt: 0,
  refreshToken: '',
};

export function localStub(): boolean {
  if (!__PDFIQ_LOCAL__) return false;
  try {
    return localStorage.getItem(LOCAL_STUB_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setLocalStub(on: boolean): void {
  if (!__PDFIQ_LOCAL__) return;
  try {
    if (on) localStorage.setItem(LOCAL_STUB_KEY, 'on');
    else localStorage.removeItem(LOCAL_STUB_KEY);
  } catch {
    // Storage refused; the stub stays off, which is the safe direction.
  }
}

/** The sign-in kept in this browser, or null. Never makes a request. */
export function signedIn(): Session | null {
  try {
    const session = readSession();
    if (session) return session;
  } catch {
    // Storage refused (private browsing, blocked site data): nobody can be signed in here.
  }
  // The constant, not the call: `localStub()` is a function call the bundler cannot fold, so
  // referencing LOCAL_STUB through it kept the stub session — and its words — in builds that must
  // not have them. With the constant first the whole branch is dropped.
  if (__PDFIQ_LOCAL__ && localStub()) return LOCAL_STUB;
  return null;
}

/**
 * What a Pro control shows instead of acting when nobody is signed in. Says what the feature
 * is, that it needs an account, and that nothing free does.
 */
export function signInPrompt(feature: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'hint';
  p.dataset.pdfiqGate = GATE_SENTINEL;
  p.append(`${feature} is part of Pro, which needs an account. `);
  const a = document.createElement('a');
  a.href = '/account/';
  a.textContent = 'Sign in';
  p.append(a, ' — nothing free on this site needs one.');
  return p;
}
