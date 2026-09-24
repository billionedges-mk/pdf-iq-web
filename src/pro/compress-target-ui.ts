/**
 * The compress page's Pro section: compress to a target resolution or a target size, per
 * docs/compress-to-target.md. Present only in a Pro-flag build, and only acts for someone signed
 * in; otherwise it says what the feature is and where to sign in.
 *
 * The page owns its views, progress and result screen; this module owns the decision and the
 * words, and asks the page for passes through `TargetContext`. Every pass is a fresh compression
 * from the original file, run by the same compressor the presets use.
 */
import { proAccount, lockedPanel, lockControls } from './gate.js';
import {
  MAX_PASSES, searchSize, describeSize, resolutionPlan, resolutionNothingToDo, describeResolution,
  parseTarget, targetMark, type Step,
} from './compress-target.js';
import { PRESETS, type Analysis, type CompressResult, type ImagePlan, type Preset } from '../lib/compress.js';
import type { PdfImage } from '../lib/pdf-inspect.js';
import { seconds } from '../lib/format.js';

export interface TargetContext {
  state(): { fileName: string; fileSize: number; analysis: Analysis } | null;
  /** The file as chosen, for Unlock to carry to the checkout and back. */
  source(): File | null;
  /** Where the locked offer goes for someone who does not own Pro: under the result, not among the options. */
  offerHost(): HTMLElement | null;
  /** One complete pass from the original file. `plan` absent means the preset applies to every image. */
  pass(opts: { preset: Preset; plan?: (img: PdfImage) => ImagePlan; label: string; signal: AbortSignal }): Promise<{ result: CompressResult; analysis: Analysis }>;
  /**
   * Start a run and return the signal that aborts it.
   *
   * Without `inPlace`, the page shows its progress card and moves focus to it — right when a result screen is
   * coming. With `inPlace`, nothing on the page changes and the caller shows the work where the reader is already
   * looking: the button they pressed becomes the Stop button, and the answer lands beside it.
   */
  begin(opts?: { inPlace?: boolean }): AbortSignal;
  end(): void;
  /** The page's own result screen, with one line of ours beneath it. */
  showResult(r: CompressResult, note: string): void;
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

  const account = proAccount();

  const note = document.createElement('p');
  note.className = 'hint';
  note.setAttribute('role', 'status');
  const say = (text: string) => { note.textContent = text; };

  /**
   * True from the moment a run starts until it ends, whichever way it ends.
   *
   * Both buttons stay on screen and stay clickable during an in-place run — the view swap used to take them away, and
   * taking the screen was the thing we just stopped doing. Two clicks then do damage the old shape could not: the
   * Stop click reaches this module's own `onclick` FIRST (it was registered before the stop listener, and listeners
   * on one element run in the order they were added), so pressing Stop STARTS a second run, whose `working()` reads
   * the button's current text — "Stop — 0.4s" — as the label to restore. Measured 24 September 2026: the button was
   * left reading "Stop — 0.4s" for good, with nothing running.
   */
  let running = false;

  /**
   * The pressed button, while its run is going: it says how long it has been working and it stops the run.
   *
   * Four seconds with no change anywhere near the control is what made a real user think the button had not worked
   * (24 September 2026). The page's own Stop lives on the progress card, which an in-place run never shows, so the
   * button has to be both — it is the only control the reader is looking at.
   */
  function working(button: HTMLButtonElement, abort: () => void): () => void {
    running = true;
    const label = button.textContent ?? '';
    const started = performance.now();
    const tick = () => { button.textContent = `Stop — ${seconds(performance.now() - started)}`; };
    tick();
    const timer = setInterval(tick, 100);
    button.setAttribute('aria-busy', 'true');
    const onStop = (e: Event) => { e.preventDefault(); abort(); };
    button.addEventListener('click', onStop);
    return () => {
      running = false;
      clearInterval(timer);
      button.removeEventListener('click', onStop);
      button.removeAttribute('aria-busy');
      button.textContent = label;
    };
  }

