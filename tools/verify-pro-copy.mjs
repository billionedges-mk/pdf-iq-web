/**
 * The Pro copy is complete, matches the feature list, and sells nothing while there is nothing
 * to sell.
 *
 * Three things it refuses:
 *
 *   1. A feature in PRO.features with no entry in PRO_COPY, or an entry for something Pro does
 *      not include. The homepage prints one list and the marks describe another; they have to be
 *      the same list, or a feature ships marked as Pro that Pro does not contain.
 *   2. An entry missing `instead`. A mark on something nobody can buy is a wall unless it leaves
 *      the reader better off than not clicking, and the free alternative is the part a hurried
 *      edit drops.
 *   3. A purchase offered while PRO.onSale is false — a control with nothing behind it (check 14),
 *      which is the exact defect this project has removed most often.
 *
 *   npm run verify:pro-copy
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRO, TOOLS } from './site.mjs';
import { PRO_COPY, proState, proStrip, proPanel } from './pro-copy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) fails++;
};

// ---------------------------------------------------------------- the two lists are one list
const listed = [...PRO.features].sort();
const described = PRO_COPY.map((c) => c.feature).sort();
const missing = listed.filter((f) => !described.includes(f));
const extra = described.filter((f) => !listed.includes(f));
ok(missing.length === 0, `every Pro feature has copy${missing.length ? ` — nothing describes: ${missing.join('; ')}` : ` (${listed.length})`}`);
ok(extra.length === 0, `and nothing is described that Pro does not include${extra.length ? ` — ${extra.join('; ')}` : ''}`);

// ---------------------------------------------------------------- every entry is complete
const REQUIRED = ['key', 'strip', 'panel', 'title', 'feature', 'route', 'what', 'onDevice', 'instead'];
for (const entry of PRO_COPY) {
  const absent = REQUIRED.filter((f) => !entry[f] || String(entry[f]).trim().length < 3);
  ok(absent.length === 0, `${entry.key ?? '(no key)'} carries every field${absent.length ? ` — missing ${absent.join(', ')}` : ''}`);
  if (entry.instead) {
    ok(entry.instead.length > 40, `${entry.key}'s free alternative is a sentence, not a shrug (${entry.instead.length} characters)`);
  }
}

// ---------------------------------------------------------------- nothing is being sold yet
// The words that ship, not the file's prose about them. The first version read the whole source
// and failed on this very file's comment explaining that it must not sell anything — an
// instrument reading its own documentation as evidence.
const shipped = [proState(), ...PRO_COPY.flatMap((c) => [c.title, c.what, c.onDevice, c.instead])]
  .join(' ')
  .toLowerCase();
const SELLING = ['buy ', 'buy now', 'upgrade', 'purchase', 'checkout', 'subscribe', 'get pro'];
const pitches = SELLING.filter((w) => shipped.includes(w));
if (!PRO.onSale) {
  ok(pitches.length === 0, `nothing offers a purchase while Pro is not on sale${pitches.length ? ` — found ${pitches.join(', ')}` : ''}`);
  ok(proState().includes('not on sale yet'), `and the state sentence says so: "${proState()}"`);
} else {
  ok(!proState().includes('not on sale'), 'Pro is on sale, and the state sentence no longer says otherwise');
}

// ---------------------------------------------------------------- the strip under every free tool's heading
// Every free tool page carries it once, straight after the heading block; it names every Pro feature; and it names a
// price only while Pro is on sale. The line itself is proStrip(), so these read what ships, not a copy of it.
{
  const strip = proStrip();
  ok(PRO_COPY.every((c) => strip.includes(c.strip)), `the strip names every Pro feature: ${PRO_COPY.map((c) => c.strip).join(', ')}`);
  ok(PRO.onSale ? strip.includes(PRO.price) && !strip.includes('not on sale') : strip.includes('not on sale yet') && !strip.includes(PRO.price),
    PRO.onSale ? 'on sale, the strip names the price' : 'not on sale, the strip says so and names no price');
  ok(!SELLING.some((w) => strip.toLowerCase().includes(w)), 'the strip offers no purchase of its own: it links to /pro/ only');
  for (const tool of TOOLS) {
    const lines = readFileSync(join(ROOT, `src/pages/${tool.slug}.html`), 'utf8').split(/\r?\n/);
    const at = lines.map((l, i) => (l.trim() === '{{proStrip}}' ? i : -1)).filter((i) => i >= 0);
    ok(at.length === 1 && lines[at[0] - 1]?.trim() === '</div>' && lines[at[0] - 2]?.includes('page-lede'),
      `/${tool.slug}/ carries the strip once, straight under its heading${at.length === 1 ? '' : ` (found ${at.length})`}`);
  }
}

// ---------------------------------------------------------------- the homepage's Pro panel (redesign stage 4)
// One panel on the homepage, generated beside the strip: every feature, a price only while Pro is on sale, what a purchase
// covers today (the web tools), plainly not the Android app, and hidden in a Pro build until src/pro/strip.ts settles it.
{
  for (const selling of [false, true]) {
    const panel = proPanel({ selling });
    const label = selling ? 'on sale' : 'not on sale';
    ok(PRO_COPY.every((c) => panel.includes(`<b>${c.panel[0]}</b> &mdash; ${c.panel[1]}`)), `${label}: the panel lists every Pro feature`);
    ok(selling ? panel.includes(`${PRO.price} ${PRO.qualifier}`) && !panel.includes('not on sale') : panel.includes('not on sale yet') && !panel.includes(PRO.price),
      selling ? 'on sale: the panel names the price' : 'not on sale: the panel says so and names no price');
    ok(panel.includes(PRO.coversToday) && /(does|will) not unlock anything in the Android app/.test(panel) && !panel.includes(PRO.covers),
      `${label}: the panel says a purchase covers the web tools, and plainly not the Android app`);
    ok(!SELLING.some((w) => panel.toLowerCase().includes(w)), `${label}: the panel offers no purchase of its own`);
  }
  ok(proPanel({ hidden: true }).includes('data-pro-strip hidden') && !proPanel().includes('data-pro-strip hidden'),
    'a Pro build writes the panel hidden until settled; production writes it visible');
  const home = readFileSync(join(ROOT, 'src/pages/index.html'), 'utf8');
  ok(home.split('{{proPanel}}').length === 2 && !/price-grid|What it costs|Nothing here is for sale today/.test(home),
    'the homepage carries the panel once, and none of the three old price cards');
}

console.log(`\n${fails ? `${fails} FAILED` : 'the Pro copy is complete, matches the feature list, and sells nothing that is not for sale'}`);
process.exitCode = fails ? 1 : 0;
