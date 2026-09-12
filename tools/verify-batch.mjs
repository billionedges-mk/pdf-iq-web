/**
 * Batch, against docs/batch.md.
 *
 * The per-file work needs a browser; everything else does not, and everything else is where the
 * app's batch went wrong: a "nothing to do" outcome reported as a failure, a summary that did not
 * match the folder, a cancel that lost what had finished. src/pro/batch.ts takes the work as a
 * dependency so those can be driven here, with scripted files that succeed, fail, decline and
 * hang until cancelled.
 *
 * Every archive this builds is opened by python's zipfile — a reader that did not write it — and
 * its entries are compared with what the run claims. "It produced bytes" is not evidence.
 *
 *   npm run verify:batch        requires python (zipfile is in the standard library)
 */
import * as esbuild from 'esbuild';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = join(tmpdir(), 'pdfiq-verify-batch');
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) fails++;
};

await esbuild.build({
  entryPoints: [join(ROOT, 'src/pro/batch.ts')],
  bundle: true, platform: 'node', format: 'esm', logLevel: 'warning',
  outfile: join(WORK, 'batch.mjs'),
});
const batch = await import(pathToFileURL(join(WORK, 'batch.mjs')).href);

/** What python's zipfile makes of an archive: names, sizes, and whether it opens at all. */
const READ_ZIP = [
  'import sys, json, zipfile',
  'path = sys.argv[1]',
  'out = {}',
  'try:',
  '    z = zipfile.ZipFile(path)',
  '    bad = z.testzip()',
  '    out["opens"] = True',
  '    out["corrupt"] = bad',
  '    out["names"] = z.namelist()',
  '    out["sizes"] = [i.file_size for i in z.infolist()]',
  '    out["texts"] = {n: z.read(n)[:40].decode("utf-8", "replace") for n in z.namelist()}',
  'except Exception as e:',
  '    out["opens"] = False',
  '    out["error"] = str(e)',
  'print(json.dumps(out))',
].join('\n');

let zipCount = 0;
const readZip = (bytes) => {
  const path = join(WORK, `run-${zipCount++}.zip`);
  writeFileSync(path, bytes);
  return JSON.parse(execFileSync('python', ['-c', READ_ZIP, path], { encoding: 'utf8' }));
};

const file = (name, body = 'x') => new File([body], name, { type: 'application/pdf' });
const bytesOf = (s) => new TextEncoder().encode(s);

/** A scripted worker: each file name maps to what its work does. */
const deps = (script, now = () => new Date(2026, 8, 12, 14, 30, 5)) => ({
  now,
  describeError: (err) => (err instanceof Error ? err.message : String(err)),
  apply: async (op, f, onPage, signal) => {
    const what = script[f.name] ?? { produce: 'body of ' + f.name };
    if (what.pages) for (let i = 1; i <= what.pages; i++) onPage(i, what.pages);
    if (what.fail) throw new Error(what.fail);
    if (what.leftAlone) return { leftAlone: what.leftAlone };
    if (what.cancelHere) { what.cancelHere(); throw new DOMException('cancelled', 'AbortError'); }
    return { bytes: bytesOf(what.produce) };
  },
});

// ---------------------------------------------------------------- a run where everything works
console.log('\n— three files, all of them fine');
{
  const files = [file('quarterly review.pdf'), file('scan.pdf'), file('notes.pdf')];
  const report = await batch.runBatch(files, 'compress', deps({}), new AbortController().signal);
  ok(report.results.every((r) => r.outcome.kind === 'done'), 'every file is done');
  ok(report.reconciles, 'the archive agrees with the summary');
  ok(report.zipName === 'pdfiq-batch-2026-09-12-14-30-05.zip', `one archive per run, named by when it ran (${report.zipName})`);

  const z = readZip(report.zip);
  ok(z.opens && !z.corrupt, `python opens the archive and finds no corrupt entry${z.error ? ` — ${z.error}` : ''}`);
  ok(JSON.stringify(z.names) === JSON.stringify(['quarterly review.pdf', 'scan.pdf', 'notes.pdf']),
    `the entries keep the names the files had: ${z.names.join(', ')}`);
  ok(z.texts['scan.pdf'] === 'body of scan.pdf', 'and the bytes in the archive are the bytes the work produced');

  const said = batch.describeRun(report);
  ok(said.head === '3 of 3 files done.', `the summary counts what happened: "${said.head}"`);
}

// ---------------------------------------------------------------- one file fails
console.log('\n— one file fails among files that do not');
{
  const files = [file('good-1.pdf'), file('broken.pdf'), file('good-2.pdf')];
  const report = await batch.runBatch(files, 'compress', deps({ 'broken.pdf': { fail: 'this file is not a readable PDF' } }), new AbortController().signal);
  ok(report.results.length === 3 && report.results[2].outcome.kind === 'done', 'the run carries on past it');
  const failed = report.results.find((r) => r.outcome.kind === 'failed');
  ok(failed?.source === 'broken.pdf' && failed.outcome.reason === 'this file is not a readable PDF',
    'the failure is named, with the reason');
  const z = readZip(report.zip);
  ok(!z.names.includes('broken.pdf'), 'and it puts nothing in the archive');
  ok(z.names.length === 2 && z.sizes.every((s) => s > 0), 'no zero-byte entry stands in for it');
  ok(report.reconciles, 'the summary still agrees with the archive');
  ok(batch.describeRun(report).detail.includes('1 failed'), 'and the summary says one failed');
}

