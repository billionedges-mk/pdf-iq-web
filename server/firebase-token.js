/**
 * Verifying a Firebase ID token without Firebase's SDK.
 *
 * /account/ signs in through Google and the Identity Toolkit REST API, so the browser holds a
 * Firebase ID token for the same uid the Android app uses. The token is an RS256 JWT, and Google
 * publishes the keys it is signed with. That makes it checkable from a Pages Function with
 * WebCrypto alone, with no Google credential stored in Cloudflare.
 *
 * The checks are the ones Firebase documents for verifying ID tokens with a third-party library:
 * header alg RS256 and a kid Google currently publishes; signature valid under that key;
 * `aud` is the project id; `iss` is https://securetoken.google.com/<project id>; `exp` in the
 * future; `iat` and `auth_time` not in the future; `sub` non-empty (it is the uid).
 */

export const FIREBASE_TOKEN_SENTINEL = 'pdfiq-server:firebase-token';

/** The Firebase project the web sign-in and the Android app share (tools/auth-config.mjs). */
export const FIREBASE_PROJECT_ID = 'pdfiq-b14cc';

/** Google's signing keys for Firebase ID tokens, as JWKs. Served with a Cache-Control max-age. */
export const FIREBASE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/** Seconds of clock difference tolerated on iat and auth_time, which Google sets from its clock. */
const CLOCK_SKEW_SECONDS = 60;

const dec = new TextDecoder();

function b64urlBytes(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const b64urlJson = (s) => JSON.parse(dec.decode(b64urlBytes(s)));

let cached = { keys: null, until: 0 };

/** Fetch Google's keys, honouring max-age. Injected in tests. */
export async function fetchGoogleKeys(now = Date.now()) {
  if (cached.keys && now < cached.until) return cached.keys;
  const res = await fetch(FIREBASE_JWKS_URL);
  if (!res.ok) throw new Error(`google keys ${res.status}`);
  const body = await res.json();
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  cached = { keys: body.keys ?? [], until: now + maxAge * 1000 };
  return cached.keys;
}

/**
 * @returns {Promise<{ ok: true, uid: string, email: string|null, emailVerified: boolean }
 *   | { ok: false, reason: string }>}
 */
export async function verifyFirebaseIdToken(token, {
  projectId = FIREBASE_PROJECT_ID,
  nowSeconds = Math.floor(Date.now() / 1000),
  getKeys = fetchGoogleKeys,
} = {}) {
  if (typeof token !== 'string') return { ok: false, reason: 'no-token' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed-token' };

  let header, claims;
  try {
    header = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
  } catch {
    return { ok: false, reason: 'malformed-token' };
  }
  // Refusing anything but RS256 closes the "alg: none" and algorithm-confusion routes before a
  // key is even looked up.
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return { ok: false, reason: 'bad-header' };

  let keys;
  try {
    keys = await getKeys();
  } catch {
    return { ok: false, reason: 'keys-unavailable' };
  }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: 'unknown-kid' };

  const key = await crypto.subtle.importKey(
    'jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
  );
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let valid = false;
  try {
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), signed);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad-signature' };

  if (claims.aud !== projectId) return { ok: false, reason: 'wrong-audience' };
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) return { ok: false, reason: 'wrong-issuer' };
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) return { ok: false, reason: 'expired' };
  if (typeof claims.iat !== 'number' || claims.iat > nowSeconds + CLOCK_SKEW_SECONDS) return { ok: false, reason: 'issued-in-future' };
  if (typeof claims.auth_time === 'number' && claims.auth_time > nowSeconds + CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: 'auth-time-in-future' };
  }
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) return { ok: false, reason: 'no-subject' };

  return {
    ok: true,
    uid: claims.sub,
    email: typeof claims.email === 'string' ? claims.email.toLowerCase() : null,
    emailVerified: claims.email_verified === true,
  };
}
