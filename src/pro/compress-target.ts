/**
 * Pro: compress to a target. docs/compress-to-target.md is the contract — for both products —
 * and this is the web's implementation of it.
 *
 * Search and wording only: no DOM, and the compression pass is handed in. So the search is
 * tested in Node with scripted sizes (tools/verify-pro-features.mjs), while the real pass, in the
 * page, runs the same compressor the presets use through its per-image `plan` hook — one
 * compressor, one set of rules, no second copy to drift.
 */
import type { Analysis, ImageOutcome, ImagePlan } from '../lib/compress.js';
import type { PdfImage } from '../lib/pdf-inspect.js';
import { formatBytes, plural } from '../lib/format.js';

export const TARGET_SENTINEL = 'pdfiq-pro:compress-target';

export interface Step {
  dpi: number;
  /** JPEG quality, 0–1, as the compressor takes it. */
  quality: number;
}

/** Mildest to harshest. Steps 4, 6 and 9 are the Balanced, Smaller and Smallest presets. */
export const LADDER: readonly Step[] = [
  { dpi: 220, quality: 0.85 },
  { dpi: 200, quality: 0.80 },
  { dpi: 180, quality: 0.76 },
  { dpi: 150, quality: 0.72 },
  { dpi: 130, quality: 0.66 },
  { dpi: 110, quality: 0.58 },
  { dpi: 96, quality: 0.52 },
  { dpi: 84, quality: 0.47 },
  { dpi: 72, quality: 0.42 },
];
/** The Smallest preset. A target is never chased past it: below it, fine print stops being readable. */
export const FLOOR_INDEX = LADDER.length - 1;

/** The site's own units (src/lib/format.ts), so "4.9 MB" is under "5 MB" by the same arithmetic. */
export const UNIT = { KB: 1024, MB: 1024 * 1024 } as const;

const q = (s: Step) => Math.round(s.quality * 100);
const exact = (n: number) => `${n.toLocaleString('en-GB')} bytes`;

// ---------------------------------------------------------------- mode 1: target resolution

/** Where a downscaled image's JPEG quality comes from when the file does not say. */
export const FALLBACK_QUALITY = 0.85;

export interface ResolutionCounts {
  /** Drawn above N dpi: these are the images the mode acts on. */
  above: number;
  atOrBelow: number;
  /** Never measurably placed: left alone, not guessed. */
  unknown: number;
  /** Not in a form the compressor can re-encode (CMYK, JPEG 2000, JBIG2, CCITT, masks). */
  cannotReencode: number;
}

export function countResolution(a: Analysis, n: number): ResolutionCounts {
  let above = 0, atOrBelow = 0, unknown = 0;
  for (const img of a.recompressible) {
    if (img.dpi == null || !Number.isFinite(img.dpi)) unknown++;
    else if (img.dpi > n) above++;
    else atOrBelow++;
  }
  return { above, atOrBelow, unknown, cannotReencode: a.images.length - a.recompressible.length };
}

/**
 * Only images drawn above N dpi change; everything else is left byte for byte. A downscaled image
 * keeps its own JPEG quality where the file records it, so resolution is the only lever.
 */
export function resolutionPlan(n: number): (img: PdfImage) => ImagePlan {
  return (img) => {
    if (img.dpi == null || !Number.isFinite(img.dpi) || img.dpi <= n) return 'keep';
    const own = img.jpeg?.quality;
    return { targetDpi: n, quality: own != null && own > 0 ? Math.min(own, 100) / 100 : FALLBACK_QUALITY };
  };
}

/** Said before running, when running would change nothing. Null when there is work to do. */
export function resolutionNothingToDo(a: Analysis, n: number): string | null {
  const c = countResolution(a, n);
  if (c.above > 0) return null;
  // A document with no images at all is not a document whose images are all small: saying "every
  // image in this file is already at or below 150 dpi" about a file that has none is a claim
  // about things that do not exist. Found by asking a text-only memo for 150 dpi.
  if (!a.images.length) {
    return 'This document holds no images, so a resolution target has nothing to act on. '
      + 'Its size is text, fonts and structure, which this setting does not touch.';
  }
  const tail = c.unknown ? ` ${plural(c.unknown, 'more image')} ${c.unknown === 1 ? 'has' : 'have'} no measurable resolution and would be left too.` : '';
  return `Every image in this file is already at or below ${n} dpi, so this would change nothing.${tail}`;
}

