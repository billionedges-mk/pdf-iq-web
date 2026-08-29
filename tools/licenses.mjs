// Licence gate. The compression trap: Ghostscript/MuPDF/CoherentPDF are AGPL-3.0 and
// WebAssembly is *conveyed* to the browser, which would trigger source disclosure for
// the whole site. Nothing copyleft may enter the shipped bundle.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN = /(^|[^A-Za-z])(A?GPL|SSPL|CC-BY-NC|BUSL|EUPL)/i;
const ALLOWED = /^(MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|Unlicense|CC0-1\.0|OFL-1\.1|BlueOak-1\.0\.0|Python-2\.0|MIT-0)$/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === '.bin' || name === '.package-lock.json') continue;
    const full = join(dir, name);
    if (name.startsWith('@')) { walk(full, out); continue; }
    const pkgPath = join(full, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const p = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (p.name) out.push({ name: p.name, version: p.version, license: normalise(p) });
      } catch {}
    }
    walk(join(full, 'node_modules'), out);
  }
  return out;
}
function normalise(p) {
  if (typeof p.license === 'string') return p.license;
  if (p.license && p.license.type) return p.license.type;
  if (Array.isArray(p.licenses)) return p.licenses.map(l => l.type || l).join(' OR ');
  return 'UNKNOWN';
}

const pkgs = walk('node_modules').sort((a, b) => a.name.localeCompare(b.name));
const bad = [], unclear = [];
for (const p of pkgs) {
  const expr = p.license.replace(/[()]/g, '');
  if (FORBIDDEN.test(expr)) { bad.push(p); continue; }
  const terms = expr.split(/\s+(?:OR|AND)\s+/i).map(s => s.trim());
  if (!terms.some(t => ALLOWED.test(t))) unclear.push(p);
}
console.log(`scanned ${pkgs.length} packages`);
const counts = {};
for (const p of pkgs) counts[p.license] = (counts[p.license] || 0) + 1;
for (const [lic, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${lic}`);
if (unclear.length) { console.log('\nUNCLEAR — review by hand:'); for (const p of unclear) console.log(`  ${p.name}@${p.version}  ${p.license}`); }
if (bad.length) {
  console.error('\nCOPYLEFT — MUST NOT SHIP:');
  for (const p of bad) console.error(`  ${p.name}@${p.version}  ${p.license}`);
  process.exit(1);
}
console.log('\nOK — no copyleft in the tree.');
