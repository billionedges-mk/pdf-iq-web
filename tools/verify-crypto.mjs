/**
 * PASSWORD_RULE.md, checked against real encrypted files rather than the one this site
 * makes for itself.
 *
 * Why this exists. The only encrypted fixture here was `encrypt-fixture.mjs`'s RC4 40-bit
 * file — the one case the decryption code handled correctly. AES was implemented from the
 * spec and never run against a file anyone else wrote. The first run of these cases, with
 * the Android app's crypto fixtures (written by MuPDF), found four defects at once, all live in the
 * free tools:
 *
 *   - AES-128 output was silently corrupt. PKCS#7 was stripped twice, so a stream or string
 *     ending in a newline lost ten bytes. It opened, pdf-lib accepted it, and the page text
 *     was gone. Only a second reader could tell.
 *   - AES-256 threw an uncaught exception on the correct user password (/UE was decrypted
 *     with a padding trick that fails on unpadded data), rejected the correct owner password
 *     (U went into the salt instead of the hash's third input), and rejected some correct
 *     user passwords too (the Algorithm 2.B loop stopped one round early).
 *   - TECH_DEBT 27: every restricted file came out unrestricted, including owner-only files
 *     opened with no password at all.
 *
 * And the suite had encoded the last one. Its end-to-end case unlocked a restricted file
 * with the user password and asserted the output carried no encryption.
 *
 * So every file a case lets through is read back by two readers that did not write it,
 * MuPDF and pypdf: no password, no encryption, no MuPDF syntax warnings, and the fixture's own
 * marker text on the page in both. "It opened" was satisfied by the corrupt AES-128 output, so
 * it is not evidence. Two readers because MuPDF also wrote the input fixtures — see below — and
 * a verdict should not rest on the library that made the files being decrypted.
 *
 * Fixtures in tools/fixtures/crypto/ come from the app repo (app/src/androidTest/assets/
 * crypto). They were written by MuPDF 1.27.2 — each file's third line says so; both sessions
 * called them PdfBox-made for a day without opening one. User password user-pw-2026, owner
 * owner-pw-2026 — different
 * on purpose, so the two code paths can be told apart. What each must produce is the table
 * in PASSWORD_RULE.md, with the web's one permitted difference: a surface that cannot write
 * a kept-limits copy refuses that case instead.
 *
 *   npm run verify:crypto              requires python with PyMuPDF and pypdf (pip install pymupdf pypdf)
 *   npm run verify:crypto -- --no-reader   classification only, and says so
 */

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { buildEncryptedPdf } from './encrypt-fixture.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'tools/fixtures/crypto');
const WORK = join(tmpdir(), 'pdfiq-verify-crypto');
const NO_READER = process.argv.includes('--no-reader');

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

// The real open path, not a copy of it: every tool opens a locked file through openPdf.
await esbuild.build({
  entryPoints: [join(ROOT, 'src/lib/open-pdf.ts')],
  bundle: true, platform: 'node', format: 'esm', logLevel: 'warning',
  outfile: join(WORK, 'open-pdf.mjs'),
});
const { openPdf } = await import(pathToFileURL(join(WORK, 'open-pdf.mjs')).href);

const U = 'user-pw-2026', O = 'owner-pw-2026', BAD = 'definitely-not-it';
const fx = (name) => new Uint8Array(readFileSync(join(FIX, name)));

// This site's own fixture: RC4 40-bit, /P 0xFFFFF0C0 (print and copy denied).
const webRc4 = new Uint8Array(buildEncryptedPdf({ userPassword: 'correct-horse', pages: 3 }));

const cases = [['plain / none', fx('plain_control.pdf'), undefined, 'open-plain', 'app']];
for (const f of ['locked_rc4_128', 'locked_aes_128', 'locked_aes_256']) {
  cases.push([`${f} / none`, fx(`${f}.pdf`), undefined, 'locked', 'app']);
  cases.push([`${f} / user`, fx(`${f}.pdf`), U, 'open', 'app']);
  cases.push([`${f} / owner`, fx(`${f}.pdf`), O, 'open', 'app']);
  cases.push([`${f} / wrong`, fx(`${f}.pdf`), BAD, 'wrong', 'app']);
}
const R = fx('locked_restricted_aes_256.pdf');
cases.push(['restricted_aes_256 / none', R, undefined, 'locked-restricted', 'app']);
cases.push(['restricted_aes_256 / user', R, U, 'refused', 'app']);
cases.push(['restricted_aes_256 / owner', R, O, 'open', 'app']);
cases.push(['restricted_aes_256 / wrong', R, BAD, 'wrong', 'app']);
const OO = fx('locked_owner_only_aes_128.pdf');
cases.push(['owner_only_aes_128 / none', OO, undefined, 'refused', 'app']);
cases.push(['owner_only_aes_128 / owner', OO, O, 'open', 'app']);
cases.push(['owner_only_aes_128 / wrong', OO, BAD, 'wrong', 'app']);
cases.push(['web rc4 (restricted) / none', webRc4, undefined, 'locked-restricted', 'web']);
cases.push(['web rc4 (restricted) / user', webRc4, 'correct-horse', 'refused', 'web']);
cases.push(['web rc4 (restricted) / owner', webRc4, 'correct-horse-owner', 'open', 'web']);

