/**
 * The error taxonomy.
 *
 * The rule is still to classify by type rather than by message text, because messages get
 * reworded between versions and some are localised. pdf.js honours that: its build keeps
 * `.name` intact, so `PasswordException` and `InvalidPDFException` dispatch correctly.
 *
 * pdf-lib does not, and finding that out cost a real bug. Its published build is ES5, and
 * `class X extends Error` transpiled to ES5 loses its prototype chain, so every one of its
 * error classes arrives as a plain `Error` with `.name === 'Error'`. The type dispatch
 * that used to be here could never fire, and a genuinely encrypted file fell through to
 * "unexpected failure" rather than reaching the password prompt.
 *
 * Encryption is therefore detected structurally now, from `doc.isEncrypted`, and never
 * from an error at all. What is left of pdf-lib dispatch matches on message, with a check
 * in `tools/verify-pdflib-errors.mjs` that fails loudly if an upgrade rewords them.
 *
 * Every kind declared here has to be reachable from a real file. A kind that nothing can
 * produce reads as covered and is not.
 */

export type ErrorKind =
  | 'locked'
  | 'wrong-password'
  | 'damaged'
  | 'not-pdf'
  | 'not-image'
  | 'empty'
  | 'too-big'
  | 'out-of-memory'
  | 'no-pages-left'
  | 'unknown';

export interface ToolError {
  kind: ErrorKind;
  /** Small caps label above the headline. */
  kicker: string;
  /** The headline. Names the real problem. */
  title: string;
  /** The explanation. Specific to this file wherever we know something about it. */
  body: string;
  /** The monospace technical line under the buttons. */
  mono: string;
  /** Label for an optional recovery action, when one genuinely exists. */
  action?: string;
  /** Show the password field. */
  password?: boolean;
}

export interface FileFacts {
  name: string;
  size: number;
  type: string;
}

const sentSuffix = '0 bytes sent';

function bytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

