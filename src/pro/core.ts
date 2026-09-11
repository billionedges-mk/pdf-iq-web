/**
 * The Pro root. Present in a build made with PDFIQ_PRO set, and absent — not greyed, not
 * stubbed, absent — from every other build.
 *
 * Why the flag is a build constant rather than a runtime setting: the JavaScript this site
 * ships is its source. A runtime flag would leave Pro code in every visitor's download,
 * readable, and switchable from the browser console. The Android app hit the same problem —
 * a runtime flag cannot keep code out of an artefact the compiler has already seen — and
 * answered it with a source-set split. This is the web's version: free code reaches Pro only
 * through `if (__PDFIQ_PRO__) await import('../pro/…')`, the build replaces the constant with
 * `false`, and esbuild drops the branch and never writes the chunk. tools/build.mjs checks its
 * own output for the sentinel below after every build, and fails if one leaks.
 *
 * The sentinel convention: every module under src/pro/ exports a string beginning
 * `pdfiq-pro:` and uses it at runtime, so minification keeps it and the check can see it.
 */
export const PRO_SENTINEL = 'pdfiq-pro:core';

/** Marks the document, so a preview build can be identified from the page itself. */
export function markPreview(): void {
  document.documentElement.dataset.pdfiqPro = PRO_SENTINEL;
}
