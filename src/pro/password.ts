/**
 * Password protect, or remove a password — Pro, and preview-only like the rest of it.
 *
 * Everything here is PASSWORD_RULE.md (app repo, 11 September 2026), which both products follow:
 *
 *   - **The file's lock is inspected the moment it is chosen**, before any password field appears,
 *     and the screen says which case it is. /P is readable without a password, so even the
 *     kept-limits case is announced up front rather than explained afterwards.
 *   - **Removing a password never lifts an author's limits without the owner password.** One
 *     predicate decides it, and this page does not compute its own: `unlockPdf` reports `mayLift`.
 *   - When it is false, the copy **keeps the limits** rather than being refused: it opens with no
 *     password, carries the original /P byte for byte, and is locked under a random owner password
 *     nobody holds. That is the one thing the free tools cannot do, because they have no writer.
 *   - **Protect is bound by the same rule**: an owner-only file protected with a new password
 *     keeps its /P, or protect would be a back door around remove.
 *
 * The sign-in gate comes after the inspection, never before it: what a file is can be answered on
 * this device, for nothing, and a wall in front of that would be a wall in front of value.
 */
import { ToolShell, wireDropzone, acceptPdf, saveFile, $ } from '../lib/ui.js';
import { formatBytes, suffixName } from '../lib/format.js';
import { unlockPdf, isEncrypted, type UnlockResult } from '../lib/decrypt.js';
import { encryptPdf, NO_RESTRICTIONS } from './encrypt.js';
import { signedIn, signInPrompt } from './gate.js';

export const PASSWORD_SENTINEL = 'pdfiq-pro:password';

/** What the file's lock is, decided before anyone is asked for anything. */
type Lock =
  /** Not encrypted. There is nothing to remove, and a password can be added. */
  | { kind: 'plain' }
  /** Will not open without a password. `restricts` is /P as declared, readable without one. */
  | { kind: 'needs-password'; restricts: boolean }
  /** Opens with no password, but the author withdrew permissions. Only the owner password lifts them. */
  | { kind: 'owner-only'; opened: Extract<UnlockResult, { ok: true }> }
  /** Encrypted, opens with no password, and grants everything. */
  | { kind: 'free-lock'; opened: Extract<UnlockResult, { ok: true }> }
  /** A security handler this code does not implement. Said plainly rather than thrown. */
  | { kind: 'unsupported'; detail: string };

const shell = new ToolShell();

let file: File | null = null;
let sourceBytes: Uint8Array | null = null;
let lock: Lock | null = null;
let result: { bytes: Uint8Array; name: string } | null = null;

const input = $<HTMLInputElement>('[data-file-input]')!;
wireDropzone($('[data-dropzone]')!, input, (files) => void take(files[0]));
$('[data-replace]')?.addEventListener('click', () => input.click());
for (const again of document.querySelectorAll('[data-again]')) {
  again.addEventListener('click', () => { reset(); shell.show('empty'); });
}

function reset(): void {
  file = null;
  sourceBytes = null;
  lock = null;
  result = null;
  input.value = '';
}

// ---------------------------------------------------------------- intake and inspection

async function take(f: File | undefined): Promise<void> {
  if (!f) return;
  reset();
  file = f;
  const accepted = await acceptPdf(f);
  if (!accepted.ok) return shell.fail(accepted.error);
  sourceBytes = accepted.bytes;

  shell.announce('Reading this file’s lock.');
  lock = await inspect(accepted.bytes);
  render();
}

/**
 * What the file is, from the one mechanism the rule is defined on. An empty password is how a
 * file with only an owner password opens, so trying it answers three of the four cases at once.
 */
async function inspect(bytes: Uint8Array): Promise<Lock> {
  if (!(await isEncrypted(bytes))) return { kind: 'plain' };
  const opened = await unlockPdf(bytes, '');
  if (!opened.ok) {
    if (opened.reason === 'unsupported') return { kind: 'unsupported', detail: opened.detail };
    return { kind: 'needs-password', restricts: opened.restricts };
  }
  return opened.mayLift ? { kind: 'free-lock', opened } : { kind: 'owner-only', opened };
}

// ---------------------------------------------------------------- what the screen says

