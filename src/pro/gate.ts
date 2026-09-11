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

/** The sign-in kept in this browser, or null. Never makes a request. */
export function signedIn(): Session | null {
  try {
    return readSession();
  } catch {
    // Storage refused (private browsing, blocked site data): nobody can be signed in here.
    return null;
  }
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