/** What the file actually appears to be, from its own first bytes rather than its name. */
export function sniff(head: Uint8Array): string | null {
  const startsWith = (sig: number[], offset = 0) =>
    sig.every((b, i) => head[offset + i] === b);
  if (startsWith([0x25, 0x50, 0x44, 0x46])) return 'application/pdf';
  if (startsWith([0x50, 0x4b, 0x03, 0x04])) return 'zip';
  if (startsWith([0xd0, 0xcf, 0x11, 0xe0])) return 'ole';
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith([0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (startsWith([0x7b])) return 'text';
  return null;
}

/** A human name for a container we recognised but cannot use. */
function describeContainer(sniffed: string | null, name: string): string {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase();
  if (sniffed === 'zip') {
    if (['docx', 'xlsx', 'pptx'].includes(ext)) {
      const app = ext === 'docx' ? 'Word document' : ext === 'xlsx' ? 'Excel workbook' : 'PowerPoint deck';
      return `a ${app}`;
    }
    if (ext === 'odt' || ext === 'ods') return 'an OpenDocument file';
    if (ext === 'epub') return 'an EPUB book';
    return 'a ZIP archive';
  }
  if (sniffed === 'ole') {
    if (ext === 'doc') return 'an older Word document';
    if (ext === 'xls') return 'an older Excel workbook';
    return 'an old Microsoft Office file';
  }
  if (sniffed?.startsWith('image/')) return `a ${sniffed.slice(6).toUpperCase()} image`;
  return ext ? `a .${ext} file` : 'not a PDF';
}

export function notPdf(file: FileFacts, head: Uint8Array): ToolError {
  const sniffed = sniff(head);
  const what = describeContainer(sniffed, file.name);
  const isImage = sniffed?.startsWith('image/');
  return {
    kind: 'not-pdf',
    kicker: 'Wrong format',
    title: `That is ${what}, not a PDF.`,
    body: isImage
      ? `${file.name} is an image. This page works on PDFs — but Images to PDF will turn it into one, and you can come back here afterwards.`
      : `${file.name} is ${what}. This page reads PDFs and nothing else — it will not quietly convert your document and hand you back something that looks different from what you opened. Export it as a PDF first, then drop it here.`,
    mono: `${sniffed ?? 'unrecognised'} · ${bytes(file.size)} · ${sentSuffix}`,
    action: isImage ? undefined : undefined,
  };
}

export function empty(file: FileFacts): ToolError {
  return {
    kind: 'empty',
    kicker: 'Empty file',
    title: 'This file has no contents.',
    body: `${file.name} is zero bytes. Whatever wrote it did not finish. Check the original and try again.`,
    mono: `0 bytes · ${sentSuffix}`,
  };
}

export function tooBig(file: FileFacts, limitBytes: number): ToolError {
  return {
    kind: 'too-big',
    kicker: 'Too large for this device',
    title: 'This file is bigger than this tab can hold in memory.',
    body:
      `${file.name} is ${bytes(file.size)}, over the ${bytes(limitBytes)} ceiling this page sets. ` +
      'Because the work happens on your device, the limit is your own memory rather than an upload cap. ' +
      'Split it first — splitting reads one page at a time and copes with far larger files — then run each part through here.',
    mono: `${bytes(file.size)} · over the ${bytes(limitBytes)} limit · ${sentSuffix}`,
  };
}

export function locked(file: FileFacts, detail: string): ToolError {
  return {
    kind: 'locked',
    kicker: 'Locked file',
    title: 'This PDF is encrypted, and only you can unlock it.',
    body:
      `${file.name} is protected with an open password, so its pages cannot be read until it is unlocked. ` +
      'Type the password and it opens right here in this tab. We have no server that could try passwords for you, ' +
      'and no way to see the one you type.',
    mono: `${detail} · ${bytes(file.size)} · ${sentSuffix}`,
    password: true,
  };
}

export function wrongPassword(file: FileFacts): ToolError {
  return {
    kind: 'wrong-password',
    kicker: 'Password not accepted',
    title: 'That password did not open the file.',
    body:
      'The document rejected it. Passwords are case sensitive, and a leading or trailing space counts as ' +
      'part of one. A PDF can carry two — the open password and the owner password — and either will unlock ' +
      'it here, so if you have both, the other one is worth a try.',
    mono: `password rejected on this device · ${sentSuffix}`,
    password: true,
  };
}

export function damaged(file: FileFacts, detail: string, readablePages?: number, totalPages?: number): ToolError {
  const partial = readablePages !== undefined && totalPages !== undefined && readablePages > 0 && readablePages < totalPages;
  return {
    kind: 'damaged',
    kicker: 'Damaged file',
    title: partial ? 'Part of this file cannot be read.' : 'This file is not a readable PDF.',
    body: partial
      ? `${file.name} is a real PDF, but ${totalPages! - readablePages!} of its ${totalPages} pages cannot be located: ${detail}. ` +
        'Most tools would work on the readable pages and hand you a file quietly missing the rest. We would rather you knew first.'
      : `${file.name} starts like a PDF but its structure is broken: ${detail}. Nothing here can be recovered from it reliably. ` +
        'If you still have whatever produced it, export a fresh copy.',
    mono: `${detail} · ${bytes(file.size)} · ${sentSuffix}`,
    action: partial ? `Continue with the ${readablePages} readable pages` : undefined,
  };
}

export function outOfMemory(file: FileFacts, stage: string): ToolError {
  return {
    kind: 'out-of-memory',
    kicker: 'Ran out of memory',
    title: 'This tab ran out of memory part-way through.',
    body:
      `${file.name} is ${bytes(file.size)} and the browser could not hold what ${stage} needs at once. ` +
      'Nothing was sent anywhere and your original is untouched. Close other tabs and try again, or split the file and do it in parts.',
    mono: `allocation failed during ${stage} · ${sentSuffix}`,
  };
}

export function noPagesLeft(): ToolError {
  return {
    kind: 'no-pages-left',
    kicker: 'Nothing left to save',
    title: 'You have removed every page.',
    body: 'A PDF needs at least one page. Put one back, or start again with a different file.',
    mono: `0 pages selected · ${sentSuffix}`,
  };
}

export function notImage(file: FileFacts, head: Uint8Array): ToolError {
  const sniffed = sniff(head);
  return {
    kind: 'not-image',
    kicker: 'Not an image',
    title: `${file.name} is not an image this browser can read.`,
    body:
      sniffed === 'application/pdf'
        ? 'That is already a PDF. Merge will combine it with others, and Compress will make it smaller.'
        : 'This page takes JPEG, PNG, GIF, WebP and AVIF. HEIC photos straight off an iPhone are not supported by most browsers — ' +
          'sharing them out of Photos usually converts them to JPEG first.',
    mono: `${sniffed ?? 'unrecognised'} · ${bytes(file.size)} · ${sentSuffix}`,
  };
}

export function unknown(file: FileFacts, err: unknown): ToolError {
  const name = err instanceof Error ? err.name : typeof err;
  return {
    kind: 'unknown',
    kicker: 'Unexpected failure',
    title: 'This file broke something we did not anticipate.',
    body:
      `Working on ${file.name} raised a ${name} we have no specific handling for. That is a gap on our side, not a mistake on yours. ` +
      'Nothing was sent anywhere. The technical line below is the whole of what we know — it would help us to have it.',
    mono: `${name} · ${bytes(file.size)} · ${sentSuffix}`,
  };
}

/**
 * Classify a thrown value from pdf-lib or pdf.js.
 * Dispatch is on constructor identity and on the stable `.name` that pdf.js sets on
 * its exception classes — never on message text.
 */
/**
 * Message fragments pdf-lib uses, and what each means.
 *
 * This matches on message text, which is normally the wrong thing to do and is banned
 * everywhere else in this codebase. The reason for the exception, measured rather than
 * assumed: pdf-lib's published build is compiled to ES5, and `class X extends Error`
 * transpiled to ES5 loses its prototype chain. Every one of its error classes arrives as
 * a plain `Error` with `.name === 'Error'` and fails `instanceof`:
 *
 *   EncryptedPDFError      instanceof self: false | .name: Error
 *   MissingPDFHeaderError  instanceof self: false | .name: Error
 *   PDFParsingError        instanceof self: false | .name: Error
 *
 * So the type-based dispatch that used to be here never fired, and every pdf-lib failure
 * fell through to "unexpected failure" — which is exactly what a real locked file
 * produced. The message is the only signal the library gives.
 *
 * That makes this a pinned-version dependency, so `tools/verify-pdflib-errors.mjs`
 * asserts these fragments still match what pdf-lib actually throws. An upgrade that
 * reworded them fails that check loudly instead of quietly degrading the error copy.
 */
export const PDFLIB_MESSAGES: Array<[fragment: string, kind: 'encrypted' | 'header' | 'parse']> = [
  ['is encrypted', 'encrypted'],
  ['No PDF header found', 'header'],
  ['Failed to parse PDF document', 'parse'],
  ['Expected instance of PDFDict', 'parse'],
  ['Unbalanced parenthesis', 'parse'],
  ['Expected object number', 'parse'],
  ['stalled', 'parse'],
];

/**
 * Classify a thrown value from pdf-lib or pdf.js.
 *
 * pdf.js is dispatched on `.name`, which its modern build preserves correctly — verified:
 * a locked file throws `PasswordException` with `code` 1 for "needs a password" and 2 for
 * "that one was wrong". pdf-lib is dispatched on message, for the reason above.
 */
export function classify(err: unknown, file: FileFacts): ToolError {
  if (err && typeof err === 'object' && 'name' in err) {
    const name = String((err as Error).name);
    if (name === 'PasswordException') {
      const code = (err as { code?: number }).code;
      return code === 2 ? wrongPassword(file) : locked(file, 'encrypted');
    }
    if (name === 'InvalidPDFException') {
      return damaged(file, 'the file structure could not be parsed');
    }
    if (name === 'RangeError' || name === 'QuotaExceededError') {
      return outOfMemory(file, 'reading this document');
    }
  }

  const message = err instanceof Error ? err.message : String(err ?? '');
  for (const [fragment, kind] of PDFLIB_MESSAGES) {
    if (!message.includes(fragment)) continue;
    if (kind === 'encrypted') return locked(file, 'encrypted');
    if (kind === 'header') return notPdf(file, new Uint8Array(0));
    return damaged(file, 'the parser could not read its structure');
  }

  return unknown(file, err);
}
