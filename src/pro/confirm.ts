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

/**
 * What each ending says, and what the page may do next.
 *
 * `mayBuy` is the half that was missing. A refunded purchase is the one ending where the account does **not** own Pro
 * and nothing is in flight: the same position as someone who never bought. /pro/buy/ used to report the refund and stop,
 * so a buyer who refunded by mistake, or changed their mind, was told Pro was not theirs and given nothing to do about
 * it (owner, 18 September 2026). Every other ending either owns Pro or has a payment we are still waiting on, and
 * offering a second checkout there would invite paying twice.
 */
export interface ConfirmEnding {
  /** What the page says. */
  words: string;
  /** The account does not own Pro and nothing is pending: the checkout may be offered. */
  mayBuy: boolean;
  /** Point at /account/, which checks again whenever it is opened. */
  accountNote: boolean;
}

export function afterConfirm(outcome: ConfirmOutcome, txn: string): ConfirmEnding {
  switch (outcome.kind) {
    case 'owned':
      return { words: 'Pro is yours, and this browser now knows it.', mayBuy: false, accountNote: false };
    case 'revoked':
      return {
        words: 'That purchase was refunded, so this account does not have Pro. You can buy it again here, at the same '
          + 'price and on the same terms.',
        mayBuy: true,
        accountNote: false,
      };
    case 'signed-out':
      return { words: `${paidWords(txn)} Sign in again on your account page to finish; there is no need to pay again.`, mayBuy: false, accountNote: true };
    case 'offline':
      return { words: `${paidWords(txn)} You are offline, so it could not be confirmed. Open this page again once you are connected; nothing is lost, and there is no need to pay again.`, mayBuy: false, accountNote: false };
    case 'slow':
      return { words: `${paidWords(txn)} Its confirmation has not reached us yet. Nothing is lost and there is no need to pay again: every Pro page says so until it arrives, and support@pdf-iq.com can match the reference.`, mayBuy: false, accountNote: true };
  }
}

/** What each ending says, on either page. */
export function confirmEndWords(outcome: ConfirmOutcome, txn: string): string {
  return afterConfirm(outcome, txn).words;
}
