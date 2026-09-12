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
import { PRO } from './site.mjs';
import { PRO_COPY, proState } from './pro-copy.mjs';

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
const REQUIRED = ['key', 'title', 'feature', 'route', 'what', 'onDevice', 'instead'];
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

console.log(`\n${fails ? `${fails} FAILED` : 'the Pro copy is complete, matches the feature list, and sells nothing that is not for sale'}`);
process.exitCode = fails ? 1 : 0;