const form = $<HTMLFormElement>('[data-form]')!;
const passwordField = $('[data-password-field]')!;
const passwordInput = $<HTMLInputElement>('[data-password-input]')!;
const passwordLabel = $('[data-password-label]')!;
const primary = $<HTMLButtonElement>('[data-primary]')!;
const also = $('[data-also]')!;
const alsoForm = $<HTMLFormElement>('[data-also-form]')!;
const alsoInput = $<HTMLInputElement>('[data-also-input]')!;
const gate = $('[data-gate]')!;

function render(): void {
  if (!file || !lock) return;
  $('[data-file-name]')!.textContent = file.name;
  $('[data-file-meta]')!.textContent = formatBytes(file.size);
  $('[data-lock]')!.dataset.pdfiqPro = PASSWORD_SENTINEL;

  const said = describeLock(lock);
  $('[data-lock-kicker]')!.textContent = said.kicker;
  $('[data-verdict]')!.textContent = said.verdict;
  primary.textContent = said.button;
  passwordLabel.textContent = said.field ?? '';
  passwordField.hidden = !said.field;
  passwordInput.required = Boolean(said.field);
  passwordInput.value = '';
  const note = $('[data-form-note]')!;
  note.textContent = said.note ?? '';
  note.hidden = !said.note;

  // Ruled out locally first, then the account. The inspection above needs nobody signed in, and a
  // file nothing can be done with is told so without being asked to sign in for it.
  const actionable = Boolean(said.button);
  gate.textContent = '';
  const account = signedIn();
  form.hidden = !actionable || !account;
  if (actionable && !account) gate.append(signInPrompt('Protecting a PDF, and removing a password'));

  // An owner-only file is the one case with two honest answers: lift the limits with the owner
  // password, or keep them through a new one.
  const canAlsoProtect = lock.kind === 'owner-only' && Boolean(account);
  also.hidden = !canAlsoProtect;
  if (canAlsoProtect) {
    $('[data-also-text]')!.textContent =
      'Or protect it with a password of your own. The copy will need that password to open, and it keeps '
      + 'the author’s limits on printing, copying or editing — protect cannot lift what removing a '
      + 'password may not.';
    alsoInput.value = '';
  }

  shell.show('selected');
  shell.announce(said.verdict);
}

/** The wording is PASSWORD_RULE.md's own table, so both products say the same thing. */
function describeLock(l: Lock): { kicker: string; verdict: string; field: string | null; button: string; note?: string } {
  switch (l.kind) {
    case 'plain':
      return {
        kicker: 'No password on this file',
        verdict: 'This file isn’t password-protected, so there’s nothing to remove. You can protect a copy of it with a password instead.',
        field: 'New password',
        button: 'Protect with this password',
        note: 'The copy is written AES-256. Nobody can lift its restrictions afterwards, because it is locked under a random owner password nobody keeps — this file has none to keep.',
      };
    case 'needs-password':
      return l.restricts
        ? {
          kicker: 'Needs a password, and its author set limits',
          verdict: 'This file needs a password to open, and its author also limited printing, copying or editing. '
            + 'With the password that opens it, your copy will open without one but keep those limits. '
            + 'With the owner password, the limits go too.',
          field: 'Password',
          button: 'Remove password',
        }
        : {
          kicker: 'Needs a password to open',
          verdict: 'This file needs a password to open. Its author set no limits on printing, copying or editing.',
          field: 'Password',
          button: 'Remove password',
        };
    case 'owner-only':
      return {
        kicker: 'Opens freely, with limits',
        verdict: 'This file already opens without a password. Its author limited printing, copying or editing, '
          + 'and lifting that needs the owner password.',
        field: 'Owner password',
        button: 'Lift the limits',
      };
    case 'free-lock':
      return {
        kicker: 'Encrypted, but opens freely',
        verdict: 'This file is encrypted and opens without a password, and its author set no limits. The lock can come off entirely.',
        field: null,
        button: 'Remove the lock',
      };
    case 'unsupported':
      return {
        kicker: 'This file cannot be read here',
        verdict: `This file uses ${l.detail}, which this page cannot read. Nothing can be done with it here, and nothing was changed.`,
        field: null,
        button: '',
      };
  }
}

// ---------------------------------------------------------------- doing it

