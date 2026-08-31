/**
 * Reading the real structure of a document.
 *
 * The compress page promises sentences like "its 62 images are already JPEG at
 * quality 61 and 148 dpi". Both halves of that have to be measured:
 *
 *  - the format and quality come from the image stream itself (see jpeg.ts);
 *  - the dpi depends on how large the image is *drawn*, which lives in the page
 *    content stream, not in the image. So we tokenise the content streams, track
 *    the graphics state exactly as a viewer would, and record the placed size of
 *    every `Do` that resolves to an image.
 *
 * Without that walk the dpi figure would be a guess, and a guess printed in a
 * monospace font next to real numbers is worse than no number at all.
 */

import {
  PDFDocument, PDFRawStream, PDFName, PDFDict, PDFArray, PDFNumber,
  PDFRef, PDFBool, type PDFObject,
} from 'pdf-lib';

// ---------------------------------------------------------------- inflate

/** FlateDecode. PDF uses zlib framing; a few writers emit raw deflate, so fall back. */
export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const tryFormat = async (format: 'deflate' | 'deflate-raw') => {
    const ds = new DecompressionStream(format);
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };
  try {
    return await tryFormat('deflate');
  } catch {
    return await tryFormat('deflate-raw');
  }
}

/** Undo PNG row predictors (DecodeParms /Predictor >= 10). */
export function unpredict(
  data: Uint8Array,
  predictor: number,
  colors: number,
  bpc: number,
  columns: number
): Uint8Array {
  if (predictor < 10) return data;
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((colors * bpc * columns) / 8);
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  let prev = new Uint8Array(rowLen);

  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowLen + 1)];
    const src = data.subarray(r * (rowLen + 1) + 1, r * (rowLen + 1) + 1 + rowLen);
    const cur = out.subarray(r * rowLen, (r + 1) * rowLen);
    cur.set(src);
    for (let i = 0; i < rowLen; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      switch (type) {
        case 1: cur[i] = (cur[i] + a) & 0xff; break;
        case 2: cur[i] = (cur[i] + b) & 0xff; break;
        case 3: cur[i] = (cur[i] + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default: break; // 0 = none
      }
    }
    prev = cur;
  }
  return out;
}

// ---------------------------------------------------------------- dict helpers

