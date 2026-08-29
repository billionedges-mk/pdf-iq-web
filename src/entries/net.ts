/**
 * The footer readout.
 *
 * This is instrumentation, not decoration, and it reports the two numbers that actually
 * carry the site's claim:
 *
 *   bytes sent          — the total size of every request body this page has handed to
 *                         fetch, XMLHttpRequest, sendBeacon or a WebSocket. A PDF leaving
 *                         this device would have to travel as a request body, so this is
 *                         the claim itself, measured at the only place it can be measured.
 *   third-party requests — anything fetched from an origin that is not this one, at any
 *                         point in the page's life.
 *
 * ---------------------------------------------------------------------------------
 * WHY IT NO LONGER COUNTS "REQUESTS SINCE LOAD"
 *
 * It used to, and that metric was wrong three separate times on its own page:
 *
 *   1. It updated one element found by id, so the redesigned homepage's second readout
 *      sat there rendering a hardcoded zero beside a live one.
 *   2. It gated counting on a flag set in the load handler. PerformanceObserver delivers
 *      asynchronously, so preloaded fonts starting at 9ms were handed to the callback
 *      after a loadEventEnd of 21ms and counted as post-load traffic.
 *   3. Fixing that to compare startTime against loadEventEnd was still wrong: browsers
 *      fetch the favicon lazily, genuinely after load, so a correct implementation of the
 *      rule still read "1 request" on a page that had done nothing.
 *
 * Each fix was right about the bug and wrong about the metric. "Requests since the load
 * event" is a proxy for nothing anyone cares about, and its boundary has an open-ended
 * supply of edge cases — lazy favicons, speculative connections, extensions, prefetch.
 *
 * The decisive argument is what it would have missed. Cloudflare Pages injected a Web
 * Analytics beacon into the document on the custom domain. That loads *during* page load,
 * so `startTime <= loadEventEnd` and the old rule skipped it. The readout would have
 * reported zero while a third-party script was on the page. The CSP caught it; this did
 * not. A counter that reads zero through the exact event it exists to detect is worse
 * than no counter.
 *
 * Counting third-party requests has no timing boundary, so it has no boundary bugs, and
 * it catches that beacon by construction.
 */

/** Stamped in at build time; compared against the document's own stamp. */
declare const __PDFIQ_BUILD__: string;

interface Sent {
  bytes: number;
  where: string;
}

const state = {
  sentBytes: 0,
  sends: [] as Sent[],
  /** Third-party origins seen, in order, deduplicated by full URL. */
  thirdParty: [] as string[],
  /** Every resource the page fetched, for the hover detail only. */
  seen: [] as string[],
};

const origin = location.origin;

function isThirdParty(url: string): boolean {
  try {
    const u = new URL(url, location.href);
    // data: and blob: never leave the tab. about:blank and similar are not fetches.
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return false;
    return u.origin !== origin;
  } catch {
    return false;
  }
}

function noteThirdParty(url: string): void {
  if (!state.thirdParty.includes(url)) {
    state.thirdParty.push(url);
    render();
  }
}

/** Best-effort byte length of anything that can be a request body. */
function bodyBytes(body: unknown): number {
  if (body == null) return 0;
  if (typeof body === 'string') return new TextEncoder().encode(body).length;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return new TextEncoder().encode(body.toString()).length;
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    let n = 0;
    body.forEach((v, k) => {
      n += new TextEncoder().encode(k).length;
      n += v instanceof Blob ? v.size : new TextEncoder().encode(String(v)).length;
    });
    return n;
  }
  // A ReadableStream body cannot be measured without consuming it. Record it as
  // present-but-unmeasured rather than pretending it was empty.
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return -1;
  return 0;
}

function recordSend(url: string, body: unknown, via: string): void {
  const n = bodyBytes(body);
  if (n === 0) return;
  state.sentBytes += n > 0 ? n : 0;
  state.sends.push({ bytes: n, where: `${via} ${url}` });
  render();
}

// ---- patch every path a request body can take out of this tab ----------------
//
// These also catch a cross-origin attempt that the CSP blocks, which never produces a
// resource timing entry — so a blocked beacon is still visible here.

const nativeFetch = window.fetch;
window.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const body = init?.body ?? (input instanceof Request ? input.body : null);
  if (body) recordSend(url, body, 'fetch');
  if (isThirdParty(url)) noteThirdParty(url);
  return nativeFetch.call(this, input as RequestInfo, init);
};

const nativeOpen = XMLHttpRequest.prototype.open;
const nativeSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: unknown[]) {
  (this as XMLHttpRequest & { __url?: string }).__url = String(url);
  if (isThirdParty(String(url))) noteThirdParty(String(url));
  // @ts-expect-error - forwarding the browser's own variadic signature
  return nativeOpen.call(this, method, url, ...rest);
};
XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
  const url = (this as XMLHttpRequest & { __url?: string }).__url ?? '';
  if (body) recordSend(url, body, 'xhr');
  return nativeSend.call(this, body);
};

