/**
 * Pro-only and free-only markup in page templates, resolved at build time.
 *
 *   <!--PRO-->  ... <!--/PRO-->    kept only when the Pro flag is on
 *   <!--FREE--> ... <!--/FREE-->   kept only when it is off
 *
 * Resolved here rather than hidden with CSS or a runtime check, because the requirement is
 * that a Pro control is ABSENT from a flag-off build — not greyed, not stubbed, not in the
 * HTML at all.
 *
 * FREE exists for claims. A sentence that is true only while sign-in does not exist is written
 * inside FREE, and its sign-in-era replacement inside PRO, so the copy cannot disagree with
 * the build that serves it — the same move as deriving the app's tool count from ocr.inApp.
 *
 * Strict on purpose: an unbalanced, nested or stray marker throws, and none may survive. A
 * marker left in the output would mean a block was neither kept nor removed on purpose.
 */
const TAG = /<!--(\/?)(PRO|FREE)-->/g;

export function applyProBlocks(body, pro, file = 'template') {
  let out = '';
  let at = 0;
  let open = null; // { kind, start }
  for (const m of body.matchAll(TAG)) {
    const [whole, slash, kind] = m;
    if (!slash) {
      if (open) throw new Error(`${file}: <!--${kind}--> opened inside <!--${open.kind}--> — Pro blocks do not nest`);
      out += body.slice(at, m.index);
      open = { kind, start: m.index + whole.length };
    } else {
      if (!open) throw new Error(`${file}: <!--/${kind}--> with nothing open`);
      if (open.kind !== kind) throw new Error(`${file}: <!--/${kind}--> closes <!--${open.kind}-->`);
      const keep = kind === 'PRO' ? pro : !pro;
      if (keep) out += body.slice(open.start, m.index);
      open = null;
    }
    at = m.index + whole.length;
  }
  if (open) throw new Error(`${file}: <!--${open.kind}--> is never closed`);
  out += body.slice(at);
  if (/<!--\/?(PRO|FREE)-->/.test(out)) throw new Error(`${file}: a Pro marker survived resolution`);
  return out;
}
