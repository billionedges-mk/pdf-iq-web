/**
 * Web sign-in, exercised in Node against a scripted Google and Firebase.
 *
 * What this proves: the URL sent to Google, that starting sign-in sends nothing, the state and
 * nonce checks, that the token leaves the address bar before any request, the exact storage
 * shape (the one /privacy describes), refresh, and how every error code is sorted into a kind.
 *
 * What it cannot prove, and does not pretend to: a real Google sign-in, the CSP override on
 * Cloudflare, and the response Firebase gives when App Check is enforced on Auth. The first two
 * need a preview deployment; the third has never happened. The App Check bodies below are
 * stand-ins that mention App Check, and they test only that such a mention is sorted into
 * `app-check` — which is the whole of what the code claims.
 *
 *   npm run verify:auth
 */
import * as esbuild from 'esbuild';
import { rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { AUTH as CONFIG } from './auth-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = join(tmpdir(), 'pdfiq-verify-auth');
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

await esbuild.build({
  entryPoints: [join(ROOT, 'src/pro/auth.ts'), join(ROOT, 'src/pro/session.ts')],
  bundle: true, splitting: true, platform: 'node', format: 'esm', logLevel: 'warning', outdir: WORK,
  // .mjs, so Node does not have to guess the module type and print a warning about it: noise in a
  // check's output is where a real failure goes to hide (CLAIMS 27).
  outExtension: { '.js': '.mjs' },
  define: { __PDFIQ_AUTH__: JSON.stringify({ ...CONFIG, apiKey: 'test-key' }) },
});
const auth = await import(pathToFileURL(join(WORK, 'auth.mjs')).href);
const session = await import(pathToFileURL(join(WORK, 'session.mjs')).href);
const { AUTH } = session;

// ---------------------------------------------------------------- a scripted browser
class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
const log = [];
const loc = {
  origin: 'https://preview.example', pathname: '/account/', search: '', hash: '', assigned: null,
  assign(u) { this.assigned = u; log.push('assign'); },
};
globalThis.window = globalThis;
globalThis.localStorage = new MemStorage();
globalThis.sessionStorage = new MemStorage();
globalThis.location = loc;
globalThis.history = { replaceState(_s, _t, url) { log.push(`replaceState ${url}`); loc.hash = ''; } };
const online = (v) => Object.defineProperty(globalThis, 'navigator', { value: { onLine: v }, configurable: true, writable: true });
online(true);
let respond = null;
const requests = [];
globalThis.fetch = async (url, init) => {
  log.push(`fetch ${String(url).split('?')[0]}`);
  requests.push({ url: String(url), init });
  const r = respond(String(url), init);
  if (r instanceof Error) throw r;
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
};
const reset = () => {
  log.length = 0; requests.length = 0;
  globalThis.localStorage = new MemStorage(); globalThis.sessionStorage = new MemStorage();
  loc.assigned = null; loc.hash = ''; online(true); respond = null;
};
const jwt = (claims) => ['{"alg":"RS256","typ":"JWT"}', JSON.stringify(claims), 'signature']
  .map((s) => Buffer.from(s).toString('base64url')).join('.');
const sorted = (a) => [...a].sort().join(',');

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`); if (!cond) fails++; };
async function kindOf(fn) {
  try { await fn(); return 'no error'; } catch (e) { return e instanceof auth.AuthError ? e.kind : `threw ${e?.message}`; }
}

// ---------------------------------------------------------------- starting
console.log('\n— starting a sign-in');
reset();
auth.startSignIn();
const pending = JSON.parse(sessionStorage.getItem(AUTH.pendingKey));
const u = new URL(loc.assigned);
ok(u.origin + u.pathname === AUTH.authorize, 'goes to Google\'s authorisation endpoint');
ok(u.searchParams.get('client_id') === CONFIG.clientId, 'with the OAuth web client the Android app uses');
ok(u.searchParams.get('redirect_uri') === 'https://preview.example/account/', 'returning to this origin\'s /account/');
ok(u.searchParams.get('response_type') === 'id_token', 'asking for an ID token');
ok(u.searchParams.get('scope') === 'openid email', 'for email and account identifier only');
ok(u.searchParams.get('state') === pending.state && u.searchParams.get('nonce') === pending.nonce, 'with the state and nonce it kept');
ok(pending.state.length >= 43 && pending.nonce.length >= 43 && pending.state !== pending.nonce, 'which are 256-bit random values');
ok(sorted(Object.keys(pending)) === sorted(AUTH.pendingFields), `keeps exactly ${AUTH.pendingFields.join(', ')} in sessionStorage`);
ok(requests.length === 0, 'and sends nothing from the page: leaving for Google is a navigation');
const first = pending.state;
reset(); auth.startSignIn();
ok(JSON.parse(sessionStorage.getItem(AUTH.pendingKey)).state !== first, 'a second sign-in gets a different state');

// ---------------------------------------------------------------- completing
console.log('\n— coming back from Google');
reset(); auth.startSignIn();
let p = JSON.parse(sessionStorage.getItem(AUTH.pendingKey));
respond = (url) => url.startsWith(`${AUTH.identityToolkit}/v1/accounts:signInWithIdp`)
  ? { status: 200, body: { localId: 'uid-123', email: 'a@example.com', idToken: 'ID-1', refreshToken: 'RT-1', expiresIn: '3600' } }
  : { status: 404, body: {} };
let s = await auth.completeSignIn(`#state=${p.state}&id_token=${jwt({ nonce: p.nonce, email: 'a@example.com' })}`);
const stored = JSON.parse(localStorage.getItem(AUTH.sessionKey));
ok(s && s.uid === 'uid-123' && s.email === 'a@example.com', 'signs in and returns the account');
ok(sorted(Object.keys(stored)) === sorted(AUTH.sessionFields), `stores exactly ${AUTH.sessionFields.join(', ')} under ${AUTH.sessionKey}`);
const iReplace = log.findIndex((l) => l.startsWith('replaceState'));
const iFetch = log.findIndex((l) => l.startsWith('fetch'));
ok(iReplace >= 0 && iFetch > iReplace, 'takes the token out of the address bar before making any request');
const req = requests[0];
const sent = JSON.parse(req.init.body);
ok(req.url.includes('key=test-key'), 'calls signInWithIdp with the web key');
ok(sent.postBody.includes('providerId=google.com') && sent.postBody.includes('id_token='), 'handing over the Google ID token');
ok(sent.requestUri === 'https://preview.example/account/' && sent.returnSecureToken === true, 'from this origin, asking for a session');
ok(requests.length === 1, 'in exactly one request');
ok(sessionStorage.getItem(AUTH.pendingKey) === null, 'and deletes the pending sign-in');

reset(); auth.startSignIn(); p = JSON.parse(sessionStorage.getItem(AUTH.pendingKey));
ok(await kindOf(() => auth.completeSignIn(`#state=someone-else&id_token=${jwt({ nonce: p.nonce })}`)) === 'forged', 'a state it did not issue: forged');
ok(requests.length === 0, 'and nothing is sent');
reset(); auth.startSignIn(); p = JSON.parse(sessionStorage.getItem(AUTH.pendingKey));
ok(await kindOf(() => auth.completeSignIn(`#state=${p.state}&id_token=${jwt({ nonce: 'wrong' })}`)) === 'forged', 'a nonce it did not issue: forged');
reset();
ok(await kindOf(() => auth.completeSignIn(`#state=x&id_token=${jwt({ nonce: 'y' })}`)) === 'forged', 'no sign-in started in this browser: forged');
reset(); auth.startSignIn();
ok(await kindOf(() => auth.completeSignIn('#error=access_denied')) === 'cancelled', 'the user backed out at Google: cancelled');
ok(log.some((l) => l.startsWith('replaceState')), 'and the fragment is still cleared');
reset();
ok((await auth.completeSignIn('')) === null && !log.some((l) => l.startsWith('replaceState')), 'no fragment: nothing to complete, nothing touched');

// ---------------------------------------------------------------- sorting errors
console.log('\n— every error sorted by code');
const cases = [
  [400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }, 'not-configured'],
  [403, { error: { code: 403, message: 'Requests from referer <empty> are blocked.', status: 'PERMISSION_DENIED', details: [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }] } }, 'not-configured'],
  [400, { error: { message: 'OPERATION_NOT_ALLOWED' } }, 'not-configured'],
  [400, { error: { message: 'INVALID_IDP_RESPONSE : the Google id_token is not allowed to be used with this application.' } }, 'not-configured'],
  [400, { error: { message: 'USER_DISABLED' } }, 'disabled'],
  [400, { error: { message: 'TOKEN_EXPIRED' } }, 'ended'],
  [400, { error: { message: 'INVALID_REFRESH_TOKEN' } }, 'ended'],
  [400, { error: { message: 'USER_NOT_FOUND' } }, 'ended'],
  [401, { error: { code: 401, message: 'Firebase App Check token is invalid.', status: 'UNAUTHENTICATED' } }, 'app-check'],
  [401, { error: { code: 401, message: 'MISSING_APP_CHECK_TOKEN' } }, 'app-check'],
  [500, null, 'unknown'],
];
for (const [status, body, want] of cases) {
  const got = auth.classify(status, body).kind;
  const label = body?.error?.message ?? `HTTP ${status}, no body`;
  const standIn = want === 'app-check' ? '  (a stand-in: the real enforcement response has never been observed)' : '';
  ok(got === want, `${label.slice(0, 60)} -> ${want}${got === want ? '' : ` (got ${got})`}${standIn}`);
}