/** What happened, from the compressor's own per-image outcomes. */
export function describeResolution(a: Analysis, n: number, outcomes: Map<string, ImageOutcome>): string {
  const c = countResolution(a, n);
  let downscaled = 0, stayedAbove = 0;
  for (const img of a.recompressible) {
    if (img.dpi == null || img.dpi <= n) continue;
    if (outcomes.get(img.key) === 'replaced') downscaled++;
    else stayedAbove++;
  }
  const bits = [`${plural(downscaled, 'image')} brought down to ${n} dpi`];
  if (c.atOrBelow) bits.push(`${c.atOrBelow} already at or below it left as ${c.atOrBelow === 1 ? 'it was' : 'they were'}`);
  if (c.unknown) bits.push(`${c.unknown} with no measurable resolution left alone`);
  if (c.cannotReencode) bits.push(`${c.cannotReencode} in a form this cannot re-encode left alone`);
  let s = `${bits.join('; ')}.`;
  if (stayedAbove) {
    s += ` ${plural(stayedAbove, 'image')} stayed above ${n} dpi, because resizing ${stayedAbove === 1 ? 'it' : 'them'} would not have made the file smaller.`;
  }
  return s;
}

// ---------------------------------------------------------------- mode 2: target size

export type SizeOutcome<T> =
  | { kind: 'already'; size: number }
  | { kind: 'cannot'; floorSize: number; passes: number }
  | { kind: 'reached'; stepIndex: number; size: number; passes: number; result: T };

/**
 * Floor first, so "cannot be met" is measured; then bisection toward the mildest step that fits.
 * Every call to `pass` is a complete compression from the original file. At most five passes.
 *
 * If an encoder ever made a milder step smaller than a harsher one, bisection could settle one
 * step harsher than necessary — but never on a result over the target, because the only result
 * returned is one that was measured under it.
 */
export async function searchSize<T>(
  originalSize: number,
  target: number,
  pass: (step: Step, passNumber: number) => Promise<{ size: number; result: T }>,
  signal?: AbortSignal,
): Promise<SizeOutcome<T>> {
  if (originalSize <= target) return { kind: 'already', size: originalSize };
  const stop = () => { if (signal?.aborted) throw new DOMException('cancelled', 'AbortError'); };

  let passes = 1;
  stop();
  const floor = await pass(LADDER[FLOOR_INDEX], passes);
  if (floor.size > target) return { kind: 'cannot', floorSize: floor.size, passes };

  let best = { index: FLOOR_INDEX, size: floor.size, result: floor.result };
  let fails = -1; // the harshest step known not to fit; -1 = none known
  let fits = FLOOR_INDEX; // the mildest step known to fit
  while (fits - fails > 1) {
    stop();
    const mid = Math.floor((fails + fits) / 2);
    const r = await pass(LADDER[mid], ++passes);
    if (r.size <= target) {
      fits = mid;
      best = { index: mid, size: r.size, result: r.result };
    } else {
      fails = mid;
    }
  }
  return { kind: 'reached', stepIndex: best.index, size: best.size, passes, result: best.result };
}

/** The most passes a search can take, for "pass 2 of up to 5". */
export const MAX_PASSES = 1 + Math.ceil(Math.log2(LADDER.length));

export function describeSize<T>(o: SizeOutcome<T>, target: number): string {
  if (o.kind === 'already') {
    return `This file is already ${formatBytes(o.size)} (${exact(o.size)}), which is under ${formatBytes(target)}. There is nothing to do.`;
  }
  if (o.kind === 'cannot') {
    const floor = LADDER[FLOOR_INDEX];
    return `This file can't be brought under ${formatBytes(target)} here. At our harshest setting — ` +
      `${floor.dpi} dpi, quality ${q(floor)} — it comes to ${formatBytes(o.floorSize)} (${exact(o.floorSize)}).`;
  }
  const step = LADDER[o.stepIndex];
  return `Under ${formatBytes(target)}: ${formatBytes(o.size)} (${exact(o.size)}) at ${step.dpi} dpi, quality ${q(step)} — ` +
    `the mildest setting that got there, found in ${plural(o.passes, 'pass', 'passes')}.`;
}

/** Parse what the user typed: a number and a unit. Null when it is not a usable size. */
export function parseTarget(amount: string, unit: 'KB' | 'MB'): number | null {
  const n = Number(String(amount).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n * UNIT[unit]);
}

export function targetMark(): string {
  return TARGET_SENTINEL;
}
