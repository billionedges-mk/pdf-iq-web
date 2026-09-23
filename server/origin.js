/**
 * Whether the endpoints under /api/ belong to the deployment answering this request.
 *
 * Both Cloudflare Pages projects build from this repo, and Pages deploys `functions/` with each of them. So
 * `pdf-iq-checkout` serves `/api/entitlement` and `/api/paddle/webhook` too — which nobody reading that project would
 * expect, because nothing in it mentions them. Measured on 23 September 2026, before the sale was switched on:
 * `pro-sale.pdf-iq-checkout.pages.dev/api/entitlement` answered **503 not-configured** and `/api/paddle/webhook`
 * answered **405 method-not-allowed**, both already past the PDFIQ_SALE gate on that project's Preview.
 *
 * The moment `PDFIQ_SALE=true` is set on the checkout project's Production, `checkout.pdf-iq.com/api/paddle/webhook`
 * becomes a second live webhook endpoint with no PURCHASES binding and no signing secret: it accepts a POST and writes
 * nowhere. Nothing points at it today. The risk is the obvious future mistake — someone repointing Paddle at
 * "checkout.pdf-iq.com" because that is what the checkout is called, and payments landing on an endpoint with no
 * database (owner, 23 September 2026).
 *
 * ### The signal already exists
 *
 * `PDFIQ_SITE_ORIGIN` names the site to a deployment that is NOT the site: the checkout build uses it to decide who may
 * frame it, and pdf-iq-web never sets it. So a deployment that declares a site origin other than its own is not the
 * site, and these endpoints are not its to serve.
 *
 * It is written as a comparison rather than as "the variable is present" on purpose. If PDFIQ_SITE_ORIGIN were ever set
 * on pdf-iq-web by mistake, presence alone would silently 404 the real webhook — a misconfiguration disabling the thing
 * that grants Pro, which is worse than the problem being fixed. Compared against the request's own origin it cannot:
 * on the site the two agree and everything serves.
 *
 * The answer is 404 with the same body as the PDFIQ_SALE refusal, so the two are indistinguishable from outside. Where
 * an endpoint lives is not something an unauthenticated caller needs to learn.
 */
export function notThisOrigin(request, env) {
  const declared = String(env?.PDFIQ_SITE_ORIGIN ?? '').trim().replace(/\/+$/, '');
  if (!declared) return false;
  let here = '';
  try { here = new URL(request.url).origin; } catch { return false; }
  return here !== declared;
}
