/**
 * The shared machinery behind every tool page.
 *
 * Each tool page is a static HTML document containing every state it can be in, as
 * sections marked `data-view`. This switches between them. Nothing is templated at
 * runtime and nothing is fetched, so the page a search engine reads and the page a
 * person uses are the same document.
 */

import { formatBytes } from './format.js';
import type { ToolError } from './errors.js';
import * as E from './errors.js';

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T | null =>
  root.querySelector<T>(sel);
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T[] =>
  Array.from(root.querySelectorAll<T>(sel));

/**
 * The ceiling on what we will attempt.
 *
 * Not an upload limit — there is no upload. Run /memory-probe/ to reproduce everything here.
 *
 * There are two different costs, and only one of them is a reason to refuse a file.
 *
 * TIME is linear in the number of images, and it is not the ceiling's job. Measured on
 * Chrome 148 / 8 cores / 16 GB, with every image recompressed as the tool really does:
 *
 *     file    images   work    of which recompress
 *      10 MB      6     1.3s          1.1s
 *      20 MB     13    11.4s         11.1s
 *      30 MB     19    22.8s         22.4s
 *      40 MB     25    29.7s         29.1s
 *
 * About 1.17s per image here, and 98% of the runtime. But that work reports progress and
 * checks for cancellation once per image, so it is a visible, stoppable operation rather
 * than a hang, and the per-image cost varies enormously by device — an iPhone measured
 * around 50ms against this machine's 1170ms, a factor of twenty-three. A single byte limit
 * cannot express "will finish in a reasonable time" across that spread, and should not try.
 *
 * MEMORY is what the ceiling is for, because its failure mode is the one the interface
 * cannot rescue. Heap runs at four to six times the file. Past roughly 85 MB the collector
 * thrashes continuously and `save()` — one uninterruptible call, with no progress and no
 * cancel — went from 4.2s to 163.3s for 6% more data. Three minutes of a live tab that
 * answers nothing. An actual crash is far higher, near 800 MB against a 4 GB limit, and an
 * iPhone completed 400 MB: measuring for death would have justified raising this to 600 MB.
 *
 * 60 MB is 29% below that collapse. The margin is deliberate: it was measured on one strong
 * desktop, which is not the machine most people will meet it on.
 *
 * Two corrections are recorded here because both misled for several runs. The comment that
 * originally stood here cited a probe file and README figures, neither of which existed —
 * CLAIMS.md check 15. And the first figures this probe produced capped recompression at six
 * images regardless of file size, so the heaviest stage did not scale and every stage timing
 * taken before that cap was removed understated the work — CLAIMS.md check 16.
 */
export const MAX_BYTES = 60 * 1024 * 1024;

export const MEASURED_COLLAPSE_BYTES = 85 * 1024 * 1024;

export type ViewName = 'empty' | 'selected' | 'processing' | 'result' | 'nogain' | 'error';

export class ToolShell {
  readonly root: HTMLElement;
  private views = new Map<string, HTMLElement>();
  current: ViewName = 'empty';

  constructor(root: HTMLElement = document.body) {
    this.root = root;
    for (const el of $$('[data-view]', root)) {
      this.views.set(el.dataset.view!, el);
      el.hidden = el.dataset.view !== 'empty';
    }
  }

  show(view: ViewName): void {
    this.current = view;
    for (const [name, el] of this.views) el.hidden = name !== view;
    // Move focus to the newly revealed region so a screen reader follows the change.
    const target = this.views.get(view);
    if (target) {
      const heading = target.querySelector<HTMLElement>('h2, [data-focus]');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
    }
  }

  /** Fill and show the error view. */
  fail(err: ToolError): void {
    const set = (sel: string, text: string) => {
      const el = $(sel, this.root);
      if (el) el.textContent = text;
    };
    set('[data-err-kicker]', err.kicker);
    set('[data-err-title]', err.title);
    set('[data-err-body]', err.body);
    set('[data-err-mono]', err.mono);

    const action = $<HTMLButtonElement>('[data-err-action]', this.root);
    if (action) {
      action.hidden = !err.action;
      if (err.action) {
        action.textContent = err.action.label;
        action.onclick = err.action.run;
      } else {
        action.onclick = null;
      }
    }
    const pw = $('[data-err-password]', this.root);
    if (pw) pw.hidden = !err.password;
    const pwInput = $<HTMLInputElement>('[data-password-input]', this.root);
    if (pwInput && err.password) pwInput.value = '';

    this.show('error');
    if (pwInput && err.password) pwInput.focus();
  }

  announce(message: string): void {
    const live = $('[data-live]', this.root);
    if (live) live.textContent = message;
  }
}

// ---------------------------------------------------------------- file intake

export interface Dropped {
  files: File[];
}

