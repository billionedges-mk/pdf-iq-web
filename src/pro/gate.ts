/**
 * Who may use a Pro feature.
 *
 *   - In a Pro build that is not selling: anyone signed in on this browser. Requiring sign-in, rather
 *     than switching Pro on for everyone, exercises the path a buyer will actually take.
 *   - In a sale build: someone signed in whose browser holds an entitlement token that verifies for their
 *     uid (src/pro/entitlement.ts). The token is checked once, here, before any feature code runs, with the
 *     public key in the build and no request, so it works offline indefinitely: someone who paid and has
 *     no signal is not locked out.
 *
 * A tool page never renews a sign-in. That happens on /account/ (and /pro/buy/, confirming a purchase), so tool pages never talk
 * to Google and keep their content security policy — which is what /privacy says.
 */
import { readSession, type Session } from './session.js';
import { storedEntitlementUid, ENTITLEMENT_SENTINEL } from './entitlement.js';
import { readPendingPurchase, PENDING_SENTINEL } from './pending.js';
// Not in GATE_CHECKS: that would keep the Unlock module, and its /pro/buy/ address, in a Pro build that is not
// selling (see proPrompt).
import { unlockButton } from './unlock.js';

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
 * The uid whose stored entitlement token verified when this module loaded. Checked before any module that
 * imports the gate runs (top-level await), so proAccount() can stay synchronous for its callers. Local
 * crypto on a token of a few hundred bytes: no request, and nothing a page has to wait for visibly.
 */
const entitledUid: string | null = __PDFIQ_SALE__ ? await storedEntitlementUid(signedIn()?.uid ?? null) : null;

/**
 * The account a Pro feature may act for, or null.
 *
 * Not selling: whoever is signed in. Selling: whoever is signed in AND holds a verified entitlement token for
 * that account on this browser. The local stub stands in for both, in a local build only.
 */
export function proAccount(): Session | null {
  const session = signedIn();
  if (!session) return null;
  if (!__PDFIQ_SALE__) return session;
  if (__PDFIQ_LOCAL__ && localStub()) return session;
  return entitledUid === session.uid ? session : null;
}

/** Keeps the entitlement module's sentinel in any bundle that carries the gate. */
export const GATE_CHECKS = [GATE_SENTINEL, ENTITLEMENT_SENTINEL, PENDING_SENTINEL] as const;

/** tools/pro-copy.mjs, per feature key: what it does, and the free thing that gets closest. */
const COPY = JSON.parse(__PDFIQ_PRO_COPY__) as Record<string, { what: string; instead: string } | undefined>;

export type ProKey = 'batch' | 'searchable' | 'target' | 'password';

export interface PromptOptions {
  /**
   * The page works on many files (Batch). The handoff store holds one file per key, so Unlock cannot carry them,
   * and the prompt says so before the button is pressed (owner's decision, 13 September 2026; TECH_DEBT records it).
   */
  manyFiles?: boolean;
  /** Leave out the "what it does" sentence, where the card around the panel already says it (OCR's intro card). */
  noWhat?: boolean;
  /** Leave out the free alternative (OCR's intro card: the approved copy has only the sentence and Unlock there). */
  noInstead?: boolean;
  /** The panel's heading, with the PRO tag beside it. Absent where the card around it already has one. */
  title?: string;
  /** The real controls, already locked (lockControls), shown inside the panel between the sentence and the action. */
  controls?: HTMLElement;
}

/**
 * The locked panel (redesign stage 2, pdf-iq-final.html 03): a gold card with the feature's heading and PRO tag, what it
 * does, the real controls disabled, one full-width action, and the free alternative. The words are the approved step 4
 * copy, from tools/pro-copy.mjs:
 *
 *   1. what it does (`what`);
 *   2. the real controls, locked, when the caller passes them;
 *   3. the action: Unlock with the line about the file (sale build), the payment being confirmed (pending, no button),
 *      or "Part of Pro, not on sale yet." (a Pro preview that is not selling);
 *   4. "Free instead:" and the free alternative (`instead`), written as a choice, not a consolation;
 *   5. "Bought it already?" (sale build, nothing pending).
 *
 * `feature` names it in the pending sentence and in the Unlock intent.
 */
