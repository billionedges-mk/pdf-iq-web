/**
 * A purchase Paddle has reported but our server has not confirmed yet, remembered in this browser.
 *
 * Why it exists: Paddle's checkout says "paid" before its webhook reaches us. If the buyer closes the tab in
 * that gap, every Pro feature on their next visit would say "Buy Pro", and they could pay twice. With this note
 * written the moment Paddle reports success, every Pro page instead says the payment is being confirmed and
 * offers no second checkout.
 *
 * Temporary by design. It holds the transaction reference, the account it was bought for and when, nothing
 * else. It is removed when the purchase is confirmed or refunded, or when the buyer signs out. After 24 hours it
 * is ignored, and removed the next time a page reads it. /privacy lists it (sale builds).
 */
export const PENDING_SENTINEL = 'pdfiq-pro:pending';

export const PENDING_KEY = 'pdfiq.pending-purchase';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface PendingPurchase {
  txn: string;
  uid: string;
  at: number;
}

export function writePendingPurchase(p: PendingPurchase): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ txn: p.txn, uid: p.uid, at: p.at }));
  } catch {
    // Storage refused: the confirmation still runs on the page that is open; only a closed tab loses the note.
  }
}

/** The pending purchase for this account, if one is recorded and less than a day old. */
export function readPendingPurchase(uid: string | null | undefined): PendingPurchase | null {
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PendingPurchase>;
    const fresh = typeof p.at === 'number' && Date.now() - p.at < MAX_AGE_MS && p.at <= Date.now() + 60_000;
    if (!fresh || typeof p.txn !== 'string' || typeof p.uid !== 'string') {
      localStorage.removeItem(PENDING_KEY);
      return null;
    }
    return p.uid === uid ? (p as PendingPurchase) : null;
  } catch {
    return null;
  }
}

export function clearPendingPurchase(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing could have been stored.
  }
}
