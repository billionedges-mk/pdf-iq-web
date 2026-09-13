/**
 * Send signed test events to a sandbox webhook: a Pro purchase, the same delivery again, and a full
 * refund, so the grant, duplicate and revoke paths write to D1 for real.
 *
 *   PADDLE_WEBHOOK_SECRET='pdl_ntfset_…' npm run paddle:test-events
 *   PADDLE_WEBHOOK_SECRET='pdl_ntfset_…' npm run paddle:test-events -- --url https://<branch>.pdf-iq-web.pages.dev
 *
 * Run it in your own terminal. The secret is read from the environment and used only to sign; it is
 * never printed. Paste it into the command, not into a chat.
 *
 * Why this exists alongside Paddle's simulator: the simulator proved Paddle's payload shapes reach
 * the handler, but its sample data carries Paddle's own test price, so nothing it sends can grant
 * Pro, and editing its JSON by hand is error-prone. These events follow the shapes the simulator
 * already delivered, carry our sandbox price, and are signed exactly as Paddle signs.
 *
 * It refuses any URL that is not a *.pages.dev preview. It cannot be pointed at pdf-iq.com.
 */

const SANDBOX_PRICE = 'pri_01m2cv2xegy64zmhtxrbk0b1bf';
const args = process.argv.slice(2);
const at = args.indexOf('--url');
const base = (at >= 0 ? args[at + 1] : 'https://pro-sale.pdf-iq-web.pages.dev').replace(/\/+$/, '');
const secret = process.env.PADDLE_WEBHOOK_SECRET ?? '';

if (!/^https:\/\/[a-z0-9-]+\.pdf-iq-web\.pages\.dev$/.test(base)) {
  console.error(`Refusing ${base}: only a *.pdf-iq-web.pages.dev preview can receive test events.`);
  process.exit(1);
}
if (!secret.startsWith('pdl_ntfset_')) {
  console.error('Set PADDLE_WEBHOOK_SECRET to the sandbox destination’s secret (it starts pdl_ntfset_).');
  process.exit(1);
}

const enc = new TextEncoder();
const id = (prefix) => `${prefix}_${[...crypto.getRandomValues(new Uint8Array(13))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 26)}`;
const txn = id('txn');
const t0 = Date.now();
const iso = (offsetSeconds) => new Date(t0 + offsetSeconds * 1000).toISOString();

async function send(label, event, expect) {
  const body = JSON.stringify(event);
  const ts = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = Buffer.from(await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}:${body}`))).toString('hex');
  const res = await fetch(`${base}/api/paddle/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Paddle-Signature': `ts=${ts};h1=${mac}` },
    body,
  });
  const text = await res.text();
  const matched = res.status === 200 && expect.test(text);
  console.log(`${matched ? 'as expected' : 'UNEXPECTED '}  ${label.padEnd(34)} ${res.status} ${text}`);
  return matched;
}

const purchase = {
  event_id: id('evt'),
  event_type: 'transaction.completed',
  occurred_at: iso(0),
  notification_id: id('ntf'),
  data: {
    id: txn,
    status: 'completed',
    custom_data: { uid: 'sim-test', email: 'sim@test.invalid' },
    items: [{ price: { id: SANDBOX_PRICE }, quantity: 1 }],
  },
};
const refund = {
  event_id: id('evt'),
  event_type: 'adjustment.updated',
  occurred_at: iso(60),
  notification_id: id('ntf'),
  data: { id: id('adj'), transaction_id: txn, action: 'refund', type: 'full', status: 'approved', customer_id: id('ctm') },
};

console.log(`\nSending to ${base}/api/paddle/webhook — transaction ${txn}\n`);
const results = [
  await send('1. purchase (our price, sim-test)', purchase, /"applied":\s*true.*"granted-new"/),
  await send('2. the same delivery again', purchase, /"applied":\s*false.*"duplicate-event"/),
  await send('3. approved full refund', refund, /"applied":\s*true.*"revoked"/),
];

console.log(`\nIn the D1 console, the row should now read uid 'sim-test', status 'revoked':`);
console.log(`  SELECT * FROM purchases WHERE transaction_id = '${txn}';`);
// By transaction, not uid: if the purchase was refused (a wrong price, say) the refund still writes
// an unbound row, and a delete by uid would leave it behind.
console.log('Then remove it:');
console.log(`  DELETE FROM purchases WHERE transaction_id = '${txn}';\n`);
process.exit(results.every(Boolean) ? 0 : 1);
