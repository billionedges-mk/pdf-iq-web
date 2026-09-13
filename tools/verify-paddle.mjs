/**
 * The Pro purchase path on the server, driven directly: the Paddle webhook and the entitlement
 * endpoint, with real SQL, real HMACs and real signatures.
 *
 * Nothing here is mocked that could hide the defect it tests:
 *   - The database is SQLite (node:sqlite) running functions/purchases-schema.sql, behind the small
 *     part of D1's API the functions use, so a wrong column or constraint fails here.
 *   - Signatures are computed with a secret, exactly as Paddle documents, and then the body, the
 *     secret and the timestamp are each broken in turn.
 *   - Firebase ID tokens are real RS256 JWTs signed by a key generated here and served to the
 *     verifier as Google's JWKS would be; each claim the verifier must check is broken in turn.
 *
 * What this cannot prove, and the sandbox walk must: that Paddle's real payloads have these shapes,
 * that Cloudflare bundles the imports, and that a real Google-issued token verifies against
 * Google's real keys.
 *
 *   npm run verify:paddle
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { onRequest as webhook } from '../functions/api/paddle/webhook.js';
import { onRequest as entitlement } from '../functions/api/entitlement.js';
import { verifyPaddleSignature, decide } from '../server/paddle.js';
import { verifyFirebaseIdToken, FIREBASE_PROJECT_ID } from '../server/firebase-token.js';
import { importPublicKey, verifyEntitlement, b64url } from '../server/entitlement.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`); if (!cond) fails++; };
const enc = new TextEncoder();

// ---------------------------------------------------------------- a D1 made of SQLite

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(join(ROOT, 'functions/purchases-schema.sql'), 'utf8'));
  return {
    raw: db,
    prepare(sql) {
      const stmt = db.prepare(sql);
      let values = [];
      const api = {
        bind(...v) { values = v; return api; },
        async first() { return stmt.get(...values) ?? null; },
        async all() { return { results: stmt.all(...values) }; },
        async run() { stmt.run(...values); return { success: true }; },
      };
      return api;
    },
  };
}
const rows = (db) => db.raw.prepare('SELECT * FROM purchases ORDER BY transaction_id').all();

// ---------------------------------------------------------------- Paddle-shaped events

const SECRET = 'pdl_ntfset_01test_secret_for_verify_paddle_only';
const PRICE = 'pri_sandbox_pro_test';
const TXN = 'txn_01aaaaaaaaaaaaaaaaaaaaaaaa';
let n = 0;
const evt = (type, data, occurredAt) => ({
  event_id: `evt_${String(++n).padStart(26, '0')}`,
  event_type: type,
  occurred_at: occurredAt,
  notification_id: `ntf_${String(n).padStart(26, '0')}`,
  data,
});
const completed = (at, custom = { uid: 'uid-alice', email: 'Alice@Example.com' }, price = PRICE, txn = TXN) =>
  evt('transaction.completed', { id: txn, status: 'completed', custom_data: custom, items: [{ price: { id: price }, quantity: 1 }] }, at);
const adjustment = (type, fields, at, txn = TXN) =>
  evt(type, { id: `adj_${n}`, transaction_id: txn, customer_id: 'ctm_x', ...fields }, at);

async function signedHeader(body, secret = SECRET, ts = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = Buffer.from(await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}:${body}`))).toString('hex');
  return `ts=${ts};h1=${mac}`;
}

const envFor = (db, extra = {}) => ({
  PDFIQ_SALE: 'true', PURCHASES: db, PADDLE_WEBHOOK_SECRET: SECRET, PDFIQ_PADDLE_PRICE_ID: PRICE, ...extra,
});

async function deliver(db, event, { env, header, body } = {}) {
  const raw = body ?? JSON.stringify(event);
  const res = await webhook({
    request: new Request('https://preview.example/api/paddle/webhook', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Paddle-Signature': header ?? await signedHeader(raw) }, body: raw,
    }),
    env: env ?? envFor(db),
  });
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------- signature

console.log('\n— signature');
{
  const body = JSON.stringify(completed('2026-09-13T10:00:00Z'));
  const now = Math.floor(Date.now() / 1000);
  ok((await verifyPaddleSignature(body, await signedHeader(body), SECRET)).ok, 'a correctly signed body verifies');
  ok((await verifyPaddleSignature(body + ' ', await signedHeader(body), SECRET)).reason === 'signature-mismatch', 'one added space in the body fails');
  ok((await verifyPaddleSignature(body, await signedHeader(body, 'pdl_ntfset_wrong'), SECRET)).reason === 'signature-mismatch', 'a different secret fails');
  ok((await verifyPaddleSignature(body, await signedHeader(body, SECRET, now - 6), SECRET)).reason === 'timestamp-outside-tolerance', 'a signature six seconds old fails');
  ok((await verifyPaddleSignature(body, await signedHeader(body, SECRET, now - 5), SECRET)).ok, 'five seconds old is within tolerance');
  ok((await verifyPaddleSignature(body, 'h1=abc', SECRET)).reason === 'malformed-signature-header', 'a header without ts fails');
  ok((await verifyPaddleSignature(body, null, SECRET)).reason === 'malformed-signature-header', 'no header fails');
  ok((await verifyPaddleSignature(body, await signedHeader(body), '')).reason === 'no-secret-configured', 'no configured secret fails rather than passing');
  const good = await signedHeader(body);
  const ts = good.split(';')[0];
  ok((await verifyPaddleSignature(body, `${ts};h1=${'0'.repeat(64)};${good.split(';')[1]}`, SECRET)).ok, 'any matching h1 among several verifies');
}

// ---------------------------------------------------------------- the webhook, end to end

console.log('\n— webhook');
{
  const db = d1();
  const e = completed('2026-09-13T10:00:00Z');
  let r = await deliver(db, e);
  ok(r.status === 200 && r.body.applied, `a completed Pro purchase is recorded (${r.body.reason})`);
  const [row] = rows(db);
  ok(row?.status === 'granted' && row.uid === 'uid-alice' && row.email === 'alice@example.com', 'as granted, to the uid and lower-cased email from custom_data');
  ok(Object.keys(row).sort().join() === 'changed_at,email,last_event_id,status,transaction_id,uid', 'and the row holds nothing else: no amount, card or address');

  r = await deliver(db, e);
  ok(r.status === 200 && r.body.reason === 'duplicate-event', 'the same event delivered twice changes nothing');

  r = await deliver(db, completed('2026-09-13T10:00:01Z'), { header: `ts=${Math.floor(Date.now() / 1000)};h1=${'ab'.repeat(32)}` });
  ok(r.status === 401 && rows(db)[0].last_event_id === e.event_id, 'a current timestamp with a wrong signature is refused with 401 and writes nothing, so Paddle shows it as a failed delivery');
  r = await deliver(db, completed('2026-09-13T10:00:01Z'), { header: 'ts=1;h1=00' });
  ok(r.status === 401, 'a stale timestamp is refused with 401 too');

  r = await deliver(db, adjustment('adjustment.created', { action: 'refund', type: 'full', status: 'pending_approval' }, '2026-09-14T09:00:00Z'));
  ok(r.body.applied === false && rows(db)[0].status === 'granted', 'a refund pending approval changes nothing');

  r = await deliver(db, adjustment('adjustment.updated', { action: 'refund', type: 'partial', status: 'approved' }, '2026-09-14T09:30:00Z'));
  ok(r.body.reason === 'partial-refund' && rows(db)[0].status === 'granted', 'an approved partial refund leaves Pro in place');

  r = await deliver(db, adjustment('adjustment.updated', { action: 'refund', type: 'full', status: 'approved' }, '2026-09-14T10:00:00Z'));
  ok(rows(db)[0].status === 'revoked', 'an approved full refund revokes');

  r = await deliver(db, completed('2026-09-13T10:00:00Z', undefined, PRICE));
  ok(rows(db)[0].status === 'revoked' && r.body.reason === 'older-than-current-status', 'a retried older purchase event does not undo the refund');

  const db2 = d1();
  await deliver(db2, completed('2026-09-13T10:00:00Z'));
  await deliver(db2, adjustment('adjustment.created', { action: 'chargeback', type: 'full', status: 'approved' }, '2026-09-20T00:00:00Z'));
  ok(rows(db2)[0].status === 'revoked', 'a chargeback revokes');
  await deliver(db2, adjustment('adjustment.created', { action: 'chargeback_reverse', type: 'full', status: 'approved' }, '2026-09-25T00:00:00Z'));
  ok(rows(db2)[0].status === 'granted' && rows(db2)[0].uid === 'uid-alice', 'a chargeback reversal grants it back, to the same person');

  const db3 = d1();
  await deliver(db3, adjustment('adjustment.updated', { action: 'refund', type: 'full', status: 'approved' }, '2026-09-14T10:00:00Z'));
  ok(rows(db3)[0]?.status === 'revoked' && rows(db3)[0].uid === null, 'a refund that arrives before its purchase is kept, unbound');
  await deliver(db3, completed('2026-09-13T10:00:00Z'));
  ok(rows(db3)[0].status === 'revoked' && rows(db3)[0].uid === 'uid-alice', 'the late purchase binds the owner but does not undo the newer refund');

  const db4 = d1();
  r = await deliver(db4, completed('2026-09-13T10:00:00Z', undefined, 'pri_something_else'));
  ok(r.status === 200 && r.body.reason === 'not-the-pro-price' && rows(db4).length === 0, 'a purchase of any other price grants nothing, and is acknowledged');
  r = await deliver(db4, evt('customer.created', { id: 'ctm_1' }, '2026-09-13T10:00:00Z'));
  ok(r.status === 200 && rows(db4).length === 0, 'an event we do not subscribe to is acknowledged and ignored');
  r = await deliver(db4, completed('2026-09-13T11:00:00Z', null, PRICE, 'txn_01bbbbbbbbbbbbbbbbbbbbbbbb'));
  ok(rows(db4)[0]?.status === 'granted' && rows(db4)[0].uid === null, 'a Pro purchase with no custom_data is kept, unbound, for support to claim');

  r = await deliver(db4, completed('2026-09-13T12:00:00Z'), { env: envFor(db4, { PDFIQ_SALE: 'false' }) });
  ok(r.status === 404, 'with PDFIQ_SALE not "true" the endpoint does not exist');
  r = await deliver(db4, completed('2026-09-13T12:00:00Z'), { env: envFor(db4, { PADDLE_WEBHOOK_SECRET: '' }) });
  ok(r.status === 503, 'with no secret configured it refuses loudly, so Paddle retries, rather than accepting');
  r = await deliver(db4, completed('2026-09-13T12:00:00Z'), { env: envFor(null) });
  ok(r.status === 503, 'with no PURCHASES binding it refuses loudly');

  ok(decide({ event_type: 'transaction.completed', data: { id: TXN, items: [{ price: { id: PRICE } }] } }, PRICE).reason === 'no-occurred-at', 'an event with no occurred_at is ignored, not applied at time zero');
  ok(decide(completed('2026-09-13T10:00:00Z'), '').reason === 'not-the-pro-price', 'an unset price id matches nothing');
}

// ---------------------------------------------------------------- Firebase ID tokens

console.log('\n— Firebase ID token');
const google = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const impostor = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const KID = 'test-kid-1';
const jwks = [{ ...(await crypto.subtle.exportKey('jwk', google.publicKey)), kid: KID, alg: 'RS256', use: 'sig' }];
const now = Math.floor(Date.now() / 1000);

async function idToken(overrides = {}, { header = {}, key = google.privateKey } = {}) {
  const h = { alg: 'RS256', kid: KID, typ: 'JWT', ...header };
  const c = {
    iss: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`, aud: FIREBASE_PROJECT_ID,
    sub: 'uid-alice', user_id: 'uid-alice', email: 'alice@example.com', email_verified: true,
    iat: now - 10, exp: now + 3500, auth_time: now - 10, ...overrides,
  };
  const head = `${b64url(enc.encode(JSON.stringify(h)))}.${b64url(enc.encode(JSON.stringify(c)))}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(head));
  return `${head}.${b64url(sig)}`;
}
const verifyOptions = { getKeys: async () => jwks, nowSeconds: now };
const reason = async (t) => (await verifyFirebaseIdToken(t, verifyOptions)).reason ?? 'ok';

{
  const v = await verifyFirebaseIdToken(await idToken(), verifyOptions);
  ok(v.ok && v.uid === 'uid-alice' && v.emailVerified, 'a valid token verifies, giving uid and verified email');
  ok(await reason(await idToken({}, { key: impostor.privateKey })) === 'bad-signature', 'signed by another key: refused');
  ok(await reason(await idToken({ aud: 'some-other-project' })) === 'wrong-audience', 'another project’s token: refused');
  ok(await reason(await idToken({ iss: 'https://securetoken.google.com/some-other-project' })) === 'wrong-issuer', 'wrong issuer: refused');
  ok(await reason(await idToken({ exp: now - 1 })) === 'expired', 'expired: refused');
  ok(await reason(await idToken({ iat: now + 3600 })) === 'issued-in-future', 'issued in the future: refused');
  ok(await reason(await idToken({ sub: '' })) === 'no-subject', 'no subject: refused');
  ok(await reason(await idToken({}, { header: { kid: 'not-published' } })) === 'unknown-kid', 'a key id Google does not publish: refused');
  ok(await reason(await idToken({}, { header: { alg: 'none' } })) === 'bad-header', 'alg none: refused before any key is used');
  ok(await reason(await idToken({}, { header: { alg: 'HS256' } })) === 'bad-header', 'alg HS256: refused');
  const t = await idToken();
  const [h, , s] = t.split('.');
  const forged = `${h}.${b64url(enc.encode(JSON.stringify({ ...JSON.parse(Buffer.from(t.split('.')[1], 'base64url')), sub: 'uid-mallory' })))}.${s}`;
  ok(await reason(forged) === 'bad-signature', 'a genuine signature over altered claims: refused');
  ok(await reason('not.a.token!') === 'malformed-token', 'garbage: refused');
  ok((await verifyFirebaseIdToken(await idToken(), { ...verifyOptions, getKeys: async () => { throw new Error('offline'); } })).reason === 'keys-unavailable', 'Google’s keys unreachable: refused, not waved through');
}

// ---------------------------------------------------------------- entitlement endpoint

console.log('\n— entitlement');
{
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const otherPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
  const publicKey = await importPublicKey(await crypto.subtle.exportKey('jwk', pair.publicKey));
  const otherPublic = await importPublicKey(await crypto.subtle.exportKey('jwk', otherPair.publicKey));

  const db = d1();
  await deliver(db, completed('2026-09-13T10:00:00Z'));
  const env = { PDFIQ_SALE: 'true', PURCHASES: db, PDFIQ_ENTITLEMENT_PRIVATE_KEY: privateJwk, PDFIQ_PADDLE_ENV: 'sandbox' };
  const ask = async (token, e = env, method = 'GET') => {
    const res = await entitlement({
      request: new Request('https://preview.example/api/entitlement', { method, headers: token ? { Authorization: `Bearer ${token}` } : {} }),
      env: e,
    }, { verifyOptions });
    return { status: res.status, body: await res.json() };
  };

  let r = await ask(await idToken());
  ok(r.status === 200 && r.body.pro === true && typeof r.body.token === 'string', 'the buyer gets pro: true and a token');
  const v = await verifyEntitlement(r.body.token, publicKey, { uid: 'uid-alice', env: 'sandbox' });
  ok(v.ok && v.claims.txn === TXN, 'the token verifies offline with the public key, for that uid, and names the purchase');
  ok((await verifyEntitlement(r.body.token, publicKey, { uid: 'uid-mallory', env: 'sandbox' })).reason === 'different-account', 'someone else’s session cannot use it');
  ok((await verifyEntitlement(r.body.token, publicKey, { uid: 'uid-alice', env: 'production' })).reason === 'wrong-environment', 'a sandbox token does not unlock a production build');
  ok((await verifyEntitlement(r.body.token, otherPublic, { uid: 'uid-alice', env: 'sandbox' })).reason === 'bad-signature', 'nor verifies under another key pair');
  const [payload, sig] = r.body.token.split('.');
  const altered = b64url(enc.encode(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), uid: 'uid-mallory' })));
  ok((await verifyEntitlement(`${altered}.${sig}`, publicKey, { uid: 'uid-mallory', env: 'sandbox' })).reason === 'bad-signature', 'editing the uid inside the token breaks it');

  r = await ask(await idToken({ sub: 'uid-bob', email: 'bob@example.com' }));
  ok(r.status === 200 && r.body.pro === false && r.body.revoked === false && !r.body.token, 'someone who never bought gets pro: false and no token');

  r = await ask(await idToken({ sub: 'uid-alice-new' }));
  ok(r.body.pro === true && rows(db)[0].uid === 'uid-alice-new', 'a re-created account with the same verified email keeps Pro, and the purchase moves to the new uid');
  r = await ask(await idToken({ sub: 'uid-eve', email: 'alice@example.com', email_verified: false }));
  ok(r.body.pro === false && rows(db)[0].uid === 'uid-alice-new', 'an unverified email claiming the same address gets nothing and moves nothing');

  await deliver(db, adjustment('adjustment.updated', { action: 'refund', type: 'full', status: 'approved' }, '2026-09-14T10:00:00Z'));
  r = await ask(await idToken({ sub: 'uid-alice-new' }));
  ok(r.body.pro === false && r.body.revoked === true, 'after a full refund: pro false, revoked true, so the browser removes its token');

  ok((await ask(null)).status === 401, 'no Authorization header: 401');
  ok((await ask(await idToken({ exp: now - 1 }))).status === 401, 'an expired ID token: 401');
  ok((await ask(await idToken(), { ...env, PDFIQ_SALE: 'false' })).status === 404, 'PDFIQ_SALE not "true": does not exist');
  ok((await ask(await idToken(), { ...env, PDFIQ_PADDLE_ENV: 'live' })).status === 503, 'an environment that is neither sandbox nor production: refuses');
  ok((await ask(await idToken(), env, 'POST')).status === 405, 'POST: refused');
}

// ---------------------------------------------------------------- the project id is the sign-in's

{
  const authConfig = readFileSync(join(ROOT, 'tools/auth-config.mjs'), 'utf8');
  ok(authConfig.includes(`project ${FIREBASE_PROJECT_ID}`), `server/firebase-token.js checks tokens for ${FIREBASE_PROJECT_ID}, the project tools/auth-config.mjs names`);
}

console.log(fails ? `\n${fails} FAILED` : '\nthe purchase path verifies what it is sent and records only what it should');
process.exit(fails ? 1 : 0);
