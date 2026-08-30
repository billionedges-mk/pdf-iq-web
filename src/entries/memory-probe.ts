/**
 * Where does a tab actually die?
 *
 * The 200 MB ceiling in ui.ts was a guess. Its own comment cited a probe and "the figures
 * it produced" — neither existed, which made an unmeasured number look measured to the
 * next reader. This is that probe, written so the number can be replaced with a real one.
 *
 * The hard part is that the interesting failure kills the page, taking any in-memory
 * result with it. So every rung is written to localStorage *before* it is attempted: a
 * rung that was started and never finished is the death point, and it survives the crash.
 *
 * Nothing is read from disk. Every fixture is generated in the page.
 */

import { PDFDocument } from 'pdf-lib';
import { analyse, compress, PRESETS } from '../lib/compress.js';
import { validate, type Rung, type State } from '../lib/probe-validity.js';

const KEY = 'pdfiq-memory-probe';
const out = document.getElementById('probe-out')!;
const status = document.getElementById('probe-status')!;

const load = (): State | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as State | null;
  } catch {
    return null;
  }
};

const save = (s: State): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Full, or blocked in a private window. The on-screen log still has it.
  }
};

const memory = () =>
  (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;

const heapMb = (): number | undefined => {
  const m = memory();
  return m ? Math.round(m.usedJSHeapSize / 1048576) : undefined;
};

const say = (s: string): void => {
  out.textContent += s + '\n';
  out.scrollTop = out.scrollHeight;
};

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------- fixtures

function drawScan(w: number, h: number, n: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#d8d2c8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#1a1a1a';
  const size = Math.round(h / 46);
  ctx.font = `${size}px Georgia`;
  for (let line = 0; line < 40; line++) {
    ctx.fillText(`Page ${n} line ${line + 1} — synthetic scan for the memory probe.`, w * 0.06, h * 0.05 + line * size);
  }

  // Noise, so the JPEG does not compress away to nothing. A real scan is not flat.
  const band = ctx.getImageData(0, 0, w, Math.min(h, 240));
  let seed = 1103 + n;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < band.data.length; i += 4) {
    const d = (rnd() - 0.5) * 70;
    band.data[i] += d;
    band.data[i + 1] += d;
    band.data[i + 2] += d;
  }
  for (let y = 0; y < h; y += 240) ctx.putImageData(band, 0, y);
  return c;
}

const blobOf = (c: HTMLCanvasElement, q: number) =>
  new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', q));

/**
 * A scanned PDF of roughly `targetMb`.
 *
 * A handful of distinct JPEGs are generated and each page embeds one of them again, so
 * the byte count and the object graph are both real without paying to render a thousand
 * separate canvases on a phone.
 */
async function scanPdfOfSize(
  targetMb: number,
  onProgress: (p: string) => void,
  reportBase?: (sizes: number[]) => void
): Promise<Uint8Array> {
  const base: Uint8Array[] = [];
  for (let i = 0; i < 6; i++) {
    const blob = await blobOf(drawScan(1700, 2340, i + 1), 0.86);
    base.push(new Uint8Array(await blob.arrayBuffer()));
    await yieldToUi();
  }
  reportBase?.(base.map((b) => b.length));
  const per = base.reduce((n, b) => n + b.length, 0) / base.length;
  const pages = Math.max(1, Math.round((targetMb * 1048576) / per));
  onProgress(`${pages} pages of about ${(per / 1024).toFixed(0)} KB`);

  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const img = await doc.embedJpg(base[i % base.length]);
    const page = doc.addPage([595.28, 841.89]);
    page.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
    if (i % 25 === 0) {
      onProgress(`building page ${i + 1} of ${pages}`);
      await yieldToUi();
    }
  }
  return doc.save();
}

// ---------------------------------------------------------------- the work

/**
 * What a tool actually does to a file, bounded so the probe finishes on a phone: hold the
 * original bytes, parse the object graph, walk every image, decode and re-encode a few,
 * and write the document back out.
 *
 * That is the shape of the peak — original bytes plus parsed graph plus output, all held
 * at once — without paying to recompress a thousand images. The recompression sample is
 * capped because the peak is set by what is *held*, not by how many are processed.
 */
interface Observed {
  pagesSeen: number;
  imagesSeen: number;
  savedBytes: number;
  detail: string;
}

async function pipeline(
  bytes: Uint8Array,
  onProgress: (p: string) => void,
  stages: Record<string, number>
): Promise<Observed> {
  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    onProgress(name);
    const t = performance.now();
    const value = await fn();
    stages[name] = Math.round(performance.now() - t);
    return value;
  };

  const doc = await timed('parse', () => PDFDocument.load(bytes, { updateMetadata: false }));
  const pages = doc.getPageCount();
  const a = await timed('analyse', () => analyse(doc, bytes.length));

  const r = await timed('recompress sample', async () => {
    const sample = await PDFDocument.load(bytes, { updateMetadata: false });
    const sa = await analyse(sample, bytes.length);
    sa.recompressible.length = Math.min(sa.recompressible.length, 6);
    return compress(sample, bytes.length, sa, { preset: PRESETS[0], stripMetadata: true });
  });

  const saved = await timed('save', () => doc.save());
  return {
    pagesSeen: pages,
    imagesSeen: a.images.length,
    savedBytes: saved.length,
    detail: `${pages} pages, ${a.images.length} images, save produced ${mb(saved.length)}, sample pass ${mb(r.afterBytes)}`,
  };
}

