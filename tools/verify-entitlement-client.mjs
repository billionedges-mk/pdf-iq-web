/**
 * The browser half of the Pro entitlement, run against the server half.
 *
 * Bundles src/pro/entitlement.ts for Node with this build's constants, replaces the public-key file with a
 * key pair generated here, and gives it a localStorage and a fetch to talk to. Tokens are signed by the real
 * server code (server/entitlement.js), so a format disagreement between the two halves fails here.
 *
 * What it proves:
 *   - a verified token is stored, and proves ownership for its own uid only, with no request;
 *   - offline, a server error, or a sign-in the server refused leaves a stored token exactly as it was;
 *   - a token that does not verify (another key, another environment, another uid, edited) is never stored;
 *   - a refund answer removes it;
 *   - with no key for the build's environment, nothing verifies.
 *
 *   npm run verify:entitlement-client
 */
import * as esbuild from 'esbuild';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { signEntitlement, b64url } from '../server/entitlement.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = join(ROOT, 'node_modules', '.cache', 'verify-entitlement-client');
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const pair = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
const other = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);

async function load(env, keys) {
  const out = join(WORK, `entitlement-${env}-${Object.keys(keys).join('-') || 'nokeys'}.mjs`);
  await esbuild.build({
    entryPoints: [join(ROOT, 'src/pro/entitlement.ts')],
    bundle: true, platform: 'neutral', format: 'esm', outfile: out, logLevel: 'silent',
    define: { __PDFIQ_PADDLE_ENV__: JSON.stringify(env) },
    plugins: [{
      name: 'test-keys',
      setup(b) {
        b.onResolve({ filter: /entitlement-public-keys\.json$/ }, () => ({ path: 'keys', namespace: 'test-keys' }));
        b.onLoad({ filter: /.*/, namespace: 'test-keys' }, () => ({ contents: JSON.stringify(keys), loader: 'json' }));
      },
    }],
  });
  return import(pathToFileURL(out).href);
}

// A localStorage and a fetch the module can use.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
let respond = async () => { throw new TypeError('offline'); };
let lastRequest = null;
globalThis.fetch = async (url, init) => { lastRequest = { url, init }; return respond(url, init); };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const sign = (claims, key = pair.privateKey) => signEntitlement({ uid: 'uid-alice', txn: 'txn_1', env: 'sandbox', iat: 1, ...claims }, key);

const E = await load('sandbox', { sandbox: publicJwk });
const KEY = E.ENTITLEMENT_KEY;

// ---------------------------------------------------------------- granting

respond = async () => json(200, { pro: true, token: await sign({}) });
let r = await E.refreshEntitlement('id-token-alice', 'uid-alice');
ok(r.state === 'owned' && store.has(KEY), 'a verified token from the server is stored');
ok(lastRequest?.url === '/api/entitlement' && lastRequest.init.headers.Authorization === 'Bearer id-token-alice', 'asked same-origin /api/entitlement with the ID token as a bearer');
ok((await E.storedEntitlementUid('uid-alice')) === 'uid-alice', 'the stored token proves ownership for its uid');
respond = async () => { throw new Error('storedEntitlementUid must not make a request'); };
lastRequest = null;
ok((await E.storedEntitlementUid('uid-alice')) === 'uid-alice' && lastRequest === null, 'and does so with no request at all');
ok((await E.storedEntitlementUid('uid-mallory')) === null, "someone else signed in on the same browser does not inherit it");
ok((await E.storedEntitlementUid(null)) === null, 'nobody signed in: no ownership');

// ---------------------------------------------------------------- nothing takes it away except a clear answer

const kept = store.get(KEY);
for (const [label, fn] of [
  ['offline', async () => { throw new TypeError('Failed to fetch'); }],
  ['a server error', async () => json(500, { error: 'store-failed' })],
  ['a sign-in the server refused', async () => json(401, { error: 'unauthorized', reason: 'expired' })],
  ['an unreadable response', async () => new Response('<html>', { status: 200 })],
]) {
  respond = fn;
  r = await E.refreshEntitlement('id', 'uid-alice');
  ok(store.get(KEY) === kept && r.state !== 'owned' && r.state !== 'revoked', `${label}: the stored token is left exactly as it was (${r.state})`);
}

for (const [label, token] of [
  ['signed by another key', await sign({}, other.privateKey)],
  ['for the production environment', await sign({ env: 'production' })],
  ['for another uid', await sign({ uid: 'uid-mallory' })],
  ['with its payload edited', await (async () => { const t = await sign({}); const [p, s] = t.split('.'); const claims = JSON.parse(Buffer.from(p, 'base64url')); return `${b64url(new TextEncoder().encode(JSON.stringify({ ...claims, txn: 'txn_forged' })))}.${s}`; })()],
  ['that is not a token', 'nonsense'],
]) {
  respond = async () => json(200, { pro: true, token });
  r = await E.refreshEntitlement('id', 'uid-alice');
  ok(store.get(KEY) === kept && r.state === 'unavailable', `a token ${label} is not stored, and the good one stays`);
}

