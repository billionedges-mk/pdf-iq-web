/**
 * AES-256, Standard security handler V5 R6: the writing half of src/lib/decrypt.ts.
 *
 * PASSWORD_RULE.md (app repo, decided 11 September 2026) governs what the callers do with this.
 * Two things it asks for can only be done by a writer:
 *
 *   - **Protect** a file with a password, keeping the author's `/P` when it has one, so protect
 *     cannot become a back door around remove.
 *   - The **kept-limits copy**: opens with no password, carries the original `/P` byte for byte,
 *     and is locked under a random owner password nobody holds. The limits can only be carried by
 *     encryption — an unencrypted PDF has no permission bits — which is why a file nobody needs a
 *     password to open is still encrypted.
 *
 * Never RC4, never AES-128: a new file this project writes is R6 or it is not written.
 *
 * The passwords are encoded UTF-8, which is what the spec says for V5 (SASLprep is not applied;
 * see TECH_DEBT). R2-R4 are Latin-1 and are not written here at all.
 *
 * Verified by tools/verify-password.mjs: every file this writes is read back by MuPDF, by pypdf
 * and by our own decrypt, and the permissions are read from the file rather than assumed.
 */
import {
  PDFDocument, PDFDict, PDFArray, PDFName, PDFNumber, PDFHexString, PDFString, PDFRawStream, PDFRef,
  type PDFObject,
} from 'pdf-lib';
import { hash2B } from '../lib/decrypt.js';

export const ENCRYPT_SENTINEL = 'pdfiq-pro:encrypt';

/** /P with every standard permission granted: the author restricted nothing. */
export const NO_RESTRICTIONS = -4; // 0xFFFFFFFC

export interface ProtectOptions {
  /** The password that opens the document. Empty means it opens with no prompt. */
  userPassword: string;
  /**
   * The password that lifts the limits. `null` generates 32 random bytes, used once and dropped:
   * nobody holds it, which is what keeping an author's limits means. It is never returned,
   * stored or shown.
   */
  ownerPassword: string | null;
  /** /P, copied from the original when limits are being kept. */
  permissions: number;
}

const utf8 = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const EMPTY = new Uint8Array(0);
const ZERO_IV = new Uint8Array(16);

/**
 * AES-CBC with no padding written: /UE, /OE and /Perms are exact multiples of the block size and
 * carry no PKCS#7. WebCrypto always appends a padding block, so it is encrypted and dropped —
 * the mirror of the trick decrypt.ts uses to read them.
 */
async function noPadEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-CBC', false, ['encrypt']);
  const out = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: iv as BufferSource }, k, data as BufferSource));
  return out.subarray(0, data.length);
}

/** Strings and streams: a random IV, then AES-CBC with PKCS#7, exactly as a reader expects. */
async function encryptData(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const iv = random(16);
  const k = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-CBC', false, ['encrypt']);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: iv as BufferSource }, k, data as BufferSource));
  return concat(iv, body);
}

async function encryptStringsIn(object: PDFObject, key: Uint8Array, depth = 0): Promise<void> {
  if (depth > 24) return;
  if (object instanceof PDFDict) {
    for (const [name, value] of object.entries()) {
      if (value instanceof PDFString || value instanceof PDFHexString) {
        object.set(name, PDFHexString.of(hex(await encryptData(key, value.asBytes()))));
      } else if (value instanceof PDFDict || value instanceof PDFArray) {
        await encryptStringsIn(value, key, depth + 1);
      }
    }
  } else if (object instanceof PDFArray) {
    for (let i = 0; i < object.size(); i++) {
      const value = object.get(i);
      if (value instanceof PDFString || value instanceof PDFHexString) {
        object.set(i, PDFHexString.of(hex(await encryptData(key, value.asBytes()))));
      } else if (value instanceof PDFDict || value instanceof PDFArray) {
        await encryptStringsIn(value, key, depth + 1);
      }
    }
  }
}

/**
 * Encrypt a document that is currently in the clear.
 *
 * @param bytes an unencrypted PDF — the output of decryptPdf, or a file that never had a password.
 * @returns the encrypted file. The owner password is not among the outputs, by design.
 */