/**
 * How long a rung may take before the tab counts as collapsed rather than slow.
 *
 * This is the number the ceiling is set from. A tab that finishes in five and a half
 * minutes has not passed — it has failed in the way that matters and stayed alive to
 * hide it, which is why "did it complete" is not the question.
 */
const COLLAPSE_MS = 30_000;

const DEFAULT_LADDER = [10, 25, 50, 75, 100, 150, 200, 300, 400, 600, 800];

// ?ladder=60,70,80,90 narrows the search once the rough shape is known, without
// re-measuring the rungs that already answered.
const LADDER = (() => {
  const raw = new URLSearchParams(location.search).get('ladder');
  if (!raw) return DEFAULT_LADDER;
  const parsed = raw.split(',').map((n) => Number(n.trim())).filter((n) => Number.isFinite(n) && n > 0);
  return parsed.length ? parsed : DEFAULT_LADDER;
})();

// ---------------------------------------------------------------- run

async function run(): Promise<void> {
  const m = memory();
  const state: State = {
    agent: navigator.userAgent,
    started: new Date().toISOString(),
    deviceMemoryGb: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
    heapLimitMb: m ? Math.round(m.jsHeapSizeLimit / 1048576) : undefined,
    cores: navigator.hardwareConcurrency,
    rungs: [],
  };
  save(state);

  say(`user agent   ${state.agent}`);
  say(`cores        ${state.cores ?? 'unknown'}`);
  say(`deviceMemory ${state.deviceMemoryGb ? state.deviceMemoryGb + ' GB' : 'not reported (Safari and Firefox do not)'}`);
  say(`heap limit   ${state.heapLimitMb ? state.heapLimitMb + ' MB' : 'not reported (Chrome only)'}`);
  say('');
  say('Each rung is recorded before it is attempted, so a crash still says where.');
  say('');

  for (const target of LADDER) {
    const rung: Rung = { mb: target, phase: 'generating', outcome: 'started' };
    state.rungs.push(rung);
    save(state);
    status.textContent = `${target} MB — generating`;
    say(`── ${target} MB`);

    const t0 = performance.now();
    try {
      let bytes = await scanPdfOfSize(
        target,
        (p) => {
          rung.phase = `generating: ${p}`;
          status.textContent = `${target} MB — ${p}`;
        },
        (sizes) => { state.baseImageBytes = sizes; }
      );
      rung.genMs = Math.round(performance.now() - t0);
      rung.builtBytes = bytes.length;
      rung.phase = 'pipeline';
      save(state);
      say(`   built ${mb(bytes.length)} in ${(rung.genMs / 1000).toFixed(1)}s (fixture, not part of the answer)`);

      const stages: Record<string, number> = {};
      const t1 = performance.now();
      const seen = await pipeline(
        bytes,
        (p) => {
          rung.phase = p;
          status.textContent = `${target} MB — ${p}`;
          save(state);
        },
        stages
      );
      rung.pipeMs = Math.round(performance.now() - t1);
      rung.stages = stages;
      rung.pagesSeen = seen.pagesSeen;
      rung.imagesSeen = seen.imagesSeen;
      rung.savedBytes = seen.savedBytes;
      const detail = seen.detail;

      // Release before the next rung, so rungs do not accumulate on top of each other.
      bytes = new Uint8Array(0);

      rung.outcome = 'survived';
      rung.detail = detail;
      rung.heapMb = heapMb();
      save(state);
      say(`   SURVIVED  ${detail}`);
      const breakdown = Object.entries(stages).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}s`).join(', ');
      say(`   work took ${(rung.pipeMs / 1000).toFixed(1)}s — ${breakdown}`);
      if (rung.heapMb && rung.builtBytes) {
        say(`   heap now ${rung.heapMb} MB — ${(rung.heapMb / (rung.builtBytes / 1048576)).toFixed(1)}x the file`);
      }
    } catch (err) {
      rung.outcome = 'threw';
      rung.detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      rung.pipeMs = Math.round(performance.now() - t0);
      save(state);
      say(`   FAILED during "${rung.phase}" — ${rung.detail}`);
      say('');
      say(`This tab refused ${target} MB by throwing rather than dying.`);
      state.finished = true;
      save(state);
      status.textContent = `done — failed at ${target} MB`;
      report(state);
      return;
    }
    await yieldToUi();
  }

  state.finished = true;
  save(state);
  status.textContent = 'done — survived every rung';
  say('');
  say(`Survived every rung, up to ${LADDER[LADDER.length - 1]} MB.`);
  report(state);
}

/**
 * The summary block.
 *
 * The first version of this reported only what completed and what died, which is the
 * question this whole exercise established was the wrong one — a rung that took five and
 * a half minutes was reported as a pass. Every line here now carries its time, and the
 * headline number is the last rung that was actually usable.
 */
function report(s: State): void {
  const done = s.rungs.filter((r) => r.outcome === 'survived');
  const usable = done.filter((r) => (r.pipeMs ?? 0) <= COLLAPSE_MS);
  const collapsed = done.find((r) => (r.pipeMs ?? 0) > COLLAPSE_MS);
  const failed = s.rungs.find((r) => r.outcome !== 'survived');
  const verdict = validate(s);

  say('');
  say('════ RESULT ════');
  if (s.baseImageBytes?.length) {
    say(`  source images: ${s.baseImageBytes.map((b) => (b / 1024).toFixed(0) + ' KB').join(', ')}`);
    say('');
  }
  for (const r of done) {
    const secs = ((r.pipeMs ?? 0) / 1000).toFixed(1);
    const built = r.builtBytes ? `${(r.builtBytes / 1048576).toFixed(1)} MB` : '?';
    const out = r.savedBytes != null ? `${(r.savedBytes / 1048576).toFixed(1)} MB` : '?';
    say(`  ${String(r.mb).padStart(4)} MB asked  built ${built.padStart(9)}  work ${secs.padStart(7)}s` +
        `  heap ${String(r.heapMb ?? '?').padStart(5)} MB  ${(r.pipeMs ?? 0) > COLLAPSE_MS ? 'COLLAPSED' : 'usable'}`);
    say(`          pipeline saw ${r.pagesSeen ?? '?'} pages, ${r.imagesSeen ?? '?'} images, wrote ${out} back out`);
  }
  if (failed) {
    say(`  ${String(failed.mb).padStart(4)} MB asked  ${failed.outcome === 'threw' ? 'refused' : 'KILLED'} during "${failed.phase}"`);
  }
  say('');

  if (!verdict.ok) {
    // The same rule the footer readout follows: when the instrument cannot stand behind a
    // number, it does not print one. A wrong figure that looks right is worse than none.
    say('RUN INVALID — no ceiling can be read from this.');
    say('');
    for (const p of verdict.problems) say(`  · ${p}`);
    say('');
    say('Send this whole block anyway. What broke is more useful than the number would have been.');
    return;
  }

  say(`largest usable size (work under ${COLLAPSE_MS / 1000}s) : ${usable.length ? Math.max(...usable.map((r) => r.mb)) + ' MB' : 'none'}`);
  say(`first size that collapsed but stayed alive  : ${collapsed ? `${collapsed.mb} MB, ${(collapsed.pipeMs! / 1000).toFixed(0)}s` : 'none in this ladder'}`);
  say(`first size that failed outright             : ${failed ? `${failed.mb} MB during "${failed.phase}"` : 'none in this ladder'}`);
  say('');
  say('Copy everything above. The first of those three is the one that sets the ceiling.');
}

// ---------------------------------------------------------------- entry

const prior = load();
const unfinished = prior?.rungs.find((r) => r.outcome === 'started');

if (prior && unfinished && !prior.finished) {
  status.textContent = `previous run died at ${unfinished.mb} MB`;
  say('A previous run did not come back — the tab was killed. That is the measurement.');
  say('');
  say(`user agent   ${prior.agent}`);
  say(`cores        ${prior.cores ?? 'unknown'}`);
  say(`deviceMemory ${prior.deviceMemoryGb ? prior.deviceMemoryGb + ' GB' : 'not reported'}`);
  say(`heap limit   ${prior.heapLimitMb ? prior.heapLimitMb + ' MB' : 'not reported'}`);
  say('');
  for (const r of prior.rungs) {
    say(
      r.outcome === 'survived'
        ? `  ${String(r.mb).padStart(4)} MB  survived in ${((r.pipeMs ?? 0) / 1000).toFixed(1)}s  ${r.detail ?? ''}`
        : `  ${String(r.mb).padStart(4)} MB  KILLED during "${r.phase}" — the tab never returned`
    );
  }
  report({ ...prior, finished: true });
  say(`the tab was killed at       : ${unfinished.mb} MB, during "${unfinished.phase}"`);
  say('');
  say('Start runs it again from scratch.');
} else {
  status.textContent = 'ready';
  say('Press Start.');
  say('');
  say('Expect the tab to go unresponsive, and expect it to be killed outright — that is');
  say('what is being measured. Every result is written down before it is attempted, so a');
  say('crash loses nothing: reopen this page afterwards and it will say where it died.');
  say('');
  say('Nothing is read from your files. Every fixture is generated in this page.');
}

document.getElementById('probe-start')!.addEventListener('click', () => {
  out.textContent = '';
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  void run();
});

document.getElementById('probe-clear')!.addEventListener('click', () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  out.textContent = 'cleared\n';
  status.textContent = 'ready';
});
