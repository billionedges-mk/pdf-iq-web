/**
 * What each tool did, in one sentence, for its result screen (the result screens proposal, approved 17 September 2026).
 *
 * Every sentence here replaces a facts table, and carries every fact that table showed: the table's rows moved into
 * words, none dropped. Each is built from the run's own counts, never written by hand. tools/verify-result.mjs runs
 * them on every branch. Compress's is in src/lib/compress.ts (describeCompressed), beside the result it reads.
 */
import { plural } from './format.js';

/** Merge. The table showed: size (now the file line), pages, bookmarks, page sizes, form fields. */
export function describeMerged(o: {
  pagesPerFile: number[];
  bookmarks: number;
  sizes: string[];
  forms: { fields: number; renamed: number };
}): string {
  const files = o.pagesPerFile.length;
  const parts = [`${o.pagesPerFile.join(' + ')} pages, in the order you set.`];
  parts.push(o.bookmarks
    ? `${plural(o.bookmarks, 'bookmark')} kept, in ${plural(files, 'group')}.`
    : 'No bookmarks: none of the files had any.');
  parts.push(o.sizes.length > 1
    ? `Page sizes ${o.sizes.join(' and ')}, all kept as they were.`
    : `Page size ${o.sizes[0] ?? 'unknown'}, unchanged.`);
  parts.push(o.forms.fields
    ? `${plural(o.forms.fields, 'form field')} kept${o.forms.renamed ? `, ${o.forms.renamed} renamed to avoid a clash` : ''}.`
    : 'No form fields in these files.');
  return parts.join(' ');
}

/** Split. It had no table; its heading gave the parts and total size, and a line said the original is untouched. */
export function describeSplit(o: { pagesPerPart: number[]; totalLabel: string }): string {
  const pages = o.pagesPerPart.length === 1
    ? `${plural(o.pagesPerPart[0], 'page')}, ${o.totalLabel}.`
    : `${o.pagesPerPart.join(' + ')} pages, ${o.totalLabel} in total.`;
  return `${pages} Your original file is untouched, on your disk, where it was.`;
}

/** Images to PDF. The table showed: images in and pages out, resolution, EXIF, page size. */
export function describeImagesToPdf(o: {
  images: number;
  converted: number;
  maxW: number;
  maxH: number;
  hadMetadata: number;
  stripped: boolean;
  pageSize: string | null;
}): string {
  const size = o.pageSize ? `Every page is ${o.pageSize}.` : 'Each page matches its image.';
  const res = o.converted
    ? `Largest image ${o.maxW} × ${o.maxH}; ${o.converted} converted.`
    : `Images unchanged, the largest ${o.maxW} × ${o.maxH}.`;
  // The option's own words for what EXIF is (src/pages/images-to-pdf.html), not a second description of it.
  const exif = !o.hadMetadata
    ? 'None of these carried photo EXIF.'
    : o.stripped
      ? `Photo EXIF (GPS coordinates, phone model, capture time) removed from ${o.hadMetadata} of ${o.images}.`
      : `Photo EXIF kept on ${o.hadMetadata} of ${o.images}.`;
  return `${size} ${res} ${exif}`;
}

/** Rotate. It had a mono line: size in and out with the measured drift, pages, none re-encoded. */
export function describeRotated(o: { inLabel: string; outLabel: string; drift: string }): string {
  return `Every page is still here, and no image was re-encoded. ${o.inLabel} in, ${o.outLabel} out (${o.drift}).`;
}

/** Reorder. Its mono line: size in and out, pages before and after, no images re-encoded, bookmarks. */
export function describeReordered(o: {
  inLabel: string;
  outLabel: string;
  pageCount: number;
  kept: number;
  hadOutline: boolean;
  bookmarks: number;
}): string {
  const parts = [`${o.pageCount} → ${o.kept} pages, and no image re-encoded. ${o.inLabel} in, ${o.outLabel} out.`];
  if (o.hadOutline) {
    parts.push(o.bookmarks ? `${plural(o.bookmarks, 'bookmark')} kept.` : 'Bookmarks dropped: their pages are gone.');
  }
  return parts.join(' ');
}
