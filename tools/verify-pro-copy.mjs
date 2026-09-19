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
import { PRO_COPY, PRO_FEATURES, proState, proStrip, proPanel, proSurfaces } from './pro-copy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) fails++;
};

// ---------------------------------------------------------------- the two lists are one list
// They were two arrays — PRO.features and PRO_COPY — and this compared them. PRO_FEATURES is now derived from PRO_COPY,
// so comparing them again would be a check that cannot fail. What can still drift is the built page: a renderer that
// prints its own list, or drops the surfaces line. tools/verify-surfaces.mjs reads the built HTML for both.
ok(PRO_FEATURES.length === PRO_COPY.length && PRO_FEATURES.every((f, i) => f === PRO_COPY[i].feature),
  `one list of ${PRO_FEATURES.length} features, derived from PRO_COPY`);

// ---------------------------------------------------------------- which surface each one is on
const shorts = PRO_COPY.map((c) => c.short);
ok(PRO_COPY.every((c) => typeof c.inApp === 'boolean'),
  'every feature says whether the Android app has it');
// Not "must be lower case": Batch is the tool's own name and keeps its capital. What it must be is a FRAGMENT — the
// line drops these into the middle of a sentence and capitalises the first one itself (up() in proSurfaces).
ok(shorts.every((s) => typeof s === 'string' && s.trim() === s && s !== '' && !/[.;,]$/.test(s)),
  'and carries a short name that reads inside a sentence (a fragment, no trailing punctuation)');
ok(new Set(shorts).size === shorts.length, `the short names are distinct (${shorts.join(', ')})`);
ok(!/\bonly\b|\bnot yet\b|\bsorry\b|\bunfortunately\b/i.test(proSurfaces()),
  `the generated line is not an apology: "${proSurfaces()}"`);

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
  // Not selling, nothing to buy. Selling, the price comes with a link to the purchase page (owner, 17 September 2026:
  // naming a price without offering the purchase is a defect); still no checkout on a tool page.
  const notSelling = proStrip({ selling: false }), sellingStrip = proStrip({ selling: true });
  ok(!SELLING.some((w) => notSelling.toLowerCase().includes(w)) && !notSelling.includes('/pro/buy/'), 'not on sale, the strip offers no purchase: it links to /pro/ only');
  ok(sellingStrip.includes('href="/pro/buy/"') && sellingStrip.includes(PRO.price), 'on sale, the strip names the price and links to the purchase page beside it');
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
    ok(selling ? panel.includes('href="/pro/buy/"') : !SELLING.some((w) => panel.toLowerCase().includes(w)) && !panel.includes('/pro/buy/'),
      selling ? 'on sale: the panel offers the purchase beside the price' : 'not on sale: the panel offers no purchase');
    // The line under "Pro" has to fit all of them: "Four things the free tools don't do", counted from PRO_COPY. Not the
    // mockup's "without doing it one file at a time", which is Batch alone.
    const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
    ok(panel.includes(`${words[PRO_COPY.length]} things the free tools don&rsquo;t do.`) && !/one file at a time/.test(panel),
      `${label}: the panel's line counts the Pro features and fits all of them`);
    ok(panel.includes('<a href="/pro/">What Pro adds</a>'), `${label}: the panel links to /pro/`);
  }
  ok(proPanel({ hidden: true }).includes('data-pro-strip hidden') && !proPanel().includes('data-pro-strip hidden'),
    'a Pro build writes the panel hidden until settled; production writes it visible');
  const home = readFileSync(join(ROOT, 'src/pages/index.html'), 'utf8');
  ok(home.split('{{proPanel}}').length === 2 && !/price-grid|What it costs|Nothing here is for sale today/.test(home),
    'the homepage carries the panel once, and none of the three old price cards');
}

console.log(`\n${fails ? `${fails} FAILED` : 'the Pro copy is complete, matches the feature list, and sells nothing that is not for sale'}`);
process.exitCode = fails ? 1 : 0;