  /** The answer goes where the reader is, not where the page happens to be scrolled. */
  const showAnswer = (text: string) => { say(text); note.scrollIntoView({ block: 'nearest' }); };

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

  const controls = document.createElement('div');
  controls.append(
    row('No image above ', dpi, ' dpi', dpiGo),
    row('No larger than ', amount, unit, sizeGo),
  );
  host.append(controls, note);

  // Not owned: the same controls, locked, and the words under them (approved copy, 13 September 2026). Not a
  // description of the controls in their place: the reader sees what they would get. No handler is attached.
  if (!account) {
    // Not among the options: nothing is sold to someone who has not seen the tool work. The gold panel goes under the
    // result instead (pdf-iq-final.html 03), carrying the heading, the PRO tag and the real controls, locked.
    host.textContent = '';
    host.hidden = true;
    lockControls(controls);
    ctx.offerHost()?.replaceChildren(lockedPanel('target', 'Compressing to a size or a resolution you choose', () => ctx.source(), { title: 'Or aim for a target', controls }));
    return;
  }
  host.hidden = false;
  ctx.offerHost()?.replaceChildren();

  dpiGo.onclick = async () => {
    if (running) return; // a click during a run is either Stop (handled below) or the other target; neither starts work
    if (!proAccount()) return;
    const s = ctx.state();
    if (!s) return;
    const n = Math.round(Number(dpi.value));
    if (!Number.isFinite(n) || n < MIN_DPI || n > MAX_DPI) return say(`Enter a resolution between ${MIN_DPI} and ${MAX_DPI} dpi.`);
    const nothing = resolutionNothingToDo(s.analysis, n);
    if (nothing) return say(nothing);
    say('');
    const controller = new AbortController();
    const signal = ctx.begin({ inPlace: true });
    signal.addEventListener('abort', () => controller.abort(), { once: true });
    const done = working(dpiGo, () => controller.abort());
    try {
      const { result, analysis } = await ctx.pass({
        preset: asPreset({ dpi: n, quality: PRESETS[0].quality }),
        plan: resolutionPlan(n),
        label: `no image above ${n} dpi`,
        signal: controller.signal,
      });
      done();
      ctx.end();
      ctx.showResult(result, describeResolution(analysis, n, result.outcomes));
    } catch (e) {
      done();
      ctx.end();
      if (isAbort(e)) showAnswer('Stopped. Nothing was handed over.');
      else ctx.fail(e);
    }
  };

  sizeGo.onclick = async () => {
    if (running) return; // see dpiGo
    if (!proAccount()) return;
    const s = ctx.state();
    if (!s) return;
    const target = parseTarget(amount.value, unit.value as 'KB' | 'MB');
    if (target == null) return say('Enter a size, such as 5 MB or 800 KB.');
    if (s.fileSize <= target) return say(describeSize({ kind: 'already', size: s.fileSize }, target));
    say('');
    const controller = new AbortController();
    const signal = ctx.begin({ inPlace: true });
    signal.addEventListener('abort', () => controller.abort(), { once: true });
    const done = working(sizeGo, () => controller.abort());
    const started = performance.now();
    try {
      const outcome = await searchSize(s.fileSize, target, async (step, passNumber) => {
        const { result } = await ctx.pass({ preset: asPreset(step), label: `pass ${passNumber} of up to ${MAX_PASSES}`, signal: controller.signal });
        return { size: result.afterBytes, result };
      }, controller.signal);
      done();
      ctx.end();
      const took = ` It took ${seconds(performance.now() - started)} on this device.`;
      // Reached: there is a file, so the page's result screen is the right place. Cannot: there is nothing to save,
      // so nothing moves and the answer appears under the button that asked for it.
      if (outcome.kind === 'reached') ctx.showResult(outcome.result, describeSize(outcome, target) + took);
      else showAnswer(describeSize(outcome, target) + (outcome.kind === 'cannot' ? took : ''));
    } catch (e) {
      done();
      ctx.end();
      if (isAbort(e)) showAnswer('Stopped. Nothing was handed over.');
      else ctx.fail(e);
    }
  };
}
