// Builds a password-protected PDF so the unlock path can be tested.
//
// There is no qpdf, mutool or Ghostscript here, and pdf-lib cannot encrypt, so the
// fixture is written by hand: the standard security handler, V1/R2, 40-bit RC4, exactly
// as Algorithms 2, 3, 4 and 1 of the PDF specification describe it. Small, and it is the
// most common form of "this PDF has a password" in the wild.
//
// The content is a synthetic invoice. No real document is committed to this repo.

import { createHash } from 'node:crypto';

const PAD = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const md5 = (...bufs) => createHash('md5').update(Buffer.concat(bufs)).digest();

/** Pad or truncate a password to the 32 bytes the algorithms expect. */
function padPassword(pw) {
  const bytes = Buffer.from(pw, 'latin1');
  return Buffer.concat([bytes.subarray(0, 32), PAD]).subarray(0, 32);
}

function rc4(key, data) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

const KEY_LENGTH = 5; // 40-bit

/** Algorithm 3: the /O entry. */
function ownerValue(ownerPw, userPw) {
  const digest = md5(padPassword(ownerPw)).subarray(0, KEY_LENGTH);
  return rc4(digest, padPassword(userPw));
}

/** Algorithm 2: the file encryption key. */
function fileKey(userPw, O, P, id) {
  const pBytes = Buffer.alloc(4);
  pBytes.writeInt32LE(P, 0);
  return md5(padPassword(userPw), O, pBytes, id).subarray(0, KEY_LENGTH);
}

/** Algorithm 4: the /U entry for R2. */
const userValue = (key) => rc4(key, PAD);

/** Algorithm 1: per-object key. */
function objectKey(key, num, gen) {
  const extra = Buffer.from([num & 0xff, (num >> 8) & 0xff, (num >> 16) & 0xff, gen & 0xff, (gen >> 8) & 0xff]);
  return md5(key, extra).subarray(0, Math.min(key.length + 5, 16));
}

const escapeString = (buf) =>
  Buffer.from(
    Array.from(buf).flatMap((b) =>
      b === 0x5c || b === 0x28 || b === 0x29 ? [0x5c, b] : [b]
    )
  );

/**
 * @param {{ userPassword: string, ownerPassword?: string, pages?: number }} opts
 */
export function buildEncryptedPdf(opts) {
  const userPw = opts.userPassword;
  const ownerPw = opts.ownerPassword ?? `${userPw}-owner`;
  const pageCount = opts.pages ?? 2;

  // A fixed id so the file is byte-identical between runs, which keeps the fixture
  // reproducible and makes a diff meaningful if it ever changes.
  const id = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
  const P = -3904; // print/copy denied, the usual restrictive default

  const O = ownerValue(ownerPw, userPw);
  const key = fileKey(userPw, O, P, id);
  const U = userValue(key);

  const parts = [];
  let length = 0;
  const push = (b) => {
    const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b;
    parts.push(buf);
    length += buf.length;
  };

  const offsets = {};
  const startObj = (n) => { offsets[n] = length; push(`${n} 0 obj\n`); };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  // 1 catalog, 2 pages, 3 font, then per page: page + contents
  startObj(1); push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const kids = [];
  for (let i = 0; i < pageCount; i++) kids.push(`${4 + i * 2} 0 R`);
  startObj(2); push(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>\nendobj\n`);
  startObj(3); push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  for (let i = 0; i < pageCount; i++) {
    const pageNum = 4 + i * 2;
    const contentNum = pageNum + 1;
    startObj(pageNum);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>\nendobj\n`);

    const text = `BT /F1 18 Tf 60 760 Td (Locked fixture page ${i + 1} of ${pageCount}) Tj ET\n` +
      `BT /F1 12 Tf 60 720 Td (This document is encrypted with a user password.) Tj ET\n`;
    // Streams are encrypted with the per-object key.
    const enc = rc4(objectKey(key, contentNum, 0), Buffer.from(text, 'latin1'));
    startObj(contentNum);
    push(`<< /Length ${enc.length} >>\nstream\n`);
    push(enc);
    push('\nendstream\nendobj\n');
  }

  // The encryption dictionary itself is never encrypted.
  const encNum = 4 + pageCount * 2;
  startObj(encNum);
  push('<< /Filter /Standard /V 1 /R 2 ' +
    `/O (${escapeString(O).toString('latin1')}) ` +
    `/U (${escapeString(U).toString('latin1')}) ` +
    `/P ${P} >>\nendobj\n`);

  const total = encNum;
  const xrefAt = length;
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= total; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Encrypt ${encNum} 0 R ` +
    `/ID [<${id.toString('hex')}> <${id.toString('hex')}>] >>\n` +
    `startxref\n${xrefAt}\n%%EOF\n`);

  return Buffer.concat(parts, length);
}
