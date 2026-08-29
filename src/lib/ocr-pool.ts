/**
 * A pool of tesseract workers, and the pipeline that feeds it.
 *
 * Pages are independent, so recognition parallelises almost linearly until cores run
 * out. Measured on an 8-core desktop, 8 pages at 200 dpi: one worker 22.5s, two 13.8s
 * (1.63x), four 8.1s (2.77x). That is the difference between a 40-page scan taking five
 * minutes and taking under one.
 *
 * Two things bound the pool rather than just "use all the cores":
 *
 *   Memory. Each worker holds its own copy of the language model — around 22 MB
 *   uncompressed for English — plus its own wasm core. Four workers is fine on a laptop
 *   and is not fine on a mid-range phone, so the size is cut on small-memory and mobile
 *   devices rather than assuming everyone has the desktop's headroom.
 *
 *   The first download. All workers read the model, but only the first one to ask
 *   fetches it; the rest come off the browser's cache. Starting them all at once would
 *   fire N simultaneous requests for the same 10 MB, so worker one is created alone and
 *   the others follow once it is ready.
 */

import { createWorker, type Worker } from 'tesseract.js';

export interface PoolOptions {
  lang: string;
  /** Progress from the first worker only, so the model download is reported once. */
  onProgress?: (status: string, progress: number) => void;
  signal?: AbortSignal;
}

const WORKER_PATHS = {
  workerPath: '/vendor/tesseract-worker.min.js',
  corePath: '/vendor/tesseract-core',
  langPath: '/vendor/tessdata',
  gzip: true,
} as const;

interface NavigatorWithHints extends Navigator {
  deviceMemory?: number;
  userAgentData?: { mobile?: boolean };
}

/**
 * How many workers this device should run. Deliberately conservative: the cost of one
 * worker too few is some wall-clock, and the cost of one too many on a phone is the tab
 * being killed mid-job.
 */
export function poolSize(): number {
  const nav = navigator as NavigatorWithHints;
  const cores = nav.hardwareConcurrency || 2;

  // Leave a core for the main thread, which is still rendering pages.
  let n = Math.max(1, Math.min(4, cores - 1));

  const mobile = nav.userAgentData?.mobile
    ?? (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  if (mobile) n = Math.min(n, 2);

  // deviceMemory is reported in GB and rounded down; it is absent on Safari and Firefox.
  const memory = nav.deviceMemory;
  if (memory !== undefined && memory <= 4) n = Math.min(n, 1);

  return n;
}

export class OcrPool {
  private workers: Worker[] = [];

  private constructor(workers: Worker[]) {
    this.workers = workers;
  }

  static async create(size: number, opts: PoolOptions): Promise<OcrPool> {
    // First worker alone: it populates the browser's model cache and is the one whose
    // progress is worth showing, because it is the one doing the downloading.
    const first = await createWorker(opts.lang, 1, {
      ...WORKER_PATHS,
      logger: opts.onProgress
        ? (m: { status?: string; progress?: number }) => {
            if (m?.status) opts.onProgress!(m.status, m.progress ?? 0);
          }
        : undefined,
    });

    if (opts.signal?.aborted) {
      await first.terminate();
      throw new DOMException('cancelled', 'AbortError');
    }

    const rest = size > 1
      ? await Promise.all(
          Array.from({ length: size - 1 }, () => createWorker(opts.lang, 1, WORKER_PATHS))
        )
      : [];

    return new OcrPool([first, ...rest]);
  }

  get size(): number {
    return this.workers.length;
  }

  /**
   * Run `jobs` across the pool. `produce` is called on the main thread to prepare each
   * job — that is where page rendering happens, because a canvas cannot be produced in
   * a worker here — and is awaited one at a time. `onDone` fires as each page finishes,
   * in whatever order they finish.
   */
  async run<T>(
    indices: number[],
    produce: (index: number) => Promise<Blob | null>,
    recognise: (worker: Worker, image: Blob, index: number) => Promise<T>,
    onDone: (index: number, result: T | null) => void,
    signal?: AbortSignal
  ): Promise<void> {
    // A small buffer: enough to keep every worker fed, not so much that a pile of
    // page images sits in memory waiting.
    const capacity = this.workers.length + 1;
    const buffer: Array<{ index: number; image: Blob }> = [];
    let producing = true;

    // Every blocked party gets its own resolver and re-checks its own condition after
    // being woken. A single shared slot deadlocks here: with one producer and N
    // consumers all waiting, each new waiter overwrites the last and those waiters are
    // never resolved. That is not a rare race — it wedged the tab on the first run.
    let waiters: Array<() => void> = [];
    const notifyAll = () => {
      const pending = waiters;
      waiters = [];
      for (const resolve of pending) resolve();
    };
    const waitForChange = () => new Promise<void>((resolve) => { waiters.push(resolve); });

    const onAbort = () => notifyAll();
    signal?.addEventListener('abort', onAbort);

    const producer = (async () => {
      try {
        for (const index of indices) {
          if (signal?.aborted) break;
          while (buffer.length >= capacity && !signal?.aborted) await waitForChange();
          if (signal?.aborted) break;
          const image = await produce(index);
          if (image) buffer.push({ index, image });
          else onDone(index, null);
          notifyAll();
        }
      } finally {
        producing = false;
        notifyAll();
      }
    })();

    const consumer = async (worker: Worker) => {
      for (;;) {
        if (signal?.aborted) return;
        const job = buffer.shift();
        if (!job) {
          if (!producing) return;
          await waitForChange();
          continue;
        }
        // A slot just freed up, so the producer may be able to run again.
        notifyAll();
        try {
          const result = await recognise(worker, job.image, job.index);
          onDone(job.index, result);
        } catch {
          // One unreadable page is not a reason to abandon the document.
          onDone(job.index, null);
        }
      }
    };

    try {
      await Promise.all([producer, ...this.workers.map(consumer)]);
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async terminate(): Promise<void> {
    const workers = this.workers;
    this.workers = [];
    await Promise.all(workers.map((w) => w.terminate().catch(() => {})));
  }
}
