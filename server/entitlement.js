/**
 * The Pro entitlement: who owns it, and the signed token that lets a browser know offline.
 *
 * Why a signed token rather than a question to the server:
 *   - Someone who paid and has no connection must not be locked out. A server check cannot run
 *     offline, so a browser needs something it can check by itself.
 *   - Tool pages send nothing (/privacy says so). A gate that asked a server on every tool page
 *     would break that. The token is fetched on /account/ only, and a tool page verifies it
 *     locally with the public key compiled into the build.
 *
 * The token does not expire: an expiry would lock out exactly the offline buyer this exists for.
 * A refund therefore takes effect on a browser the next time it visits /account/ online, where the
 * token is refreshed or removed. /refunds has to say that, and does once this ships.
 *
 * Format: base64url(JSON payload) "." base64url(ECDSA P-256 SHA-256 signature, raw r||s — the
 * form WebCrypto produces and verifies). Not a JWT on purpose: no header means no algorithm field
 * for anyone to argue with, and nothing reads it but our own verifier.
 *
 * `env` is 'sandbox' or 'production' and is part of what is signed. Preview and Production use
 * different key pairs as well, so a token earned with a sandbox test card cannot unlock Pro on
 * pdf-iq.com twice over: the signature fails, and so would the env check.
 */

export const ENTITLEMENT_SENTINEL = 'pdfiq-server:entitlement';

export const TOKEN_VERSION = 1;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlBytes(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad), (c) => c.charCodeAt(0));
}

const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

export async function importPrivateKey(jwk) {
  return crypto.subtle.importKey('jwk', typeof jwk === 'string' ? JSON.parse(jwk) : jwk, ALG, false, ['sign']);
}

export async function importPublicKey(jwk) {
  return crypto.subtle.importKey('jwk', typeof jwk === 'string' ? JSON.parse(jwk) : jwk, ALG, false, ['verify']);
}

/** @param {{ uid: string, txn: string, env: string, iat: number }} claims */
export async function signEntitlement(claims, privateKey) {
  const payload = b64url(enc.encode(JSON.stringify({ v: TOKEN_VERSION, pro: true, ...claims })));
  const sig = await crypto.subtle.sign(SIGN, privateKey, enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

/**
 * @returns {Promise<{ ok: true, claims: object } | { ok: false, reason: string }>}
 */
export async function verifyEntitlement(token, publicKey, { uid, env }) {
  if (typeof token !== 'string') return { ok: false, reason: 'no-token' };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  let valid = false;
  try {
    valid = await crypto.subtle.verify(SIGN, publicKey, b64urlBytes(parts[1]), enc.encode(parts[0]));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad-signature' };
  let claims;
  try {
    claims = JSON.parse(dec.decode(b64urlBytes(parts[0])));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (claims.v !== TOKEN_VERSION || claims.pro !== true) return { ok: false, reason: 'not-an-entitlement' };
  if (claims.env !== env) return { ok: false, reason: 'wrong-environment' };
  if (claims.uid !== uid) return { ok: false, reason: 'different-account' };
  return { ok: true, claims };
}

/**
 * Whether this signed-in person owns Pro, and the purchase that says so.
 *
 * By uid first. If none, by verified email: deleting an account and signing in again with the
 * same Google account produces a new uid, and /privacy promises deletion does not revoke Pro. A
 * purchase found that way is rebound to the new uid, but only when the email is verified by
 * Google — an unverified email is a claim anyone can type.
 *
 * @returns {Promise<{ pro: true, txn: string } | { pro: false, revoked: boolean }>}
 */
export async function findEntitlement(db, { uid, email, emailVerified }) {
  const byUid = await db.prepare('SELECT transaction_id, status FROM purchases WHERE uid = ? ORDER BY changed_at DESC')
    .bind(uid).all();
  const rows = byUid.results ?? [];
  const granted = rows.find((r) => r.status === 'granted');
  if (granted) return { pro: true, txn: granted.transaction_id };

  if (email && emailVerified) {
    const byEmail = await db.prepare(
      "SELECT transaction_id, uid FROM purchases WHERE email = ? AND status = 'granted' ORDER BY changed_at DESC"
    ).bind(email).all();
    const found = (byEmail.results ?? [])[0];
    if (found) {
      if (found.uid !== uid) {
        await db.prepare('UPDATE purchases SET uid = ? WHERE transaction_id = ?').bind(uid, found.transaction_id).run();
      }
      return { pro: true, txn: found.transaction_id };
    }
  }
  return { pro: false, revoked: rows.length > 0 };
}