// ---------------------------------------------------------------- refresh, and the rest
console.log('\n— a kept sign-in');
reset();
const keep = (expiresIn) => localStorage.setItem(AUTH.sessionKey, JSON.stringify({
  uid: 'u', email: 'a@example.com', idToken: 'OLD', idTokenExpiresAt: Date.now() + expiresIn, refreshToken: 'RT-OLD',
}));
keep(60 * 60 * 1000);
ok((await auth.freshSession()).idToken === 'OLD' && requests.length === 0, 'far from expiry: used as it is, nothing sent');
reset(); keep(60 * 1000);
respond = (url) => url.startsWith(`${AUTH.secureToken}/v1/token`)
  ? { status: 200, body: { id_token: 'NEW', refresh_token: 'RT-NEW', expires_in: '3600', user_id: 'u' } }
  : { status: 404, body: {} };
s = await auth.freshSession();
ok(s.idToken === 'NEW' && s.refreshToken === 'RT-NEW', 'within five minutes of expiry: refreshed at the token service');
ok(new URLSearchParams(requests[0].init.body).get('grant_type') === 'refresh_token', 'with a refresh-token grant');
ok(sorted(Object.keys(JSON.parse(localStorage.getItem(AUTH.sessionKey)))) === sorted(AUTH.sessionFields), 'and the stored shape is unchanged');
reset(); keep(60 * 1000);
respond = () => ({ status: 400, body: { error: { code: 400, message: 'TOKEN_EXPIRED', status: 'INVALID_ARGUMENT' } } });
ok(await kindOf(() => auth.freshSession()) === 'ended', 'a refresh Google refuses: ended');
ok(localStorage.getItem(AUTH.sessionKey) === null, 'and the dead session is deleted, not kept to fail again');
reset(); keep(60 * 1000);
respond = () => new TypeError('Failed to fetch'); online(false);
ok(await kindOf(() => auth.freshSession()) === 'offline', 'the network is down: offline');
reset(); keep(60 * 1000);
respond = () => new TypeError('Failed to fetch'); online(true);
ok(await kindOf(() => auth.freshSession()) === 'unknown', 'online but the request never arrived (a CSP block looks like this): unknown, not offline');
reset(); keep(60 * 60 * 1000); auth.signOut();
ok(localStorage.getItem(AUTH.sessionKey) === null, 'signing out deletes the session from this browser');

console.log('\n— what cannot work, says so');
reset();
const key = AUTH.apiKey; AUTH.apiKey = '';
ok(await kindOf(() => auth.startSignIn()) === 'not-configured' && loc.assigned === null && requests.length === 0,
  'no web key in the build: not-configured, and nobody is sent to Google for nothing');
AUTH.apiKey = key;
reset();
globalThis.sessionStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} };
ok(await kindOf(() => auth.startSignIn()) === 'storage', 'a browser that refuses storage: storage');
reset();
let refused = '';
try { session.writeSession({ uid: 'u', email: 'e', idToken: 'i', idTokenExpiresAt: 1, refreshToken: 'r', name: 'extra' }); } catch (e) { refused = e.message; }
ok(/privacy lists/.test(refused), 'storing a field /privacy does not list is refused');

console.log(`\n${fails ? `${fails} FAILED` : 'web sign-in behaves as described — up to what Node can show'}`);
process.exitCode = fails ? 1 : 0;
