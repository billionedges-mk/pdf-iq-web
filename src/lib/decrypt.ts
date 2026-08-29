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
  // WebCrypto's AES-CBC always strips PKCS#7 padding and rejects a bad pad. PDF streams
  // are padded that way, but a corrupt or short block would throw where we want to fail
  // softly, so decryption is done block by block through a zero-IV trick instead.
  const k = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-CBC', false, ['decrypt']);
  // Append a block encrypted from a known padding so the built-in unpadding succeeds,
  // then discard it. Simpler: decrypt with padding disabled by adding a dummy block.
  const padded = concat(data, new Uint8Array(16));
  try {
    const out = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv as BufferSource }, k, padded as BufferSource);
    return new Uint8Array(out);
  } catch {
    // Fall back: decrypt without the dummy block and accept whatever unpadding gives.
    const out = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv as BufferSource }, k, data as BufferSource);
    return new Uint8Array(out);
  }
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

/** Algorithm 2.B, the R6 hash. R5 is the single SHA-256 that starts it. */
async function hash2B(password: Uint8Array, salt: Uint8Array, extra: Uint8Array, r: number): Promise<Uint8Array> {
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

    if (round >= 63 && encrypted[encrypted.length - 1] <= round - 32) break;
  }
  return k.subarray(0, 32);
}

/** Algorithms 2.A / 8 / 9: the AES-256 file key. */
async function aes256Key(info: EncryptInfo, password: string): Promise<{ key: Uint8Array; role: 'user' | 'owner' } | null> {
  const pw = latin1(password).subarray(0, 127);
  const U = info.U;
  if (U.length < 48) return null;

  const validation = U.subarray(32, 40);
  const keySalt = U.subarray(40, 48);
  const check = await hash2B(pw, validation, new Uint8Array(0), info.r);
  if (equal(check, U.subarray(0, 32), 32)) {
    const intermediate = await hash2B(pw, keySalt, new Uint8Array(0), info.r);
    if (!info.UE) return null;
    const k = await crypto.subtle.importKey('raw', intermediate as BufferSource, 'AES-CBC', false, ['decrypt']);
    const out = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: new Uint8Array(16) as BufferSource }, k,
      concat(info.UE.subarray(0, 32), new Uint8Array(16)) as BufferSource
    );
    return { key: new Uint8Array(out).subarray(0, 32), role: 'user' };
  }

  // Try it as the owner password.
  if (info.O.length >= 48 && info.OE) {
    const oValidation = info.O.subarray(32, 40);
    const oKeySalt = info.O.subarray(40, 48);
    const oCheck = await hash2B(pw, concat(oValidation, U.subarray(0, 48)), new Uint8Array(0), info.r);
    if (equal(oCheck, info.O.subarray(0, 32), 32)) {
      const intermediate = await hash2B(pw, concat(oKeySalt, U.subarray(0, 48)), new Uint8Array(0), info.r);
      const k = await crypto.subtle.importKey('raw', intermediate as BufferSource, 'AES-CBC', false, ['decrypt']);
      const out = await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv: new Uint8Array(16) as BufferSource }, k,
        concat(info.OE.subarray(0, 32), new Uint8Array(16)) as BufferSource
      );
      return { key: new Uint8Array(out).subarray(0, 32), role: 'owner' };
    }
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
    // Strip PKCS#7 if WebCrypto left it on.
    const pad = out[out.length - 1];
    return pad >= 1 && pad <= 16 && pad <= out.length ? out.subarray(0, out.length - pad) : out;
  } catch {
    return new Uint8Array(0);
  }
}

export type DecryptResult =
  | { ok: true; bytes: Uint8Array; handler: string; role: 'user' | 'owner' }
  | { ok: false; reason: 'wrong-password' | 'unsupported'; detail: string };

/**
 * Decrypt a protected document and return bytes pdf-lib can open normally.
 * `password` is the user (open) password; an empty string covers the very common case of
 * a file that only carries an owner password to restrict printing.
 */
export async function decryptPdf(bytes: Uint8Array, password: string): Promise<DecryptResult> {
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

  let handler: Handler;
  let role: 'user' | 'owner' = 'user';
  if (info.v === 5) {
    const result = await aes256Key(info, password);
    if (!result) return { ok: false, reason: 'wrong-password', detail: `AES-256 (R${info.r})` };
    handler = { key: result.key, cipher: 'aes', perObject: false };
    role = result.role;
  } else if (info.v >= 1 && info.v <= 4) {
    const asUser = legacyKey(info, password);
    if (legacyKeyMatches(info, asUser)) {
      handler = { key: asUser, cipher: info.cipher, perObject: true };
      role = 'user';
    } else {
      // Not the user password — it may still be the owner password, which also opens the
      // document. Checking only the first of the two rejects a password that works.
      const recovered = userPasswordFromOwner(info, password);
      const asOwner = legacyKeyFromPadded(info, recovered);
      if (!legacyKeyMatches(info, asOwner)) {
        return { ok: false, reason: 'wrong-password', detail: info.cipher === 'aes' ? 'AES-128' : `RC4 ${info.length || 40}-bit` };
      }
      handler = { key: asOwner, cipher: info.cipher, perObject: true };
      role = 'owner';
    }
  } else {
    return { ok: false, reason: 'unsupported', detail: `V${info.v} handler` };
  }

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
  const cipherName = info.v === 5 ? `AES-256 (R${info.r})`
    : info.cipher === 'aes' ? 'AES-128'
    : `RC4 ${info.length || 40}-bit`;
  return { ok: true, bytes: out, handler: `${cipherName}, ${role} password`, role };
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
