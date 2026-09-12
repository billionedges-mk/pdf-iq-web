/**
 * The Pro password feature, checked against files other implementations wrote and read back by
 * readers that did not write them.
 *
 * src/pro/encrypt.ts is the first thing this project writes encryption with, so nothing here may
 * rest on our own reader: every file it produces is opened by MuPDF and by pypdf, and the
 * permissions are read out of the file rather than assumed from what was asked for. Our own
 * unlockPdf is checked too, because the two halves have to agree — but agreeing with itself is
 * not the evidence (CLAIMS 30).
 *
 * What PASSWORD_RULE.md asks a writer for:
 *   - protect keeps an author's /P, so it cannot become a back door around remove;
 *   - the kept-limits copy opens with no password, carries the original /P byte for byte, is
 *     AES-256 V5 R6, and is locked under a random owner password nobody holds.
 *
 *   npm run verify:password        requires python with PyMuPDF and pypdf
 */
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'tools/fixtures/crypto');
const WORK = join(tmpdir(), 'pdfiq-verify-password');
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) fails++;
};

// Both halves from one bundle, so they share the hash they agree on.
await esbuild.build({
  entryPoints: [join(ROOT, 'src/pro/encrypt.ts'), join(ROOT, 'src/lib/decrypt.ts')],
  bundle: true, splitting: true, platform: 'node', format: 'esm', logLevel: 'warning',
  outdir: WORK, entryNames: '[name]', outExtension: { '.js': '.mjs' },
});
const { encryptPdf, NO_RESTRICTIONS } = await import(pathToFileURL(join(WORK, 'encrypt.mjs')).href);
const { unlockPdf, decryptPdf } = await import(pathToFileURL(join(WORK, 'decrypt.mjs')).href);

// ---------------------------------------------------------------- the two readers
const READ = [
  'import sys, json',
  'import fitz',
  'from pypdf import PdfReader',
  'path = sys.argv[1]',
  'pw = sys.argv[2] if len(sys.argv) > 2 else ""',
  'out = {}',
  'fitz.TOOLS.reset_mupdf_warnings()',
  'd = fitz.open(path)',
  'out["needsPass"] = bool(d.needs_pass)',
  'authed = bool(d.authenticate(pw)) if d.needs_pass else True',
  'out["authenticated"] = authed',
  'meta = d.metadata or {}',
  'out["encryption"] = meta.get("encryption")',
  'out["permissions"] = int(d.permissions) & 0xFFFFFFFF',
  'out["text"] = "".join(p.get_text() for p in d) if authed else ""',
  'out["warnings"] = fitz.TOOLS.mupdf_warnings()',
  'r = PdfReader(path)',
  'out["pypdfEncrypted"] = bool(r.is_encrypted)',
  'pok = bool(r.decrypt(pw)) if r.is_encrypted else True',
  'out["pypdfDecrypted"] = pok',
  'out["pypdfText"] = "".join((p.extract_text() or "") for p in r.pages) if pok else ""',
  'enc = r.trailer.get("/Encrypt")',
  'if enc is None:',
  '    out["P"] = None',
  '    out["R"] = None',
  '    out["V"] = None',
  'else:',
  '    e = enc.get_object()',
  '    out["P"] = int(e.get("/P")) & 0xFFFFFFFF',
  '    out["R"] = int(e.get("/R"))',
  '    out["V"] = int(e.get("/V"))',
  'print(json.dumps(out))',
].join('\n');

const read = (file, pw = '') => JSON.parse(execFileSync('python', ['-c', READ, file, pw], { encoding: 'utf8' }));
const write = (name, bytes) => {
  const p = join(WORK, name);
  writeFileSync(p, bytes);
  return p;
};
const fx = (name) => new Uint8Array(readFileSync(join(FIX, name)));

const MARKER = 'PDFIQCRYPTO PAGE 1';
const STANDARD = 0xf3c; // the eight permission bits PASSWORD_RULE.md counts
const U = 'user-pw-2026', O = 'owner-pw-2026';

