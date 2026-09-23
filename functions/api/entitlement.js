/**
 * GET /api/entitlement — does the signed-in person own Pro? If so, a signed token the browser
 * keeps and checks offline (server/entitlement.js explains the token).
 *
 * Called from /account/ and /pro/buy/ only, in a Pro build, with the Firebase ID token in
 * `Authorization: Bearer …`. Tool pages never call it: they verify the stored token locally and
 * send nothing, which is what /privacy says of them.
 *
 * Same-origin by construction. The Authorization header makes any cross-origin browser request
 * preflight, and nothing here answers OPTIONS with CORS headers, so another site's page cannot
 * read the answer. The Android app is not a browser and calls it directly with its own ID token.
 *
 * Refuses with 404 unless PDFIQ_SALE is "true" in this deployment's environment.
 */
import { verifyFirebaseIdToken } from '../../server/firebase-token.js';
import { findEntitlement, importPrivateKey, signEntitlement } from '../../server/entitlement.js';
import { notThisOrigin } from '../../server/origin.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });

export async function onRequest(context, deps = {}) {
  const { request, env } = context;

  // Not the site's deployment (server/origin.js): Pages serves this file from the checkout project as well, where it
  // has no database and no signing key, and answered 503 "not-configured" rather than saying it does not belong there.
  if (notThisOrigin(request, env)) return json({ error: 'not-found' }, 404);
  if (env.PDFIQ_SALE !== 'true') return json({ error: 'not-found' }, 404);
  if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
  if (!env.PURCHASES || !env.PDFIQ_ENTITLEMENT_PRIVATE_KEY || !['sandbox', 'production'].includes(env.PDFIQ_PADDLE_ENV)) {
    return json({ error: 'not-configured' }, 503);
  }

  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const who = await verifyFirebaseIdToken(token, deps.verifyOptions);
  if (!who.ok) return json({ error: 'unauthorized', reason: who.reason }, 401);

  let found;
  try {
    found = await findEntitlement(env.PURCHASES, who);
  } catch (err) {
    console.error(JSON.stringify({ event: 'entitlement-read-failed', message: String(err?.message).slice(0, 200) }));
    return json({ error: 'store-failed' }, 500);
  }

  if (!found.pro) return json({ pro: false, revoked: found.revoked });

  const key = await importPrivateKey(env.PDFIQ_ENTITLEMENT_PRIVATE_KEY);
  const signed = await signEntitlement(
    { uid: who.uid, txn: found.txn, env: env.PDFIQ_PADDLE_ENV, iat: Math.floor(Date.now() / 1000) },
    key,
  );
  return json({ pro: true, token: signed });
}
