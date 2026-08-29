/**
 * Two questions about OCR, answered by measurement rather than argument:
 *   1. Is the background-tab limit removable? pdf.js only uses requestAnimationFrame
 *      for display intent; print intent schedules itself. If that renders while hidden,
 *      the limit is a configuration choice, not a property of the problem.
 *   2. Is 7.3 s/page inherent, or is it one worker at 300 dpi? Pages are independent,
 *      so a pool should scale close to linearly until cores run out.
 */
import { PDFDocument } from 'pdf-lib';
import { createWorker } from 'tesseract.js';
import { openDocument, renderPage } from '../lib/pdfjs.js';

const out = document.getElementById('out')!;
const log = (s: string) => { out.textContent += s + '\n'; };

const LINES = [
  'INVOICE 2026-0417', 'Billion Edges Limited',
  'Twelve Hanover Square, London W1S 1JX',
  'Description Quantity Amount',
  'Professional services 14 1,240.00',
  'Document processing 62 310.50',
  'Total due on receipt 1,550.50',
  'Payment terms are thirty days from the date',
  'shown above. Late payment interest applies at',
  'eight per cent above base rate.',
];
const EXPECTED = LINES.join(' ').toLowerCase();

function drawPage(w: number, h: number, n: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#111';
  const size = Math.round(h / 46);
  ctx.font = `${size}px Georgia, serif`;
  ctx.textBaseline = 'top';
  LINES.forEach((l, i) => ctx.fillText(l, w * 0.09, h * 0.08 + i * size * 2.1));
  ctx.fillText(`Page ${n}`, w * 0.09, h * 0.86);
  return c;
}

async function buildPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const blob = await new Promise<Blob | null>((r) => drawPage(1700, 2400, i + 1).toBlob(r, 'image/jpeg', 0.9));
    const img = await doc.embedJpg(new Uint8Array(await blob!.arrayBuffer()));
    const p = doc.addPage([595.28, 841.89]);
    p.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }
  return doc.save();
}

const WORKER_OPTS = {
  workerPath: '/vendor/tesseract-worker.min.js',
  corePath: '/vendor/tesseract-core',
  langPath: '/vendor/tessdata',
  gzip: true,
} as const;

/** How much of the expected text came back. */
function accuracy(text: string): number {
  const got = text.toLowerCase();
  const words = EXPECTED.split(/\s+/).filter((w) => w.length > 2);
  const hit = words.filter((w) => got.includes(w)).length;
  return Math.round((hit / words.length) * 100);
}

async function main() {
  log(`cores reported by the browser: ${navigator.hardwareConcurrency}`);
  log(`document.hidden at start: ${document.hidden}`);
  log('');

  const bytes = await buildPdf(8);
  log(`fixture: 8-page scan, ${(bytes.length / 1048576).toFixed(2)} MB`);
  log('');

  // ---- Q1: does print intent render while hidden? -------------------------
  log('Q1 — render intent vs a hidden tab');
  const opened = await openDocument(bytes);
  for (const intent of ['display', 'print'] as const) {
    const page = await opened.doc.getPage(1);
    const viewport = page.getViewport({ scale: 300 / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const t0 = performance.now();
    let verdict: string;
    try {
      await Promise.race([
        page.render({ canvas, viewport, intent } as never).promise,
        new Promise((_, r) => setTimeout(() => r(new Error('did not settle in 12s')), 12000)),
      ]);
      const ctx = canvas.getContext('2d')!;
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 200) ink++;
      verdict = `settled in ${(performance.now() - t0).toFixed(0)}ms, ${ink.toLocaleString()} dark pixels`;
    } catch (e) {
      verdict = (e as Error).message;
    }
    log(`  intent=${intent.padEnd(8)} hidden=${document.hidden}  ${verdict}`);
    page.cleanup();
  }
  log('');

  // ---- Q2: dpi ------------------------------------------------------------
  log('Q2 — resolution: time and how much text comes back');
  const single = await createWorker('eng', 1, WORKER_OPTS);
  for (const dpi of [150, 200, 300]) {
    const page = await opened.doc.getPage(1);
    const canvas = document.createElement('canvas');
    const base = page.getViewport({ scale: 1 });
    const tRender = performance.now();
    await renderPage(page, base.width * (dpi / 72), canvas, false, 'print');
    const renderMs = performance.now() - tRender;
    const tOcr = performance.now();
    const { data } = await single.recognize(canvas, {}, { text: true, blocks: true });
    const ocrMs = performance.now() - tOcr;
    log(`  ${String(dpi).padStart(3)} dpi  ${canvas.width}x${canvas.height}  render ${renderMs.toFixed(0)}ms  ocr ${ocrMs.toFixed(0)}ms  total ${((renderMs + ocrMs) / 1000).toFixed(1)}s  conf ${Math.round(data.confidence)}%  text recovered ${accuracy(data.text ?? '')}%`);
    page.cleanup();
  }
  log('');

  // ---- Q3: worker pool ----------------------------------------------------
  log('Q3 — one worker vs a pool, 8 pages at 200 dpi');
  // Render all 8 first so the comparison is recognition only.
  const canvases: HTMLCanvasElement[] = [];
  for (let i = 1; i <= 8; i++) {
    const page = await opened.doc.getPage(i);
    const c = document.createElement('canvas');
    const base = page.getViewport({ scale: 1 });
    await renderPage(page, base.width * (200 / 72), c, false, 'print');
    canvases.push(c);
    page.cleanup();
  }
  log('  (8 pages rendered)');

  const t1 = performance.now();
  for (const c of canvases) await single.recognize(c, {}, { text: true });
  const serialMs = performance.now() - t1;
  log(`  1 worker : ${(serialMs / 1000).toFixed(1)}s  (${(serialMs / 8 / 1000).toFixed(1)}s a page)`);
  await single.terminate();

  for (const size of [2, 4]) {
    const pool = await Promise.all(
      Array.from({ length: size }, () => createWorker('eng', 1, WORKER_OPTS))
    );
    const queue = canvases.map((c, i) => ({ c, i }));
    const t2 = performance.now();
    await Promise.all(pool.map(async (w) => {
      for (;;) {
        const job = queue.shift();
        if (!job) return;
        await w.recognize(job.c, {}, { text: true });
      }
    }));
    const poolMs = performance.now() - t2;
    log(`  ${size} workers: ${(poolMs / 1000).toFixed(1)}s  (${(poolMs / 8 / 1000).toFixed(1)}s a page)  speedup ${(serialMs / poolMs).toFixed(2)}x`);
    await Promise.all(pool.map((w) => w.terminate()));
  }

  await opened.close();
  log('');
  log('DONE');
  (window as unknown as { probeDone: boolean }).probeDone = true;
}
void main().catch((e) => log('THREW: ' + (e instanceof Error ? e.stack : String(e))));