export function filterNames(dict: PDFDict): string[] {
  const f = dict.lookup(PDFName.of('Filter'));
  if (f instanceof PDFName) return [f.asString().replace(/^\//, '')];
  if (f instanceof PDFArray) {
    return f.asArray().map((x) => (x instanceof PDFName ? x.asString().replace(/^\//, '') : '?'));
  }
  return [];
}

function num(dict: PDFDict, key: string, fallback = 0): number {
  const v = dict.lookup(PDFName.of(key));
  return v instanceof PDFNumber ? v.asNumber() : fallback;
}

function nameOf(obj: PDFObject | undefined): string | null {
  return obj instanceof PDFName ? obj.asString().replace(/^\//, '') : null;
}

/** ColorSpace can be a name, or an array like [/Indexed /DeviceRGB 255 <stream>]. */
function colorSpaceOf(doc: PDFDocument, dict: PDFDict): { name: string | null; components: number } {
  const cs = dict.lookup(PDFName.of('ColorSpace'));
  const direct = nameOf(cs);
  if (direct) return { name: direct, components: componentsFor(direct) };
  if (cs instanceof PDFArray && cs.size() > 0) {
    const family = nameOf(cs.lookup(0));
    if (family === 'Indexed') return { name: 'Indexed', components: 1 };
    if (family === 'ICCBased') {
      const streamRef = cs.get(1);
      const stream = streamRef instanceof PDFRef ? doc.context.lookup(streamRef) : null;
      const n = stream instanceof PDFRawStream ? num(stream.dict, 'N', 3) : 3;
      return { name: `ICCBased(${n})`, components: n };
    }
    if (family) return { name: family, components: componentsFor(family) };
  }
  return { name: null, components: 0 };
}

function componentsFor(name: string): number {
  if (name === 'DeviceGray' || name === 'CalGray' || name === 'G') return 1;
  if (name === 'DeviceRGB' || name === 'CalRGB' || name === 'Lab' || name === 'RGB') return 3;
  if (name === 'DeviceCMYK' || name === 'CMYK') return 4;
  return 0;
}

// ---------------------------------------------- content stream tokenisation

type Token = { t: 'num'; v: number } | { t: 'name'; v: string } | { t: 'op'; v: string } | { t: 'other' };

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

/**
 * A tokeniser that understands just enough to follow the graphics state: numbers,
 * names, and operators. Strings, dictionaries and inline image data are recognised
 * only so they can be stepped over without being mistaken for operators.
 */
function* tokenize(data: Uint8Array): Generator<Token> {
  let i = 0;
  const n = data.length;
  const dec = new TextDecoder('latin1');

  while (i < n) {
    const c = data[i];
    if (WHITESPACE.has(c)) { i++; continue; }

    if (c === 0x25) { // % comment
      while (i < n && data[i] !== 0x0a && data[i] !== 0x0d) i++;
      continue;
    }
    if (c === 0x2f) { // /Name
      i++;
      const start = i;
      while (i < n && !WHITESPACE.has(data[i]) && !DELIM.has(data[i])) i++;
      yield { t: 'name', v: decodeName(dec.decode(data.subarray(start, i))) };
      continue;
    }
    if (c === 0x28) { // ( literal string )
      i++;
      let depth = 1;
      while (i < n && depth > 0) {
        if (data[i] === 0x5c) { i += 2; continue; }
        if (data[i] === 0x28) depth++;
        else if (data[i] === 0x29) depth--;
        i++;
      }
      yield { t: 'other' };
      continue;
    }
    if (c === 0x3c && data[i + 1] === 0x3c) { i += 2; yield { t: 'other' }; continue; }
    if (c === 0x3e && data[i + 1] === 0x3e) { i += 2; yield { t: 'other' }; continue; }
    if (c === 0x3c) { // <hex string>
      i++;
      while (i < n && data[i] !== 0x3e) i++;
      i++;
      yield { t: 'other' };
      continue;
    }
    if (c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d) { i++; yield { t: 'other' }; continue; }

    if ((c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2d || c === 0x2e) {
      const start = i;
      i++;
      while (i < n && ((data[i] >= 0x30 && data[i] <= 0x39) || data[i] === 0x2e || data[i] === 0x2d || data[i] === 0x2b)) i++;
      const v = parseFloat(dec.decode(data.subarray(start, i)));
      yield Number.isFinite(v) ? { t: 'num', v } : { t: 'other' };
      continue;
    }

    // bare keyword / operator
    const start = i;
    while (i < n && !WHITESPACE.has(data[i]) && !DELIM.has(data[i])) i++;
    if (i === start) { i++; continue; }
    const word = dec.decode(data.subarray(start, i));

    if (word === 'BI') {
      // Inline image: skip to the EI that follows the binary data.
      i = skipInlineImage(data, i);
      yield { t: 'other' };
      continue;
    }
    yield { t: 'op', v: word };
  }
}

function decodeName(raw: string): string {
  return raw.replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** From just after `BI`, find the end of the inline image and return the index past `EI`. */
function skipInlineImage(data: Uint8Array, from: number): number {
  const n = data.length;
  let i = from;
  // find ID
  while (i < n - 1) {
    if (data[i] === 0x49 && data[i + 1] === 0x44) { i += 2; break; }
    i++;
  }
  if (i < n && WHITESPACE.has(data[i])) i++;
  // scan for whitespace-EI-delimiter
  while (i < n - 2) {
    if (data[i] === 0x45 && data[i + 1] === 0x49) {
      const before = i > 0 ? data[i - 1] : 0x20;
      const after = i + 2 < n ? data[i + 2] : 0x20;
      if (WHITESPACE.has(before) && (WHITESPACE.has(after) || DELIM.has(after))) return i + 2;
    }
    i++;
  }
  return n;
}

// ---------------------------------------------------------------- placement

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

export interface Placement {
  /** Largest drawn width in PDF points across all placements of this image. */
  widthPt: number;
  heightPt: number;
  /** How many times the image is drawn anywhere in the document. */
  uses: number;
  pages: Set<number>;
}

async function streamBytes(doc: PDFDocument, stream: PDFRawStream): Promise<Uint8Array> {
  const filters = filterNames(stream.dict);
  let bytes = stream.getContents();
  for (const f of filters) {
    if (f === 'FlateDecode') {
      bytes = await inflate(bytes);
      const parms = stream.dict.lookup(PDFName.of('DecodeParms'));
      const p = parms instanceof PDFDict ? parms : parms instanceof PDFArray ? parms.lookup(0) : null;
      if (p instanceof PDFDict) {
        const predictor = num(p, 'Predictor', 1);
        if (predictor >= 10) {
          bytes = unpredict(bytes, predictor, num(p, 'Colors', 1), num(p, 'BitsPerComponent', 8), num(p, 'Columns', 1));
        }
      }
    } else if (f === 'ASCIIHexDecode' || f === 'ASCII85Decode') {
      // Rare in modern writers; treat as opaque rather than mis-parsing it.
      return new Uint8Array(0);
    }
  }
  return bytes;
}

/**
 * Walk every page's content stream and record how large each image XObject is drawn.
 * Form XObjects are followed too, with a depth limit, because scanners often wrap
 * the page image in one.
 */
export async function measurePlacements(doc: PDFDocument): Promise<Map<string, Placement>> {
  const out = new Map<string, Placement>();
  const pages = doc.getPages();

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const node = pages[pageIndex].node;
    const contents = node.Contents();
    const parts: Uint8Array[] = [];
    if (contents instanceof PDFRawStream) {
      parts.push(await streamBytes(doc, contents));
    } else if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) {
        const s = contents.lookup(i);
        if (s instanceof PDFRawStream) parts.push(await streamBytes(doc, s));
      }
    }
    if (!parts.length) continue;
    const joined = concat(parts, true);
    const resources = node.Resources();
    await walk(doc, joined, resources instanceof PDFDict ? resources : null, IDENTITY, pageIndex, out, 0);
  }
  return out;
}

function concat(parts: Uint8Array[], spaceBetween = false): Uint8Array {
  const gap = spaceBetween ? 1 : 0;
  const total = parts.reduce((n, p) => n + p.length + gap, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
    if (gap) { out[at] = 0x0a; at += 1; }
  }
  return out;
}

async function walk(
  doc: PDFDocument,
  content: Uint8Array,
  resources: PDFDict | null,
  base: Matrix,
  pageIndex: number,
  out: Map<string, Placement>,
  depth: number
): Promise<void> {
  if (depth > 6) return;

  let ctm: Matrix = base;
  const stack: Matrix[] = [];
  const operands: number[] = [];
  let lastName: string | null = null;

  const xobjects = resources?.lookup(PDFName.of('XObject'));
  const xdict = xobjects instanceof PDFDict ? xobjects : null;

  for (const tok of tokenize(content)) {
    if (tok.t === 'num') { operands.push(tok.v); if (operands.length > 8) operands.shift(); continue; }
    if (tok.t === 'name') { lastName = tok.v; continue; }
    if (tok.t === 'other') { operands.length = 0; continue; }

    switch (tok.v) {
      case 'q': stack.push(ctm); break;
      case 'Q': ctm = stack.pop() ?? IDENTITY; break;
      case 'cm':
        if (operands.length >= 6) {
          ctm = multiply(operands.slice(-6) as Matrix, ctm);
        }
        break;
      case 'Do': {
        if (lastName && xdict) {
          const ref = xdict.get(PDFName.of(lastName));
          const target = ref instanceof PDFRef ? doc.context.lookup(ref) : xdict.lookup(PDFName.of(lastName));
          if (target instanceof PDFRawStream && ref instanceof PDFRef) {
            const subtype = nameOf(target.dict.lookup(PDFName.of('Subtype')));
            if (subtype === 'Image') {
              record(out, ref.toString(), ctm, pageIndex);
            } else if (subtype === 'Form') {
              const mtxObj = target.dict.lookup(PDFName.of('Matrix'));
              let inner = ctm;
              if (mtxObj instanceof PDFArray && mtxObj.size() === 6) {
                const m = mtxObj.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : 0)) as Matrix;
                inner = multiply(m, ctm);
              }
              const formRes = target.dict.lookup(PDFName.of('Resources'));
              const bytes = await streamBytes(doc, target);
              if (bytes.length) {
                await walk(doc, bytes, formRes instanceof PDFDict ? formRes : resources, inner, pageIndex, out, depth + 1);
              }
            }
          }
        }
        break;
      }
      default: break;
    }
    operands.length = 0;
  }
}

function record(out: Map<string, Placement>, key: string, ctm: Matrix, pageIndex: number): void {
  // An image is drawn into the unit square, so the CTM column magnitudes are its
  // on-page size in points, rotation included.
  const widthPt = Math.hypot(ctm[0], ctm[1]);
  const heightPt = Math.hypot(ctm[2], ctm[3]);
  const existing = out.get(key);
  if (existing) {
    existing.widthPt = Math.max(existing.widthPt, widthPt);
    existing.heightPt = Math.max(existing.heightPt, heightPt);
    existing.uses += 1;
    existing.pages.add(pageIndex);
  } else {
    out.set(key, { widthPt, heightPt, uses: 1, pages: new Set([pageIndex]) });
  }
}

// ---------------------------------------------------------------- images

export interface PdfImage {
  ref: PDFRef;
  key: string;
  stream: PDFRawStream;
  width: number;
  height: number;
  bitsPerComponent: number;
  filters: string[];
  colorSpace: string | null;
  components: number;
  encodedBytes: number;
  isMask: boolean;
  isSoftMask: boolean;
  /** Effective resolution as drawn, or null when the image is never actually placed. */
  dpi: number | null;
  placement: Placement | null;
  /** JPEG facts, when the stream is a JPEG we could read. */
  jpeg: import('./jpeg.js').JpegFacts | null;
  recompressible: boolean;
  skipReason: string | null;
}

import { readJpeg } from './jpeg.js';

export async function findImages(doc: PDFDocument): Promise<PdfImage[]> {
  const placements = await measurePlacements(doc);
  const softMaskRefs = new Set<string>();
  const objects = doc.context.enumerateIndirectObjects();

  // First pass: note every object used as a soft mask or stencil, so the second pass
  // can leave them alone. Re-encoding an alpha channel as JPEG puts ringing into the
  // edges of whatever it is masking.
  for (const [, obj] of objects) {
    if (!(obj instanceof PDFRawStream)) continue;
    for (const key of ['SMask', 'Mask']) {
      const v = obj.dict.get(PDFName.of(key));
      if (v instanceof PDFRef) softMaskRefs.add(v.toString());
    }
  }

  const images: PdfImage[] = [];
  for (const [ref, obj] of objects) {
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = nameOf(obj.dict.lookup(PDFName.of('Subtype')));
    if (subtype !== 'Image') continue;

    const key = ref.toString();
    const width = num(obj.dict, 'Width');
    const height = num(obj.dict, 'Height');
    const bpc = num(obj.dict, 'BitsPerComponent', 8);
    const filters = filterNames(obj.dict);
    const cs = colorSpaceOf(doc, obj.dict);
    const maskFlag = obj.dict.lookup(PDFName.of('ImageMask'));
    const isMask = maskFlag instanceof PDFBool ? maskFlag.asBoolean() : false;
    const encoded = obj.getContents();
    const placement = placements.get(key) ?? null;

    const dpi = placement && placement.widthPt > 0.01
      ? (width / placement.widthPt) * 72
      : null;

    let jpeg = null;
    if (filters.includes('DCTDecode') && filters.length === 1) {
      jpeg = readJpeg(encoded);
    }

    const { recompressible, skipReason } = judge({
      filters, isMask, isSoftMask: softMaskRefs.has(key), bpc, cs, width, height, placement,
    });

    images.push({
      ref, key, stream: obj, width, height,
      bitsPerComponent: bpc, filters,
      colorSpace: cs.name, components: cs.components,
      encodedBytes: encoded.length,
      isMask, isSoftMask: softMaskRefs.has(key),
      dpi, placement, jpeg, recompressible, skipReason,
    });
  }
  return images;
}

function judge(o: {
  filters: string[]; isMask: boolean; isSoftMask: boolean; bpc: number;
  cs: { name: string | null; components: number }; width: number; height: number;
  placement: Placement | null;
}): { recompressible: boolean; skipReason: string | null } {
  const no = (skipReason: string) => ({ recompressible: false, skipReason });

  if (o.isMask || o.bpc === 1) {
    return no('a 1-bit stencil — JPEG would make it larger, not smaller');
  }
  if (o.isSoftMask) return no('a transparency mask — recompressing it would fringe the edges it masks');
  if (!o.width || !o.height) return no('has no usable dimensions');
  if (o.width * o.height < 8000) return no('smaller than 8,000 pixels — already negligible');
  if (!o.placement) return no('never drawn on any page');

  for (const f of o.filters) {
    if (f === 'JBIG2Decode' || f === 'CCITTFaxDecode') {
      return no(`${f} bilevel scan — already far denser than JPEG could manage`);
    }
    if (f === 'JPXDecode') return no('JPEG 2000 — this page ships no JPEG 2000 decoder');
    if (f === 'ASCIIHexDecode' || f === 'ASCII85Decode') return no(`${f} wrapper we do not unwrap`);
  }
  const supported = o.filters.length === 0
    || (o.filters.length === 1 && (o.filters[0] === 'DCTDecode' || o.filters[0] === 'FlateDecode' || o.filters[0] === 'RunLengthDecode'));
  if (!supported) return no(`filter chain ${o.filters.join('+')} is not one we rebuild`);

  if (o.filters.includes('DCTDecode')) return { recompressible: true, skipReason: null };

  // Raw samples: we can only rebuild colour spaces we can lay out into a canvas.
  const name = o.cs.name ?? '';
  const ok = name === 'DeviceRGB' || name === 'DeviceGray' || name === 'Indexed'
    || name.startsWith('ICCBased') || name === 'CalRGB' || name === 'CalGray';
  if (!ok) return no(`${name || 'unknown'} colour space we do not convert`);
  if (o.bpc !== 8 && !(name === 'Indexed' && (o.bpc === 2 || o.bpc === 4))) {
    return no(`${o.bpc}-bit samples we do not unpack`);
  }
  return { recompressible: true, skipReason: null };
}