/** Wire a drop zone: click, keyboard, and drag. */
export function wireDropzone(
  zone: HTMLElement,
  input: HTMLInputElement,
  onFiles: (files: File[]) => void
): void {
  const open = () => input.click();

  zone.addEventListener('click', open);
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });

  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    // Reset so choosing the same file twice in a row still fires.
    input.value = '';
    if (files.length) onFiles(files);
  });

  const ring = zone.querySelector<HTMLElement>('.dropzone__ring');
  const setDragging = (on: boolean) => {
    if (ring) ring.hidden = !on;
  };
  setDragging(false);

  let depth = 0;
  zone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    depth++;
    setDragging(true);
  });
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  zone.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) setDragging(false);
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    setDragging(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) onFiles(files);
  });

  // Dropping anywhere else on the page should not make the browser navigate away
  // from an in-progress job and lose it.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}

/** Read the first bytes, for deciding what a file really is. */
export async function readHead(file: File, n = 16): Promise<Uint8Array> {
  const slice = file.slice(0, n);
  return new Uint8Array(await slice.arrayBuffer());
}

/**
 * Validate a candidate PDF by its own bytes rather than its name or the type string
 * the OS attached to it, both of which are frequently wrong.
 */
export async function acceptPdf(file: File): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: ToolError }> {
  const facts = { name: file.name, size: file.size, type: file.type };
  if (file.size === 0) return { ok: false, error: E.empty(facts) };
  if (file.size > MAX_BYTES) return { ok: false, error: E.tooBig(facts, MAX_BYTES) };

  const head = await readHead(file, 1024);
  if (E.sniff(head) !== 'application/pdf') {
    return { ok: false, error: E.notPdf(facts, head) };
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { ok: true, bytes };
  } catch (err) {
    return { ok: false, error: E.outOfMemory(facts, 'reading the file off disk') };
  }
}

// ---------------------------------------------------------------- output

/**
 * Hand the finished file to the browser's download machinery.
 * A real static site, so a plain anchor works; the object URL is released once the
 * browser has had a turn with it.
 */
export function saveFile(bytes: Uint8Array | Blob, filename: string, mime = 'application/pdf'): void {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------------------------------------------------------------- progress

export class Progress {
  private bar: HTMLElement | null;
  private pct: HTMLElement | null;
  private facts: HTMLElement | null;
  private stagesEl: HTMLElement | null;
  private started = 0;
  private elapsedTimer: number | undefined;

  constructor(private root: ParentNode = document, private stageLabels: string[] = []) {
    this.bar = $('[data-bar]', root);
    this.pct = $('[data-pct]', root);
    this.facts = $('[data-facts]', root);
    this.stagesEl = $('[data-stages]', root);
  }

  start(): void {
    this.started = performance.now();
    this.set(0, 1, 0, '');
    clearInterval(this.elapsedTimer);
    this.elapsedTimer = window.setInterval(() => this.tickElapsed(), 100);
  }

  stop(): void {
    clearInterval(this.elapsedTimer);
  }

  private tickElapsed(): void {
    const el = $('[data-elapsed]', this.root);
    if (el) el.textContent = `${((performance.now() - this.started) / 1000).toFixed(1)}s elapsed`;
  }

  set(done: number, total: number, stage: number, detail: string): void {
    const fraction = total > 0 ? Math.min(1, done / total) : 0;
    // The bar spans the whole job, with each stage owning a slice of it.
    const stageCount = Math.max(1, this.stageLabels.length);
    const overall = stageCount > 1
      ? (stage + fraction) / stageCount
      : fraction;
    const shown = Math.min(100, Math.round(overall * 100));

    if (this.bar) this.bar.style.width = `${shown}%`;
    if (this.pct) this.pct.textContent = `${shown}%`;
    const region = this.bar?.closest('[role="progressbar"]') ?? $('[role="progressbar"]', this.root);
    region?.setAttribute('aria-valuenow', String(shown));

    if (this.facts && detail) this.facts.textContent = detail;
    this.renderStages(stage);
  }

  private renderStages(active: number): void {
    if (!this.stagesEl) return;
    const items = $$('li', this.stagesEl);
    items.forEach((li, i) => {
      const mark = $('[data-stage-mark]', li);
      const status = $('[data-stage-status]', li);
      const state = i < active ? 'done' : i === active ? 'working' : 'waiting';
      if (mark) mark.textContent = state === 'done' ? '✓' : state === 'working' ? '▸' : '·';
      if (status) status.textContent = state;
    });
  }
}

// ---------------------------------------------------------------- misc

/** Yield to the browser so a paint can happen mid-job. */
export const breathe = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export function describeFile(file: File, extra: string[] = []): string {
  return [formatBytes(file.size), ...extra].join(' · ');
}

/** Guard the user against losing work by closing the tab mid-job. */
export function warnWhileBusy(isBusy: () => boolean): void {
  window.addEventListener('beforeunload', (e) => {
    if (isBusy()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}