// ---------------------------------------------------------------- 1. protect a plain file
console.log('\n— protect a file that had no password');
{
  const plain = fx('plain_control.pdf');
  const out = await encryptPdf(plain, { userPassword: 'new-pw-2026', ownerPassword: null, permissions: NO_RESTRICTIONS });
  const file = write('protected.pdf', out);

  const locked = read(file, '');
  ok(locked.needsPass && !locked.authenticated, 'MuPDF will not open it without the password');
  const opened = read(file, 'new-pw-2026');
  ok(opened.authenticated, 'MuPDF opens it with the password');
  ok(/AES.*256|V5|R6/i.test(String(opened.encryption)), `MuPDF reads it as AES-256 ("${opened.encryption}")`);
  ok(opened.R === 6 && opened.V === 5, `written as Standard V5 R6 (V${opened.V} R${opened.R})`);
  ok(opened.text.includes(MARKER), 'MuPDF reads the page text out of it');
  ok(opened.pypdfEncrypted && opened.pypdfDecrypted && opened.pypdfText.includes(MARKER), 'pypdf decrypts it with the same password and reads the same page');
  ok((opened.permissions & STANDARD) === STANDARD, 'every standard permission is granted: this file had no limits to keep');
  ok(!opened.warnings.trim(), `MuPDF raises no warning${opened.warnings.trim() ? `: ${opened.warnings.trim()}` : ''}`);

  const mine = await unlockPdf(out, 'new-pw-2026');
  ok(mine.ok && mine.role === 'user' && mine.mayLift, 'our own reader opens it as the user, and may lift: no limits were set');
  ok(mine.ok && mine.permissionsAuthentic, 'and /Perms verifies, so /P is the authentic one');
  const wrong = await unlockPdf(out, 'not-the-password');
  ok(!wrong.ok && wrong.reason === 'wrong-password', 'a wrong password is refused');
  const removed = await decryptPdf(out, 'new-pw-2026');
  ok(removed.ok, 'and the ordinary remove path takes the password straight back off');
  if (removed.ok) {
    const back = read(write('protected-removed.pdf', removed.bytes), '');
    ok(!back.needsPass && !back.pypdfEncrypted && back.text.includes(MARKER), 'the copy it writes has no encryption left, in both readers');
  }
}

// ---------------------------------------------------------------- 2. the kept-limits copy
console.log('\n— the kept-limits copy: opens with no password, keeps the author\'s limits');
{
  const source = fx('locked_restricted_aes_256.pdf');
  const declared = read(join(FIX, 'locked_restricted_aes_256.pdf'), U).P;

  const opened = await unlockPdf(source, U);
  ok(opened.ok && opened.role === 'user' && !opened.mayLift, 'the user password opens it and may not lift: this is the case the free tools refuse');
  ok(opened.ok && (opened.permissions & STANDARD) === (declared & STANDARD), `the permissions come back as the file declares them (0x${(declared >>> 0).toString(16)})`);

  const kept = await encryptPdf(opened.bytes, { userPassword: '', ownerPassword: null, permissions: opened.permissions });
  const file = write('kept-limits.pdf', kept);
  const r = read(file, '');
  ok(!r.needsPass, 'MuPDF opens it with no password at all');
  ok(r.R === 6 && r.V === 5, `and it is still encrypted, Standard V5 R6 (V${r.V} R${r.R})`);
  ok((r.P & STANDARD) === (declared & STANDARD), `carrying the original permission bits, not reconstructed ones (0x${(r.P >>> 0).toString(16)})`);
  ok((r.permissions & STANDARD) === (declared & STANDARD), 'MuPDF reports the same limits it read from the original');
  ok(r.text.includes(MARKER), 'and the page is intact');
  ok(r.pypdfEncrypted && r.pypdfDecrypted && r.pypdfText.includes(MARKER), 'pypdf opens it without a password and reads the same page');
  ok(!r.warnings.trim(), `MuPDF raises no warning${r.warnings.trim() ? `: ${r.warnings.trim()}` : ''}`);

  const mine = await unlockPdf(kept, '');
  ok(mine.ok && mine.role === 'user' && !mine.mayLift, 'our reader opens it with no password and still may not lift — the limits survived the rewrite');
  ok(mine.ok && mine.permissionsAuthentic, 'and /Perms verifies against the file key');

  // Nobody holds the owner password: the user password is empty, and the owner password was 32
  // random bytes dropped inside encryptPdf. The only check available is that the obvious
  // candidates do not authenticate as owner.
  for (const guess of ['', U, O, 'owner']) {
    const attempt = await unlockPdf(kept, guess);
    ok(!(attempt.ok && attempt.role === 'owner'), `"${guess || '(empty)'}" does not open it as the owner`);
  }
}