// Tampering: rewrite the plaintext /P to grant everything, keeping the byte length. On R6
// only /Perms protects /P, which is what this checks; on R2-R4 /P is mixed into the key,
// so the edited file must simply stop opening with the empty password.
const tamper = (bytes, name) => {
  const raw = Buffer.from(bytes).toString('latin1');
  const from = '/P -3392';
  if (!raw.includes(from)) throw new Error(`${name}: "${from}" is not in plaintext, so the tamper case cannot be built`);
  return new Uint8Array(Buffer.from(raw.replace(from, '/P -4' + ' '.repeat(from.length - 5)), 'latin1'));
};
cases.push(['TAMPERED /P restricted_aes_256 / user', tamper(R, 'restricted_aes_256'), U, 'refused', 'app']);
cases.push(['TAMPERED /P owner_only_aes_128 / none', tamper(OO, 'owner_only_aes_128'), undefined, 'locked', 'app']);

// By type, never by message text.
const classify = (r) => {
  if (r.ok) return r.value.wasEncrypted ? 'open' : 'open-plain';
  const e = r.error;
  if (e.kind === 'wrong-password') return 'wrong';
  if (e.kind === 'restricted') return 'refused';
  if (e.kind === 'locked') return e.ownerPasswordNeeded ? 'locked-restricted' : 'locked';
  return `other:${e.kind}`;
};

const rows = [];
for (const [label, bytes, pw, want, origin] of cases) {
  let got, out = null, threw = '';
  try {
    const r = await openPdf(bytes, { name: label, size: bytes.length, type: 'application/pdf' }, pw);
    got = classify(r);
    if (r.ok && r.value.wasEncrypted) {
      out = `out_${rows.length}.pdf`;
      writeFileSync(join(WORK, out), r.value.bytes);
    }
  } catch (err) {
    // openPdf returns every failure as a value. A throw escapes the tool's error panel.
    got = 'THREW';
    threw = `${err?.name}: ${err?.message}`;
  }
  rows.push({ label, want, got, out, origin, threw, pass: got === want, note: '' });
}

// The second readers. MuPDF also wrote the input fixtures, so pypdf reads every output too:
// the verdict must not rest on the library that made the files being decrypted.
const PY = [
  'import json, os, sys, fitz, pypdf',
  'fitz.TOOLS.mupdf_display_errors(False)',
  'res = {}',
  'for f in sorted(os.listdir(sys.argv[1])):',
  '    if not f.startswith("out_"): continue',
  '    p = os.path.join(sys.argv[1], f)',
  '    fitz.TOOLS.reset_mupdf_warnings()',
  '    d = fitz.open(p)',
  '    text = "" if d.needs_pass else "".join(pg.get_text() for pg in d)',
  '    m = dict(needsPass=bool(d.needs_pass), encryption=d.metadata.get("encryption"),',
  '             pages=len(d), text=text[:400], warnings=fitz.TOOLS.mupdf_warnings().strip()[:160])',
  '    try:',
  '        r = pypdf.PdfReader(p)',
  '        enc = bool(r.is_encrypted)',
  '        pt = "" if enc else "".join((pg.extract_text() or "") for pg in r.pages)',
  '        y = dict(encrypted=enc, pages=len(r.pages), text=pt[:400], error="")',
  '    except Exception as e:',
  '        y = dict(encrypted=None, pages=0, text="", error=repr(e)[:160])',
  '    res[f] = dict(mupdf=m, pypdf=y)',
  'print(json.dumps(res))',
].join('\n');

let reader = null;
if (!NO_READER) {
  try {
    reader = JSON.parse(execFileSync('python', ['-c', PY, WORK], { encoding: 'utf8' }));
  } catch (err) {
    console.error(
      '\nThe outputs could not be read back with MuPDF and pypdf (python + PyMuPDF + pypdf). That check is the point:\n' +
      'the corrupt AES-128 output passed everything else. Install it, or run with --no-reader to\n' +
      'classify only — which is then all this run proves.\n'
    );
    process.exit(2);
  }
  const hasMarker = (text, origin) => (origin === 'app' ? text.includes('PDFIQCRYPTO PAGE 1') : text.trim().length > 0);
  for (const row of rows) {
    if (!row.out) continue;
    const { mupdf: m, pypdf: y } = reader[row.out];
    const mOk = !m.needsPass && m.encryption == null && !m.warnings && hasMarker(m.text, row.origin);
    const yOk = !y.error && y.encrypted === false && hasMarker(y.text, row.origin);
    const mNote = mOk ? 'ok' : 'BAD (' + [
      m.needsPass ? 'needs password' : '', m.encryption ?? '',
      hasMarker(m.text, row.origin) ? '' : 'marker missing', m.warnings ? m.warnings.split('\n')[0] : '',
    ].filter(Boolean).join(', ') + ')';
    const yNote = yOk ? 'ok' : 'BAD (' + (y.error || (y.encrypted ? 'still encrypted' : 'marker missing')) + ')';
    row.note = `MuPDF ${mNote} · pypdf ${yNote} · ${m.pages}p`;
    if (!mOk || !yOk) row.pass = false;
  }
}

let fails = 0;
for (const r of rows) {
  if (!r.pass) fails++;
  console.log(`${r.pass ? 'ok  ' : 'FAIL'}  ${r.label.padEnd(40)} want ${r.want.padEnd(17)} got ${r.got.padEnd(17)} ${r.note}`);
  if (r.threw) console.log(`        threw ${r.threw}`);
}
console.log(`\n${rows.length} cases, ${fails} failing${NO_READER ? ' — outputs NOT read back by a second reader (--no-reader)' : ', every output read back by MuPDF and pypdf'}`);
process.exitCode = fails ? 1 : 0;