store.set(KEY, 'edited.' + kept.split('.')[1]);
ok((await E.storedEntitlementUid('uid-alice')) === null, 'an edited stored token proves nothing');
store.set(KEY, kept);

// ---------------------------------------------------------------- refund

respond = async () => json(200, { pro: false, revoked: true });
r = await E.refreshEntitlement('id', 'uid-alice');
ok(r.state === 'revoked' && !store.has(KEY), 'a refund answer removes the token');
ok((await E.storedEntitlementUid('uid-alice')) === null, 'and ownership ends on this browser');

respond = async () => json(200, { pro: false, revoked: false });
store.set(KEY, kept);
r = await E.refreshEntitlement('id', 'uid-alice');
ok(r.state === 'not-owned' && !store.has(KEY), 'an account that does not own Pro keeps no token');

store.set(KEY, kept);
E.clearEntitlement();
ok(!store.has(KEY), 'clearEntitlement removes it (sign-out)');

// ---------------------------------------------------------------- the pending-purchase note
const PENDING = 'pdfiq.pending-purchase';
const note = JSON.stringify({ txn: 'txn_1', uid: 'uid-alice', at: Date.now() });
store.set(PENDING, note);
respond = async () => json(200, { pro: false, revoked: false });
await E.refreshEntitlement('id', 'uid-alice');
ok(store.get(PENDING) === note, 'not-owned (the seconds before the webhook) leaves the pending note in place');
respond = async () => json(500, { error: 'store-failed' });
await E.refreshEntitlement('id', 'uid-alice');
ok(store.get(PENDING) === note, 'a server error leaves it in place');
respond = async () => json(200, { pro: true, token: await sign({}) });
await E.refreshEntitlement('id', 'uid-alice');
ok(!store.has(PENDING), 'confirmation removes it');
store.set(PENDING, note);
respond = async () => json(200, { pro: false, revoked: true });
await E.refreshEntitlement('id', 'uid-alice');
ok(!store.has(PENDING), 'a refund removes it');

// ---------------------------------------------------------------- the build's own key

store.set(KEY, kept);
const NoKey = await load('production', { sandbox: publicJwk });
ok((await NoKey.storedEntitlementUid('uid-alice')) === null, 'a production build with no production key verifies nothing, not even a valid sandbox token');

// ---------------------------------------------------------------- what each confirmation ending lets the page do
//
// A refunded account owns nothing and has nothing in flight, which is where a purchase starts: the checkout has to be
// offered. /pro/buy/ reported the refund and stopped, so someone who refunded by mistake was told Pro was not theirs
// and given no way to buy it again (owner, 18 September 2026). Every other ending either owns Pro or is waiting on a
// payment, where a second checkout would invite paying twice.
{
  const out = join(WORK, 'confirm.mjs');
  await esbuild.build({
    entryPoints: [join(ROOT, 'src/pro/confirm.ts')],
    bundle: true, platform: 'neutral', format: 'esm', outfile: out, logLevel: 'silent',
    define: { __PDFIQ_PADDLE_ENV__: '"sandbox"', __PDFIQ_SALE__: 'true', __PDFIQ_PRO__: 'true', __PDFIQ_LOCAL__: 'false', __PDFIQ_AUTH__: 'null', __PDFIQ_BUILD__: '"test"', __PDFIQ_CHECKOUT_ORIGIN__: '""', __PDFIQ_PRO_PRICE__: '"$14.99"', __PDFIQ_PRO_COPY__: '"{}"' },
  });
  const C = await import(pathToFileURL(out).href);
  const TXN = 'txn_01aaaaaaaaaaaaaaaaaaaaaaaa';

  const refunded = C.afterConfirm({ kind: 'revoked' }, TXN);
  ok(refunded.mayBuy === true, 'a refunded account is offered the checkout again');
  ok(/buy it again/i.test(refunded.words) && !/not on this browser/i.test(refunded.words),
    `and is told it can, rather than told about this browser: "${refunded.words}"`);

  for (const kind of ['owned', 'signed-out', 'offline', 'slow']) {
    ok(C.afterConfirm({ kind }, TXN).mayBuy === false, `a "${kind}" ending offers no second checkout`);
  }
  ok(C.confirmEndWords({ kind: 'revoked' }, TXN) === refunded.words, 'both pages read the same words from one place');
}

console.log(fails ? `\n${fails} FAILED` : '\nthe browser keeps Pro only on a verified token, offline, until a clear answer says otherwise');
process.exit(fails ? 1 : 0);
