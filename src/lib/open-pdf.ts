/**
 * Opening a document, including the locked ones.
 *
 * Two things were wrong here and both were found by a real password-protected file:
 *
 *   Detection did not work. It tested `err instanceof EncryptedPDFError`, and pdf-lib's
 *   dist is compiled to ES5, where `class X extends Error` loses its prototype chain.
 *   Every pdf-lib error arrives as a plain `Error` with `.name === 'Error'`, so the check
 *   never fired and a locked file fell through to the catch-all. Detection is now
 *   structural: `doc.isEncrypted` after loading with `ignoreEncryption`.
 *
 *   The unlock route did not work either. It opened the file in pdf.js with the password
 *   and called `saveDocument()`. That preserves encryption — measured: the output was the
 *   same size, still carried `/Encrypt`, and pdf-lib refused it. Decryption is now done
 *   directly, in decrypt.ts.
 */

import { PDFDocument } from 'pdf-lib';
import * as E from './errors.js';
import type { ToolError, FileFacts } from './errors.js';
import { decryptPdf, isEncrypted } from './decrypt.js';

export interface OpenedPdf {
  doc: PDFDocument;
  /** The bytes the document was parsed from — decrypted, if it started locked. */
  bytes: Uint8Array;
  wasEncrypted: boolean;
  /** Which handler was unlocked, for the result panel. */
  handler?: string;
}

export type OpenResult =
  | { ok: true; value: OpenedPdf }
  | { ok: false; error: ToolError };

const LOAD_OPTS = { updateMetadata: false } as const;

export async function openPdf(bytes: Uint8Array, facts: FileFacts, password?: string): Promise<OpenResult> {
  // Structural check first, so encryption never depends on an error surviving a
  // transpiler. `ignoreEncryption` lets the parse succeed; the flag is the real answer.
  let encrypted: boolean;
  try {
    encrypted = await isEncrypted(bytes);
  } catch (err) {
    return { ok: false, error: E.classify(err, facts) };
  }

  if (encrypted) {
    // A file carrying only an owner password opens with an empty user password. That is
    // very common — "protected" usually means printing is restricted, not that anyone
    // was ever given a password — so try it before asking.
    const candidate = password ?? '';
    const result = await decryptPdf(bytes, candidate);

    if (!result.ok) {
      if (result.reason === 'unsupported') {
        return { ok: false, error: unsupportedEncryption(facts, result.detail) };
      }
      // Wrong password, or none supplied yet.
      return {
        ok: false,
        error: password === undefined
          ? E.locked(facts, result.detail)
          : E.wrongPassword(facts),
      };
    }

    try {
      // No ignoreEncryption here, deliberately: the decrypted bytes must open as an
      // ordinary document, or we have produced something subtly wrong.
      const doc = await PDFDocument.load(result.bytes, LOAD_OPTS);
      return { ok: true, value: { doc, bytes: result.bytes, wasEncrypted: true, handler: result.handler } };
    } catch (err) {
      return { ok: false, error: decryptedButBroken(facts, result.handler) };
    }
  }

  try {
    const doc = await PDFDocument.load(bytes, LOAD_OPTS);
    return { ok: true, value: { doc, bytes, wasEncrypted: false } };
  } catch (err) {
    return { ok: false, error: E.classify(err, facts) };
  }
}

function unsupportedEncryption(facts: FileFacts, detail: string): ToolError {
  return {
    kind: 'locked',
    kicker: 'Protected in a way we cannot open',
    title: 'This file uses a form of protection this page does not handle.',
    body:
      `${facts.name} is encrypted with ${detail}, which is outside the standard password ` +
      'protection we can unlock here. Open it in a PDF reader, save an unprotected copy, and ' +
      'that copy will work. Nothing was sent anywhere.',
    mono: `${detail} · 0 bytes sent`,
  };
}

function decryptedButBroken(facts: FileFacts, handler: string): ToolError {
  return {
    kind: 'damaged',
    kicker: 'Unlocked, but not readable',
    title: 'The password was right, but what came out was not a usable document.',
    body:
      `${facts.name} decrypted with ${handler}, and the result still could not be parsed. That ` +
      'points at damage inside the file rather than at the password. Your original is untouched, ' +
      'and nothing was sent anywhere.',
    mono: `${handler} · decrypted, parse failed · 0 bytes sent`,
  };
}
