/**
 * Measure what Paddle's checkout actually does on /pro/buy/: every host contacted, what the page's
 * policy blocked, every cookie set and every storage key written — in each phase separately.
 *
 *   npm run measure:paddle
 *   npm run measure:paddle -- --url https://pro-sale.pdf-iq-web.pages.dev/pro/buy/ --pay 10
 *
 * Opens a visible Chrome with a fresh profile and drives it over the DevTools protocol, attached to
 * every frame (Paddle's checkout runs in a cross-origin frame, which a page-only recorder misses):
 *   1. arrival — load the page and do nothing;
 *   2. open    — press "Pay", let Paddle.js load, initialise and open its checkout;
 *   3. pay     — with --pay N, wait up to N minutes for a person to complete the sandbox payment in
 *                the window, then record what completing it did.
 * Nobody but the person at the keyboard types into the checkout. This script never enters card
 * details or an email.
 *
 * The page needs a signed-in session to offer the button. Preview has no sign-in configured, so this
 * plants a session in the page's own storage, for the page's origin only, with a clearly fake uid.
 * A purchase made during a measurement is therefore recorded against that fake uid in the sandbox
 * database, and is cleaned up with the SQL the report prints.
 *
 * Reports names, never values: cookie names and domains, storage keys, URL hosts and paths without
 * query strings. The JSON report is written next to the summary.
 *
 * Why this exists: what the copy says about Paddle.js must come from what it does here, not from
 * Paddle's documentation. It is also why it must be run again against production on the day the
 * sale opens: Paddle.js 2.9.7 behaves differently outside sandbox (it injects Retain analytics).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const URL_ = opt('--url', 'https://pro-sale.pdf-iq-web.pages.dev/pro/buy/');
const PAY_MINUTES = Number(opt('--pay', '0'));
const CHROME = opt('--chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const OUT = opt('--out', join(tmpdir(), `paddle-measure-${Date.now()}.json`));
const PORT = 9335;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const origin = new URL(URL_).origin;
const FAKE_UID = `measure-${Date.now()}`;

const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'pdfiq-measure-'))}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });

let version;
for (let i = 0; i < 60 && !version; i++) {
  try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await wait(250); }
}
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));

let nextId = 0;
const pending = new Map();
const listeners = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  for (const l of listeners) l(m);
});
const send = (method, params = {}, sessionId) => new Promise((resolve) => {
  const id = ++nextId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

// ---------------------------------------------------------------- recording

let phase = 'arrival';
const requests = [];      // { phase, frame, type, host, path, blocked }
const setCookies = [];    // { phase, host, names }
const consoleLines = [];  // CSP refusals and Paddle errors
const frames = new Map(); // sessionId -> { url, type }
const byRequest = new Map();

const bare = (u) => { try { const x = new URL(u); return x.origin + x.pathname; } catch { return String(u).split(/[?#]/)[0]; } };
const hostPath = (u) => { try { const x = new URL(u); return { host: x.host, path: x.pathname }; } catch { return { host: u.slice(0, 40), path: '' }; } };

listeners.push((m) => {
  const s = m.sessionId;
  if (m.method === 'Network.requestWillBeSent') {
    const { host, path } = hostPath(m.params.request.url);
    if (m.params.request.url.startsWith('data:') || m.params.request.url.startsWith('blob:')) return;
    const row = { phase, frame: bare(frames.get(s)?.url ?? '?'), type: m.params.type ?? '', host, path, blocked: '' };
    byRequest.set(`${s}:${m.params.requestId}`, row);
    requests.push(row);
  } else if (m.method === 'Network.loadingFailed') {
    const row = byRequest.get(`${s}:${m.params.requestId}`);
    if (row) row.blocked = m.params.blockedReason ?? m.params.errorText ?? 'failed';
  } else if (m.method === 'Network.responseReceivedExtraInfo') {
    const headers = m.params.headers ?? {};
    const raw = Object.entries(headers).filter(([k]) => k.toLowerCase() === 'set-cookie').map(([, v]) => v).join('\n');
    if (raw) {
      const row = byRequest.get(`${s}:${m.params.requestId}`);
      setCookies.push({ phase, host: row?.host ?? '?', names: raw.split('\n').map((c) => c.split('=')[0].trim()) });
    }
  } else if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Log.entryAdded') {
    const text = m.method === 'Log.entryAdded' ? m.params.entry.text : (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
    if (/Content Security Policy|Refused to|paddle|profitwell/i.test(text)) consoleLines.push({ phase, frame: bare(frames.get(s)?.url ?? '?'), text: text.slice(0, 300) });
  } else if (m.method === 'Target.attachedToTarget') {
    const { sessionId, targetInfo } = m.params;
    frames.set(sessionId, { url: targetInfo.url, type: targetInfo.type, targetId: targetInfo.targetId });
    void setUp(sessionId);
  } else if (m.method === 'Target.targetInfoChanged') {
    for (const [sid, f] of frames) if (f.targetId === m.params.targetInfo.targetId) f.url = m.params.targetInfo.url;
  }
});

async function setUp(sessionId) {
  await send('Network.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Log.enable', {}, sessionId);
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
  await send('Runtime.runIfWaitingForDebugger', {}, sessionId);
}

await send('Target.setDiscoverTargets', { discover: true });
const { result: { targetInfos } } = await send('Target.getTargets');
const pageTarget = targetInfos.find((t) => t.type === 'page');
const { result: { sessionId: page } } = await send('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true });
frames.set(page, { url: URL_, type: 'page', targetId: pageTarget.targetId });
await setUp(page);
await send('Page.enable', {}, page);

// A fake session for the page's origin only, so the page offers the button. Never in Paddle's frames.
const fakeSession = { uid: FAKE_UID, email: 'pdfiq-sandbox-measure@example.com', idToken: 'measurement', idTokenExpiresAt: 0, refreshToken: 'measurement' };
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `if (location.origin === ${JSON.stringify(origin)}) { try { localStorage.setItem('pdfiq.session', ${JSON.stringify(JSON.stringify(fakeSession))}); } catch {} }`,
}, page);

const evalIn = async (sessionId, expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)).result?.result?.value;

async function storage(label) {
  const out = [];
  for (const [sid, f] of frames) {
    if (!/^https?:/.test(f.url ?? '')) continue;
    const v = await evalIn(sid, `(async () => ({ origin: location.origin,
      local: Object.keys(localStorage), session: Object.keys(sessionStorage),
      idb: (await (indexedDB.databases?.() ?? Promise.resolve([]))).map((d) => d.name) }))()`).catch(() => null);
    if (v) out.push({ at: label, ...v });
  }
  return out;
}

// ---------------------------------------------------------------- phases

await send('Page.navigate', { url: URL_ }, page);
await wait(6000);
const storageArrival = await storage('arrival');
// The page's own footer counter at the end of each phase, to set beside what the recorder saw in every frame.
const readout = {};
const readReadout = async (label) => {
  readout[label] = await evalIn(page, "document.querySelector('[data-netreadout-text]')?.textContent ?? '(no readout)'");
};
await readReadout('arrival');

phase = 'open';
const view = await evalIn(page, `document.body.dataset.pdfiqBuyState ?? ''`);
if (view !== 'ready') {
  console.log(`The page is in state "${view}", not "ready" — is this a sale build with a token? Stopping.`);
} else {
  await evalIn(page, `document.querySelector('[data-buy-pay]').click()`);
  for (let i = 0; i < 40; i++) {
    if ([...frames.values()].some((f) => /buy\.paddle\.com/.test(f.url ?? ''))) break;
    await wait(500);
  }
  await wait(Number(opt('--open-seconds', '10')) * 1000);
}
const storageOpen = await storage('open');
await readReadout('open');

let storagePay = [];
if (PAY_MINUTES > 0 && view === 'ready') {
  phase = 'pay';
  console.log(`\nComplete the sandbox payment in the Chrome window (up to ${PAY_MINUTES} minutes).`);
  console.log('Use a Paddle sandbox test card. This script does not type anything into the checkout.\n');
  const until = Date.now() + PAY_MINUTES * 60000;
  while (Date.now() < until && (await evalIn(page, `document.body.dataset.pdfiqBuyState`)) !== 'done') await wait(2000);
  await wait(8000);
  storagePay = await storage('pay');
  await readReadout('pay');
}

const { result: { cookies } } = await send('Storage.getCookies', {});
const finalState = await evalIn(page, `({ state: document.body.dataset.pdfiqBuyState, reference: document.querySelector('[data-buy-reference]')?.textContent ?? '' })`);

// ---------------------------------------------------------------- report

const firstParty = (h) => h === new URL(URL_).host;
const summary = {};
for (const r of requests) {
  const key = `${r.phase}  ${firstParty(r.host) ? '(this site)' : r.host}`;
  summary[key] ??= { requests: 0, blocked: new Set(), types: new Set() };
  summary[key].requests++;
  if (r.blocked) summary[key].blocked.add(r.blocked);
  summary[key].types.add(r.type);
}
const report = {
  url: URL_, measuredAt: new Date().toISOString(), fakeUid: FAKE_UID,
  final: finalState,
  hosts: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, { requests: v.requests, types: [...v.types], blocked: [...v.blocked] }])),
  thirdPartyPaths: requests.filter((r) => !firstParty(r.host)).map((r) => `${r.phase} ${r.blocked ? `[BLOCKED ${r.blocked}] ` : ''}${r.type} ${r.host}${r.path}`),
  setCookieHeaders: setCookies,
  cookiesAtEnd: cookies.map((c) => ({ domain: c.domain, name: c.name, session: c.session, expires: c.session ? null : new Date(c.expires * 1000).toISOString(), httpOnly: c.httpOnly, sameSite: c.sameSite, partitioned: Boolean(c.partitionKey) })),
  storage: [...storageArrival, ...storageOpen, ...storagePay],
  console: consoleLines,
  footerReadout: readout,
  profitwellSeen: requests.some((r) => /profitwell/i.test(r.host)),
};
writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log('\nHosts by phase:');
for (const [k, v] of Object.entries(report.hosts)) console.log(`  ${k.padEnd(44)} ${String(v.requests).padStart(3)} req  ${v.types.join(',')}${v.blocked.length ? `  BLOCKED: ${v.blocked.join(',')}` : ''}`);
console.log(`\nCookies in the browser at the end (${report.cookiesAtEnd.length}):`);
for (const c of report.cookiesAtEnd) console.log(`  ${c.domain}  ${c.name}  ${c.session ? 'session' : `until ${c.expires}`}${c.httpOnly ? '  httpOnly' : ''}  sameSite=${c.sameSite ?? '-'}${c.partitioned ? '  partitioned' : ''}`);
console.log('\nStorage keys by origin:');
for (const s of report.storage) console.log(`  ${s.at.padEnd(8)} ${s.origin}  local=[${s.local.join(', ')}] session=[${s.session.join(', ')}] idb=[${s.idb.join(', ')}]`);
console.log('\nFooter counter on the page, by phase:');
for (const [k, v] of Object.entries(readout)) console.log(`  ${k.padEnd(8)} ${v}`);
console.log(`\nProfitWell / Retain requested: ${report.profitwellSeen ? 'YES' : 'no'}`);
console.log(`Console lines about policy or Paddle: ${consoleLines.length}`);
console.log(`Final page state: ${finalState?.state}${finalState?.reference ? `, reference ${finalState.reference}` : ''}`);
if (finalState?.state === 'done') console.log(`\nClean up the measurement purchase in D1:\n  DELETE FROM purchases WHERE uid = '${FAKE_UID}';`);
console.log(`\nFull report: ${OUT}`);

ws.close();
chrome.kill();
process.exit(0);
