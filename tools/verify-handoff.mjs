/**
 * Every "next, with this file" link must land somewhere that can receive the file.
 *
 * The result panels hand the finished document to the next tool through IndexedDB
 * (src/lib/handoff.ts): the link stashes it and navigates with `?from=`, and the receiving page
 * claims it with `claimIncoming()`. A page that does not claim opens empty, having silently
 * consumed the handoff — the link looks like an offer and is not one (check 14).
 *
 * That happened the day /password/ joined the result panels: six tools offered "Protect it", the
 * document was stashed on every click, and the page it arrived at never listened. Found by
 * following the chain a person would take, not by any check — hence this one.
 *
 *   npm run verify:handoff
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL, PRO_PAGES } from './site.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) fails++;
};

const routes = [...ALL, ...PRO_PAGES];
const entryFile = (route) =>
  route.entry ? join(ROOT, `src/${route.entryDir ?? 'entries'}/${route.entry}.ts`) : null;

/** The hrefs inside a result panel's next-links block, Pro blocks included. */
function nextLinks(html) {
  const out = [];
  for (const block of html.matchAll(/<div class="nextup"[^>]*>([\s\S]*?)<\/div>/g)) {
    for (const a of block[1].matchAll(/href="(\/[a-z-]*\/)"/g)) out.push(a[1]);
  }
  return [...new Set(out)];
}

let checked = 0;
for (const route of routes) {
  const page = join(ROOT, 'src/pages', `${route.slug || 'index'}.html`);
  if (!existsSync(page)) continue;
  const links = nextLinks(readFileSync(page, 'utf8'));
  if (!links.length) continue;

  const source = entryFile(route);
  const wires = source && existsSync(source) && readFileSync(source, 'utf8').includes('wireNextLinks');
  ok(wires, `/${route.slug}/ wires its next links to carry the file (${links.length} links)`);

  for (const href of links) {
    const slug = href.replace(/\//g, '');
    const target = routes.find((r) => r.slug === slug);
    const targetSource = target && entryFile(target);
    if (!target || !targetSource || !existsSync(targetSource)) {
      ok(false, `/${route.slug}/ offers ${href}, which has no entry to receive a file`);
      continue;
    }
    checked++;
    // A call, not a mention: the first version matched the word and passed a page whose import
    // was there and whose call was not, which is the exact state it existed to catch.
    const claims = /claimIncoming\s*\(/.test(readFileSync(targetSource, 'utf8'));
    ok(claims, claims
      ? `/${route.slug}/ → ${href} lands on a page that claims the file`
      : `/${route.slug}/ offers ${href}, but ${href} never calls claimIncoming: the file is stashed and lost`);
  }
}

ok(checked > 0, `${checked} handoffs between tools were checked`);
console.log(`\n${fails ? `${fails} FAILED` : 'every next-tool link lands somewhere that takes the file'}`);
process.exitCode = fails ? 1 : 0;
