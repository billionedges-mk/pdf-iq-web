/**
 * Batch: one operation across many files. The contract is docs/batch.md, written before this.
 *
 * What is here is everything that can be decided without a browser: which files produced what,
 * what the archive contains, whether the summary agrees with it, and what the screen says. The
 * work itself — compressing, reading text, rotating — needs a canvas and workers, so it arrives
 * through `RunDeps` and is wired by src/pro/batch-page.ts. That split is what lets
 * tools/verify-batch.mjs drive real runs in Node: cancellation, name collisions, a file that
 * fails among files that do not, and the reconciliation — none of which are about pixels.
 *
 * The rules that matter, from the app's BatchRunner and from the contract:
 *
 *   - A file that fails puts nothing in the archive. No zero-byte entry, no copy of the input.
 *   - "Left alone" is not a failure: compress declines a document whose images are already small
 *     enough, and reporting that as an error is how twenty good documents were once described as
 *     having been deleted.
 *   - A cancel keeps what finished and names what was not attempted.
 *   - The summary is reconciled against the archive's own entries before it is shown.
 */
import { makeZip, safeName, type ZipEntry } from '../lib/zip.js';

export const BATCH_SENTINEL = 'pdfiq-pro:batch';

export type BatchOp = 'compress' | 'text' | 'rotate';

export interface OpSpec {
  label: string;
  /** Present tense, for "Compressing 3 of 20". */
  verb: string;
  /** Only a change of type changes the extension. */
  extension: string | null;
  /** Whether per-page progress within one file means anything for this operation. */
  pages: boolean;
}

export const OPERATIONS: Record<BatchOp, OpSpec> = {
  compress: { label: 'Compress', verb: 'Compressing', extension: null, pages: false },
  text: { label: 'Read the text', verb: 'Reading', extension: 'txt', pages: true },
  rotate: { label: 'Rotate right', verb: 'Rotating', extension: null, pages: false },
};

export type Outcome =
  | { kind: 'done'; name: string; bytes: number }
  | { kind: 'failed'; reason: string }
  | { kind: 'left-alone'; why: string }
  | { kind: 'not-attempted' }
  /**
   * The stop came while this file was being worked on. Nothing of it is kept.
   *
   * Without this it was reported as done: the OCR pool returns the pages it had recognised, so a
   * 30-page scan stopped at page 10 produced a third of its text and the run counted it as a
   * finished file, archive entry and all. Watched on 12 September 2026. "Stopping keeps what
   * finished" has to mean finished files.
   */
  | { kind: 'interrupted' };

export interface FileResult {
  source: string;
  outcome: Outcome;
}

/** One file's work: the bytes to keep, or why there was nothing to keep. */
export type Produced = { bytes: Uint8Array } | { leftAlone: string };

export interface RunDeps {
  apply(op: BatchOp, file: File, onPage: (done: number, total: number) => void, signal: AbortSignal): Promise<Produced>;
  /** An unknown error as a short reason a person can act on. */
  describeError(err: unknown): string;
  /** Injected so a test can fix the archive's name. */
  now?(): Date;
}

export interface RunHooks {
  onFile?(index: number, total: number, name: string): void;
  onPage?(done: number, total: number): void;
  onResult?(result: FileResult): void;
}

export interface RunReport {
  op: BatchOp;
  results: FileResult[];
  cancelled: boolean;
  /** Null when nothing finished: an empty archive is not worth handing over. */
  zip: Uint8Array | null;
  zipName: string;
  /** Entry names read back out of what was built, not the list that went in. */
  entries: string[];
  /** Does the archive hold exactly what the summary says it does? */
  reconciles: boolean;
}

/**
 * Keep the name the file already has; disambiguate only against this run.
 *
 * No "-compressed" suffix: inside an archive that says what happened it is a convention we would
 * be inventing, and the name someone recognises is the one they gave the file. The set is per run
 * because a fresh archive has nothing else to collide with.
 */
export function allocateName(sourceName: string, extension: string | null, taken: Set<string>): string {
  const clean = safeName(sourceName);
  const dot = clean.lastIndexOf('.');
  const base = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = extension ?? (dot > 0 ? clean.slice(dot + 1) : 'pdf');
  let candidate = base + '.' + ext;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = base + ' (' + n + ').' + ext;
    n++;
  }
  taken.add(candidate);
  return candidate;
}

const two = (n: number) => String(n).padStart(2, '0');

/** One archive per run, named by when the run happened, to the second. */
export function archiveName(at: Date): string {
  return 'pdfiq-batch-' + at.getFullYear() + '-' + two(at.getMonth() + 1) + '-' + two(at.getDate())
    + '-' + two(at.getHours()) + '-' + two(at.getMinutes()) + '-' + two(at.getSeconds()) + '.zip';
}

/**
 * The entry names inside a zip, read back from the bytes.
 *
 * Read rather than remembered on purpose: the reconciliation below is only worth doing if it
 * looks at what was built, not at the list that was handed to the builder.
 */