if (navigator.sendBeacon) {
  const nativeBeacon = navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = function (url: string | URL, data?: BodyInit | null) {
    recordSend(String(url), data, 'beacon');
    if (isThirdParty(String(url))) noteThirdParty(String(url));
    return nativeBeacon(url, data);
  };
}

const NativeWebSocket = window.WebSocket;
if (NativeWebSocket) {
  class WatchedWebSocket extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      if (isThirdParty(String(url))) noteThirdParty(String(url));
      render();
    }
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      recordSend(this.url, data, 'websocket');
      super.send(data as string);
    }
  }
  window.WebSocket = WatchedWebSocket as unknown as typeof WebSocket;
}

// ---- watch every resource, whenever it happens ------------------------------

function watchResources(): void {
  if (typeof PerformanceObserver === 'undefined') return;
  const obs = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const e = entry as PerformanceResourceTiming;
      state.seen.push(e.name);
      if (isThirdParty(e.name)) noteThirdParty(e.name);
    }
    render();
  });
  try {
    // buffered:true so resources fetched before this script ran are included. A script
    // injected into the document head loads early; missing it is exactly the failure
    // this readout exists to prevent.
    obs.observe({ type: 'resource', buffered: true });
  } catch {
    /* older browsers: the send-side instrumentation above still holds */
  }
}

// ---- render -----------------------------------------------------------------

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function formatBytes(n: number): string {
  if (n === 0) return '0 bytes';
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/**
 * Is this bundle the one this page was built with?
 *
 * They can disagree. Cloudflare Pages keeps assets from earlier deployments reachable, so
 * a browser holding stale HTML fetches the old asset path, is handed pre-fix code marked
 * `immutable`, and runs it — reporting a number the current build cannot produce, with
 * nothing on the wire to explain it. Content-hashed filenames stop that happening again,
 * but only once a visitor has received new HTML at least once.
 *
 * No local test can see this: it is a property of what a particular browser is holding.
 * The page is the only thing positioned to notice, so it checks, and says so rather than
 * showing a figure it cannot stand behind.
 */
function staleBundle(): { running: string; expected: string } | null {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="pdfiq-build"]');
  const expected = meta?.content ?? '';
  const running = typeof __PDFIQ_BUILD__ === 'string' ? __PDFIQ_BUILD__ : '';
  if (!expected || !running || expected === running) return null;
  return { running, expected };
}

function render(): void {
  // Every readout on the page, not one by id. The homepage carries two.
  const wraps = Array.from(document.querySelectorAll<HTMLElement>('[data-netreadout]'));
  if (!wraps.length) return;

  const stale = staleBundle();
  if (stale) {
    for (const wrap of wraps) {
      const el = wrap.querySelector<HTMLElement>('[data-netreadout-text]');
      if (el) el.textContent = 'reload this page — it is running an old copy';
      wrap.classList.add('netreadout--dirty');
      wrap.setAttribute('title',
        `This page was built as ${stale.expected} but the script running is ${stale.running}. ` +
        'Your browser is holding a cached copy from an earlier deploy, so any figure here ' +
        'would describe code you are not running. Reload to get the current one.');
    }
    return;
  }

  const sent = state.sentBytes;
  const third = state.thirdParty.length;
  const text = `${formatBytes(sent)} sent · ${plural(third, 'third-party request', 'third-party requests')}`;
  const bad = sent > 0 || third > 0;

  const detail: string[] = [];
  detail.push(bad
    ? 'Something left this page. That is a bug — please report it.'
    : 'Nothing has been sent, and nothing has been fetched from anyone but this site.');
  if (sent > 0) detail.push(`Request bodies: ${state.sends.map((s) => s.where).join(', ')}`);
  if (third > 0) detail.push(`Third-party: ${state.thirdParty.join(', ')}`);
  detail.push(`${state.seen.length} files loaded from this site.`);

  for (const wrap of wraps) {
    const el = wrap.querySelector<HTMLElement>('[data-netreadout-text]');
    if (el) el.textContent = text;
    wrap.classList.toggle('netreadout--dirty', bad);
    wrap.setAttribute('title', detail.join('\n'));
  }
}

watchResources();
render();
if (document.readyState !== 'complete') window.addEventListener('load', render, { once: true });

// Read by the readout self-test, and by anyone who wants to check from the console.
declare global {
  interface Window {
    pdfiqNet: {
      build: () => { running: string; expected: string; stale: boolean };
      bytesSent: () => number;
      thirdParty: () => string[];
      seen: () => string[];
      /** True when the page has done nothing it should not have. */
      clean: () => boolean;
    };
  }
}
window.pdfiqNet = {
  build: () => ({
    running: typeof __PDFIQ_BUILD__ === 'string' ? __PDFIQ_BUILD__ : 'unknown',
    expected: document.querySelector<HTMLMetaElement>('meta[name="pdfiq-build"]')?.content ?? 'unknown',
    stale: staleBundle() !== null,
  }),
  bytesSent: () => state.sentBytes,
  thirdParty: () => state.thirdParty.slice(),
  seen: () => state.seen.slice(),
  clean: () => staleBundle() === null && state.sentBytes === 0 && state.thirdParty.length === 0,
};

export {};
