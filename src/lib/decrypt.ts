/**
 * Decrypting a password-protected PDF, in the browser.
 *
 * The original design routed this through pdf.js: open with the password, call
 * `saveDocument()`, hand the result to pdf-lib. That does not work, and it was never run
 * until a real locked file arrived. `saveDocument()` writes back annotation and form
 * changes; it preserves encryption. Measured on a 1,679-byte fixture: the output was
 * 1,679 bytes, still carried `/Encrypt`, and pdf-lib refused it.
 *
 * pdf-lib cannot decrypt at all. So the decryption happens here.
 *
 * The structure of a PDF is plaintext even when encrypted — only strings and stream
 * contents are ciphertext. That means pdf-lib can parse the object graph with
 * `ignoreEncryption`, and the job reduces to walking that graph and decrypting the
 * leaves, then dropping `/Encrypt`. No PDF parser of our own is needed.
 *
 * Handlers covered, which is everything in ordinary use:
 *   V1      RC4 40-bit                    (R2)
 *   V2      RC4 40–128 bit                (R3)
 *   V4      AES-128, /AESV2               (R4)
 *   V5      AES-256, /AESV3               (R5 and R6)
 *
 * MD5 is implemented here because WebCrypto does not offer it and the pre-AES key
 * derivations require it. AES and SHA-256 come from WebCrypto.
 */

import {
  PDFDocument, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef,
  PDFString, PDFHexString, PDFArray, type PDFObject,
} from 'pdf-lib';

// ---------------------------------------------------------------- MD5

/** RFC 1321. Needed for every handler below AES-256, and absent from WebCrypto. */
function md5(input: Uint8Array): Uint8Array {
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

  const len = input.length;
  const withPadding = new Uint8Array(((len + 8) >> 6 << 6) + 64);
  withPadding.set(input);
  withPadding[len] = 0x80;
  const bitLen = len * 8;
  const view = new DataView(withPadding.buffer);
  view.setUint32(withPadding.length - 8, bitLen >>> 0, true);
  view.setUint32(withPadding.length - 4, Math.floor(bitLen / 4294967296), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const rotl = (x: number, c: number) => (x << c) | (x >>> (32 - c));

  for (let chunk = 0; chunk < withPadding.length; chunk += 64) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) M[i] = view.getUint32(chunk + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + rotl(F, S[i])) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  new DataView(out.buffer).setUint32(0, a0, true);
  new DataView(out.buffer).setUint32(4, b0, true);
  new DataView(out.buffer).setUint32(8, c0, true);
  new DataView(out.buffer).setUint32(12, d0, true);
  return out;
}

// ---------------------------------------------------------------- RC4

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
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

// ---------------------------------------------------------------- helpers

const PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

function padPassword(pw: string): Uint8Array {
  const bytes = latin1(pw);
  return concat(bytes.subarray(0, 32), PAD).subarray(0, 32);
}

const equal = (a: Uint8Array, b: Uint8Array, n = Math.min(a.length, b.length)) => {
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
};

async function aesCbcNoPadDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  // AES-CBC with nothing removed. WebCrypto always strips PKCS#7 and throws on a bad pad,
  // and PDF has two kinds of AES data: streams and strings, which are PKCS#7-padded, and
  // the AES-256 key material (/UE, /OE, /Perms), which is not padded at all. So a final
  // block is appended whose decryption is exactly one full block of padding — sixteen
  // 0x10 — WebCrypto strips that, and what is left is the ciphertext decrypted byte for
  // byte. Callers remove PKCS#7 themselves, once, where it applies.
  //
  // This used to append sixteen zero bytes. Their decryption is random, so WebCrypto
  // rejected the pad and threw — uncaught, on every AES-256 file's /UE — or, about once
  // in 256 blocks, accepted it and returned the block with trailing garbage.
  if (data.length === 0 || data.length % 16 !== 0) throw new Error('AES data is not a whole number of blocks');
  const k = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-CBC', false, ['encrypt', 'decrypt']);
  const last = data.subarray(data.length - 16);
  const target = new Uint8Array(16).fill(16);
  for (let i = 0; i < 16; i++) target[i] ^= last[i];
  // CBC under a zero IV over one block is AES-ECB of that block. WebCrypto appends its own
  // padding block to the ciphertext; only the first block is wanted.
  const extra = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(16) as BufferSource }, k, target as BufferSource)
  ).subarray(0, 16);
  const out = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv as BufferSource }, k, concat(data, extra) as BufferSource);
  return new Uint8Array(out);
}

