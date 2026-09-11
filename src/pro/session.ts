/**
 * The signed-in session, kept in this browser and nowhere else.
 *
 * What is stored, where, and under which names comes from tools/auth-config.mjs — the same
 * object /privacy is written from — and writeSession() refuses to store an object whose fields
 * differ from that list. So the privacy page cannot describe storage this code does not do, or
 * miss storage it does: change one and the other fails.
 *
 * The refresh token is the sensitive part. In localStorage it can be read by any script that
 * runs on pdf-iq.com. That is the trade accepted for keeping sign-in in the browser instead of
 * behind a cookie and a server of ours. What makes it acceptable is that the only scripts that can
 * run here are the site's own — the content security policy says script-src 'self', and no page
 * loads a third-party script. If either of those ever changes, this storage has to change with it.
 */
export const SESSION_SENTINEL = 'pdfiq-pro:session';

export interface AuthConfig {
  clientId: string;
  apiKey: string;
  scope: string;
  authorize: string;
  identityToolkit: string;
  secureToken: string;
  hosts: string[];
  sessionKey: string;
  sessionFields: string[];
  pendingKey: string;
  pendingFields: string[];
}
declare const __PDFIQ_AUTH__: AuthConfig;
export const AUTH: AuthConfig = __PDFIQ_AUTH__;

export interface Session {
  uid: string;
  email: string;
  idToken: string;
  idTokenExpiresAt: number;
  refreshToken: string;
}

export interface Pending {
  state: string;
  nonce: string;
  startedAt: number;
}

/** localStorage or sessionStorage refused: private browsing, or site data blocked. */
export class StorageUnavailable extends Error {
  constructor() {
    super('browser storage unavailable');
  }
}

function store(kind: 'local' | 'session'): Storage {
  try {
    const s = kind === 'local' ? window.localStorage : window.sessionStorage;
    const probe = '__pdfiq_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    throw new StorageUnavailable();
  }
}

/** Refuse to store a shape /privacy does not describe. */
function exactly(obj: object, fields: string[], what: string): void {
  const got = Object.keys(obj).sort().join(', ');
  const want = [...fields].sort().join(', ');
  if (got !== want) {
    throw new Error(`${what} would store {${got}} but /privacy lists {${want}}: change both, in tools/auth-config.mjs`);
  }
}

export function writeSession(s: Session): void {
  exactly(s, AUTH.sessionFields, 'the session');
  store('local').setItem(AUTH.sessionKey, JSON.stringify(s));
}

/** The stored session, or null. A stored shape that does not match is discarded, not trusted. */
export function readSession(): Session | null {
  const s = store('local');
  const raw = s.getItem(AUTH.sessionKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    exactly(parsed, AUTH.sessionFields, 'the stored session');
    return parsed;
  } catch {
    s.removeItem(AUTH.sessionKey);
    return null;
  }
}

export function clearSession(): void {
  try {
    store('local').removeItem(AUTH.sessionKey);
  } catch {
    // Nothing could have been stored, so there is nothing to clear.
  }
}

export function writePending(p: Pending): void {
  exactly(p, AUTH.pendingFields, 'the sign-in in progress');
  store('session').setItem(AUTH.pendingKey, JSON.stringify(p));
}

/** Read and delete in one step: a pending sign-in can be completed once. */
export function takePending(): Pending | null {
  const s = store('session');
  const raw = s.getItem(AUTH.pendingKey);
  s.removeItem(AUTH.pendingKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Pending;
  } catch {
    return null;
  }
}
