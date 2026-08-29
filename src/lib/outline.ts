/**
 * Reading and writing the bookmark tree.
 *
 * pdf-lib copies pages but not outlines, so a merge would silently drop every bookmark
 * in every source file and a split would hand back parts with no navigation at all.
 * The design promises bookmarks survive a merge, nested under each file's name, so they
 * have to be rebuilt rather than hoped for.
 *
 * Destinations are read out as *page indices* and written back as fresh page references.
 * That indirection is what makes the same code work for both jobs: merge concatenates
 * trees with an index offset, split filters and renumbers them.
 */

import {
  PDFDocument, PDFDict, PDFArray, PDFName, PDFNumber, PDFRef,
  PDFString, PDFHexString, type PDFObject,
} from 'pdf-lib';

export interface OutlineNode {
  title: string;
  /** Zero-based page index in the document this was read from, or null if unresolvable. */
  pageIndex: number | null;
  children: OutlineNode[];
}

// ---------------------------------------------------------------- reading

export function readOutline(doc: PDFDocument): OutlineNode[] {
  const root = doc.catalog.lookup(PDFName.of('Outlines'));
  if (!(root instanceof PDFDict)) return [];

  const pageIndexByRef = new Map<string, number>();
  doc.getPages().forEach((page, i) => pageIndexByRef.set(page.ref.toString(), i));
  const named = readNamedDestinations(doc);

  return readSiblings(doc, root.get(PDFName.of('First')), pageIndexByRef, named, 0);
}

function readSiblings(
  doc: PDFDocument,
  firstRef: PDFObject | undefined,
  pages: Map<string, number>,
  named: Map<string, number>,
  depth: number
): OutlineNode[] {
  const out: OutlineNode[] = [];
  if (depth > 12) return out;

  let cursor = firstRef;
  const guard = new Set<string>();
  while (cursor instanceof PDFRef) {
    const key = cursor.toString();
    if (guard.has(key)) break;         // malformed files can make Next loop
    guard.add(key);
    const item = doc.context.lookup(cursor);
    if (!(item instanceof PDFDict)) break;

    out.push({
      title: readText(item.lookup(PDFName.of('Title'))) || 'Untitled',
      pageIndex: resolveDestination(doc, item, pages, named),
      children: readSiblings(doc, item.get(PDFName.of('First')), pages, named, depth + 1),
    });
    cursor = item.get(PDFName.of('Next'));
    if (out.length > 5000) break;      // a sane ceiling on absurd documents
  }
  return out;
}

function readText(obj: PDFObject | undefined): string {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  return '';
}