// ---------------------------------------------------------------- the handler

interface Handler {
  /** File encryption key. */
  key: Uint8Array;
  /** Cipher for strings and streams. */
  cipher: 'rc4' | 'aes';
  /** V5 uses the file key directly, with no per-object derivation. */
  perObject: boolean;
}

interface EncryptInfo {
  v: number;
  r: number;
  length: number;
  O: Uint8Array;
  U: Uint8Array;
  OE: Uint8Array | null;
  UE: Uint8Array | null;
  P: number;
  id: Uint8Array;
  cipher: 'rc4' | 'aes';
  encryptMetadata: boolean;
  /** R6 only: an encrypted copy of /P, which is the only thing protecting /P on R6. */
  Perms: Uint8Array | null;
}

const bytesOf = (o: PDFObject | undefined): Uint8Array | null =>
  o instanceof PDFString || o instanceof PDFHexString ? o.asBytes() : null;

/** Read the encryption dictionary. It is never itself encrypted. */
function readEncryptDict(doc: PDFDocument): EncryptInfo | null {
  const ref = doc.context.trailerInfo.Encrypt;
  const dict = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
  if (!(dict instanceof PDFDict)) return null;

  const num = (k: string, d: number) => {
    const v = dict.lookup(PDFName.of(k));
    return v instanceof PDFNumber ? v.asNumber() : d;
  };
  const v = num('V', 0);
  const r = num('R', 0);
  const O = bytesOf(dict.lookup(PDFName.of('O')));
  const U = bytesOf(dict.lookup(PDFName.of('U')));
  if (!O || !U) return null;

  // V4/V5 name a crypt filter; anything other than AES there means RC4.
  let cipher: 'rc4' | 'aes' = 'rc4';
  if (v >= 4) {
    const cf = dict.lookup(PDFName.of('CF'));
    const stmF = dict.lookup(PDFName.of('StmF'));
    const name = stmF instanceof PDFName ? stmF.asString().replace(/^\//, '') : 'StdCF';
    const filter = cf instanceof PDFDict ? cf.lookup(PDFName.of(name)) : null;
    const cfm = filter instanceof PDFDict ? filter.lookup(PDFName.of('CFM')) : null;
    const method = cfm instanceof PDFName ? cfm.asString().replace(/^\//, '') : '';
    if (method === 'AESV2' || method === 'AESV3') cipher = 'aes';
  }

  const idArray = doc.context.trailerInfo.ID;
  const first = idArray instanceof PDFArray ? idArray.lookup(0) : null;
  const id = bytesOf(first ?? undefined) ?? new Uint8Array(0);

  const meta = dict.lookup(PDFName.of('EncryptMetadata'));
  return {
    v, r,
    length: num('Length', 40),
    O, U,
    OE: bytesOf(dict.lookup(PDFName.of('OE'))),
    UE: bytesOf(dict.lookup(PDFName.of('UE'))),
    P: num('P', -1) | 0,
    id,
    cipher,
    encryptMetadata: !(meta && String(meta) === 'false'),
    Perms: bytesOf(dict.lookup(PDFName.of('Perms'))),
  };
}

const keyLength = (info: EncryptInfo) =>
  info.v === 1 ? 5 : Math.max(5, Math.min(16, info.length >> 3));

/** Algorithm 2: the file key for R2–R4, from an already-padded password. */
function legacyKeyFromPadded(info: EncryptInfo, padded: Uint8Array): Uint8Array {
  const n = keyLength(info);
  const p = new Uint8Array(4);
  new DataView(p.buffer).setInt32(0, info.P, true);

  const pieces = [padded.subarray(0, 32), info.O.subarray(0, 32), p, info.id];
  if (info.r >= 4 && !info.encryptMetadata) {
    pieces.push(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
  }
  let hash = md5(concat(...pieces));
  if (info.r >= 3) {
    for (let i = 0; i < 50; i++) hash = md5(hash.subarray(0, n));
  }
  return hash.subarray(0, n);
}

const legacyKey = (info: EncryptInfo, password: string) =>
  legacyKeyFromPadded(info, padPassword(password));

/**
 * Algorithm 7: authenticate an *owner* password.
 *
 * A PDF carries two passwords. The user password opens it; the owner password also opens
 * it and additionally lifts the restrictions. Checking only the user password rejects a
 * correct owner password — which is what happened with the first real locked file to
 * reach this code: pdf.js opened it and this did not, because the password supplied was
 * the owner one and the file's user password is something else entirely.
 *
 * The owner password is verified indirectly: it decrypts /O to recover the padded user
 * password, and that is then checked the ordinary way.
 */
function userPasswordFromOwner(info: EncryptInfo, password: string): Uint8Array {
  const n = keyLength(info);
  let hash = md5(padPassword(password));
  if (info.r >= 3) {
    for (let i = 0; i < 50; i++) hash = md5(hash.subarray(0, n));
  }
  const rc4Key = hash.subarray(0, n);

  if (info.r === 2) return rc4(rc4Key, info.O);
  // R3 and R4 apply RC4 twenty times, with the key XORed by a descending counter.
  let value = info.O;
  for (let i = 19; i >= 0; i--) {
    const k = new Uint8Array(n);
    for (let j = 0; j < n; j++) k[j] = rc4Key[j] ^ i;
    value = rc4(k, value);
  }
  return value;
}

/** Algorithms 4 and 5: does this key match the /U value? */
function legacyKeyMatches(info: EncryptInfo, key: Uint8Array): boolean {
  if (info.r === 2) return equal(rc4(key, PAD), info.U, 32);
  const hash = md5(concat(PAD, info.id));
  let value = rc4(key, hash);
  for (let i = 1; i <= 19; i++) {
    const k = new Uint8Array(key.length);
    for (let j = 0; j < key.length; j++) k[j] = key[j] ^ i;
    value = rc4(k, value);
  }
  // Only the first 16 bytes are defined; the rest is arbitrary padding.
  return equal(value, info.U, 16);
}

const sha256 = async (data: Uint8Array) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));

/**
 * Algorithm 2.B, the R6 hash. R5 is the single SHA-256 that starts it.
 *
 * Exported for src/pro/encrypt.ts, which writes the values this reads. One implementation, so a
 * file this project writes and a file it reads cannot disagree about the hash.
 */
export async function hash2B(password: Uint8Array, salt: Uint8Array, extra: Uint8Array, r: number): Promise<Uint8Array> {
  let k = await sha256(concat(password, salt, extra));
  if (r === 5) return k;

  for (let round = 0; ; round++) {
    const k1Parts: Uint8Array[] = [];
    for (let i = 0; i < 64; i++) k1Parts.push(password, k, extra);
    const k1 = concat(...k1Parts);
    const aesKey = await crypto.subtle.importKey('raw', k.subarray(0, 16) as BufferSource, 'AES-CBC', false, ['encrypt']);
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-CBC', iv: k.subarray(16, 32) as BufferSource }, aesKey, k1 as BufferSource)
    ).subarray(0, k1.length);

    let sum = 0;
    for (let i = 0; i < 16; i++) sum += encrypted[i];
    const which = sum % 3;
    const algo = which === 0 ? 'SHA-256' : which === 1 ? 'SHA-384' : 'SHA-512';
    k = new Uint8Array(await crypto.subtle.digest(algo, encrypted as BufferSource));

    // Stop once at least 64 rounds are done and the last byte of E is at most the round
    // count minus 32 — counting rounds from one, as the spec and qpdf do. `round` here counts
    // from zero, so the bound is round - 31. It said round - 32, which ran an extra round
    // whenever the byte landed exactly on the boundary: a correct password then failed, on
    // some files and not others, depending only on the bytes.
    if (round >= 63 && encrypted[encrypted.length - 1] <= round - 31) break;
  }
  return k.subarray(0, 32);
}

