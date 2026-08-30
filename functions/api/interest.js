/**
 * Registering interest in professional access.
 *
 * This is the only endpoint on the site, and the only thing anywhere that receives data
 * from a visitor. Everything about it is shaped by that.
 *
 * Same origin, deliberately. The site's Content-Security-Policy is `connect-src 'self'`,
 * so a hosted form service — Formspree, Google Forms, Tally — is blocked by the browser
 * before it is blocked by judgement. Using one would mean widening the CSP on every page
 * of the site and putting a third party in the path of the one thing that ever leaves a
 * visitor's device. The footer readout would also have to report a third-party request on
 * the one page where it matters most.
 *
 * No Turnstile for the same reason: it loads challenges.cloudflare.com, which is a
 * third-party script and a third-party request. Abuse is handled here instead — a honeypot,
 * length caps, and a unique index that makes a repeat submission an update rather than a
 * row — with a WAF rate-limit rule at the edge.
 *
 * We are handed CF-Connecting-IP on every request. It is deliberately not written down.
 * Three columns are stored: the address, what the person does, and when. That is the whole
 * record, and /privacy says so in the same terms.
 */

const MAX_EMAIL = 254; // RFC 5321
const MAX_PROFESSION = 200;
// Longer, deliberately: this is the answer the page exists to collect and the one nobody
// should feel clipped writing. Both fields are free text — a dropdown only ever returns
// the answers we already thought of, and learning the ones we did not is the whole point.
const MAX_SPENDS_TOO_LONG = 1200;
const MAX_CADENCE = 200;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Nothing here is cacheable and nothing here is cross-origin.
      'cache-control': 'no-store',
      // _headers does not apply to Function responses, so the ones that matter here are
      // set explicitly. Measured: the live API response carried no nosniff at all.
      'x-content-type-options': 'nosniff',
    },
  });

/** Deliberately permissive. Rejecting valid addresses is worse than accepting a typo. */
const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

export async function onRequest(context) {
  const { request, env } = context;

  // One handler rather than onRequest plus onRequestPost: exporting both leaves which one
  // wins up to the platform, and a router nobody can predict is not worth the brevity.
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'method-not-allowed' }, 405);
  }

  // Cross-site submissions.
  //
  // Measured before this existed: a POST with Content-Type: text/plain and
  // Origin: https://evil.example was accepted and wrote a row. That is a simple request,
  // so the browser never sends a preflight and the absence of CORS headers never gets a
  // chance to refuse it. The honeypot does not help — an attacker writes the body.
  //
  // The harm is not theft, it is poisoning: this table exists to be read as a signal
  // about which professions turn up, and junk rows destroy exactly that.
  //
  // Two guards. Requiring JSON forces a preflight for any cross-origin caller, which then
  // fails because nothing here answers OPTIONS with CORS headers. And an Origin that is
  // present but foreign is refused outright. Origin is compared against the request URL
  // rather than a hard-coded host so preview deployments work unchanged; a caller with no
  // Origin at all is a non-browser client, which is not the vector being closed.
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) {
    return json({ ok: false, error: 'cross-origin' }, 403);
  }
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) {
    return json({ ok: false, error: 'bad-content-type' }, 415);
  }

  if (!env.DB) {
    // Fail loudly rather than accepting the address and dropping it. A button that thanks
    // you and discards what you typed is the exact failure this project keeps removing.
    return json({ ok: false, error: 'not-configured' }, 503);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'bad-request' }, 400);
  }

  // The honeypot is hidden from people and invisible to assistive technology; anything
  // that fills it in is not a person. Answer as though it worked.
  if (typeof payload.company === 'string' && payload.company.trim() !== '') {
    return json({ ok: true, recorded: false });
  }

  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  const profession = typeof payload.profession === 'string' ? payload.profession.trim() : '';
  const spendsTooLong = typeof payload.spendsTooLong === 'string' ? payload.spendsTooLong.trim() : '';
  const cadence = typeof payload.cadence === 'string' ? payload.cadence.trim() : '';

  if (!looksLikeEmail(email) || email.length > MAX_EMAIL) {
    return json({ ok: false, error: 'bad-email' }, 400);
  }
  if (!profession || profession.length > MAX_PROFESSION) {
    return json({ ok: false, error: 'bad-profession' }, 400);
  }
  // Not required. A demand test wants the contact; this is the part that teaches us
  // something, and losing the whole submission because someone had nothing to add would
  // trade the lead away for the lesson.
  if (spendsTooLong.length > MAX_SPENDS_TOO_LONG) {
    return json({ ok: false, error: 'bad-spends-too-long' }, 400);
  }
  if (cadence.length > MAX_CADENCE) {
    return json({ ok: false, error: 'bad-cadence' }, 400);
  }

  try {
    // A second submission from the same address updates what they do rather than adding a
    // row, so the count means distinct people.
    await env.DB.prepare(
      'INSERT INTO interest (email, profession, spends_too_long, cadence_expected, at) VALUES (?, ?, ?, ?, ?)\n' +
      'ON CONFLICT(email) DO UPDATE SET profession = excluded.profession, ' +
      'spends_too_long = excluded.spends_too_long, cadence_expected = excluded.cadence_expected, ' +
      'at = excluded.at'
    )
      .bind(email.toLowerCase(), profession, spendsTooLong || null, cadence || null, new Date().toISOString())
      .run();
  } catch (err) {
    return json({ ok: false, error: 'store-failed', detail: String(err && err.message).slice(0, 200) }, 500);
  }

  return json({ ok: true, recorded: true });
}