export function lockedPanel(key: ProKey, feature: string, carry?: () => File | null, opts: PromptOptions = {}): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'lock';
  wrap.dataset.pdfiqGate = GATE_SENTINEL;
  wrap.dataset.pdfiqLocked = key;
  const copy = COPY[key];
  if (opts.title) {
    const head = document.createElement('div');
    head.className = 'lock__head';
    const h = document.createElement('p');
    h.className = 'lock__title';
    h.textContent = opts.title;
    head.append(h, proLabel());
    wrap.append(head);
  }
  if (copy && !opts.noWhat) wrap.append(para('lock__what', copy.what));
  if (opts.controls) {
    opts.controls.classList.add('lock__controls');
    wrap.append(opts.controls);
  }
  // The sale action is referenced only inside this constant branch. esbuild drops a false branch when it parses, so in
  // a build that is not selling nothing reaches saleAction, and it, the Unlock module and its /pro/buy/ address are left
  // out. Code after an early `return` is dropped only when printing, too late: the references already kept them
  // (tools/verify-sale-build.mjs caught exactly that).
  let pending = false;
  if (__PDFIQ_SALE__) {
    pending = saleAction(wrap, feature, carry, opts);
  } else {
    // A Pro preview that is not selling: nothing to buy. Testers sign in on the account page to use Pro here.
    const a = Object.assign(document.createElement('a'), { href: '/account/', textContent: 'Sign in' });
    const p = para('lock__state', 'Part of Pro, not on sale yet. ');
    p.append(a, ' to use it in this preview build.');
    wrap.append(p);
  }
  if (copy && !opts.noInstead) wrap.append(para('lock__alt', `Free instead: ${copy.instead}`));
  if (__PDFIQ_SALE__) {
    if (!pending) wrap.append(alreadyLine());
  }
  return wrap;
}

function para(className: string, text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

/** The sale build's action. Returns true when a payment is pending, which replaces the button. */
function saleAction(wrap: HTMLElement, feature: string, carry: (() => File | null) | undefined, opts: PromptOptions): boolean {
  const session = signedIn();
  // Paid, not yet confirmed: say so, and offer no second checkout.
  const pending = readPendingPurchase(session?.uid);
  if (pending) {
    const account = Object.assign(document.createElement('a'), { href: '/account/', textContent: 'your account page' });
    const p = para('lock__state', `${feature} is part of Pro, and your payment for it (reference ${pending.txn}) is being confirmed. Open `);
    p.append(account, ' to finish. There is no need to pay again.');
    wrap.append(p);
    return true;
  }
  // Unlock, from here: the checkout opens straight away, and paying brings the buyer back to this page with the file
  // they had open (src/pro/unlock.ts).
  const button = unlockButton(feature, carry);
  button.className = 'cta';
  const after = para('lock__after', opts.manyFiles
    ? 'These files do not come with you to the checkout: after paying, you come back here and choose them again.'
    : carry
      ? 'After paying you come back here with this file. Meanwhile it is kept on this device only, for up to ten minutes.'
      : 'After paying you come back here.');
  // Signed out, Unlock signs in with Google first (src/pro/buy.ts), and an account that already owns Pro is found there
  // before any checkout opens.
  if (!session) after.append(' Buying needs an account, so you sign in with Google first and come straight back.');
  wrap.append(button, after);
  return false;
}

function alreadyLine(): HTMLParagraphElement {
  const p = para('lock__already', '');
  if (signedIn()) {
    const account = Object.assign(document.createElement('a'), { href: '/account/', textContent: 'your account page' });
    p.append('Bought it already? Open ', account, ' once with a connection and this browser will know.');
  } else {
    // This website's purchases only: one made in the Android app is not visible here (BILLING_ENABLED is not split).
    p.append('Bought it already on this website? Unlock signs you in and checks before offering a checkout.');
  }
  return p;
}

/**
 * Show a real control locked: disabled, dimmed, still itself. Everything focusable inside is disabled, so it cannot
 * act; the handlers check the gate as well, because a disabled attribute is only a property of the page.
 */
export function lockControls(host: HTMLElement): void {
  host.classList.add('pro-locked');
  host.setAttribute('aria-disabled', 'true');
  for (const el of host.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select, textarea')) el.disabled = true;
}

/** The small "Pro" label beside a heading. Only for someone who does not own Pro: the caller checks. */
export function proLabel(): HTMLElement {
  const span = document.createElement('span');
  span.className = 'pro-label';
  span.textContent = 'PRO';
  return span;
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