/**
 * Algorithms 2.A / 8 / 9: the AES-256 file key.
 *
 * The owner password is tried first, as Algorithm 2.A specifies. Which password
 * authenticated decides whether an author's limits may be lifted (PASSWORD_RULE.md), and a
 * file whose two passwords are the same must count as opened by its owner.
 *
 * Two defects lived here, both unseen because the only fixture was RC4. The owner check
 * passed U as part of the salt instead of as the hash's third input; for R5 that is the
 * same bytes, but R6 mixes that input into every round, so no owner password ever matched.
 * And /UE and /OE were decrypted with a trick that threw on unpadded data — which they
 * always are — so the right user password crashed the tool instead of opening the file.
 */
async function aes256Key(info: EncryptInfo, password: string): Promise<{ key: Uint8Array; role: 'user' | 'owner' } | null> {
  // V5 passwords are UTF-8, not Latin-1: PDF 32000-2 says the bytes are the UTF-8 encoding of the
  // password (SASLprep first, which this does not do — see TECH_DEBT). Latin-1 here was invisible
  // on every ASCII fixture and wrong on the first password with an accent in it: MuPDF opened a
  // file this refused. R2-R4 remain Latin-1, which is what padPassword does.
  const pw = new TextEncoder().encode(password).subarray(0, 127);
  const U = info.U;
  if (U.length < 48) return null;
  const zeroIv = new Uint8Array(16);

  if (info.O.length >= 48 && info.OE && info.OE.length >= 32) {
    const oCheck = await hash2B(pw, info.O.subarray(32, 40), U.subarray(0, 48), info.r);
    if (equal(oCheck, info.O.subarray(0, 32), 32)) {
      const intermediate = await hash2B(pw, info.O.subarray(40, 48), U.subarray(0, 48), info.r);
      return { key: await aesCbcNoPadDecrypt(intermediate, zeroIv, info.OE.subarray(0, 32)), role: 'owner' };
    }
  }

  const check = await hash2B(pw, U.subarray(32, 40), new Uint8Array(0), info.r);
  if (equal(check, U.subarray(0, 32), 32)) {
    if (!info.UE || info.UE.length < 32) return null;
    const intermediate = await hash2B(pw, U.subarray(40, 48), new Uint8Array(0), info.r);
    return { key: await aesCbcNoPadDecrypt(intermediate, zeroIv, info.UE.subarray(0, 32)), role: 'user' };
  }
  return null;
}