export async function encryptPdf(bytes: Uint8Array, opts: ProtectOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  if (doc.isEncrypted) throw new Error('this document is already encrypted; decrypt it first');

  const permissions = opts.permissions | 0;
  const fileKey = random(32);
  const user = utf8(opts.userPassword).subarray(0, 127);
  // A password nobody keeps: generated here, used for these four values, and gone when this
  // function returns. Hex of 32 random bytes, so the string itself carries 256 bits.
  const owner = utf8(opts.ownerPassword ?? hex(random(32))).subarray(0, 127);

  // Algorithm 8: /U and /UE. The validation salt proves the password; the key salt wraps the key.
  const userValidation = random(8);
  const userKeySalt = random(8);
  const U = concat(await hash2B(user, userValidation, EMPTY, 6), userValidation, userKeySalt);
  const UE = await noPadEncrypt(await hash2B(user, userKeySalt, EMPTY, 6), ZERO_IV, fileKey);

  // Algorithm 9: /O and /OE, which take the whole 48-byte /U as the hash's third input.
  const ownerValidation = random(8);
  const ownerKeySalt = random(8);
  const O = concat(await hash2B(owner, ownerValidation, U, 6), ownerValidation, ownerKeySalt);
  const OE = await noPadEncrypt(await hash2B(owner, ownerKeySalt, U, 6), ZERO_IV, fileKey);

  // Algorithm 10: /Perms, the only thing protecting /P on R6. decrypt.ts reads it back and treats
  // a block that does not verify as restricted, so this must be exact.
  const perms = new Uint8Array(16);
  new DataView(perms.buffer).setInt32(0, permissions, true);
  perms.set([0xff, 0xff, 0xff, 0xff], 4);
  perms[8] = 0x54; // 'T': the metadata is encrypted too
  perms.set([0x61, 0x64, 0x62], 9); // "adb"
  perms.set(random(4), 12);
  const Perms = await noPadEncrypt(fileKey, ZERO_IV, perms);

  // Every string and stream, before the encryption dictionary exists — so it cannot encrypt
  // itself. V5 uses the file key directly: there is no per-object derivation.
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) {
      const cipher = await encryptData(fileKey, object.getContents());
      object.dict.set(PDFName.of('Length'), PDFNumber.of(cipher.length));
      await encryptStringsIn(object.dict, fileKey);
      doc.context.assign(ref, PDFRawStream.of(object.dict, cipher));
    } else {
      await encryptStringsIn(object, fileKey);
    }
  }

  const encrypt = doc.context.obj({
    Filter: 'Standard',
    V: 5,
    R: 6,
    Length: 256,
    CF: { StdCF: { CFM: 'AESV3', AuthEvent: 'DocOpen', Length: 32 } },
    StmF: 'StdCF',
    StrF: 'StdCF',
    P: permissions,
    EncryptMetadata: true,
    U: PDFHexString.of(hex(U)),
    UE: PDFHexString.of(hex(UE)),
    O: PDFHexString.of(hex(O)),
    OE: PDFHexString.of(hex(OE)),
    Perms: PDFHexString.of(hex(Perms)),
  });
  doc.context.trailerInfo.Encrypt = doc.context.register(encrypt);

  // /ID is not part of the V5 key, but a reader that finds none on an encrypted file is entitled
  // to complain, and every file this writes gets a fresh one.
  const id = PDFHexString.of(hex(random(16)));
  doc.context.trailerInfo.ID = doc.context.obj([id, id]);

  // No object streams: an object stream would carry its members' strings inside one encrypted
  // stream, and this walks objects.
  return doc.save({ useObjectStreams: false });
}

/** The reference an object was enumerated under — pdf-lib gives the pair, this keeps the types honest. */
function refOf(doc: PDFDocument, object: PDFObject): PDFRef {
  for (const [ref, candidate] of doc.context.enumerateIndirectObjects()) {
    if (candidate === object) return ref;
  }
  throw new Error('an object disappeared from the context while it was being encrypted');
}

/** Referenced so the sentinel survives minification in the bundle that carries this module. */
export function encryptMark(): string {
  return ENCRYPT_SENTINEL;
}
