/**
 * The compress page's Pro section: compress to a target resolution or a target size, per
 * docs/compress-to-target.md. Present only in a Pro-flag build, and only acts for someone signed
 * in; otherwise it says what the feature is and where to sign in.
 *
 * The page owns its views, progress and result screen; this module owns the decision and the
 * words, and asks the page for passes through `TargetContext`. Every pass is a fresh compression
 * from the original file, run by the same compressor the presets use.
 */
import { signedIn, signInPrompt } from './gate.js';
import {
  MAX_PASSES, searchSize, describeSize, resolutionPlan, resolutionNothingToDo, describeResolution,
  parseTarget, targetMark, type Step,
} from './compress-target.js';
import { PRESETS, type Analysis, type CompressResult, type ImagePlan, type Preset } from '../lib/compress.js';
import type { PdfImage } from '../lib/pdf-inspect.js';
import { seconds } from '../lib/format.js';

export interface TargetContext {
  state(): { fileName: string; fileSize: number; analysis: Analysis } | null;
  /** One complete pass from the original file. `plan` absent means the preset applies to every image. */
  pass(opts: { preset: Preset; plan?: (img: PdfImage) => ImagePlan; label: string; signal: AbortSignal }): Promise<{ result: CompressResult; analysis: Analysis }>;
  /** Show progress and return the signal the page's Stop button aborts. */
  begin(): AbortSignal;
  end(): void;
  /** The page's own result screen, with one line of ours beneath it. */
  showResult(r: CompressResult, note: string): void;
  /** Back to the options, where our message is shown. */
  back(): void;
  fail(err: unknown): void;
}

const MIN_DPI = 50;
const MAX_DPI = 600;

/** A preset-shaped setting for one step, so the compressor treats it exactly as it treats a preset. */
const asPreset = (step: Step): Preset => ({ ...PRESETS[0], targetDpi: step.dpi, quality: step.quality });

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

function row(...children: (Node | string)[]): HTMLElement {
  const div = document.createElement('div');
  div.className = 'actions';
  div.style.marginTop = '10px';
  div.append(...children);
  return div;
}

export function mountTarget(host: HTMLElement, ctx: TargetContext): void {
  host.textContent = '';
  host.dataset.pdfiqPro = targetMark();
  const legend = document.createElement('legend');
  legend.textContent = 'Or aim for a target';
  host.append(legend);

  if (!signedIn()) {
    host.append(signInPrompt('Compressing to a size or a resolution you choose'));
    return;
  }

  const note = document.createElement('p');
  note.className = 'hint';
  note.setAttribute('role', 'status');
  const say = (text: string) => { note.textContent = text; };

  // ---- target resolution
  const dpi = document.createElement('input');
  dpi.type = 'number';
  dpi.min = String(MIN_DPI);
  dpi.max = String(MAX_DPI);
  dpi.step = '1';
  dpi.value = '150';
  dpi.style.width = '6em';
  dpi.setAttribute('aria-label', 'Highest resolution, in dpi');
  const dpiGo = document.createElement('button');
  dpiGo.type = 'button';
  dpiGo.className = 'btn-quiet';
  dpiGo.textContent = 'Compress to this resolution';

  // ---- target size
  const amount = document.createElement('input');
  amount.type = 'number';
  amount.min = '0';
  amount.step = 'any';
  amount.placeholder = '5';
  amount.style.width = '6em';
  amount.setAttribute('aria-label', 'Largest size');
  const unit = document.createElement('select');
  unit.setAttribute('aria-label', 'Unit');
  for (const u of ['MB', 'KB']) {
    const o = document.createElement('option');
    o.value = u;
    o.textContent = u;
    unit.append(o);
  }
  const sizeGo = document.createElement('button');
  sizeGo.type = 'button';
  sizeGo.className = 'btn-quiet';
  sizeGo.textContent = 'Compress to this size';

  host.append(
    row('No image above ', dpi, ' dpi', dpiGo),
    row('No larger than ', amount, unit, sizeGo),
    note,
  );

  dpiGo.onclick = async () => {
    const s = ctx.state();
    if (!s) return;
    const n = Math.round(Number(dpi.value));
    if (!Number.isFinite(n) || n < MIN_DPI || n > MAX_DPI) return say(`Enter a resolution between ${MIN_DPI} and ${MAX_DPI} dpi.`);
    const nothing = resolutionNothingToDo(s.analysis, n);
    if (nothing) return say(nothing);
    say('');
    const signal = ctx.begin();
    try {
      const { result, analysis } = await ctx.pass({
        preset: asPreset({ dpi: n, quality: PRESETS[0].quality }),
        plan: resolutionPlan(n),
        label: `no image above ${n} dpi`,
        signal,
      });
      ctx.end();
      ctx.showResult(result, describeResolution(analysis, n, result.outcomes));
    } catch (e) {
      ctx.end();
      if (isAbort(e)) { ctx.back(); say('Stopped. Nothing was handed over.'); }
      else ctx.fail(e);
    }
  };

  sizeGo.onclick = async () => {
    const s = ctx.state();
    if (!s) return;
    const target = parseTarget(amount.value, unit.value as 'KB' | 'MB');
    if (target == null) return say('Enter a size, such as 5 MB or 800 KB.');
    if (s.fileSize <= target) return say(describeSize({ kind: 'already', size: s.fileSize }, target));
    say('');
    const signal = ctx.begin();
    const started = performance.now();
    try {
      const outcome = await searchSize(s.fileSize, target, async (step, passNumber) => {
        const { result } = await ctx.pass({ preset: asPreset(step), label: `pass ${passNumber} of up to ${MAX_PASSES}`, signal });
        return { size: result.afterBytes, result };
      }, signal);
      ctx.end();
      const took = ` It took ${seconds(performance.now() - started)} on this device.`;
      if (outcome.kind === 'reached') ctx.showResult(outcome.result, describeSize(outcome, target) + took);
      else { ctx.back(); say(describeSize(outcome, target) + (outcome.kind === 'cannot' ? took : '')); }
    } catch (e) {
      ctx.end();
      if (isAbort(e)) { ctx.back(); say('Stopped. Nothing was handed over.'); }
      else ctx.fail(e);
    }
  };
}
