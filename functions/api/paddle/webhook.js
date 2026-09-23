/**
 * POST /api/paddle/webhook — Paddle telling us a Pro purchase happened, or was refunded.
 *
 * The caller is Paddle's server, not a browser; nothing on the site links here and no page sends
 * anything to it. Subscribed events: transaction.completed, adjustment.created, adjustment.updated.
 *
 * Proof of sender is the signature alone (server/paddle.js). An IP allowlist was considered and
 * not used: Paddle publishes different sets for sandbox and live, a copied list goes stale, and a
 * valid HMAC over the raw body inside five seconds already proves who sent it.
 *
 * Paddle wants a 200 within five seconds and retries failures for three days, so this does one
 * short D1 read and at most one write, and answers 200 for anything that verified — including
 * events that mean nothing to Pro. A non-2xx is reserved for "try again": a bad signature (so a
 * misconfigured secret shows up as failed deliveries in Paddle's dashboard rather than silently
 * dropped purchases) and a storage failure.
 *
 * Refuses with 404 unless PDFIQ_SALE is "true" in this deployment's environment. Production keeps
 * it false until the sale is deliberately switched on — and with the same 404 on any deployment that is not the site,
 * because Pages serves this file from the checkout project too (server/origin.js).
 */
import { verifyPaddleSignature, decide, applyDecision } from '../../../server/paddle.js';
import { notThisOrigin } from '../../../server/origin.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });

export async function onRequest(context) {
  const { request, env } = context;

  // Not the site's deployment: this endpoint is not ours to answer. First, so that a checkout deployment with the sale
  // flag set never looks like a working webhook — it would take a POST and write nowhere (server/origin.js).
  if (notThisOrigin(request, env)) return json({ error: 'not-found' }, 404);

  if (env.PDFIQ_SALE !== 'true') return json({ error: 'not-found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  if (!env.PURCHASES || !env.PADDLE_WEBHOOK_SECRET || !env.PDFIQ_PADDLE_PRICE_ID) {
    // Loud, and retried by Paddle: a purchase must never be acknowledged into a void.
    return json({ error: 'not-configured' }, 503);
  }

  // The exact bytes received. Parsing first and re-serialising would break the signature.
  const raw = await request.text();
  const check = await verifyPaddleSignature(raw, request.headers.get('Paddle-Signature'), env.PADDLE_WEBHOOK_SECRET);
  if (!check.ok) {
    console.warn(JSON.stringify({ event: 'paddle-webhook-rejected', reason: check.reason }));
    return json({ error: 'unauthorized' }, 401);
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ applied: false, reason: 'unparseable' });
  }

  const decision = decide(event, env.PDFIQ_PADDLE_PRICE_ID);
  try {
    const result = await applyDecision(env.PURCHASES, decision, String(event.event_id ?? ''));
    // Logged without uid or email: which purchase and what happened is enough to debug, and the
    // log is not a second copy of the table.
    // The adjustment's own fields go in the line: when a refund changes nothing, the reason alone does not say which
    // of action, status and type it was read from, and that is the question a silent non-revocation asks (CLAIMS 49).
    const adj = /^adjustment\./.test(String(event.event_type)) && event.data && typeof event.data === 'object'
      ? {
          action: event.data.action ?? null, status: event.data.status ?? null, refundType: event.data.type ?? null,
          // The adjustment's "type" and its items' "type" disagree by design; the decision reads the items, so the log
          // shows both rather than the one that happens to be at the top.
          itemTypes: Array.isArray(event.data.items) ? event.data.items.map((i) => i?.type ?? null) : null,
        }
      : null;
    console.info(JSON.stringify({
      event: 'paddle-webhook', type: event.event_type ?? null,
      transaction: decision.transactionId ?? null, ...(adj ?? {}), ...result,
    }));
    return json(result);
  } catch (err) {
    console.error(JSON.stringify({ event: 'paddle-webhook-store-failed', message: String(err?.message).slice(0, 200) }));
    return json({ error: 'store-failed' }, 500);
  }
}