/** A destination is an explicit array, or a name that has to be looked up. */
function resolveDestination(
  doc: PDFDocument,
  item: PDFDict,
  pages: Map<string, number>,
  named: Map<string, number>
): number | null {
  let dest: PDFObject | undefined = item.lookup(PDFName.of('Dest'));

  if (dest === undefined) {
    const action = item.lookup(PDFName.of('A'));
    if (action instanceof PDFDict) {
      const kind = action.lookup(PDFName.of('S'));
      // Only GoTo stays inside this document. GoToR and URI point elsewhere and
      // cannot be carried across a merge, so they are dropped rather than faked.
      if (kind instanceof PDFName && kind.asString() === '/GoTo') {
        dest = action.lookup(PDFName.of('D'));
      }
    }
  }

  if (dest instanceof PDFString || dest instanceof PDFHexString) {
    return named.get(dest.decodeText()) ?? null;
  }
  if (dest instanceof PDFName) {
    return named.get(dest.asString().replace(/^\//, '')) ?? null;
  }
  if (dest instanceof PDFArray && dest.size() > 0) {
    const target = dest.get(0);
    if (target instanceof PDFRef) return pages.get(target.toString()) ?? null;
    // Some writers put a bare page number here instead of a reference.
    if (target instanceof PDFNumber) {
      const n = target.asNumber();
      return Number.isInteger(n) && n >= 0 && n < pages.size ? n : null;
    }
  }
  return null;
}

/** Both the modern /Names /Dests name tree and the legacy /Dests dictionary. */
function readNamedDestinations(doc: PDFDocument): Map<string, number> {
  const out = new Map<string, number>();
  const pageIndexByRef = new Map<string, number>();
  doc.getPages().forEach((page, i) => pageIndexByRef.set(page.ref.toString(), i));

  const record = (name: string, value: PDFObject | undefined) => {
    let arr = value;
    if (arr instanceof PDFDict) arr = arr.lookup(PDFName.of('D'));
    if (arr instanceof PDFArray && arr.size() > 0) {
      const target = arr.get(0);
      if (target instanceof PDFRef) {
        const idx = pageIndexByRef.get(target.toString());
        if (idx !== undefined) out.set(name, idx);
      }
    }
  };

  const legacy = doc.catalog.lookup(PDFName.of('Dests'));
  if (legacy instanceof PDFDict) {
    for (const [key, value] of legacy.entries()) {
      record(key.asString().replace(/^\//, ''), doc.context.lookup(value));
    }
  }

  const names = doc.catalog.lookup(PDFName.of('Names'));
  if (names instanceof PDFDict) {
    const dests = names.lookup(PDFName.of('Dests'));
    if (dests instanceof PDFDict) walkNameTree(doc, dests, record, 0);
  }
  return out;
}

function walkNameTree(
  doc: PDFDocument,
  node: PDFDict,
  record: (name: string, value: PDFObject | undefined) => void,
  depth: number
): void {
  if (depth > 12) return;
  const names = node.lookup(PDFName.of('Names'));
  if (names instanceof PDFArray) {
    for (let i = 0; i + 1 < names.size(); i += 2) {
      const key = names.lookup(i);
      const value = names.lookup(i + 1);
      if (key instanceof PDFString || key instanceof PDFHexString) record(key.decodeText(), value);
    }
  }
  const kids = node.lookup(PDFName.of('Kids'));
  if (kids instanceof PDFArray) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookup(i);
      if (kid instanceof PDFDict) walkNameTree(doc, kid, record, depth + 1);
    }
  }
}

// ---------------------------------------------------------------- writing

/**
 * Replace the document's outline with this tree. Nodes whose page index no longer
 * exists are dropped along with their subtree, rather than left pointing at a page
 * that is not the one the title names.
 */
export function writeOutline(doc: PDFDocument, nodes: OutlineNode[]): number {
  const pages = doc.getPages();
  const context = doc.context;

  const pruned = prune(nodes, pages.length);
  if (!pruned.length) {
    doc.catalog.delete(PDFName.of('Outlines'));
    return 0;
  }

  const rootRef = context.nextRef();
  let written = 0;

  const build = (items: OutlineNode[], parentRef: PDFRef): { first: PDFRef; last: PDFRef; count: number } => {
    const refs = items.map(() => context.nextRef());
    let visibleCount = 0;

    items.forEach((node, i) => {
      const dict = context.obj({}) as PDFDict;
      dict.set(PDFName.of('Title'), PDFHexString.fromText(node.title));
      dict.set(PDFName.of('Parent'), parentRef);
      if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1]);
      if (i < items.length - 1) dict.set(PDFName.of('Next'), refs[i + 1]);

      if (node.pageIndex !== null) {
        // /XYZ with nulls means "keep the reader's current zoom and scroll to the top",
        // which is what a bookmark should do.
        const dest = context.obj([
          pages[node.pageIndex].ref,
          PDFName.of('XYZ'),
          context.obj(null),
          context.obj(null),
          context.obj(null),
        ]) as PDFArray;
        dict.set(PDFName.of('Dest'), dest);
      }

      if (node.children.length) {
        const inner = build(node.children, refs[i]);
        dict.set(PDFName.of('First'), inner.first);
        dict.set(PDFName.of('Last'), inner.last);
        // A positive Count opens the branch; negative would collapse it.
        dict.set(PDFName.of('Count'), PDFNumber.of(inner.count));
        visibleCount += 1 + inner.count;
      } else {
        visibleCount += 1;
      }

      context.assign(refs[i], dict);
      written++;
    });

    return { first: refs[0], last: refs[refs.length - 1], count: visibleCount };
  };

  const top = build(pruned, rootRef);
  const root = context.obj({}) as PDFDict;
  root.set(PDFName.of('Type'), PDFName.of('Outlines'));
  root.set(PDFName.of('First'), top.first);
  root.set(PDFName.of('Last'), top.last);
  root.set(PDFName.of('Count'), PDFNumber.of(top.count));
  context.assign(rootRef, root);
  doc.catalog.set(PDFName.of('Outlines'), rootRef);

  return written;
}

function prune(nodes: OutlineNode[], pageCount: number): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (const node of nodes) {
    const children = prune(node.children, pageCount);
    const valid = node.pageIndex !== null && node.pageIndex >= 0 && node.pageIndex < pageCount;
    // Keep a node with an unusable destination only if it still leads somewhere.
    if (valid || children.length) {
      out.push({ title: node.title, pageIndex: valid ? node.pageIndex : null, children });
    }
  }
  return out;
}

/** Shift every page index in a tree, for concatenation. */
export function shiftOutline(nodes: OutlineNode[], by: number): OutlineNode[] {
  return nodes.map((n) => ({
    title: n.title,
    pageIndex: n.pageIndex === null ? null : n.pageIndex + by,
    children: shiftOutline(n.children, by),
  }));
}

/** Remap page indices through a lookup, dropping nodes whose page is gone. */
export function remapOutline(nodes: OutlineNode[], map: Map<number, number>): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (const node of nodes) {
    const children = remapOutline(node.children, map);
    const moved = node.pageIndex === null ? null : map.get(node.pageIndex) ?? null;
    if (moved !== null || children.length) {
      out.push({ title: node.title, pageIndex: moved, children });
    }
  }
  return out;
}

export function countOutline(nodes: OutlineNode[]): number {
  return nodes.reduce((n, node) => n + 1 + countOutline(node.children), 0);
}
