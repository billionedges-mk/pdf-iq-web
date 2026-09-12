/**
 * Proves the Pro flag does what CLAUDE.md says, by building the site both ways and reading
 * the output — the web's equivalent of the Android gate that checks the release mapping.
 *
 *   1. The block resolver keeps and drops what it should, and throws on malformed markers.
 *   2. Flag off: no `pdfiq-pro:` sentinel anywhere in dist, no preview banner, robots allows
 *      crawling, and noindex only on pages that declare it.
 *   3. Flag on (a local build, not production): the Pro core chunk is written AND referenced
 *      by the page code, every page carries the preview banner and noindex, robots disallows.
 *   4. Flag on for Cloudflare's production branch: the build refuses, with the named error.
 *      A Cloudflare build that does not say which branch it is counts as production.
 *   5. Flag off for production: builds. This runs last, so dist is left as production has it.
 *
 * Each build calls tools/build.mjs directly with a scrubbed environment, so a PDFIQ_PRO or
 * CF_PAGES variable in the calling shell cannot decide the result.
 *
 *   npm run verify:pro-gate
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyProBlocks } from './pro-blocks.mjs';
import { ALL } from './site.mjs';
import { AUTH } from './auth-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SENTINEL = 'pdfiq-pro:';
let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) fails++;
};

const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CF_PAGES|PDFIQ_PRO)/.test(k)));
const build = (extra) =>
  spawnSync(process.execPath, [join(ROOT, 'tools/build.mjs')], { cwd: ROOT, env: { ...baseEnv, ...extra }, encoding: 'utf8' });
// The build's own error line when there is one; Node puts it before the stack trace, so the
// last lines of the output are only ever the stack and the version banner.
const tail = (r) => {
  const text = `${r.stderr || ''}${r.stdout || ''}`;
  const error = text.split('\n').map((l) => l.trim()).find((l) => /^\w*Error: /.test(l));
  return error ?? text.trim().split('\n').filter(Boolean).slice(-2).join(' | ');
};

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const TEXT = /\.(html|js|css|txt|xml|json|svg)$/;
function scan() {
  const hits = [];
  const pages = [];
  const assets = [];
  const all = [];
  for (const f of walk(DIST)) {
    if (!TEXT.test(f)) continue;
    const s = readFileSync(f, 'utf8');
    const rel = relative(DIST, f).split(sep).join('/');
    if (s.includes(SENTINEL)) hits.push(rel);
    if (rel.endsWith('.html')) pages.push({ rel, s });
    if (rel.startsWith('assets/') && rel.endsWith('.js')) assets.push({ rel, s });
    all.push({ rel, s });
  }
  return { hits, pages, assets, all, robots: readFileSync(join(DIST, 'robots.txt'), 'utf8'), headers: readFileSync(join(DIST, '_headers'), 'utf8') };
}
// The 404 page declares noindex inline in build.mjs rather than in the route list.
const declaredNoindex = new Set([...ALL.filter((p) => p.noindex).map((p) => `${p.slug}/index.html`), '404.html']);
const hasNoindex = (s) => /<meta name="robots" content="noindex/.test(s);

// ---------------------------------------------------------------- 1. the resolver
console.log('\n— the block resolver');
ok(applyProBlocks('a<!--PRO-->p<!--/PRO-->b', false) === 'ab', 'a PRO block is dropped when the flag is off');
ok(applyProBlocks('a<!--PRO-->p<!--/PRO-->b', true) === 'apb', 'a PRO block is kept when it is on');
ok(applyProBlocks('a<!--FREE-->f<!--/FREE-->b', false) === 'afb', 'a FREE block is kept when the flag is off');
ok(applyProBlocks('a<!--FREE-->f<!--/FREE-->b', true) === 'ab', 'a FREE block is dropped when it is on');
for (const [bad, why] of [
  ['a<!--PRO-->p', 'never closed'],
  ['a<!--/PRO-->b', 'nothing open'],
  ['<!--PRO--><!--FREE-->x<!--/FREE--><!--/PRO-->', 'do not nest'],
  ['<!--PRO-->x<!--/FREE-->', 'closes'],
]) {
  let threw = '';
  try { applyProBlocks(bad, true); } catch (e) { threw = e.message; }
  ok(threw.includes(why), `a malformed marker throws (${why})`);
}

// ---------------------------------------------------------------- 2. flag off
console.log('\n— flag off');
let r = build({});
ok(r.status === 0, `builds${r.status ? ` — ${tail(r)}` : ''}`);
let s = scan();
ok(s.hits.length === 0, `no "${SENTINEL}" anywhere in dist${s.hits.length ? ` — found in ${s.hits.slice(0, 6).join(', ')}` : ''}`);
ok(s.pages.every((p) => !p.s.includes('data-pdfiq-pro')), 'no page carries the preview banner');
ok(!/^Disallow: \/\s*$/m.test(s.robots), 'robots.txt allows crawling');
const offNoindex = s.pages.filter((p) => hasNoindex(p.s)).map((p) => p.rel);
ok(offNoindex.every((rel) => declaredNoindex.has(rel)), `noindex only where a page declares it (${offNoindex.join(', ') || 'none'})`);
ok(!existsSync(join(DIST, 'account')), 'there is no /account/ page');
ok(!s.headers.includes('/account/'), '_headers has no account rule — it is public/_headers as written');
const offCsp = (s.headers.match(/Content-Security-Policy: (.+)/) ?? [])[1];
const authLeaks = s.all.filter((f) => f.s.includes(new URL(AUTH.identityToolkit).host) || f.s.includes(AUTH.clientId)).map((f) => f.rel);
ok(authLeaks.length === 0, `no sign-in host or client ID anywhere in dist${authLeaks.length ? ` — found in ${authLeaks.slice(0, 5).join(', ')}` : ''}`);
// Pro wording outside src/pro/. The sentinel covers every module under src/pro/, and esbuild drops
// a whole module nothing free imports, but a Pro branch inside a shared function ships in every
// production bundle, unreachable, where neither can see it. The searchable-PDF sentence did exactly
// that from src/lib/ocr-result.ts until 12 September 2026, and a live check found it. A tripwire,
// not a census: phrases only a Pro path produces. Section 3 proves each one exists in a Pro build,
// so none of them is a string that could never be found.
const PRO_WORDING = [
  'now searchable', 'given a text layer here', 'searchable already', 'Save as a searchable PDF',
  'Or aim for a target',
  'Protect with this password', 'Lift the limits',
];
const wordingLeaks = s.assets.flatMap((a) => PRO_WORDING.filter((w) => a.s.includes(w)).map((w) => `"${w}" in ${a.rel}`));
ok(wordingLeaks.length === 0, `no Pro wording in any flag-off bundle${wordingLeaks.length ? ` — ${wordingLeaks.slice(0, 4).join('; ')}` : ''}`);

// ---------------------------------------------------------------- 3. flag on, locally
console.log('\n— flag on (a local preview build)');
r = build({ PDFIQ_PRO: '1' });
ok(r.status === 0, `builds${r.status ? ` — ${tail(r)}` : ''}`);
s = scan();
const core = s.assets.find((a) => a.s.includes('pdfiq-pro:core'));
ok(Boolean(core), `the Pro core is written to an asset${core ? ` (${core.rel})` : ''}`);
if (core) {
  const name = basename(core.rel);
  const refs = s.assets.filter((a) => a !== core && a.s.includes(name)).map((a) => a.rel);
  ok(refs.length > 0, `and something the pages load refers to it${refs.length ? ` (${refs.slice(0, 3).join(', ')})` : ''}`);
}
ok(s.pages.length > 0 && s.pages.every((p) => p.s.includes('data-pdfiq-pro')), `every page carries the preview banner (${s.pages.length} pages)`);
ok(s.pages.every((p) => hasNoindex(p.s)), 'every page is noindex');
ok(/^Disallow: \/\s*$/m.test(s.robots), 'robots.txt disallows crawling');
const account = s.pages.find((p) => p.rel === 'account/index.html');
ok(Boolean(account) && hasNoindex(account.s), 'the /account/ page exists, noindex');
const onCsp = (s.headers.match(/Content-Security-Policy: (.+)/) ?? [])[1];
ok(Boolean(offCsp) && onCsp === offCsp, 'the site-wide CSP is identical to the flag-off build');
const acctRule = /\/account\/\*\s*\n\s*! Content-Security-Policy\s*\n\s*Content-Security-Policy: ([^\n]+)/.exec(s.headers);
const acctConnect = acctRule ? (/connect-src ([^;]+)/.exec(acctRule[1]) ?? [])[1] ?? '' : '';
ok(Boolean(acctRule) && AUTH.hosts.every((h) => acctConnect.includes(h)) && acctConnect.split(/\s+/).filter((t) => t.startsWith('https://')).length === AUTH.hosts.length,
  `/account/ alone may connect to ${AUTH.hosts.map((h) => new URL(h).host).join(' and ')}, and to nothing else new`);
const privacy = s.pages.find((p) => p.rel === 'privacy/index.html')?.s ?? '';
for (const name of [AUTH.sessionKey, AUTH.pendingKey, ...AUTH.sessionFields, ...AUTH.pendingFields, ...AUTH.hosts.map((h) => new URL(h).host)]) {
  ok(privacy.includes(name), `/privacy names ${name}, which the sign-in code stores or contacts`);
}
// The other half of the wording tripwire: every phrase exists in a Pro build, and in a bundle that
// carries a Pro sentinel, meaning it is produced by code under src/pro/, not by a shared function.
for (const w of PRO_WORDING) {
  const where = s.assets.filter((a) => a.s.includes(w));
  const inPro = where.filter((a) => a.s.includes(SENTINEL));
  ok(inPro.length > 0 && inPro.length === where.length,
    `"${w}" is produced by Pro code alone${where.length === 0 ? ' — IT IS NOWHERE, so the flag-off check for it proves nothing' : inPro.length < where.length ? ` — also in ${where.filter((a) => !a.s.includes(SENTINEL)).map((a) => a.rel).join(', ')}, which has no sentinel` : ''}`);
}

// ---------------------------------------------------------------- 4. flag on, production
console.log('\n— flag on for production');
// Matched against the whole output: Node prints the message first and a stack trace after it,
// so the last lines never carry the name. The first version checked only the tail and failed a
// build that had refused correctly.
const named = (r) => /PDFIQ_PRO is set on a production build/.test(`${r.stderr || ''}${r.stdout || ''}`);
r = build({ PDFIQ_PRO: '1', CF_PAGES: '1', CF_PAGES_BRANCH: 'main' });
ok(r.status !== 0 && named(r), `refuses on the production branch, by name${r.status === 0 ? ' — IT BUILT' : named(r) ? '' : ` — but not by name: ${tail(r)}`}`);
r = build({ PDFIQ_PRO: '1', CF_PAGES: '1' });
ok(r.status !== 0 && named(r), `refuses on a Cloudflare build that names no branch${r.status === 0 ? ' — IT BUILT' : named(r) ? '' : ` — but not by name: ${tail(r)}`}`);
r = build({ PDFIQ_PRO: '1', CF_PAGES: '1', CF_PAGES_BRANCH: 'pro-preview' });
ok(r.status === 0, `builds on a Cloudflare preview branch${r.status ? ` — ${tail(r)}` : ''}`);

// ---------------------------------------------------------------- 5. flag off, production
console.log('\n— flag off for production (leaves dist as production has it)');
r = build({ CF_PAGES: '1', CF_PAGES_BRANCH: 'main' });
ok(r.status === 0, `builds${r.status ? ` — ${tail(r)}` : ''}`);
s = scan();
ok(s.hits.length === 0, 'and carries no Pro sentinel');
const prodWording = s.assets.flatMap((a) => PRO_WORDING.filter((w) => a.s.includes(w)).map((w) => `"${w}" in ${a.rel}`));
ok(prodWording.length === 0, `and no Pro wording${prodWording.length ? ` — ${prodWording.slice(0, 4).join('; ')}` : ''}`);

console.log(`\n${fails ? `${fails} FAILED` : 'the Pro flag holds: absent when off, present when on, refused in production'}`);
process.exitCode = fails ? 1 : 0;
