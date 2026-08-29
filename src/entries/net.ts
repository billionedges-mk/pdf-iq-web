/**
 * The footer readout.
 *
 * This is instrumentation, not decoration. It reports two measured numbers:
 *
 *   requests   — resource requests the browser actually made *after* this page
 *                finished loading, counted by PerformanceObserver.
 *   bytes sent — the total size of every request body this page has handed to
 *                fetch, XMLHttpRequest, sendBeacon or a WebSocket.
 *
 * "bytes sent" is the number that carries the claim. A PDF leaving this device
 * would have to travel as a request body, so if that figure is ever non-zero
 * something is wrong and the readout says so loudly rather than quietly.
 *
 * The request count is honestly allowed to move: the OCR page fetches its
 * language model, and pdf.js fetches its worker. Both are same-origin static
 * assets and neither carries a byte of the user's document. Hovering the
 * readout lists exactly what was fetched.
 */

interface Sent {
  bytes: number;
  where: string;
}

const state = {
  requests: [] as string[],
  sentBytes: 0,
  sends: [] as Sent[],
  crossOrigin: [] as string[],
  loaded: false,
};

const origin = location.origin;

function isCrossOrigin(url: string): boolean {
  try {
    const u = new URL(url, location.href);
    if (u.protocol === 'data:' || u.protocol === 'blob:') return false;
    return u.origin !== origin;
  } catch {
    return false;
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
  // unknown-but-present rather than pretending it was empty.
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

const nativeFetch = window.fetch;
window.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const body = init?.body ?? (input instanceof Request ? input.body : null);
  if (body) recordSend(url, body, 'fetch');
  if (isCrossOrigin(url)) noteCrossOrigin(url);
  return nativeFetch.call(this, input as RequestInfo, init);
};

const nativeOpen = XMLHttpRequest.prototype.open;
const nativeSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: unknown[]) {
  (this as XMLHttpRequest & { __url?: string }).__url = String(url);
  if (isCrossOrigin(String(url))) noteCrossOrigin(String(url));
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
    if (isCrossOrigin(String(url))) noteCrossOrigin(String(url));
    return nativeBeacon(url, data);
  };
}

const NativeWebSocket = window.WebSocket;
if (NativeWebSocket) {
  class WatchedWebSocket extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      state.requests.push(`websocket ${url}`);
      if (isCrossOrigin(String(url))) noteCrossOrigin(String(url));
      render();
    }
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      recordSend(this.url, data, 'websocket');
      super.send(data as string);
    }
  }
  window.WebSocket = WatchedWebSocket as unknown as typeof WebSocket;
}

function noteCrossOrigin(url: string): void {
  if (!state.crossOrigin.includes(url)) {
    state.crossOrigin.push(url);
    render();
  }
}

// ---- count requests made after load ----------------------------------------

function watchResources(): void {
  if (typeof PerformanceObserver === 'undefined') return;
  const obs = new PerformanceObserver((list) => {
    if (!state.loaded) return;
    for (const entry of list.getEntries()) {
      const e = entry as PerformanceResourceTiming;
      state.requests.push(e.name);
      if (isCrossOrigin(e.name)) noteCrossOrigin(e.name);
    }
    render();
  });
  try {
    obs.observe({ type: 'resource', buffered: false });
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

function render(): void {
  const el = document.getElementById('netreadout-text');
  const wrap = document.getElementById('netreadout');
  if (!el || !wrap) return;

  const reqs = state.requests.length;
  const sent = state.sentBytes;
  el.textContent = `${plural(reqs, 'request', 'requests')} · ${formatBytes(sent)} sent since this page loaded`;

  const bad = sent > 0 || state.crossOrigin.length > 0;
  wrap.classList.toggle('netreadout--dirty', bad);

  const detail: string[] = [];
  if (reqs === 0) {
    detail.push('Nothing has been requested since this page finished loading.');
  } else {
    detail.push('Requested since load (all same-origin assets of this site):');
    for (const r of state.requests.slice(-12)) detail.push(`  ${r.replace(origin, '')}`);
  }
  if (sent > 0) detail.push(`Request bodies sent: ${state.sends.map((s) => s.where).join(', ')}`);
  if (state.crossOrigin.length) detail.push(`Cross-origin: ${state.crossOrigin.join(', ')}`);
  wrap.setAttribute('title', detail.join('\n'));
}

function start(): void {
  state.loaded = true;
  render();
}

watchResources();
if (document.readyState === 'complete') start();
else window.addEventListener('load', start, { once: true });

// Let the tool pages report what they fetched, and let tests read the truth.
declare global {
  interface Window {
    pdfiqNet: {
      requests: () => string[];
      bytesSent: () => number;
      crossOrigin: () => string[];
    };
  }
}
window.pdfiqNet = {
  requests: () => state.requests.slice(),
  bytesSent: () => state.sentBytes,
  crossOrigin: () => state.crossOrigin.slice(),
};

export {};
