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
