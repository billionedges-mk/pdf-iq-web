// Is "copying pages is fast; rebuilding bookmarks is the slow part" true?
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readOutline, writeOutline, shiftOutline, type OutlineNode } from '../lib/outline.js';

const out = document.getElementById('out')!;
const log = (s: string) => { out.textContent += s + '\n'; };

async function makeDoc(pages: number, label: string, bookmarks: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([595.28, 841.89]);
    for (let l = 0; l < 30; l++) {
      p.drawText(`${label} page ${i + 1} line ${l + 1} — some body text to give the page real content.`,
        { x: 56, y: 780 - l * 24, size: 10, font });
    }
  }
  const tree: OutlineNode[] = [];
  for (let b = 0; b < bookmarks; b++) {
    tree.push({
      title: `${label} section ${b + 1}`,
      pageIndex: Math.min(pages - 1, Math.floor((b * pages) / bookmarks)),
      children: [{ title: `${label} sub ${b + 1}`, pageIndex: Math.min(pages - 1, Math.floor((b * pages) / bookmarks)), children: [] }],
    });
  }
  writeOutline(doc, tree);
  return doc.save();
}

async function main() {
  for (const [files, pagesEach, bookmarksEach] of [[3, 20, 8], [5, 60, 25]] as const) {
    log(`--- ${files} files x ${pagesEach} pages, ${bookmarksEach} bookmarks each ---`);
    const sources: Uint8Array[] = [];
    for (let i = 0; i < files; i++) sources.push(await makeDoc(pagesEach, `Doc${i + 1}`, bookmarksEach));
    log(`  fixtures: ${(sources.reduce((n, s) => n + s.length, 0) / 1048576).toFixed(2)} MB total`);

    const out = await PDFDocument.create();
    const groups: OutlineNode[] = [];
    let at = 0;
    let readMs = 0, copyMs = 0;

    for (const bytes of sources) {
      const t0 = performance.now();
      const src = await PDFDocument.load(bytes, { updateMetadata: false });
      const tree = readOutline(src);
      readMs += performance.now() - t0;

      const t1 = performance.now();
      const copied = await out.copyPages(src, src.getPages().map((_, i) => i));
      for (const p of copied) out.addPage(p);
      copyMs += performance.now() - t1;

      groups.push({ title: 'file', pageIndex: at, children: shiftOutline(tree, at) });
      at += pagesEach;
    }

    const t2 = performance.now();
    const written = writeOutline(out, groups);
    const outlineMs = performance.now() - t2;

    const t3 = performance.now();
    const saved = await out.save({ useObjectStreams: true });
    const saveMs = performance.now() - t3;

    const total = readMs + copyMs + outlineMs + saveMs;
    const pct = (ms: number) => `${((ms / total) * 100).toFixed(1)}%`;
    log(`  parse + read outlines : ${readMs.toFixed(0).padStart(6)} ms  ${pct(readMs)}`);
    log(`  copyPages             : ${copyMs.toFixed(0).padStart(6)} ms  ${pct(copyMs)}`);
    log(`  writeOutline (${String(written).padStart(3)} nodes): ${outlineMs.toFixed(0).padStart(6)} ms  ${pct(outlineMs)}`);
    log(`  save                  : ${saveMs.toFixed(0).padStart(6)} ms  ${pct(saveMs)}`);
    log(`  total ${total.toFixed(0)} ms for ${at} pages -> ${(saved.length / 1048576).toFixed(2)} MB`);
    log('');
  }
  log('DONE');
  (window as unknown as { probeDone: boolean }).probeDone = true;
}
void main().catch((e) => log('THREW: ' + (e instanceof Error ? e.stack : String(e))));