// ---------------------------------------------------------------- nothing to do is not a failure
console.log('\n— a file with nothing to gain');
{
  const files = [file('already small.pdf'), file('big.pdf')];
  const report = await batch.runBatch(files, 'compress', deps({ 'already small.pdf': { leftAlone: 'its images are already small enough' } }), new AbortController().signal);
  const left = report.results[0].outcome;
  ok(left.kind === 'left-alone' && left.why.includes('already small enough'), 'it is left alone, not failed');
  const z = readZip(report.zip);
  ok(z.names.length === 1 && z.names[0] === 'big.pdf', 'it is not in the archive, and nothing else is missing');
  const said = batch.describeRun(report);
  ok(said.detail.includes('left alone') && !said.detail.includes('failed'), `and the summary does not call it a failure: "${said.detail}"`);
}

// ---------------------------------------------------------------- cancel
console.log('\n— stopped halfway');
{
  const controller = new AbortController();
  const files = [file('a.pdf'), file('b.pdf'), file('c.pdf'), file('d.pdf')];
  const script = { 'c.pdf': { cancelHere: () => controller.abort() } };
  const report = await batch.runBatch(files, 'compress', deps(script), controller.signal);
  ok(report.cancelled, 'the run knows it was stopped');
  const kinds = report.results.map((r) => r.outcome.kind);
  ok(kinds[0] === 'done' && kinds[1] === 'done', 'what finished before the stop is kept');
  ok(kinds[2] === 'interrupted', 'the file the stop landed in is "interrupted", not done and not simply missed');
  ok(kinds[3] === 'not-attempted', 'and what was never reached is named, not left unmentioned');
  const z = readZip(report.zip);
  ok(z.names.length === 2, 'the archive holds exactly what finished');
  ok(report.reconciles, 'and the summary agrees with it');
  ok(batch.describeRun(report).head.startsWith('Stopped. 2 files finished'), `the wording is "stopped", not "failed": "${batch.describeRun(report).head}"`);
}

// ---------------------------------------------------------------- names
console.log('\n— names');
{
  const files = [file('report.pdf'), file('report.pdf'), file('report.pdf')];
  const report = await batch.runBatch(files, 'compress', deps({}), new AbortController().signal);
  const z = readZip(report.zip);
  ok(JSON.stringify(z.names) === JSON.stringify(['report.pdf', 'report (2).pdf', 'report (3).pdf']),
    `three files of the same name become three entries: ${z.names.join(', ')}`);

  const text = await batch.runBatch([file('contract.pdf')], 'text', deps({}), new AbortController().signal);
  ok(readZip(text.zip).names[0] === 'contract.txt', 'reading the text changes the extension, because the type changed');

  // The property, not a string I guessed: no separators, no leading dot, nothing that could
  // place an entry outside the archive when it is unpacked. The first version asserted an
  // exact output and failed against safeName doing its job.
  const taken = new Set();
  const hostile = batch.allocateName('../../etc/passwd.pdf', null, taken);
  const sep = String.fromCharCode(92);
  ok(!hostile.includes('/') && !hostile.includes(sep) && !hostile.startsWith('.') && hostile.endsWith('.pdf'),
    'a name that tries to leave the archive is made safe: ' + hostile);
}

// ---------------------------------------------------------------- a stop mid-file
console.log('\n— stopped inside a file, where the work returns what it had');
{
  // The OCR pool does exactly this: stopped at page 10 of 30 it returns ten pages of text rather
  // than throwing. That was counted as a finished file, archive entry and all.
  const controller = new AbortController();
  const partial = {
    'long.pdf': {
      produce: 'ten pages of thirty',
      cancelDuring: () => controller.abort(),
    },
  };
  const deps2 = {
    now: () => new Date(2026, 8, 12, 14, 30, 5),
    describeError: (err) => String(err),
    apply: async (op, f) => {
      const what = partial[f.name];
      if (what?.cancelDuring) what.cancelDuring();
      return { bytes: new TextEncoder().encode(what ? what.produce : 'body') };
    },
  };
  const report = await batch.runBatch([file('short.pdf'), file('long.pdf'), file('never.pdf')], 'text', deps2, controller.signal);
  const kinds = report.results.map((r) => r.outcome.kind);
  ok(kinds[0] === 'done', 'the file that finished before the stop is kept');
  ok(kinds[1] === 'interrupted', 'the one the stop landed in is not counted as done');
  ok(kinds[2] === 'not-attempted', 'and the rest are named');
  const z = readZip(report.zip);
  ok(z.names.length === 1 && z.names[0] === 'short.txt', `its partial output is not in the archive: ${z.names.join(', ') || 'nothing'}`);
  ok(report.reconciles, 'and the summary agrees with the archive');
  ok(batch.describeRun(report).detail.includes('stopped partway'), `the summary says so: "${batch.describeRun(report).detail}"`);
}

// ---------------------------------------------------------------- the reconciliation itself
console.log('\n— the summary is reconciled against the archive');
{
  const files = [file('a.pdf'), file('b.pdf')];
  const report = await batch.runBatch(files, 'compress', deps({}), new AbortController().signal);
  ok(report.entries.length === 2, 'the entries are read back out of the built archive, not from the list');

  // What the screen does if they ever disagree.
  const doctored = { ...report, entries: ['a.pdf'], reconciles: false };
  const said = batch.describeRun(doctored);
  ok(said.head === 'This run cannot be handed over.', `a disagreement refuses the whole summary: "${said.head}"`);
  ok(said.detail.includes('archive holds 1') && said.detail.includes('recorded 2'), 'and states both numbers');
}

console.log(`\n${fails ? `${fails} FAILED` : 'batch behaves as docs/batch.md describes, every archive opened by python'}`);
process.exitCode = fails ? 1 : 0;
