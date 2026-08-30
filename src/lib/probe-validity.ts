/**
 * Whether a memory-probe run is allowed to produce a number.
 *
 * Separate from the probe itself so the checks can be driven with real recorded runs —
 * including the one that produced an impossible answer — rather than trusted by reading.
 */

export interface Rung {
  mb: number;
  phase: string;
  outcome: 'survived' | 'threw' | 'started';
  detail?: string;
  /** Time to build the fixture. Not part of the answer — no user does this. */
  genMs?: number;
  /** Time for the work a tool actually does. This is the number that matters. */
  pipeMs?: number;
  /** Per-stage breakdown of pipeMs, so "it got slow" can name which part. */
  stages?: Record<string, number>;
  heapMb?: number;
  builtBytes?: number;
}

export interface State {
  agent: string;
  started: string;
  /** Sizes of the base JPEGs. A blank canvas compresses to a fraction of a real one, and
   *  six blank canvases all compress to the SAME size — which is the cheapest tell there
   *  is that drawing silently failed, and it works on browsers that report no heap. */
  baseImageBytes?: number[];
  deviceMemoryGb?: number;
  heapLimitMb?: number;
  cores?: number;
  rungs: Rung[];
  finished?: boolean;
}

/**
 * Is this run allowed to produce a number at all?
 *
 * An iPhone reported 0.4s of work at 30, 50, 60 and 80 MB — identical at every rung, on a
 * device with no heap readout to contradict it. The figure was impossible and the probe
 * printed it as a ceiling anyway. That is the same failure as a readout showing a count it
 * cannot stand behind, and it gets the same answer: refuse, and say why.
 *
 * These checks are deliberately about internal consistency rather than absolute values, so
 * they hold on a slow phone as well as a fast desktop. The only absolute is a floor on the
 * fixture, and it is an order of magnitude below anything a real encoder produces.
 */
export interface Validity {
  ok: boolean;
  problems: string[];
}

export function validate(s: State): Validity {
  const problems: string[] = [];
  const done = s.rungs.filter((r) => r.outcome === 'survived');

  // The fixture has to be the size it was asked for. Every rung below reports the size it
  // *requested*, so a generator that silently produced something small would otherwise be
  // invisible — which is the one thing the failing run had no way to show.
  for (const r of done) {
    if (r.builtBytes == null) {
      problems.push(`${r.mb} MB: no fixture size recorded`);
      continue;
    }
    const builtMb = r.builtBytes / 1048576;
    if (Math.abs(builtMb - r.mb) / r.mb > 0.25) {
      problems.push(`${r.mb} MB: fixture was actually ${builtMb.toFixed(1)} MB, more than 25% out`);
    }
  }

  // Six different drawings compress to six different sizes. If they are all identical the
  // canvas produced nothing, and every size above is a document full of blank pages.
  const base = s.baseImageBytes;
  if (base && base.length) {
    if (new Set(base).size === 1) {
      problems.push(`all ${base.length} source images are exactly ${base[0]} bytes — the canvas drew nothing`);
    }
    const smallest = Math.min(...base);
    if (smallest < 150 * 1024) {
      problems.push(`source images are only ${(smallest / 1024).toFixed(0)} KB — far below a real scan, so the fixture is not representative`);
    }
  } else if (done.length) {
    problems.push('no source image sizes recorded');
  }

  // No amount of parsing, recompressing and serialising megabytes finishes instantly.
  for (const r of done) {
    if ((r.pipeMs ?? 0) < 50) {
      problems.push(`${r.mb} MB: work took ${r.pipeMs ?? 0}ms, which is not a possible time for that much data`);
    }
  }

  // The headline check. Work must grow with the file. If a ladder spanning at least double
  // the size shows essentially flat time, the pipeline is not doing what it claims to.
  if (done.length >= 3) {
    const sizes = done.map((r) => r.mb);
    const span = Math.max(...sizes) / Math.min(...sizes);
    const times = done.map((r) => r.pipeMs ?? 0);
    const slowest = Math.max(...times);
    const fastest = Math.min(...times);
    if (span >= 2 && slowest < fastest * 1.5) {
      problems.push(
        `work did not grow with the file: ${span.toFixed(1)}x the size changed the time only ` +
        `${(slowest / Math.max(fastest, 1)).toFixed(2)}x (${(fastest / 1000).toFixed(1)}s to ${(slowest / 1000).toFixed(1)}s)`
      );
    }
  }

  return { ok: problems.length === 0, problems };
}

