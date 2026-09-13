/**
 * Waiting for our server to learn about a payment Paddle has already taken, and saying so the whole time.
 *
 * Used by /pro/buy/ straight after paying, and by /account/ when a pending purchase is on this browser. Both
 * pages may renew a sign-in (their policies allow Google's token host); tool pages never call this.
 *
 * Paddle's webhook can land seconds after its checkout says "paid", so this asks every two seconds for up to
 * ninety, and reports each attempt in words with the elapsed time, never a bare spinner.
 */
import { freshSession } from './auth.js';
import { refreshEntitlement, type RefreshResult } from './entitlement.js';
import { clearPendingPurchase } from './pending.js';

export const CONFIRM_SENTINEL = 'pdfiq-pro:confirm';

export type ConfirmOutcome =
  | { kind: 'owned' }
  | { kind: 'revoked' }
  | { kind: 'signed-out' }
  | { kind: 'offline' }
  | { kind: 'slow' };

const LIMIT_MS = 90_000;
const EVERY_MS = 2_000;

export function paidWords(txn: string): string {
  return `Paddle has taken your payment${txn ? ` (reference ${txn})` : ''}.`;
}

export async function confirmPurchase(txn: string, say: (text: string) => void): Promise<ConfirmOutcome> {
  const started = Date.now();
  for (;;) {
    const seconds = Math.round((Date.now() - started) / 1000);
    say(`${paidWords(txn)} Confirming it with Paddle, which usually takes a few seconds… ${seconds}s`);
    let result: RefreshResult;
    try {
      const session = await freshSession();
      if (!session) return { kind: 'signed-out' };
      result = await refreshEntitlement(session.idToken, session.uid);
    } catch {
      result = { state: 'unavailable', detail: 'sign-in could not be renewed' };
    }
    if (result.state === 'owned') {
      clearPendingPurchase();
      return { kind: 'owned' };
    }
    if (result.state === 'revoked') {
      clearPendingPurchase();
      return { kind: 'revoked' };
    }
    if (result.state === 'offline') return { kind: 'offline' };
    if (Date.now() - started > LIMIT_MS) return { kind: 'slow' };
    await new Promise((r) => setTimeout(r, EVERY_MS));
  }
}

/** What each ending says, on either page. */
export function confirmEndWords(outcome: ConfirmOutcome, txn: string): string {
  switch (outcome.kind) {
    case 'owned': return 'Pro is yours, and this browser now knows it.';
    case 'revoked': return 'This purchase was refunded, so Pro is not on this browser.';
    case 'signed-out': return `${paidWords(txn)} Sign in again on your account page to finish; there is no need to pay again.`;
    case 'offline': return `${paidWords(txn)} You are offline, so it could not be confirmed. Open this page again once you are connected; nothing is lost, and there is no need to pay again.`;
    case 'slow': return `${paidWords(txn)} Its confirmation has not reached us yet. Nothing is lost and there is no need to pay again: every Pro page says so until it arrives, and support@pdf-iq.com can match the reference.`;
  }
}
