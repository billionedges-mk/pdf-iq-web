/** Sizes are quoted the way a file manager quotes them, so the number on screen
 *  matches the number the user sees on disk after saving. */
export function formatBytes(n: number, opts: { precise?: boolean } = {}): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} bytes`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 || opts.precise ? 1 : 0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 || opts.precise ? 2 : 1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function percent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** "8.4 MB → 2.9 MB" */

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** contract-2026-final.pdf + "-small" -> contract-2026-final-small.pdf */
export function suffixName(name: string, suffix: string, ext = '.pdf'): string {
  const base = name.replace(/\.[^.]+$/, '');
  return `${base}${suffix}${ext}`;
}

/** Parse "1-4, 7, 9-12" into zero-based indices, validated against a page count. */
export function parseRanges(input: string, pageCount: number): { pages: number[]; error: string | null } {
  const text = input.trim();
  if (!text) return { pages: [], error: 'Type which pages you want, for example 1-4, 7.' };

  const pages: number[] = [];
  const seen = new Set<number>();
  for (const rawPart of text.split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    const m = /^(\d+)\s*(?:[-–—]\s*(\d+))?$/.exec(part);
    if (!m) return { pages: [], error: `"${part}" is not a page or a range. Use numbers like 3 or 5-9.` };
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (from < 1 || to < 1) return { pages: [], error: 'Pages are numbered from 1.' };
    if (from > pageCount || to > pageCount) {
      return { pages: [], error: `This document has ${pageCount} pages, so ${Math.max(from, to)} does not exist.` };
    }
    if (to < from) return { pages: [], error: `"${part}" runs backwards. Write it as ${to}-${from}.` };
    for (let p = from; p <= to; p++) {
      if (!seen.has(p)) { seen.add(p); pages.push(p - 1); }
    }
  }
  if (!pages.length) return { pages: [], error: 'Type which pages you want, for example 1-4, 7.' };
  return { pages, error: null };
}

/** "1, 2, 3, 5" for a set of zero-based indices, collapsing runs into ranges. */
export function describeRanges(indices: number[]): string {
  if (!indices.length) return 'none';
  const sorted = [...indices].sort((a, b) => a - b).map((i) => i + 1);
  const out: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur !== prev + 1) {
      out.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = cur;
    }
    prev = cur;
  }
  return out.join(', ');
}
