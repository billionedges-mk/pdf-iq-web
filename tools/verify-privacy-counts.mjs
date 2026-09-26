/**
 * /privacy/'s storage heading counts its own table, and the two are written by hand.
 *
 * "Four things stored in your browser, and two more if you sign in" — with "up to four" when Pro is on sale — sits
 * above a table with one row per stored thing. They are two records of one fact, which this repo has learned to
 * distrust (check 54). They disagreed on the day the table was written: the original list described the session and
 * the pending check in ONE bullet, so the table had five rows under a heading claiming six, and seven under one
 * claiming eight. Nothing caught it but counting (26 September 2026).
 *
 * The three build states are resolved here with the same functions the build uses, rather than by building three
 * times: what changes between states is exactly which rows and which words survive the blocks.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyProBlocks, applySaleBlocks } from './pro-blocks.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

const source = readFileSync(join(ROOT, 'src/pages/privacy.html'), 'utf8');
let failed = 0;

for (const [label, pro, sale] of [['free', false, false], ['pro, not selling', true, false], ['selling', true, true]]) {
  const html = applySaleBlocks(applyProBlocks(source, pro, 'privacy.html'), sale, 'privacy.html');

  const heading = /<h3>Four things stored in your browser([^<]*)<\/h3>/.exec(html);
  if (!heading) { console.log(`FAIL  ${label}: the storage heading is not where this check looks for it`); failed++; continue; }

  // The table is the one whose caption says so, and the rows are the ones in <tbody> — counting every <tr> counts
  // the header as a stored thing, which is how the first run of this check reported every state off by one.
  const table = /<caption[^>]*>What this site keeps in your browser<\/caption>([\s\S]*?)<\/table>/.exec(html);
  if (!table) { console.log(`FAIL  ${label}: the storage table is not on the page`); failed++; continue; }
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(table[1]);
  if (!body) { console.log(`FAIL  ${label}: the storage table has no tbody`); failed++; continue; }
  const rows = (body[1].match(/<tr>/g) || []).length;

  const said = [...heading[1].matchAll(/\b([a-z]+)\b/g)].map((m) => WORDS[m[1]]).filter(Boolean);
  const claimed = 4 + (said.length ? said[said.length - 1] : 0);

  const ok = claimed === rows;
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${label}: the heading claims ${claimed}, the table has ${rows}`);
  if (!ok) failed++;
}

if (!failed) console.log('the storage heading and its table agree in every build state');
process.exit(failed ? 1 : 0);
