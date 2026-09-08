/**
 * Every foreground/background pair the design actually uses, measured.
 *
 * This script used to print two FAILs and then `process.exitCode = 0`, which is the worst
 * state a check can be in: a true-looking warning nobody heeds, that teaches everyone to
 * skim past the output before it ever fires on something real. Two things were wrong.
 *
 * The first is that it measured the wrong pairs. There are two ambers on purpose.
 * `--amber` is the drawn brand colour — borders, bars, dots, focus rings, icon fills,
 * gradients — and `--amber-text` is the same hue darkened until it clears 4.5:1 for text.
 * The script was holding `--amber` to the 4.5:1 text threshold at a job it never does, and
 * one row measured `--amber` for `.size-saved`, which has used `--amber-text` since the
 * split. The two FAILs were measurements of colour combinations the stylesheet does not
 * produce.
 *
 * The second is that the licence for that is a naming convention, and a convention is not
 * a check. So `assertAmberIsNeverText` below is the thing that earns `--amber` the 3:1
 * non-text threshold: if anyone ever writes `color: var(--amber)`, in the stylesheet or in
 * a style set from TypeScript, the build fails and says to use `--amber-text`.
 *
 * Colours are read out of app.css rather than written here. This file hardcoded the four
 * hexes and would have gone on reporting the old palette's ratios after a change to the
 * real one — see tools/og.mjs, which had the same reasoning applied to it earlier.
 *
 * Exit code is non-zero on any failure.
 */

import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS_PATH = join(ROOT, 'src/styles/app.css');
const css = readFileSync(CSS_PATH, 'utf8');

/** A palette token, from the stylesheet the site actually uses. */
function token(name) {
  const m = css.match(new RegExp(String.raw`--${name}:\s*(#[0-9a-fA-F]{6})\s*;`));
  if (!m) throw new Error(`--${name} is not a hex token in app.css — contrast would measure a guess`);
  return m[1];
}

const hex = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
// alpha over an opaque backdrop
const over = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const PAPER = hex(token('paper')), CARD = hex(token('card')), INK = hex(token('ink'));
const AMBER = hex(token('amber')), AMBER_TEXT = hex(token('amber-text'));

/**
 * `--amber` is measured against the 3:1 non-text threshold below, and that is only correct
 * for as long as it never colours text. This is what makes that true rather than customary.
 *
 * Deliberately narrow: it looks for `--amber` reached by a property that paints glyphs, not
 * for every mention. `--amber-text` cannot match, because the capture stops at the closing
 * paren and is compared exactly.
 */
function assertAmberIsNeverText() {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(css|ts|html)$/.test(e)) files.push(p);
    }
  };
  walk(join(ROOT, 'src'));

  // `color`, and the two properties that paint glyphs without being called colour.
  const TEXT_PROP = /(?:^|[^-\w])(color|-webkit-text-fill-color|text-decoration-color)\s*[:=]\s*['"]?\s*var\(\s*(--amber[\w-]*)\s*\)/g;
  const bad = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(TEXT_PROP)) {
      if (m[2] !== '--amber') continue;
      const line = src.slice(0, m.index).split('\n').length;
      bad.push(`${relative(ROOT, f).split(sep).join('/')}:${line}  ${m[1]}: var(--amber)`);
    }
  }
  if (bad.length) {
    console.error(
      `\n--amber is the drawn brand colour and measures ${ratio(AMBER, CARD).toFixed(2)}:1 on card,\n` +
      `which is below the 4.5:1 that text needs. Use --amber-text (${ratio(AMBER_TEXT, CARD).toFixed(2)}:1).\n\n` +
      bad.map(b => `  ${b}`).join('\n') + '\n'
    );
    return false;
  }
  console.log(`ok    --amber never colours text (${files.length} files), so 3:1 is the right bar for it\n`);
  return true;
}

// kind: 'body' and 'small' are text at 4.5:1; 'large' is 19px+ bold or 24px+ at 3:1;
// 'ui' is a border, bar, dot or ring — WCAG 1.4.11 non-text contrast, also 3:1.
const pairs = [
  ['ink on paper',                INK,                     PAPER, 'body'],
  ['ink on card',                 INK,                     CARD,  'body'],
  ['ink .78 on card',             over(INK, .78, CARD),    CARD,  'body'],
  ['ink .76 on card',             over(INK, .76, CARD),    CARD,  'body'],
  ['ink .74 on card',             over(INK, .74, CARD),    CARD,  'small'],
  ['ink .74 on paper',            over(INK, .74, PAPER),   PAPER, 'small'],
  ['paper on ink (button)',       PAPER,                   INK,   'body'],
  // Text. --amber-text exists to clear 4.5:1, so it is held to 4.5:1 at every size.
  ['amber-text on card',          AMBER_TEXT,              CARD,  'body'],
  ['amber-text on paper',         AMBER_TEXT,              PAPER, 'body'],
  // Not text: borders, bars, dots, focus rings, icon accents. Enforced above.
  ['amber border/bar on card',    AMBER,                   CARD,  'ui'],
  ['amber border/bar on paper',   AMBER,                   PAPER, 'ui'],
];

let fail = assertAmberIsNeverText() ? 0 : 1;
for (const [name, fg, bg, kind] of pairs) {
  const r = ratio(fg, bg);
  const need = kind === 'large' || kind === 'ui' ? 3.0 : 4.5;
  const ok = r >= need;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2)}:1  (needs ${need})  ${name}  [${kind}]`);
}

if (fail) {
  console.log('\nDarker candidates on the card, if a text colour needs to move:');
  for (const c of ['#C87A1E', '#B86E18', '#A96214', '#9A5710', '#8B4D0D', '#7C440B']) {
    console.log(`  ${c}  ${ratio(hex(c), CARD).toFixed(2)}:1`);
  }
  console.error(`\n${fail} contrast failure(s).`);
} else {
  console.log('\nevery pair the stylesheet produces clears its threshold');
}
process.exitCode = fail ? 1 : 0;
