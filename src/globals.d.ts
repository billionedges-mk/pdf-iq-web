/**
 * Build-time constants, replaced by esbuild's `define` in tools/build.mjs.
 *
 * __PDFIQ_PRO__ is true only in a build made with PDFIQ_PRO set, which a production build
 * refuses. Branch on it only to reach code under src/pro/ through a dynamic import, so that a
 * flag-off build drops the branch and the chunk with it. Branching on it to hide or grey out
 * something that is still shipped defeats the point: absent, not hidden.
 */
declare const __PDFIQ_PRO__: boolean;
