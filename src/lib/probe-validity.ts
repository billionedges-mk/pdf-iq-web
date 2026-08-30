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
  /** What the pipeline actually observed. A structural signal that does not depend on
   *  timing at all, so it survives a device whose clock or scheduler misleads us. */
  pagesSeen?: number;
  imagesSeen?: number;
  savedBytes?: number;
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

  // Work must grow with the file, and the growth must be worth the span.
  //
  // The first version of this compared only the fastest rung to the slowest, and passed a
  // run of 0.2s, 0.4s, 0.4s, 0.4s across 10 to 80 MB: one quick small rung gave 2x apparent
  // growth and satisfied a flat 1.5x threshold, while 30, 50 and 80 MB sat at an identical
  // 0.4s. A single outlier could satisfy the whole check. It is now measured against how far
  // the ladder actually spans.
  const bySize = [...done].sort((a, b) => a.mb - b.mb);
  if (bySize.length >= 3) {
    const smallest = bySize[0];
    const largest = bySize[bySize.length - 1];
    const span = largest.mb / smallest.mb;
    const ratio = (largest.pipeMs ?? 0) / Math.max(smallest.pipeMs ?? 0, 1);
    const expected = Math.max(1.5, span * 0.5);
    if (span >= 2 && ratio < expected) {
      problems.push(
        `work did not grow with the file: ${span.toFixed(1)}x the size changed the time only ` +
        `${ratio.toFixed(2)}x (${((smallest.pipeMs ?? 0) / 1000).toFixed(1)}s at ${smallest.mb} MB to ` +
        `${((largest.pipeMs ?? 0) / 1000).toFixed(1)}s at ${largest.mb} MB), where at least ` +
        `${expected.toFixed(1)}x was needed`
      );
    }

    // Independently of the ratio above: a run of rungs sitting at the same time while the
    // file keeps growing is the shape a person spots instantly, so check for it directly
    // rather than relying on one formula not to be gamed by an outlier.
    for (let i = 0; i + 2 < bySize.length; i++) {
      const group = bySize.slice(i);
      const times = group.map((r) => r.pipeMs ?? 0);
      const lo = Math.min(...times);
      const hi = Math.max(...times);
      const grew = group[group.length - 1].mb / group[0].mb;
      if (group.length >= 3 && grew >= 2 && hi <= lo * 1.1) {
        problems.push(
          `${group.length} rungs from ${group[0].mb} to ${group[group.length - 1].mb} MB all took ` +
          `essentially the same time (${(lo / 1000).toFixed(1)}s to ${(hi / 1000).toFixed(1)}s) while the ` +
          `file grew ${grew.toFixed(1)}x`
        );
        break;
      }
    }
  }

  // Structural, and independent of any clock: the pipeline has to have seen a document, and
  // writing it back out has to produce roughly what was read in. A pipeline that silently
  // did nothing reports a plausible elapsed time for having done nothing.
  for (const r of done) {
    if (r.pagesSeen != null && r.pagesSeen === 0) {
      problems.push(`${r.mb} MB: the pipeline parsed 0 pages, so it measured nothing`);
    }
    if (r.savedBytes != null && r.builtBytes != null) {
      const out = r.savedBytes / r.builtBytes;
      if (out < 0.5) {
        problems.push(
          `${r.mb} MB: writing it back out produced ${(r.savedBytes / 1048576).toFixed(1)} MB from ` +
          `${(r.builtBytes / 1048576).toFixed(1)} MB in — the document did not survive the round trip`
        );
      }
    }
  }

  return { ok: problems.length === 0, problems };
}

