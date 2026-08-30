/**
 * The interest endpoint, driven directly.
 *
 * It is plain ESM with no Cloudflare imports, so it can be called here with a stub binding
 * instead of needing wrangler or a deployment. The point is the things that are easy to get
 * wrong and impossible to see from the outside: that a rejected submission really is not
 * written, that a missing binding fails loudly instead of silently accepting an address,
 * and that the IP we are handed never reaches the database.
 */

import { onRequest } from '../functions/api/interest.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const ok = (cond, message) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!cond) failures++;
};

/** A stub D1 that records what it was asked to write. */
function stubDb() {
  const writes = [];
  return {
    writes,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              writes.push({ sql, values });
              return { success: true };
            },
          };
        },
      };
    },
  };
}

const post = (body, env, headers = {}) =>
  onRequest({
    request: new Request('https://pdf-iq.com/api/interest', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Cloudflare hands this to every request. Nothing may do anything with it.
        'CF-Connecting-IP': '203.0.113.42',
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
  });

console.log('interest endpoint');

// A good submission.
{
  const db = stubDb();
  const res = await post(
    {
      email: 'A.Person@Example.COM',
      profession: 'solicitor',
      spendsTooLong: 'redacting client names by hand',
      cadence: 'once — it is a tool',
    },
    { DB: db }
  );
  const json = await res.json();
  ok(res.status === 200 && json.ok === true, 'a valid submission is accepted');
  ok(db.writes.length === 1, 'and is written exactly once');
  const [write] = db.writes;
  ok(write.values.length === 5, `five values are bound, not more (got ${write.values.length})`);
  ok(write.values[0] === 'a.person@example.com', 'the address is stored lowercased, so it is one person');
  ok(write.values[1] === 'solicitor', 'the profession is stored verbatim');
  ok(write.values[2] === 'redacting client names by hand', 'the free text is stored verbatim, not categorised');
  ok(write.values[3] === 'once — it is a tool', 'the cadence answer is stored verbatim too, not mapped to a choice');
  ok(!Number.isNaN(Date.parse(write.values[4])), 'the last value is a timestamp');
  ok(
    !JSON.stringify(write.values).includes('203.0.113.42'),
    'the IP address we were handed is not among them'
  );
  ok(/ON CONFLICT\(email\) DO UPDATE/.test(write.sql), 'a repeat from the same address updates rather than duplicates');
}

// The third field is optional, and an absent one is stored as NULL rather than an empty
// string: nobody who was never asked should look like they had nothing to say.
{
  const db = stubDb();
  const res = await post({ email: 'b@c.co', profession: 'architect' }, { DB: db });
  ok(res.status === 200, 'a submission without the third field is still accepted');
  ok(db.writes[0].values[2] === null, 'and the missing answer is stored as NULL, not an empty string');
  ok(db.writes[0].values[3] === null, 'as is a missing cadence answer');
}

// Too long is refused rather than silently truncated.
{
  const db = stubDb();
  const res = await post(
    { email: 'a@b.co', profession: 'solicitor', spendsTooLong: 'x'.repeat(2000) },
    { DB: db }
  );
  const json = await res.json();
  ok(res.status === 400 && json.error === 'bad-spends-too-long', 'an over-long answer is refused');
  ok(db.writes.length === 0, 'and nothing is written');
}

// The binding is missing — the case that will be true until D1 is bound.
{
  const res = await post({ email: 'a@b.co', profession: 'architect' }, {});
  const json = await res.json();
  ok(res.status === 503 && json.error === 'not-configured', 'a missing database fails loudly');
  ok(json.ok !== true, 'and never reports success for an address it did not store');
}

// Rejections must not write.
for (const [label, body] of [
  ['an address that is not one', { email: 'not-an-email', profession: 'solicitor' }],
  ['an empty address', { email: '   ', profession: 'solicitor' }],
  ['an empty profession', { email: 'a@b.co', profession: '   ' }],
  ['an over-long address', { email: 'x'.repeat(250) + '@b.co', profession: 'solicitor' }],
  ['an over-long profession', { email: 'a@b.co', profession: 'x'.repeat(500) }],
]) {
  const db = stubDb();
  const res = await post(body, { DB: db });
  ok(res.status === 400 && db.writes.length === 0, `${label} is refused and nothing is written`);
}

// Cross-site submission. Measured against the live endpoint before the guard existed: a
// text/plain POST from a foreign Origin was accepted and wrote a row.
{
  const db = stubDb();
  const res = await onRequest({
    request: new Request('https://pdf-iq.com/api/interest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ email: 'a@b.co', profession: 'x' }),
    }),
    env: { DB: db },
  });
  const json = await res.json();
  ok(res.status === 403 && json.error === 'cross-origin', 'a foreign Origin is refused');
  ok(db.writes.length === 0, 'and writes nothing');
}

