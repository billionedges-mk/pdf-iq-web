/**
 * Paddle, server side: proving a notification came from Paddle, deciding what it means for Pro,
 * and recording that.
 *
 * Plain ESM with WebCrypto and no imports, so the Pages Function and `tools/verify-paddle.mjs` run
 * the same code: Workers and Node both provide `crypto.subtle`.
 *
 * Everything Paddle-shaped here is from Paddle's developer docs (read 13 September 2026), not
 * from memory:
 *   - Signature: header `Paddle-Signature: ts=<unix>;h1=<hex>`, HMAC-SHA256 of `ts + ":" + rawBody`
 *     with the destination's secret key, compared in constant time, with a five-second tolerance
 *     on `ts` — the tolerance Paddle's own SDKs apply.
 *   - `transaction.completed`: "Transactions move to completed after they're paid."
 *   - Adjustments: refunds start `pending_approval` and move to `approved` or `rejected`
 *     (`adjustment.updated`); chargebacks and chargeback reversals are created by Paddle.
 */

export const PADDLE_SENTINEL = 'pdfiq-server:paddle';

/** Paddle's SDKs reject a signature whose timestamp is more than five seconds from now. */
export const SIGNATURE_TOLERANCE_SECONDS = 5;

const enc = new TextEncoder();

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time for equal lengths; a length mismatch is already a refusal. */
function sameString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Parse `ts=…;h1=…`. More than one h1 is accepted, because a header can carry a signature per
 * secret while a key is being replaced; any one matching is enough.
 */
export function parseSignatureHeader(header) {
  if (typeof header !== 'string' || !header) return null;
  let ts = null;
  const h1 = [];
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === 'ts') ts = value;
    else if (key === 'h1') h1.push(value.toLowerCase());
  }
  if (!ts || !/^\d+$/.test(ts) || h1.length === 0) return null;
  return { ts: Number(ts), tsText: ts, h1 };
}

/**
 * Whether `rawBody` was signed by Paddle with `secret`. The body must be the exact bytes received:
 * re-serialising parsed JSON changes whitespace and breaks the signature, which Paddle names as
 * the most common failure.
 *
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export async function verifyPaddleSignature(rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret) return { ok: false, reason: 'no-secret-configured' };
  const parsed = parseSignatureHeader(header);
  if (!parsed) return { ok: false, reason: 'malformed-signature-header' };
  if (Math.abs(nowSeconds - parsed.ts) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'timestamp-outside-tolerance' };
  }
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${parsed.tsText}:${rawBody}`)));
  return parsed.h1.some((candidate) => sameString(candidate, mac))
    ? { ok: true }
    : { ok: false, reason: 'signature-mismatch' };
}

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * What one notification means for Pro. Pure: no storage, no clock.
 *
 * @returns {{ action: 'grant' | 'revoke' | 'ignore', transactionId?: string, uid?: string|null,
 *   email?: string|null, occurredAt?: string, reason: string }}
 */
export function decide(event, priceId) {
  const type = event?.event_type;
  const data = event?.data ?? {};
  const occurredAt = str(event?.occurred_at);
  if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) return { action: 'ignore', reason: 'no-occurred-at' };

  if (type === 'transaction.completed') {
    const transactionId = str(data.id);
    if (!transactionId) return { action: 'ignore', reason: 'no-transaction-id' };
    const items = Array.isArray(data.items) ? data.items : [];
    // Only our Pro price grants Pro. Anything else sold through the same account is not ours to
    // interpret, and a missing price id is not a match.
    if (!priceId || !items.some((item) => str(item?.price?.id) === priceId)) {
      return { action: 'ignore', reason: 'not-the-pro-price' };
    }
    const custom = data.custom_data && typeof data.custom_data === 'object' ? data.custom_data : {};
    return {
      action: 'grant', transactionId, occurredAt,
      uid: str(custom.uid),
      email: str(custom.email)?.toLowerCase() ?? null,
      reason: 'transaction-completed',
    };
  }

  if (type === 'adjustment.created' || type === 'adjustment.updated') {
    const transactionId = str(data.transaction_id);
    if (!transactionId) return { action: 'ignore', reason: 'no-transaction-id' };
    const { action, status } = data;
    const ignore = (reason) => ({ action: 'ignore', transactionId, reason });

    if (action === 'refund') {
      if (status !== 'approved') return ignore(`refund-${status ?? 'unknown'}`);
      // A partial refund returns some money and leaves the purchase standing; only a full refund
      // takes Pro away. /refunds offers the whole amount back, so a full refund is the normal case.
      if (data.type !== 'full') return ignore('partial-refund');
      return { action: 'revoke', transactionId, occurredAt, reason: 'refund-approved' };
    }
    if (action === 'chargeback') {
      if (status === 'rejected' || status === 'reversed') return ignore(`chargeback-${status}`);
      return { action: 'revoke', transactionId, occurredAt, reason: 'chargeback' };
    }
    if (action === 'chargeback_reverse') {
      if (status === 'rejected') return ignore('chargeback-reverse-rejected');
      return { action: 'grant', transactionId, occurredAt, uid: null, email: null, reason: 'chargeback-reversed' };
    }
    return ignore(`adjustment-${action ?? 'unknown'}`);
  }

  return { action: 'ignore', reason: `event-${type ?? 'unknown'}` };
}

/**
 * Record a decision. Idempotent, and safe against out-of-order delivery:
 *   - the same event id twice changes nothing;
 *   - an event older than the one that last set the status does not change the status;
 *   - a purchase's uid and email are filled in whenever they arrive, whatever the order, because
 *     knowing whose purchase it is never goes stale.
 *
 * @returns {Promise<{ applied: boolean, reason: string }>}
 */
export async function applyDecision(db, decision, eventId) {
  if (decision.action === 'ignore') return { applied: false, reason: decision.reason };
  const status = decision.action === 'grant' ? 'granted' : 'revoked';
  const row = await db.prepare('SELECT * FROM purchases WHERE transaction_id = ?').bind(decision.transactionId).first();

  if (!row) {
    await db.prepare(
      'INSERT INTO purchases (transaction_id, uid, email, status, changed_at, last_event_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(decision.transactionId, decision.uid ?? null, decision.email ?? null, status, decision.occurredAt, eventId).run();
    return { applied: true, reason: `${status}-new` };
  }

  if (row.last_event_id === eventId) return { applied: false, reason: 'duplicate-event' };

  const newer = Date.parse(decision.occurredAt) >= Date.parse(row.changed_at);
  const uid = row.uid ?? decision.uid ?? null;
  const email = row.email ?? decision.email ?? null;

  if (newer) {
    await db.prepare(
      'UPDATE purchases SET uid = ?, email = ?, status = ?, changed_at = ?, last_event_id = ? WHERE transaction_id = ?'
    ).bind(uid, email, status, decision.occurredAt, eventId, decision.transactionId).run();
    return { applied: true, reason: `${status}` };
  }
  if (uid !== row.uid || email !== row.email) {
    await db.prepare('UPDATE purchases SET uid = ?, email = ? WHERE transaction_id = ?')
      .bind(uid, email, decision.transactionId).run();
    return { applied: true, reason: 'bound-older-event' };
  }
  return { applied: false, reason: 'older-than-current-status' };
}
