/**
 * The test that has to catch every way this element has been wrong.
 *
 * The readout is the site's central claim made checkable, and it has been wrong three
 * times on its own page. A unit test over the counting function would have caught none
 * of them: every failure was an integration failure — which elements got updated, when
 * the browser delivered an entry, when the browser chose to fetch a favicon. So this
 * loads each real page in a same-origin iframe, lets it settle, and inspects the readout
 * the way a visitor would.
 *
 * The three regressions it locks down:
 *
 *   1. Only one readout updated. Asserted by checking *every* [data-netreadout-text] on
 *      the page, not the first.
 *   2. Preloaded fonts counted as post-load traffic. Asserted by a clean page reading
 *      clean after a real load with real fonts.
 *   3. The lazily-fetched favicon counted. Same assertion, with a settle window long
 *      enough for the favicon to arrive — it landed at 165ms in production.
 *
 * And the case none of those covered, which is the one that matters most: a readout that
 * always reads zero is indistinguishable from a decorative one. The last two cases prove
 * it can be non-zero, by making a real cross-origin request and by sending a real request
 * body, and asserting it notices both. Without those, this file would pass on a readout
 * that had been replaced with the literal string "0 bytes sent".
 */

type Log = (line: string) => void;
let emit: Log = () => {};
function ok(cond: boolean, message: string): void {
  emit(`  ${cond ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!cond) throw new Error(message);
}
const note = (line: string) => emit(`      ${line}`);

const ROUTES = ['/', '/compress/', '/merge/', '/split/', '/images-to-pdf/', '/rotate/', '/reorder/', '/ocr/', '/app/', '/privacy/', '/terms/', '/support/'];

interface Loaded {
  win: Window & { pdfiqNet?: Window['pdfiqNet'] };
  doc: Document;
  frame: HTMLIFrameElement;
}

/** Load a route in an iframe and wait for load plus a settle window. */
function load(route: string, settleMs: number): Promise<Loaded> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width:900px;height:600px;position:absolute;left:-10000px;top:0;';
    frame.src = route;
    frame.addEventListener('load', () => {
      // The favicon and other lazy fetches land after the load event; that is the whole
      // point of the settle window.
      setTimeout(() => {
        const win = frame.contentWindow as Loaded['win'] | null;
        const doc = frame.contentDocument;
        if (!win || !doc) return reject(new Error(`${route}: no contentWindow`));
        resolve({ win, doc, frame });
      }, settleMs);
    });
    frame.addEventListener('error', () => reject(new Error(`${route}: iframe error`)));
    document.body.appendChild(frame);
  });
}

const readouts = (doc: Document) =>
  Array.from(doc.querySelectorAll<HTMLElement>('[data-netreadout-text]')).map((e) => e.textContent ?? '');

const CLEAN = /^0 bytes sent · 0 third-party requests$/;

async function main(): Promise<void> {
  const out = document.getElementById('out')!;
  const write = (s: string) => { out.textContent += s + '\n'; };
  emit = write;

  write(`readout self-test — ${navigator.userAgent}`);
  write('');
  let failed = 0;

  // ---- 1. every route reads clean, on every readout element -----------------
  write('• Every page reads clean, on every readout it carries');
  for (const route of ROUTES) {
    try {
      const { win, doc, frame } = await load(route, 900);
      const texts = readouts(doc);
      const net = win.pdfiqNet;
      ok(texts.length > 0, `${route}: has at least one readout`);
      // The primary assertion is on the rendered text, not the internal API: what the
      // visitor reads is the claim, and asserting on internals would let a rewrite pass
      // the test while showing something else on screen.
      note(`${route} → ${texts.length} readout${texts.length === 1 ? '' : 's'}: ${JSON.stringify(texts[0])}` +
        (net ? ` (${net.seen?.().length ?? '?'} files loaded)` : ' (no instrumentation API)'));
      // Every element, not the first — regression 1.
      for (const [i, t] of texts.entries()) {
        ok(CLEAN.test(t), `${route}: readout ${i + 1} reads clean ("${t}")`);
      }
      if (net?.clean) ok(net.clean(), `${route}: internal state agrees with the text`);
      frame.remove();
    } catch (err) {
      failed++;
      write(`  FAIL  ${route}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  write('');

  // ---- 2. the homepage specifically carries two, and both are live ----------
  write('• The homepage carries two readouts and both are wired to the same state');
  try {
    const { win, doc, frame } = await load('/', 900);
    const texts = readouts(doc);
    note(`found ${texts.length}: ${JSON.stringify(texts)}`);
    ok(texts.length === 2, 'the homepage has exactly two readouts');
    ok(texts[0] === texts[1], 'both show the same value');
    // Prove they are driven, not hardcoded: change the state and re-render.
    const before = texts[0];
    await win.fetch('https://example.invalid/should-be-blocked').catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
    const after = readouts(doc);
    note(`after a cross-origin attempt: ${JSON.stringify(after)}`);
    ok(after[0] !== before, 'the first readout changed');
    ok(after[1] !== before, 'the second readout changed too — neither is hardcoded');
    ok(after[0] === after[1], 'both still agree');
    frame.remove();
  } catch (err) {
    failed++;
    write(`  FAIL  ${err instanceof Error ? err.message : String(err)}`);
  }
  write('');

  // ---- 3. it notices a third-party request ---------------------------------
  write('• A third-party request is noticed (a readout stuck at zero is decorative)');
  try {
    const { win, doc, frame } = await load('/compress/', 700);
    ok(win.pdfiqNet!.clean(), 'clean before');
    // Blocked by CSP in production; the patched fetch records the attempt either way,
    // which is the point — a blocked beacon still has to be visible.
    await win.fetch('https://cloudflareinsights.com/cdn-cgi/beacon/x').catch(() => {});
    await new Promise((r) => setTimeout(r, 250));
    const third = win.pdfiqNet!.thirdParty();
    note(`third-party recorded: ${JSON.stringify(third)}`);
    ok(third.length === 1, 'exactly one third-party request recorded');
    ok(!win.pdfiqNet!.clean(), 'no longer reports clean');
    ok(readouts(doc).every((t) => /1 third-party request$/.test(t)), 'the text says so');
    ok(doc.querySelector('[data-netreadout]')!.classList.contains('netreadout--dirty'),
      'the readout is marked dirty');
    frame.remove();
  } catch (err) {
    failed++;
    write(`  FAIL  ${err instanceof Error ? err.message : String(err)}`);
  }
  write('');

  // ---- 4. it notices bytes leaving ------------------------------------------
  write('• A request body is measured (this is the claim itself)');
  try {
    const { win, doc, frame } = await load('/compress/', 700);
    ok(win.pdfiqNet!.bytesSent() === 0, '0 bytes before');
    const payload = new Uint8Array(4096);
    // Same-origin on purpose: this must be caught because of the body, not the origin.
    await win.fetch('/', { method: 'POST', body: payload }).catch(() => {});
    await new Promise((r) => setTimeout(r, 250));
    const sent = win.pdfiqNet!.bytesSent();
    note(`bytes recorded: ${sent}`);
    ok(sent === 4096, 'the exact body size was measured');
    ok(readouts(doc).every((t) => /^4\.0 KB sent/.test(t)), 'the text leads with what was sent');
    ok(!win.pdfiqNet!.clean(), 'no longer reports clean');
    frame.remove();
  } catch (err) {
    failed++;
    write(`  FAIL  ${err instanceof Error ? err.message : String(err)}`);
  }
  write('');

  // ---- 5. a stale bundle is detected and refuses to show a figure ----------
  write('• A cached bundle from an older deploy is caught, not trusted');
  try {
    const { win, doc, frame } = await load('/compress/', 700);
    const api = (win as unknown as { pdfiqNet: { build: () => { running: string; expected: string; stale: boolean } } }).pdfiqNet;
    const build = api.build();
    note(`running ${build.running}, page expects ${build.expected}`);
    ok(build.running === build.expected, 'a fresh load agrees with itself');
    ok(!build.stale, 'not reported stale');
    ok(CLEAN.test(readouts(doc)[0]), 'shows a figure while it agrees');

    // Rewrite the document's stamp to simulate HTML from a different deploy, which is
    // exactly the shape of the real failure: new markup, cached script.
    const meta = doc.querySelector('meta[name="pdfiq-build"]') as HTMLMetaElement;
    meta.content = 'deadbeefcafe';
    await win.fetch('/favicon.svg').catch(() => {});
    await new Promise((r) => setTimeout(r, 250));
    const after = readouts(doc);
    note(`after the stamp changed: ${JSON.stringify(after[0])}`);
    ok(after.every((t) => /running an old copy/.test(t)), 'every readout says to reload');
    ok(!CLEAN.test(after[0]), 'it stops showing a figure it cannot stand behind');
    ok(api.build().stale, 'reported stale');
    frame.remove();
  } catch (err) {
    failed++;
    write(`  FAIL  ${err instanceof Error ? err.message : String(err)}`);
  }
  write('');

  write(failed === 0 ? 'READOUT VERIFIED' : `${failed} GROUP(S) FAILED`);
  document.title = failed === 0 ? 'readout: pass' : `readout: ${failed} failed`;
  (window as unknown as { selftestDone: boolean }).selftestDone = true;
  (window as unknown as { selftestFailed: number }).selftestFailed = failed;
}

void main().catch((e) => emit('THREW: ' + (e instanceof Error ? e.stack : String(e))));
