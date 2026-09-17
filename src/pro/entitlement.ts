/**
 * Owning Pro, as this browser knows it: a signed entitlement token, checked here with no request.
 *
 * The server (functions/api/entitlement.js, server/entitlement.js) signs a token for a Firebase uid
 * that owns Pro. This module is the other half:
 *
 *   - refreshEntitlement() asks /api/entitlement, from /account/ and /pro/buy/ only, and stores the token only if
 *     it verifies here first. A token that does not verify is never stored.
 *   - storedEntitlementUid() verifies the stored token against the signed-in uid and this build's Paddle
 *     environment, with the public key compiled into the build. No request: it works with no connection,
 *     indefinitely, because someone who paid must not be locked out by a missing signal.
 *
 * The token does not expire. A refund therefore reaches a browser the next time /account/ is opened with a
 * connection, where refreshEntitlement() is told `pro: false` and removes it. /refunds says so.
 *
 * Tool pages never call refreshEntitlement(): they send nothing, which is what /privacy says of them.
 */
import PUBLIC_KEYS from './entitlement-public-keys.json';
import { clearPendingPurchase } from './pending.js';

export const ENTITLEMENT_SENTINEL = 'pdfiq-pro:entitlement';

/** localStorage. Named in /privacy's list of what is stored in the browser (sale builds). */
export const ENTITLEMENT_KEY = 'pdfiq.entitlement';

const TOKEN_VERSION = 1;
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let keyPromise: Promise<CryptoKey | null> | null = null;
function publicKey(): Promise<CryptoKey | null> {
  if (!keyPromise) {
    const jwk = (PUBLIC_KEYS as Record<string, JsonWebKey | undefined>)[__PDFIQ_PADDLE_ENV__];
    keyPromise = jwk
      ? crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']).catch(() => null)
      : Promise.resolve(null);
  }
  return keyPromise;
}

/** True only for a token signed by this environment's key, for this uid, in this environment. */
export async function verifyToken(token: unknown, uid: string): Promise<boolean> {
  if (typeof token !== 'string' || !uid) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const key = await publicKey();
  if (!key) return false;
  try {
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64urlBytes(parts[1]), enc.encode(parts[0]));
    if (!valid) return false;
    const claims = JSON.parse(dec.decode(b64urlBytes(parts[0]))) as Record<string, unknown>;
    return claims.v === TOKEN_VERSION && claims.pro === true && claims.env === __PDFIQ_PADDLE_ENV__ && claims.uid === uid;
  } catch {
    return false;
  }
}

function read(): string | null {
  try {
    return localStorage.getItem(ENTITLEMENT_KEY);
  } catch {
    return null;
  }
}

export function clearEntitlement(): void {
  try {
    localStorage.removeItem(ENTITLEMENT_KEY);
  } catch {
    // Storage refused: nothing could have been stored.
  }
}

/** The uid the stored token proves owns Pro, if it matches the given signed-in uid. No request. */
export async function storedEntitlementUid(uid: string | null): Promise<string | null> {
  if (!uid) return null;
  return (await verifyToken(read(), uid)) ? uid : null;
}

/**
 * Paddle's reference for the purchase the stored token proves, for the account page to show as the one thing support can
 * act on. Read from the token only after it verifies for this uid; null when there is no valid token or no well-formed
 * reference in it. No request.
 */
export async function storedPaymentReference(uid: string | null): Promise<string | null> {
  const token = read();
  if (!uid || !(await verifyToken(token, uid))) return null;
  try {
    const claims = JSON.parse(dec.decode(b64urlBytes((token as string).split('.')[0]))) as Record<string, unknown>;
    return typeof claims.txn === 'string' && /^txn_[a-z0-9]{26}$/.test(claims.txn) ? claims.txn : null;
  } catch {
    return null;
  }
}

export type RefreshResult =
  | { state: 'owned' }
  | { state: 'not-owned' }
  | { state: 'revoked' }
  | { state: 'offline' }
  | { state: 'unavailable'; detail: string };

/**
 * Ask the server, from /account/ and /pro/buy/ only. Anything short of a clear answer — no connection, a server error, a
 * sign-in the server did not accept, a token that does not verify — leaves what is stored exactly as it
 * was: an unreachable server must not take Pro away from someone who paid.
 */
export async function refreshEntitlement(idToken: string, uid: string): Promise<RefreshResult> {
  let res: Response;
  try {
    res = await fetch('/api/entitlement', { headers: { Authorization: `Bearer ${idToken}` }, cache: 'no-store' });
  } catch {
    return { state: 'offline' };
  }
  if (!res.ok) return { state: 'unavailable', detail: `status ${res.status}` };
  let body: { pro?: unknown; token?: unknown; revoked?: unknown };
  try {
    body = await res.json();
  } catch {
    return { state: 'unavailable', detail: 'unreadable response' };
  }
  if (body.pro === true) {
    if (!(await verifyToken(body.token, uid))) return { state: 'unavailable', detail: 'a token that does not verify' };
    try {
      localStorage.setItem(ENTITLEMENT_KEY, body.token as string);
    } catch {
      return { state: 'unavailable', detail: 'browser storage unavailable' };
    }
    clearPendingPurchase();
    return { state: 'owned' };
  }
  if (body.pro === false) {
    clearEntitlement();
    // Refunded ends a pending note. Not-owned does not: that is also what the server says in the seconds before
    // Paddle's webhook arrives, and the note exists for exactly those seconds.
    if (body.revoked === true) {
      clearPendingPurchase();
      return { state: 'revoked' };
    }
    return { state: 'not-owned' };
  }
  return { state: 'unavailable', detail: 'unexpected response' };
}
