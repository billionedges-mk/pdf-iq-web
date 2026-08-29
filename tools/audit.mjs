// Static audit of the built site: metadata, weight, and the invariants that should hold
// on every route. Run after `npm run build`.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const pages = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name === 'index.html') pages.push(p);
  }
})(DIST);

const routeOf = (p) => '/' + relative(DIST, p).replaceAll('\\', '/').replace(/index\.html$/, '');
const grab = (html, re) => (html.match(re) || [])[1] ?? '';

let problems = 0;
console.log('route              title  desc  canon   og   KB');
for (const p of pages.sort((a, b) => routeOf(a).localeCompare(routeOf(b)))) {
  const html = readFileSync(p, 'utf8');
  const title = grab(html, /<title>([^<]*)<\/title>/);
  const desc = grab(html, /name="description" content="([^"]*)"/);
  const canonical = /rel="canonical"/.test(html);
  const og = /property="og:title"/.test(html);
  const kb = Math.round(Buffer.byteLength(html) / 1024);

  // Google truncates titles past roughly 60 characters and descriptions past roughly 160.
  const tOk = title.length >= 15 && title.length <= 70;
  const dOk = desc.length >= 50 && desc.length <= 165;
  if (!tOk || !dOk || !canonical || !og) problems++;

  console.log(
    routeOf(p).padEnd(18),
    `${String(title.length).padStart(5)}${tOk ? ' ' : '!'}`,
    `${String(desc.length).padStart(4)}${dOk ? ' ' : '!'}`,
    String(canonical).padStart(5),
    String(og).padStart(5),
    String(kb).padStart(4)
  );
}
console.log(problems === 0 ? '\nmetadata: all routes within range' : `\nmetadata: ${problems} route(s) flagged with !`);

// ---- invariants that must hold on every page --------------------------------

const MUST = [
  ['a skip link', /class="skip-link"/],
  ['a main landmark', /<main[^>]*id="main"/],
  ['exactly one h1', /<h1/],
  ['a net readout', /data-netreadout\b/],
  ['the instrumentation bundle', /assets\/net-[A-Z0-9]{8}\.js/],
];
let invariantFails = 0;
for (const p of pages) {
  const html = readFileSync(p, 'utf8');
  for (const [label, re] of MUST) {
    if (!re.test(html)) { console.log(`  MISSING ${label} on ${routeOf(p)}`); invariantFails++; }
  }
  const h1s = (html.match(/<h1/g) || []).length;
  if (h1s !== 1) { console.log(`  ${h1s} h1 elements on ${routeOf(p)}`); invariantFails++; }
  // No inline event handlers anywhere: they would need a CSP unsafe-inline for scripts.
  if (/\son(click|load|error|submit|change)=/i.test(html)) {
    console.log(`  inline event handler on ${routeOf(p)}`); invariantFails++;
  }
}
console.log(invariantFails === 0 ? 'invariants: all pages have the shell, readout and bundle' : `invariants: ${invariantFails} problem(s)`);

// ---- weight ------------------------------------------------------------------

const fontBytes = readdirSync(join(DIST, 'fonts')).reduce((n, f) => n + statSync(join(DIST, 'fonts', f)).size, 0);
console.log('\nfirst-load weight (uncompressed)');
for (const p of pages) {
  const html = readFileSync(p, 'utf8');
  const js = [...html.matchAll(/src="(\/assets\/[^"]+)"/g)]
    .reduce((n, m) => n + statSync(join(DIST, m[1])).size, 0);
  const total = Buffer.byteLength(html) + js + fontBytes;
  console.log(`  ${routeOf(p).padEnd(18)} ${(total / 1024).toFixed(0).padStart(4)} KB`);
}

process.exitCode = problems + invariantFails > 0 ? 1 : 0;
