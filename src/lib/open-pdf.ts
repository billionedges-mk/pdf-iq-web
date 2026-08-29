/**
 * Opening a document, including the locked ones.
 *
 * pdf-lib parses and rebuilds PDFs but has no decryption at all, so an encrypted file
 * cannot simply be handed to it. pdf.js does decrypt. So for a locked file we let
 * pdf.js open it with the password and write the document back out, then check that
 * what came back is genuinely readable without a password before going near it.
 *
 * That check matters. If the unlocked copy were still encrypted, pdf-lib would parse
 * the ciphertext as though it were content and cheerfully produce a corrupt file — the
 * failure would land on the user as a broken download rather than as an error here.
 */

import { PDFDocument } from 'pdf-lib';
import * as E from './errors.js';
import type { ToolError, FileFacts } from './errors.js';
import { openDocument } from './pdfjs.js';

export interface OpenedPdf {
  doc: PDFDocument;
  /** The bytes the document was parsed from — unlocked, if it started locked. */
  bytes: Uint8Array;
  wasEncrypted: boolean;
}

export type OpenResult =
  | { ok: true; value: OpenedPdf }
  | { ok: false; error: ToolError };

const LOAD_OPTS = { updateMetadata: false } as const;

export async function openPdf(bytes: Uint8Array, facts: FileFacts, password?: string): Promise<OpenResult> {
  if (password === undefined) {
    try {
      const doc = await PDFDocument.load(bytes, LOAD_OPTS);
      return { ok: true, value: { doc, bytes, wasEncrypted: false } };
    } catch (err) {
      const mapped = E.classify(err, facts);
      if (mapped.kind !== 'locked') return { ok: false, error: mapped };
      // Fall through: ask pdf.js what kind of encryption this is so the message can
      // say something true about it.
      return { ok: false, error: await describeLock(bytes, facts) };
    }
  }

  // ---- a password was supplied ----
  let unlocked: Uint8Array;
  try {
    const opened = await openDocument(bytes, password);
    unlocked = await opened.doc.saveDocument();
    await opened.close();
  } catch (err) {
    return { ok: false, error: E.classify(err, facts) };
  }

  try {
    // No ignoreEncryption here on purpose: this must succeed as an ordinary document.
    const doc = await PDFDocument.load(unlocked, LOAD_OPTS);
    return { ok: true, value: { doc, bytes: unlocked, wasEncrypted: true } };
  } catch (err) {
    const mapped = E.classify(err, facts);
    if (mapped.kind === 'locked') {
      return {
        ok: false,
        error: {
          kind: 'locked',
          kicker: 'Unlocked, but not rebuildable',
          title: 'The password was right, but this file cannot be rewritten here.',
          body:
            `${facts.name} opened with that password, so we could read it — but its encryption is applied in a way ` +
            'this page cannot remove while rebuilding the document, and writing it back out would produce a corrupt file. ' +
            'Open it in a PDF reader, save an unprotected copy, and that copy will work here.',
          mono: `decrypted for reading, re-save blocked · 0 bytes sent`,
        },
      };
    }
    return { ok: false, error: mapped };
  }
}

/** Ask pdf.js what the encryption actually is, so "Locked file" can be specific. */
async function describeLock(bytes: Uint8Array, facts: FileFacts): Promise<ToolError> {
  let detail = 'encrypted';
  try {
    const probe = await openDocument(bytes);
    await probe.close();
    // Opened without a password after all — permissions-only encryption.
  } catch (err) {
    if (err && typeof err === 'object' && 'name' in err && (err as Error).name === 'PasswordException') {
      detail = 'open password required';
    }
  }
  const version = readVersion(bytes);
  return E.locked(facts, [version, detail].filter(Boolean).join(' · '));
}

function readVersion(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 16));
  const m = /%PDF-(\d\.\d)/.exec(head);
  return m ? `PDF ${m[1]}` : '';
}
