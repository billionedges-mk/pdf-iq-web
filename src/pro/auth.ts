/**
 * Web sign-in: Google, by redirect, with the exchange done in this browser.
 *
 * Why each of those:
 *
 *  - Google only, because it is the one method that yields the same Firebase account as the
 *    Android app without building account linking on both surfaces. The app requests its Google
 *    ID token for the project's OAuth web client; this requests one for the same client.
 *  - A redirect, not a popup, because every page sends Cross-Origin-Opener-Policy: same-origin,
 *    which severs a popup from the page that opened it.
 *  - The exchange here, not on a server of ours, because a server-side exchange would keep the
 *    footer's third-party count at zero only by moving the Google traffic where the counter
 *    cannot see it. Done here, the counter shows it.
 *
 * Errors are sorted by Firebase's error code — its stable identifier, never its prose — into
 * kinds whose words (account.ts) are true about what the person can do. `app-check` exists for
 * one reason: App Check on Firebase Auth is monitoring, not enforced. If it is ever enforced,
 * this sign-in, which carries no App Check token, starts failing — and "sign in again" would be
 * advice that cannot work, which is the trap the Android app's AppUnverified state exists to
 * avoid. It matches any mention of App Check in the error, because the actual response to
 * enforcement has never been observed: it has not happened. That match is untested against it.
 */
import {
  AUTH,
  writePending,
  takePending,
  writeSession,
  readSession,
  clearSession,
  StorageUnavailable,
  type Session,
} from './session.js';

export const AUTH_SENTINEL = 'pdfiq-pro:auth';

export type AuthErrorKind =
  | 'cancelled'
  | 'forged'
  | 'offline'
  | 'not-configured'
  | 'app-check'
  | 'ended'
  | 'disabled'
  | 'storage'
  | 'unknown';

export class AuthError extends Error {
  constructor(readonly kind: AuthErrorKind, readonly code: string) {
    super(`${kind}: ${code}`);
  }
}

const NO_KEY = 'no Firebase web API key in this build';
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const redirectUri = () => `${location.origin}/account/`;

function guarded<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof StorageUnavailable) throw new AuthError('storage', 'browser storage unavailable');
    throw e;
  }
}

export function signInUrl(state: string, nonce: string): string {
  const u = new URL(AUTH.authorize);
  u.search = new URLSearchParams({
    client_id: AUTH.clientId,
    redirect_uri: redirectUri(),
    response_type: 'id_token',
    scope: AUTH.scope,
    nonce,
    state,
    prompt: 'select_account',
  }).toString();
  return u.toString();
}

/** Leave for Google. Nothing is sent from this page: it is a navigation, not a request. */
export function startSignIn(): void {
  if (!AUTH.apiKey) throw new AuthError('not-configured', NO_KEY);
  const pending = { state: random(), nonce: random(), startedAt: Date.now() };
  guarded(() => writePending(pending));
  location.assign(signInUrl(pending.state, pending.nonce));
}

function jwtClaims(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Finish a sign-in from the fragment Google sent back. Null when the URL carries none.
 * The claims are read only to compare the nonce; Firebase verifies the token's signature.
 */
export async function completeSignIn(hash: string): Promise<Session | null> {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!params.has('id_token') && !params.has('error')) return null;

  // Out of the address bar and the history before anything else, so the token cannot survive
  // a reload, a bookmark or the back button.
  history.replaceState(null, '', location.pathname + location.search);
  const pending = guarded(() => takePending());

  const error = params.get('error');
  if (error) throw new AuthError(error === 'access_denied' ? 'cancelled' : 'unknown', `google: ${error}`);

  const idToken = params.get('id_token') ?? '';
  if (!pending || params.get('state') !== pending.state) {
    throw new AuthError('forged', 'state does not match a sign-in started in this browser');
  }
  const claims = jwtClaims(idToken);
  if (!claims || claims.nonce !== pending.nonce) throw new AuthError('forged', 'nonce does not match');
  if (!AUTH.apiKey) throw new AuthError('not-configured', NO_KEY);

  const body = await call(`${AUTH.identityToolkit}/v1/accounts:signInWithIdp?key=${encodeURIComponent(AUTH.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postBody: `id_token=${encodeURIComponent(idToken)}&providerId=google.com`,
      requestUri: redirectUri(),
      returnIdpCredential: false,
      returnSecureToken: true,
    }),
  });
  const session: Session = {
    uid: String(body.localId),
    email: String(body.email ?? ''),
    idToken: String(body.idToken),
    idTokenExpiresAt: Date.now() + Number(body.expiresIn ?? 3600) * 1000,
    refreshToken: String(body.refreshToken),
  };
  guarded(() => writeSession(session));
  return session;
}

/** The stored session, refreshed if it is within five minutes of expiring. Null if signed out. */
export async function freshSession(): Promise<Session | null> {
  const s = guarded(() => readSession());
  if (!s) return null;
  if (s.idTokenExpiresAt - Date.now() > 5 * 60 * 1000) return s;
  if (!AUTH.apiKey) throw new AuthError('not-configured', NO_KEY);
  let body: Record<string, unknown>;
  try {
    body = await call(`${AUTH.secureToken}/v1/token?key=${encodeURIComponent(AUTH.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: s.refreshToken }).toString(),
    });
  } catch (e) {
    // A session Google has ended is gone; keeping it would only fail again on the next page.
    if (e instanceof AuthError && (e.kind === 'ended' || e.kind === 'disabled')) clearSession();
    throw e;
  }
  const next: Session = {
    ...s,
    idToken: String(body.id_token),
    refreshToken: String(body.refresh_token),
    idTokenExpiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000,
  };
  guarded(() => writeSession(next));
  return next;
}

export function signOut(): void {
  clearSession();
}

async function call(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new AuthError(
      navigator.onLine === false ? 'offline' : 'unknown',
      'the request did not reach Google (offline, or blocked before it left)'
    );
  }
  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (res.ok && body) return body;
  throw classify(res.status, body);
}

/** By Firebase's error code, not its wording. */
export function classify(status: number, body: unknown): AuthError {
  const err = (body as { error?: { message?: unknown; status?: unknown; details?: unknown } } | null)?.error;
  const message = String(err?.message ?? '');
  const statusName = String(err?.status ?? '');
  const details = err?.details;
  const reasons = (Array.isArray(details) ? details : [])
    .map((d: unknown) => String((d as { reason?: unknown })?.reason ?? ''))
    .join(' ');
  const code = message.split(' : ')[0].trim() || statusName || `HTTP ${status}`;
  const all = `${message} ${statusName} ${reasons}`;

  if (/app.?check/i.test(all)) return new AuthError('app-check', code);
  if (/^(TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_NOT_FOUND|INVALID_ID_TOKEN|CREDENTIAL_TOO_OLD_LOGIN_AGAIN)$/.test(code)) {
    return new AuthError('ended', code);
  }
  if (code === 'USER_DISABLED') return new AuthError('disabled', code);
  if (
    /API_KEY|OPERATION_NOT_ALLOWED|INVALID_IDP_RESPONSE|UNAUTHORIZED_DOMAIN|INVALID_REQUEST_URI|CONFIGURATION_NOT_FOUND|PERMISSION_DENIED/.test(all)
  ) {
    return new AuthError('not-configured', code);
  }
  return new AuthError('unknown', code);
}