// ---------------------------------------------------------------- 3. protect keeps /P
console.log('\n— protect keeps an author\'s limits, so it is not a back door around remove');
{
  const source = fx('locked_owner_only_aes_128.pdf');
  const declared = read(join(FIX, 'locked_owner_only_aes_128.pdf'), '').P;
  ok((declared & STANDARD) !== STANDARD, `the fixture is owner-only: it opens freely and restricts something (0x${(declared >>> 0).toString(16)})`);

  const opened = await unlockPdf(source, '');
  ok(opened.ok && !opened.mayLift, 'it opens with no password, and may not lift');

  const protectedBytes = await encryptPdf(opened.bytes, { userPassword: 'new-pw-2026', ownerPassword: null, permissions: opened.permissions });
  const r = read(write('protected-keeps-p.pdf', protectedBytes), 'new-pw-2026');
  ok(r.needsPass && r.authenticated, 'the copy needs the new password');
  ok((r.P & STANDARD) === (declared & STANDARD), 'and still carries the author\'s permission bits');
  ok(r.text.includes(MARKER), 'with the page intact');
  const mine = await unlockPdf(protectedBytes, 'new-pw-2026');
  ok(mine.ok && !mine.mayLift, 'so the new password does not lift what the owner password withheld');
}

// ---------------------------------------------------------------- 4. a password that is not ASCII
console.log('\n— a password outside ASCII');
{
  const PW = 'pässwörd-2026';
  const out = await encryptPdf(fx('plain_control.pdf'), { userPassword: PW, ownerPassword: null, permissions: NO_RESTRICTIONS });
  const file = write('protected-utf8.pdf', out);
  const r = read(file, PW);
  ok(r.authenticated && r.text.includes(MARKER), 'MuPDF opens it with the password as typed — V5 passwords are UTF-8');
  const mine = await unlockPdf(out, PW);
  ok(mine.ok, 'and so does our own reader, which is the half that has to agree with it');

  // pypdf 5.9.0 encodes a V5 password Latin-1 — the same mistake decrypt.ts had until this case
  // was written. It is pypdf's and not ours: pypdf also refuses a file MuPDF wrote with this
  // password, and accepts either file when handed the UTF-8 bytes as a Latin-1 string (measured
  // 12 September 2026). If the first check below ever fails, pypdf has been fixed — read it as
  // good news, and require pypdf here the way MuPDF is required.
  ok(r.pypdfDecrypted === false, 'pypdf 5.9.0 does not, because it encodes V5 passwords Latin-1: not evidence about this file');
  const asLatin1 = read(file, Buffer.from(PW, 'utf8').toString('latin1'));
  ok(asLatin1.pypdfDecrypted && asLatin1.pypdfText.includes(MARKER),
    'and handed those same bytes the way pypdf encodes them, it opens the file and reads the page');
}

// ---------------------------------------------------------------- 5. an edited /P
console.log('\n— /P edited after the fact');
{
  const out = await encryptPdf(fx('plain_control.pdf'), { userPassword: 'new-pw-2026', ownerPassword: null, permissions: -3392 });
  const text = Buffer.from(out).toString('latin1');
  const at = text.indexOf('/P -3392');
  ok(at > 0, 'the written /P is there to edit');
  const edited = Buffer.from(text.replace('/P -3392', '/P -0004'), 'latin1');
  const mine = await unlockPdf(new Uint8Array(edited), 'new-pw-2026');
  ok(mine.ok, 'the file still opens: /P is not part of the R6 key');
  // The first version of this check asserted that /Perms "fails to verify". It does verify — it
  // is an encrypted copy of the original /P, and an edit to the plaintext cannot touch it. The
  // point is that the edited value is never the one used.
  ok(mine.ok && mine.permissions === -3392 && mine.permissionsAuthentic,
    `the permissions come from /Perms, not from the edited /P (${mine.permissions})`);
  ok(mine.ok && !mine.mayLift, 'so the rule sees the author\'s limits, not the ones the edit asked for');
}

console.log(`\n${fails ? `${fails} FAILED` : 'the password writer behaves as PASSWORD_RULE.md describes, every output read by MuPDF and pypdf'}`);
process.exit(fails ? 1 : 0);