// A simple request — the shape that skips the preflight entirely.
{
  const db = stubDb();
  const res = await onRequest({
    request: new Request('https://pdf-iq.com/api/interest', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ email: 'a@b.co', profession: 'x' }),
    }),
    env: { DB: db },
  });
  const json = await res.json();
  ok(res.status === 415 && json.error === 'bad-content-type', 'a non-JSON content type is refused');
  ok(db.writes.length === 0, 'and writes nothing');
}

// Our own page must still work, and so must a preview deployment on another host.
for (const [label, url, origin] of [
  ['the production origin', 'https://pdf-iq.com/api/interest', 'https://pdf-iq.com'],
  ['a preview deployment', 'https://abc.pdf-iq-web.pages.dev/api/interest', 'https://abc.pdf-iq-web.pages.dev'],
]) {
  const db = stubDb();
  const res = await onRequest({
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: 'a@b.co', profession: 'x' }),
    }),
    env: { DB: db },
  });
  ok(res.status === 200 && db.writes.length === 1, `${label} still works`);
}

// Every response carries nosniff: _headers does not reach Function responses.
{
  const res = await post({ email: 'a@b.co', profession: 'x' }, { DB: stubDb() });
  ok(res.headers.get('x-content-type-options') === 'nosniff', 'responses carry nosniff');
}

// The honeypot answers like success and writes nothing.
{
  const db = stubDb();
  const res = await post({ email: 'a@b.co', profession: 'solicitor', company: 'Acme' }, { DB: db });
  const json = await res.json();
  ok(res.status === 200 && json.ok === true, 'the honeypot looks like success');
  ok(json.recorded === false, 'but says it recorded nothing');
  ok(db.writes.length === 0, 'and writes nothing');
}

// Anything that is not a POST.
{
  const res = await onRequest({
    request: new Request('https://pdf-iq.com/api/interest', { method: 'GET' }),
    env: { DB: stubDb() },
  });
  ok(res.status === 405, 'a GET is refused rather than falling through to the 404 page');
}

// Malformed body.
{
  const db = stubDb();
  const res = await post('{not json', { DB: db });
  ok(res.status === 400 && db.writes.length === 0, 'a body that is not JSON is refused and writes nothing');
}

// A write that throws must be reported as a failure, never as success.
{
  const env = {
    DB: {
      prepare: () => ({ bind: () => ({ run: async () => { throw new Error('D1_ERROR: no such table'); } }) }),
    },
  };
  const res = await post({ email: 'a@b.co', profession: 'solicitor' }, env);
  const json = await res.json();
  ok(res.status === 500 && json.ok !== true, 'a failed write is reported as a failure');
  ok(/no such table/.test(json.detail ?? ''), 'and says what the store actually complained about');
}

// The schema must match what /privacy says is stored: three columns, and no IP.
{
  const schema = readFileSync(join(ROOT, 'functions/schema.sql'), 'utf8');
  const columns = [...schema.matchAll(/^\s{2}(\w+)\s+TEXT/gm)].map((m) => m[1]);
  console.log(`      schema columns: ${columns.join(', ')}`);
  ok(columns.length === 5, `the table has five columns (got ${columns.length})`);
  ok(columns.includes('spends_too_long'), 'including the free-text answer');
  ok(columns.includes('cadence_expected'), 'and the once-or-yearly answer');
  ok(!/ip|address|agent|referer/i.test(columns.join(' ')), 'and none of them is an IP or a user agent');
}

console.log();
console.log(failures === 0 ? 'interest endpoint: all green' : `${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
