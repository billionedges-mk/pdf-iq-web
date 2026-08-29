/**
 * Asserts that pdf-lib still throws what src/lib/errors.ts expects.
 *
 * That file matches pdf-lib failures on message text, which is normally forbidden here.
 * The exception exists because pdf-lib's published build is ES5, and `class X extends
 * Error` transpiled to ES5 loses its prototype chain — every error arrives as a plain
 * `Error` with `.name === 'Error'`, so there is no type to dispatch on. The message is
 * the only signal the library gives.
 *
 * Matching on message is a pinned-version dependency, so this makes the pin explicit: an
 * upgrade that reworded a message fails here instead of quietly turning a specific,
 * useful error into "unexpected failure" — which is exactly the failure that sent a real
 * locked file to the catch-all.
 */

import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEncryptedPdf } from './encrypt-fixture.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Read the fragments straight out of the source, so the two cannot drift.
const source = readFileSync(join(ROOT, 'src/lib/errors.ts'), 'utf8');
const block = source.match(/PDFLIB_MESSAGES[^=]*=\s*\[([\s\S]*?)\];/);
if (!block) {
  console.error('could not find PDFLIB_MESSAGES in src/lib/errors.ts');
  process.exit(1);
}
const fragments = [...block[1].matchAll(/\['([^']+)',\s*'([a-z]+)'\]/g)].map((m) => ({ text: m[1], kind: m[2] }));
console.log(`errors.ts declares ${fragments.length} pdf-lib message fragments`);

/** Provoke each failure with a real document and capture what pdf-lib actually says. */
const cases = [
  {
    kind: 'encrypted',
    what: 'a password-protected PDF',
    bytes: new Uint8Array(buildEncryptedPdf({ userPassword: 'x', pages: 1 })),
  },
  {
    kind: 'header',
    what: 'a file with no PDF header',
    bytes: new TextEncoder().encode('this is definitely not a pdf'),
  },
  {
    kind: 'parse',
    what: 'a truncated PDF',
    bytes: (() => {
      const good = new Uint8Array(buildEncryptedPdf({ userPassword: 'x', pages: 1 }));
      return good.subarray(0, Math.floor(good.length * 0.4));
    })(),
  },
];

let failures = 0;
const seen = new Set();

for (const c of cases) {
  let message = null;
  let name = null;
  try {
    await PDFDocument.load(c.bytes, { updateMetadata: false });
    console.log(`  FAIL  ${c.what} did not throw at all`);
    failures++;
    continue;
  } catch (err) {
    message = String(err?.message ?? '');
    name = err?.name;
  }

  const matched = fragments.filter((f) => message.includes(f.text));
  const right = matched.some((f) => f.kind === c.kind);
  console.log(`  ${right ? 'ok  ' : 'FAIL'}  ${c.what}`);
  console.log(`        name=${name}  message="${message.slice(0, 70)}${message.length > 70 ? '…' : ''}"`);
  if (right) {
    for (const m of matched) seen.add(m.text);
  } else {
    console.log(`        expected a fragment of kind "${c.kind}" to match; matched: ${matched.map((m) => m.text).join(', ') || 'none'}`);
    failures++;
  }
}

// The error classes really are unidentifiable — assert that too, so if a future pdf-lib
// fixes it, we find out and can go back to proper type dispatch.
const { EncryptedPDFError } = await import('pdf-lib');
let typedWorks = false;
try {
  await PDFDocument.load(new Uint8Array(buildEncryptedPdf({ userPassword: 'x', pages: 1 })), { updateMetadata: false });
} catch (err) {
  typedWorks = err instanceof EncryptedPDFError;
}
console.log();
if (typedWorks) {
  console.log('  NOTE  pdf-lib error classes now survive instanceof — message matching in');
  console.log('        errors.ts can be replaced with proper type dispatch.');
} else {
  console.log('  ok    pdf-lib error classes are still unidentifiable (instanceof false),');
  console.log('        so message matching remains necessary.');
}

const unused = fragments.filter((f) => !seen.has(f.text));
if (unused.length) {
  console.log(`\n  note  ${unused.length} fragment(s) not exercised here: ${unused.map((f) => f.text).join(', ')}`);
}

console.log();
console.log(failures === 0 ? 'pdf-lib error messages still match errors.ts' : `${failures} mismatch(es) — errors.ts needs updating for this pdf-lib`);
process.exit(failures === 0 ? 0 : 1);
