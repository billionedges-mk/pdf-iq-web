/**
 * Build-time constants, replaced by esbuild's `define` in tools/build.mjs.
 *
 * __PDFIQ_PRO__ is true only in a build made with PDFIQ_PRO set, which a production build
 * refuses. Branch on it only to reach code under src/pro/ through a dynamic import, so that a
 * flag-off build drops the branch and the chunk with it. Branching on it to hide or grey out
 * something that is still shipped defeats the point: absent, not hidden.
 */
declare const __PDFIQ_PRO__: boolean;

/**
 * True only in a Pro build served from a developer machine (`npm run dev` with PDFIQ_PRO set, or
 * PDFIQ_LOCAL=1 locally). It gates the local sign-in stub in src/pro/gate.ts, which exists because
 * a local build has no Firebase key and therefore no way to reach a Pro feature at all.
 *
 * A Cloudflare build that asks for it refuses; every deployed build defines it false, so the stub
 * and its storage key are dropped from the bundle. Never branch on it for anything else.
 */
declare const __PDFIQ_LOCAL__: boolean;

/**
 * The checkout configuration: true / non-empty only in a build that is selling (tools/paddle-config.mjs).
 * Read only from src/pro/buy.ts. Separate string constants rather than one object, because esbuild
 * hoists an object-valued define into a chunk shared by every page, and a purchase path belongs on
 * one page. The token is Paddle's client-side token, public by design.
 */
declare const __PDFIQ_SALE__: boolean;
declare const __PDFIQ_PADDLE_ENV__: string;
/** The checkout origin /pro/buy/ frames and talks to (tools/paddle-config.mjs). Empty when not selling. */
declare const __PDFIQ_CHECKOUT_ORIGIN__: string;
/** The Pro price as site.mjs states it (PRO.price), for the Unlock button. One source, not a second literal. */
declare const __PDFIQ_PRO_PRICE__: string;
/**
 * tools/pro-copy.mjs's `what` and `instead` per feature key, as a JSON string (Pro builds; '{}' otherwise), for the
 * locked controls. One source: the /pro/ page and the locked controls say the same sentences.
 */
declare const __PDFIQ_PRO_COPY__: string;

/** Checkout build only (tools/build-checkout.mjs): the Paddle configuration and the one origin it answers. */
declare const __CHECKOUT_PADDLE_ENV__: string;
declare const __CHECKOUT_PADDLE_TOKEN__: string;
declare const __CHECKOUT_PADDLE_PRICE__: string;
declare const __CHECKOUT_PADDLE_SCRIPT__: string;
declare const __CHECKOUT_SITE_ORIGIN__: string;