/** Algorithm 1: the per-object key. */
function objectKey(handler: Handler, num: number, gen: number): Uint8Array {
  if (!handler.perObject) return handler.key;
  const extra = new Uint8Array([
    num & 0xff, (num >> 8) & 0xff, (num >> 16) & 0xff, gen & 0xff, (gen >> 8) & 0xff,
  ]);
  const parts = handler.cipher === 'aes'
    ? [handler.key, extra, new Uint8Array([0x73, 0x41, 0x6c, 0x54])] // "sAlT"
    : [handler.key, extra];
  return md5(concat(...parts)).subarray(0, Math.min(handler.key.length + 5, 16));
}

async function decryptBytes(handler: Handler, key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (handler.cipher === 'rc4') return rc4(key, data);
  if (data.length <= 16) return new Uint8Array(0);
  const iv = data.subarray(0, 16);
  const body = data.subarray(16);
  if (body.length % 16 !== 0) return new Uint8Array(0);
  try {
    const out = await aesCbcNoPadDecrypt(key, iv, body);
    // PKCS#7, removed exactly once and only when it is well formed. This used to let
    // WebCrypto strip it and then strip again by the last byte of what remained, so any
    // stream or string whose real final byte was 0x01-0x10 — a newline is 0x0A — lost up
    // to sixteen bytes of content. That is how AES-128 files came out with page streams
    // cut short: they opened, pdf-lib accepted them, and the text was gone.
    const pad = out[out.length - 1];
    if (pad >= 1 && pad <= 16 && pad <= out.length && out.subarray(out.length - pad).every((b) => b === pad)) {
      return out.subarray(0, out.length - pad);
    }
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

/**
 * The eight standard permissions in /P — 1-based bits 3, 4, 5, 6, 9, 10, 11 and 12 of PDF
 * 32000-1 Table 22: print, modify, copy, annotate, fill forms, extract for accessibility,
 * assemble, print at full quality. All of them set means the author restricted nothing.
 */
const STANDARD_PERMISSIONS = 0xf3c;
export const allPermissions = (p: number): boolean => (p & STANDARD_PERMISSIONS) === STANDARD_PERMISSIONS;

/**
 * R6 protects /P only through /Perms, an AES-encrypted copy of it. Returns the /P it
 * carries, or null when it does not verify. PASSWORD_RULE.md asks for this rather than
 * trusting the plaintext, which anyone can edit on an R6 file without breaking the key.
 */
async function permsP(info: EncryptInfo, key: Uint8Array): Promise<number | null> {
  if (!info.Perms || info.Perms.length < 16) return null;
  const block = await aesCbcNoPadDecrypt(key, new Uint8Array(16), info.Perms.subarray(0, 16));
  if (block[9] !== 0x61 || block[10] !== 0x64 || block[11] !== 0x62) return null; // "adb"
  return new DataView(block.buffer, block.byteOffset, 4).getInt32(0, true);
}

const describe = (info: EncryptInfo): string =>
  info.v === 5 ? `AES-256 (R${info.r})` : info.cipher === 'aes' ? 'AES-128' : `RC4 ${info.length || 40}-bit`;

export type DecryptResult =
  | { ok: true; bytes: Uint8Array; handler: string; role: 'user' | 'owner' }
  /** `restricts` is read from /P as declared, so a notice can be shown before any password. */
  | { ok: false; reason: 'wrong-password'; detail: string; restricts: boolean }
  /**
   * The password opened the file, but the author set limits and it was not the owner
   * password. Every tool here writes an unencrypted copy, so using it would strip those
   * limits — which PASSWORD_RULE.md forbids. Refused rather than stripped.
   */
  | { ok: false; reason: 'restricted'; detail: string }
  | { ok: false; reason: 'unsupported'; detail: string };

/**
 * What a file allowed, and to whom, once a password has authenticated. The mechanism with no
 * policy in it: it never refuses on the rule's behalf.
 */
export type UnlockResult =
  | {
    ok: true;
    /** The document with every string and stream in the clear and no encryption dictionary. */
    bytes: Uint8Array;
    /** "AES-256 (R6)", "RC4 128-bit" — what the file used. */
    detail: string;
    role: 'user' | 'owner';
    /** The authentic /P where it can be known, and the declared one where it cannot. */
    permissions: number;
    /** False when R6's /Perms did not verify: /P is then only what the file claims. */
    permissionsAuthentic: boolean;
    /** PASSWORD_RULE.md's one predicate: owner, or an author who restricted nothing. */
    mayLift: boolean;
  }
  | { ok: false; reason: 'wrong-password'; detail: string; restricts: boolean }
  | { ok: false; reason: 'unsupported'; detail: string };

/**
 * Authenticate a password, decrypt the document, and say what it permits.
 *
 * This is the mechanism both surfaces of the rule are built on, and it is one implementation on
 * purpose: `decryptPdf` below is this plus PASSWORD_RULE.md's refusal, and the Pro password page
 * is this plus the ability to write a kept-limits copy. Two callers cannot disagree about which
 * password authenticated, or about what the file permits, because neither decides it.
 */
export async function unlockPdf(bytes: Uint8Array, password: string): Promise<UnlockResult> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const info = readEncryptDict(doc);
  if (!info) return { ok: false, reason: 'unsupported', detail: 'no readable encryption dictionary' };

  const filter = (() => {
    const ref = doc.context.trailerInfo.Encrypt;
    const dict = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
    const f = dict instanceof PDFDict ? dict.lookup(PDFName.of('Filter')) : null;
    return f instanceof PDFName ? f.asString().replace(/^\//, '') : '';
  })();
  if (filter && filter !== 'Standard') {
    return { ok: false, reason: 'unsupported', detail: `${filter} security handler` };
  }

  const detail = describe(info);
  const wrong = { ok: false as const, reason: 'wrong-password' as const, detail, restricts: !allPermissions(info.P) };

  let handler: Handler;
  let role: 'user' | 'owner';
  if (info.v === 5) {
    const result = await aes256Key(info, password);
    if (!result) return wrong;
    handler = { key: result.key, cipher: 'aes', perObject: false };
    role = result.role;
  } else if (info.v >= 1 && info.v <= 4) {
    // Owner first: which password authenticated decides what may be
    // lifted, so a password that is both must count as the owner's.
    const asOwner = legacyKeyFromPadded(info, userPasswordFromOwner(info, password));
    if (legacyKeyMatches(info, asOwner)) {
      handler = { key: asOwner, cipher: info.cipher, perObject: true };
      role = 'owner';
    } else {
      const asUser = legacyKey(info, password);
      if (!legacyKeyMatches(info, asUser)) return wrong;
      handler = { key: asUser, cipher: info.cipher, perObject: true };
      role = 'user';
    }
  } else {
    return { ok: false, reason: 'unsupported', detail: `V${info.v} handler` };
  }

  // On R2-R4 /P is mixed into the key, so an edited /P does not open at all; on R6 only /Perms
  // protects it, so the authentic value comes from there, and a /Perms that does not verify
  // counts as restricted — failing closed.
  const p = info.v === 5 ? await permsP(info, handler.key) : info.P;
  const mayLift = role === 'owner' || (p !== null && allPermissions(p));

  // Walk the object graph and decrypt every string and stream in place. The structure is
  // already plaintext, which is why this works without a parser of our own.
  const encryptRef = doc.context.trailerInfo.Encrypt;
  const encryptKey = encryptRef instanceof PDFRef ? encryptRef.toString() : null;

  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (encryptKey && ref.toString() === encryptKey) continue; // never encrypted
    const key = objectKey(handler, ref.objectNumber, ref.generationNumber);

    if (object instanceof PDFRawStream) {
      const plain = await decryptBytes(handler, key, object.getContents());
      const dict = object.dict;
      dict.set(PDFName.of('Length'), PDFNumber.of(plain.length));
      doc.context.assign(ref, PDFRawStream.of(dict, plain));
      await decryptStringsIn(dict, handler, key);
    } else {
      await decryptStringsIn(object, handler, key);
    }
  }

  // With the contents in the clear, the encryption dictionary must go, or a reader would
  // try to decrypt them a second time.
  delete doc.context.trailerInfo.Encrypt;
  if (encryptRef instanceof PDFRef) doc.context.delete(encryptRef);

  const out = await doc.save({ useObjectStreams: false });
  return {
    ok: true,
    bytes: out,
    detail,
    role,
    permissions: p ?? info.P,
    permissionsAuthentic: p !== null,
    mayLift,
  };
}

/**
 * Decrypt a protected document and return bytes pdf-lib can open normally — only when the rule
 * allows the result to be unrestricted.
 *
 * The rule, decided 11 September 2026 for Android and the web alike: removing a password never
 * lifts an author's print/copy/edit limits without the owner password.
 *
 *     may lift = the password authenticated as the owner, OR /P restricts nothing
 *
 * An empty `password` is how a file with only an owner password opens — and a file like that with
 * restricted /P is exactly the case this refuses. Stripping it silently is what this function did
 * until TECH_DEBT 27 was fixed. Every tool here writes an unencrypted copy, so refusing is the
 * only honest answer on those pages. A surface that can write a kept-limits copy does that
 * instead, and calls unlockPdf directly.
 */
export async function decryptPdf(bytes: Uint8Array, password: string): Promise<DecryptResult> {
  const opened = await unlockPdf(bytes, password);
  if (!opened.ok) return opened;
  if (!opened.mayLift) return { ok: false, reason: 'restricted', detail: opened.detail };
  return {
    ok: true,
    bytes: opened.bytes,
    handler: `${opened.detail}, ${opened.role} password`,
    role: opened.role,
  };
}

/** Strings live inside dictionaries and arrays, at any depth. */
async function decryptStringsIn(object: PDFObject, handler: Handler, key: Uint8Array, depth = 0): Promise<void> {
  if (depth > 24) return;
  if (object instanceof PDFDict) {
    for (const [name, value] of object.entries()) {
      if (value instanceof PDFString || value instanceof PDFHexString) {
        const plain = await decryptBytes(handler, key, value.asBytes());
        object.set(name, PDFHexString.of(hex(plain)));
      } else if (value instanceof PDFDict || value instanceof PDFArray) {
        await decryptStringsIn(value, handler, key, depth + 1);
      }
    }
  } else if (object instanceof PDFArray) {
    for (let i = 0; i < object.size(); i++) {
      const value = object.get(i);
      if (value instanceof PDFString || value instanceof PDFHexString) {
        const plain = await decryptBytes(handler, key, value.asBytes());
        object.set(i, PDFHexString.of(hex(plain)));
      } else if (value instanceof PDFDict || value instanceof PDFArray) {
        await decryptStringsIn(value, handler, key, depth + 1);
      }
    }
  }
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Is this document encrypted at all? Structural, not error-based. */
export async function isEncrypted(bytes: Uint8Array): Promise<boolean> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return doc.isEncrypted;
  } catch {
    return false;
  }
}
