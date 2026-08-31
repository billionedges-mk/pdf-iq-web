/**
 * Rules keyed on a JavaScript-toggled state class must target something that exists.
 *
 * Written after a near-miss. Removing the bordered readout card from the homepage left five
 * CSS rules behind. Four were genuinely dead. The fifth was:
 *
 *     .netreadout--dirty .checkit__dot--live { animation: none; background: var(--ink); }
 *
 * `netreadout--dirty` is toggled by `net.ts` when bytes are sent or a third-party request
 * appears — it is how the readout shows it has stopped reading zero. Renaming the dot to
 * `.home-proof__dot--live` orphaned that rule silently. Nothing would have looked broken:
 * the readout keeps rendering, keeps showing zero, and quietly loses the ability to show
 * that it is not.
 *
 * The tell was reading the five rules rather than counting references to them, and reading
 * does not scale. This does: for every class the code toggles at runtime, every CSS rule
 * that mentions it must target classes that something actually produces — either present in
 * the built HTML, or toggled from the code as well.
 *
 * A failure here is a state that can be entered and can no longer be seen.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
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

const source = walk(join(ROOT, 'src'), (p) => p.endsWith('.ts'))
  .map((p) => readFileSync(p, 'utf8'))
  .join('\n');

// Comments are stripped first. Without this the check reads class names out of its own
// explanatory prose — "pagegrid.ts" parsed as a selector containing `.ts`, which was the
// first false positive it produced.
const css = readFileSync(join(ROOT, 'src/styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const html = walk(join(ROOT, 'dist'), (p) => p.endsWith('.html'))
  .map((p) => readFileSync(p, 'utf8'))
  .join('\n');

if (!html) {
  console.error('dist/ has no HTML — run `npm run build` first');
  process.exit(1);
}

/** Classes the code adds, removes or toggles at runtime. */
const toggled = new Set(
  [...source.matchAll(/classList\.(?:add|remove|toggle)\(\s*'([^']+)'/g)].map((m) => m[1])
);

/**
 * Classes the code writes directly, rather than toggling — `el.className = 'x'` and
 * `classList.add` are the same thing to a stylesheet, and an element built entirely in
 * JavaScript never appears in the built HTML at all. Missing these was the check's second
 * false positive: the page grid's cells are created at runtime, so every rule targeting
 * them looked orphaned.
 */
const written = new Set(
  [...source.matchAll(/className\s*=\s*'([^']+)'/g)].flatMap((m) => m[1].split(/\s+/))
);

/** Classes that appear in the built markup. */
const inMarkup = new Set(
  [...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean)
);

console.log(`${toggled.size} toggled at runtime, ${written.size} written by code, ${inMarkup.size} in the built markup`);

let failures = 0;

for (const state of [...toggled].sort()) {
  // Every rule whose selector mentions this state class.
  const rules = [...css.matchAll(/(^|\})([^{}]*?)\{/gm)]
    .map((m) => m[2].trim())
    .filter((sel) => sel.includes(`.${state}`) && !sel.startsWith('@'));

  for (const selector of rules) {
    const classes = [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
    const orphans = classes.filter(
      (c) => c !== state && !inMarkup.has(c) && !toggled.has(c) && !written.has(c)
    );
    if (orphans.length) {
      failures++;
      console.log(`  FAIL  ${selector}`);
      console.log(`        "${state}" is toggled at runtime, but ${orphans.map((o) => `.${o}`).join(', ')} ` +
        `${orphans.length === 1 ? 'is' : 'are'} in no page and set by no code.`);
      console.log('        This state can be entered and can no longer be seen.');
    }
  }

  if (!rules.length) {
    // Not an error on its own — plenty of state classes are read by JS rather than styled —
    // but worth printing, because a state with no styling and no reader is also suspect.
    const read = new RegExp(`classList\\.contains\\(\\s*'${state}'|\\.${state}\\b`).test(source);
    if (!read) console.log(`  note  .${state} is toggled but never styled or read`);
  }
}

console.log();
console.log(failures === 0
  ? 'every runtime state class styles something that exists'
  : `${failures} rule(s) style a state nothing can show`);
process.exit(failures === 0 ? 0 : 1);