export function entryNames(zip: Uint8Array): string[] {
  const names: string[] = [];
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const LOCAL_HEADER = 0x04034b50;
  for (let i = 0; i + 30 <= zip.length; i++) {
    if (view.getUint32(i, true) !== LOCAL_HEADER) continue;
    const size = view.getUint32(i + 18, true);
    const nameLength = view.getUint16(i + 26, true);
    const extraLength = view.getUint16(i + 28, true);
    names.push(new TextDecoder().decode(zip.subarray(i + 30, i + 30 + nameLength)));
    i += 30 + nameLength + extraLength + size - 1;
  }
  return names;
}

export async function runBatch(
  files: File[],
  op: BatchOp,
  deps: RunDeps,
  signal: AbortSignal,
  hooks: RunHooks = {},
): Promise<RunReport> {
  const spec = OPERATIONS[op];
  const results: FileResult[] = [];
  const taken = new Set<string>();
  const entries: ZipEntry[] = [];
  let cancelled = false;

  for (let i = 0; i < files.length; i++) {
    if (signal.aborted) { cancelled = true; break; }
    const file = files[i];
    hooks.onFile?.(i, files.length, file.name);

    let outcome: Outcome;
    try {
      const produced = await deps.apply(op, file, (done, total) => hooks.onPage?.(done, total), signal);
      // Asked after the work, not only before it: an operation can return what it had rather than
      // throw when it is stopped, and a partial result is not a finished file.
      if (signal.aborted) outcome = { kind: 'interrupted' };
      else if ('leftAlone' in produced) {
        outcome = { kind: 'left-alone', why: produced.leftAlone };
      } else {
        const name = allocateName(file.name, spec.extension, taken);
        entries.push({ name, data: produced.bytes });
        outcome = { kind: 'done', name, bytes: produced.bytes.length };
      }
    } catch (err) {
      // One file's failure cannot end the run: a batch that stops at file seven and says nothing
      // is worse than doing seven by hand, because the other thirteen are lost as well.
      outcome = signal.aborted ? { kind: 'interrupted' } : { kind: 'failed', reason: deps.describeError(err) };
    }

    const result: FileResult = { source: file.name, outcome };
    results.push(result);
    hooks.onResult?.(result);
    if (outcome.kind === 'interrupted') { cancelled = true; break; }
  }

  // Everything not reached is named, so a cancelled run of twenty after three does not leave
  // seventeen files unmentioned for the reader to assume the worst about.
  if (cancelled) {
    for (const file of files.slice(results.length)) {
      results.push({ source: file.name, outcome: { kind: 'not-attempted' } });
    }
  }

  const zip = entries.length ? makeZip(entries) : null;
  const built = zip ? entryNames(zip) : [];
  const done = results.filter((r) => r.outcome.kind === 'done').length;

  return {
    op,
    results,
    cancelled,
    zip,
    zipName: archiveName(deps.now?.() ?? new Date()),
    entries: built,
    reconciles: built.length === done,
  };
}

/** What the screen says when it is over. Counts only; the per-file list is rendered beside it. */
export function describeRun(report: RunReport): { head: string; detail: string } {
  const count = (kind: Outcome['kind']) => report.results.filter((r) => r.outcome.kind === kind).length;
  const done = count('done');
  const failed = count('failed');
  const left = count('left-alone');
  const missed = count('not-attempted');
  const spec = OPERATIONS[report.op];

  // The archive's contents are the result. A summary that disagrees with them is the screen
  // lying about the reader's files, so nothing is offered at all.
  if (!report.reconciles) {
    return {
      head: 'This run cannot be handed over.',
      detail: 'The archive holds ' + report.entries.length + ' files and the run recorded ' + done
        + '. Rather than show a summary that disagrees with the archive, nothing is offered here:'
        + ' run it again, and if it happens twice the files are better done one at a time.',
    };
  }

  const head = done === 0
    ? (report.cancelled ? 'Stopped before any file was finished.' : 'Nothing was written.')
    : report.cancelled
      ? 'Stopped. ' + done + (done === 1 ? ' file' : ' files') + ' finished before you did.'
      : done + ' of ' + report.results.length + (report.results.length === 1 ? ' file' : ' files') + ' done.';

  const parts: string[] = [];
  if (done) parts.push(done + ' in the archive, with ' + spec.label.toLowerCase() + ' applied');
  if (left) parts.push(left + ' left alone, because there was nothing to gain');
  if (failed) parts.push(failed + ' failed, each named below with the reason');
  const stopped = count('interrupted');
  if (stopped) parts.push(stopped + ' stopped partway, with nothing of it kept');
  if (missed) parts.push(missed + ' not attempted');

  return { head, detail: parts.length ? parts.join('. ') + '.' : '' };
}

/** Referenced so the sentinel survives minification in the bundle that carries this module. */
export function batchMark(): string {
  return BATCH_SENTINEL;
}
