/**
 * Every class a page renders or the code sets must be defined by a stylesheet.
 *
 * Written after finding that a class which does not exist fails silently. /ocr/ labelled its
 * text box `sr-only`; the stylesheet only has `visually-hidden`. Nothing broke: the label simply
 * rendered, visible, above the box, on production. The same scan then found the legal pages
 * (`prose`, `prose__updated`) and the 404, for-professionals and memory-probe headings
 * (`page__title`, `page__lede`, typed for `page-title` and `page-lede`) had never been styled
 * since the first commit. Every one of those pages looked finished to the eye that wrote it.
 *
 * verify-state-styles.mjs asks the opposite question (a rule must target something that
 * exists). This one asks whether a class that is used has any rule at all.
 *
 * Definitions come from src/styles/*.css and any inline <style> in the scanned sources (the
 * checkout frame carries its own). A class used only as a script hook belongs on a data-
 * attribute in this codebase, so there is no allowlist; add one here, with a reason, if that
 * ever has to change.
 *
 * What it cannot see: a class defined only inside a descendant rule counts as defined. That is how
 * `page__title` passed this check before the rename (`.askgrid__pitch .page__title` gives it a
 * margin on one page, and nothing on the 404).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, test, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, test, out);
    else if (test(p)) out.push(p);
  }
  return out;
}

const sources = [
  ...walk(join(ROOT, 'src'), (p) => /\.(html|ts)$/.test(p)),
  ...walk(join(ROOT, 'tools'), (p) => /\.mjs$/.test(p) && !/[\\/](verify-|fixtures[\\/])/.test(p) && !p.endsWith('verify-classes.mjs')),
];
const cssFiles = walk(join(ROOT, 'src/styles'), (p) => p.endsWith('.css'));

const defined = new Set();
const define = (css) => {
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(m[1]);
};
for (const f of cssFiles) define(readFileSync(f, 'utf8'));

const used = new Map();
const note = (list, where) => {
  for (const c of list.split(/\s+/)) {
    if (!/^-?[_a-zA-Z][\w-]*$/.test(c)) continue; // part of a template expression, not a class name
    if (!used.has(c)) used.set(c, new Set());
    used.get(c).add(where);
  }
};

for (const f of sources) {
  const s = readFileSync(f, 'utf8');
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  for (const m of s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) define(m[1]);
  for (const m of s.matchAll(/class="([^"]*)"/g)) note(m[1], rel);
  if (f.endsWith('.ts')) {
    for (const m of s.matchAll(/className\s*=\s*'([^']+)'/g)) note(m[1], rel);
    for (const m of s.matchAll(/classList\.(?:add|toggle|remove|contains)\(([^)]*)\)/g)) {
      for (const a of m[1].matchAll(/'([^']+)'/g)) note(a[1], rel);
    }
  }
}

/**
 * Two components wearing one class name.
 *
 * A class can be defined and still be wrong: .facts was a <dl> grid, a new table took the same name, and the table
 * inherited `display: grid` — its headings laid out beside its rows instead of above them (26 September 2026). The
 * undefined check above passed, correctly and uselessly. The site has been bitten by this before, by an .acct class
 * that restyled the header (check 47).
 *
 * The signal is a base rule — `.x {` with nothing else in the selector — written twice outside any media query.
 * An override belongs in a media query or in a more specific selector; the same bare selector twice is two authors
 * who did not know about each other.
 */
const bases = new Map();
for (const f of cssFiles) {
  const css = readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ' ');
  for (const m of css.matchAll(/(^|\})\s*\.([-\w]+)\s*\{/g)) {
    const name = m[2];
    bases.set(name, (bases.get(name) ?? 0) + 1);
  }
}

const twice = [...bases].filter(([, n]) => n > 1).sort(([a], [b]) => a.localeCompare(b));
for (const [c, n] of twice) console.log(`FAIL  .${c} has ${n} base rules outside any media query — two components sharing one name?`);

const missing = [...used].filter(([c]) => !defined.has(c)).sort(([a], [b]) => a.localeCompare(b));
for (const [c, where] of missing) console.log(`FAIL  .${c} is used and never defined: ${[...where].join(', ')}`);
console.log(`${used.size} classes used, ${defined.size} defined, ${missing.length} undefined`);
if (!used.size || !defined.size) { console.log('FAIL  the scan read nothing'); process.exit(1); }
console.log(`${bases.size} base classes, ${twice.length} defined more than once`);
process.exit(missing.length || twice.length ? 1 : 0);