form.addEventListener('submit', (e) => {
  e.preventDefault();
  void run(async () => {
    if (!sourceBytes || !lock || !file) return null;
    const typed = passwordInput.value;

    if (lock.kind === 'plain') {
      if (!typed) return { failure: 'A password is needed to protect anything. Nothing was written.' };
      const bytes = await encryptPdf(sourceBytes, { userPassword: typed, ownerPassword: null, permissions: NO_RESTRICTIONS });
      return {
        bytes,
        name: suffixName(file.name, '-protected'),
        head: 'Your copy needs this password to open.',
        body: 'It is written AES-256 (Standard V5 R6). Your original is untouched, and still opens with no password.',
      };
    }

    if (lock.kind === 'free-lock') {
      return {
        bytes: lock.opened.bytes,
        name: suffixName(file.name, '-unlocked'),
        head: 'The lock is off.',
        body: 'Your copy has no encryption left and opens with no password. Your original is untouched.',
      };
    }

    // Both remaining cases turn on which password was given, and that is decided by the same
    // predicate the free tools use — not by this page.
    const opened = await unlockPdf(sourceBytes, typed);
    if (!opened.ok) {
      if (opened.reason === 'unsupported') return { failure: `This file uses ${opened.detail}, which this page cannot read.` };
      if (lock.kind === 'owner-only') return { failure: 'That isn’t the owner password for this file. Nothing was written.' };
      return { failure: typed ? 'That password doesn’t open this file. Nothing was written.' : 'This file needs its password to open.' };
    }

    if (opened.mayLift) {
      return {
        bytes: opened.bytes,
        name: suffixName(file.name, '-unlocked'),
        head: 'Your copy opens without a password, and nothing is restricted.',
        body: 'The owner password was given, so the author’s limits came off with the lock. Your original is untouched.',
      };
    }

    // The user password on a restricted file: keep the limits rather than strip them.
    const kept = await encryptPdf(opened.bytes, { userPassword: '', ownerPassword: null, permissions: opened.permissions });
    return {
      bytes: kept,
      name: suffixName(file.name, '-unlocked'),
      head: 'Your copy opens without a password now.',
      body: 'Its author’s limits on printing, copying or editing are still in place — lifting those needs the owner '
        + 'password, which this copy does not carry. Your original is untouched.',
    };
  });
});

alsoForm.addEventListener('submit', (e) => {
  e.preventDefault();
  void run(async () => {
    if (!lock || lock.kind !== 'owner-only' || !file) return null;
    const typed = alsoInput.value;
    if (!typed) return { failure: 'A password is needed to protect anything. Nothing was written.' };
    const bytes = await encryptPdf(lock.opened.bytes, {
      userPassword: typed,
      ownerPassword: null,
      permissions: lock.opened.permissions,
    });
    return {
      bytes,
      name: suffixName(file.name, '-protected'),
      head: 'Your copy needs this password to open, and still carries its author’s limits.',
      body: 'Printing, copying or editing are limited exactly as they were, and this copy is locked under a random '
        + 'owner password nobody keeps — so nothing can lift them. Your original is untouched.',
    };
  });
});

type Outcome =
  | { bytes: Uint8Array; name: string; head: string; body: string }
  | { failure: string }
  | null;

async function run(work: () => Promise<Outcome>): Promise<void> {
  shell.show('processing');
  shell.announce('Working on your device.');
  try {
    const outcome = await work();
    if (!outcome) return shell.show('selected');
    if ('failure' in outcome) {
      shell.show('selected');
      const note = $('[data-form-note]')!;
      note.textContent = outcome.failure;
      note.hidden = false;
      shell.announce(outcome.failure);
      return;
    }
    result = { bytes: outcome.bytes, name: outcome.name };
    $('[data-result-head]')!.textContent = outcome.head;
    $('[data-result-body]')!.textContent = outcome.body;
    $('[data-result-mono]')!.textContent = `${outcome.name} · ${formatBytes(outcome.bytes.length)}`;
    shell.show('result');
    shell.announce(outcome.head);
  } catch (err) {
    shell.show('selected');
    const note = $('[data-form-note]')!;
    note.textContent = `This file could not be rewritten: ${err instanceof Error ? err.message : String(err)}. Nothing was written.`;
    note.hidden = false;
  }
}

$('[data-save]')?.addEventListener('click', () => {
  if (result) saveFile(result.bytes, result.name);
});

/** Referenced so the sentinel survives minification in the bundle that carries this module. */
export function passwordMark(): string {
  return PASSWORD_SENTINEL;
}
