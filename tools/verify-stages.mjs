/**
 * The stage list a tool shows while it works must be the stage list its code runs.
 *
 * Each tool page types its stages into HTML (`<span class="stages__label">`) while its entry
 * declares them in code (`const STAGES = [...]`). Nothing tied the two together, so a re-scope
 * could change one and leave the other — and did: `/ocr/` announced "Writing the text behind the
 * scan" for months after the free path stopped writing anything into the scan. It is check 24's
 * failure exactly, in the one place on the screen nobody re-reads, because it is only visible
 * while a run is in progress.
 *
 * src/lib/ui.ts now writes the labels from the array at run time, so the screen cannot disagree
 * with the code once a run starts. This checks the markup too, because that is what a reader sees
 * before the first stage begins, and because a label nobody maintains goes stale silently.
 *
 *   npm run verify:stages
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from './site.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) fails++;
};

/** `const STAGES = ['a', 'b']` — one array, one line or several. */
function stagesInCode(source) {
  const m = /const STAGES(?:\s*:\s*[^=]+)?\s*=\s*\[([\s\S]*?)\]/.exec(source);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((q) => q[1] ?? q[2]);
}

/** The labels the page carries, in order. */
function stagesInPage(html) {
  return [...html.matchAll(/<span class="stages__label">([\s\S]*?)<\/span>/g)]
    .map((m) => m[1].replace(/\s+/g, ' ').trim());
}

let checked = 0;
for (const tool of TOOLS) {
  if (!tool.entry) continue;
  const page = join(ROOT, 'src/pages', `${tool.slug}.html`);
  const entry = join(ROOT, 'src/entries', `${tool.entry}.ts`);
  if (!existsSync(page) || !existsSync(entry)) continue;

  const html = readFileSync(page, 'utf8');
  const labels = stagesInPage(html);
  if (!labels.length) continue; // a tool with no stage list has nothing to disagree about

  // A tool may declare its stages or import them — /compress/ takes STAGES from src/lib/compress.ts,
  // and a check that only read the entry called that a missing array.
  const entrySource = readFileSync(entry, 'utf8');
  let code = stagesInCode(entrySource);
  if (!code) {
    const imported = /import\s*\{[^}]*\bSTAGES\b[^}]*\}\s*from\s*'([^']+)'/.exec(entrySource);
    if (imported) {
      const from = join(ROOT, 'src/entries', imported[1]).replace(/\.js$/, '.ts');
      if (existsSync(from)) code = stagesInCode(readFileSync(from, 'utf8'));
    }
  }
  checked++;
  if (!code) {
    ok(false, `/${tool.slug}/ shows ${labels.length} stages but its entry declares no STAGES array`);
    continue;
  }
  const same = code.length === labels.length && code.every((s, i) => s === labels[i]);
  ok(same, same
    ? `/${tool.slug}/ shows the stages its code runs (${labels.join(' → ')})`
    : `/${tool.slug}/ shows "${labels.join(' → ')}" but its code runs "${code.join(' → ')}"`);
}

ok(checked > 0, `${checked} tool pages have a stage list to check`);
console.log(`\n${fails ? `${fails} FAILED` : 'every stage list on screen is the one its code runs'}`);
process.exitCode = fails ? 1 : 0;
