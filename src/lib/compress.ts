/**
 * Compression.
 *
 * Deliberately *not* Ghostscript, MuPDF or CoherentPDF. All three are AGPL-3.0, and a
 * WebAssembly build of any of them is conveyed to every visitor's browser, which would
 * put the whole site under source-disclosure obligations. See tools/licenses.mjs.
 *
 * Instead this is the approach the Android app uses, which is permissively licensed and
 * already proven: walk the image XObjects, downsample and re-encode the ones that are
 * carrying the weight, and put them back in place. Text, vectors, form fields, page
 * count, page order and page size are never touched — the file is rebuilt around new
 * image streams, not re-rendered.
 *
 * Two rules the code keeps rather than states:
 *   1. No image is ever replaced by a larger one.
 *   2. No size is ever predicted. Every number the UI shows has been measured after
 *      the work was done.
 */

import { PDFDocument, PDFRawStream, PDFName, PDFNumber, PDFArray, PDFDict, PDFRef, PDFString, PDFHexString } from 'pdf-lib';
import { findImages, inflate, unpredict, filterNames, type PdfImage } from './pdf-inspect.js';

export interface Preset {
  key: 'balanced' | 'smaller' | 'smallest';
  name: string;
  note: string;
  /** Images drawn above this resolution are scaled down to it. */
  targetDpi: number;
  /** JPEG quality handed to the encoder. */
  quality: number;
}

export const PRESETS: Preset[] = [
  { key: 'balanced', name: 'Balanced', note: '150 dpi images, text stays sharp', targetDpi: 150, quality: 0.72 },
  { key: 'smaller', name: 'Smaller', note: '110 dpi, scans slightly soft', targetDpi: 110, quality: 0.58 },
  { key: 'smallest', name: 'Smallest', note: '72 dpi, fine print may blur', targetDpi: 72, quality: 0.42 },
];

export interface Analysis {
  pageCount: number;
  totalBytes: number;
  images: PdfImage[];
  recompressible: PdfImage[];
  /** Bytes of the file that are image streams we could act on. */
  actionableBytes: number;
  /** Bytes of image streams we deliberately leave alone, with the reasons. */
  skippedBytes: number;
  skipReasons: Map<string, number>;
  medianDpi: number | null;
  medianQuality: number | null;
  allJpeg: boolean;
  hasText: boolean;
  signed: boolean;
}

export interface CompressOptions {
  preset: Preset;
  stripMetadata: boolean;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, stage: number) => void;
}

export interface CompressResult {
  bytes: Uint8Array;
  beforeBytes: number;
  afterBytes: number;
  imagesRecompressed: number;
  imagesSkipped: number;
  /** Median quality and dpi actually written, for the result panel. */
  writtenQuality: number;
  writtenDpi: number | null;
  downscaled: number;
  metadataStripped: boolean;
  signed: boolean;
}

export const STAGES = [
  'Reading page tree',
  'Recompressing images',
  'Rebuilding the file',
  'Verifying every page is present',
];

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1];
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
}

/** Does the document carry a real text layer, or is it pure scan? */
function documentHasText(doc: PDFDocument): boolean {
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict) {
      const type = obj.get(PDFName.of('Type'));
      if (type instanceof PDFName && type.asString() === '/Font') return true;
    }
  }
  return false;
}

function documentIsSigned(doc: PDFDocument): boolean {
  const form = doc.catalog.lookup(PDFName.of('AcroForm'));
  if (!(form instanceof PDFDict)) return false;
  const flags = form.lookup(PDFName.of('SigFlags'));
  if (flags instanceof PDFNumber && flags.asNumber() > 0) return true;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict) {
      const ft = obj.get(PDFName.of('FT'));
      if (ft instanceof PDFName && ft.asString() === '/Sig') return true;
    }
  }
  return false;
}

export async function analyse(doc: PDFDocument, totalBytes: number): Promise<Analysis> {
  const images = await findImages(doc);
  const recompressible = images.filter((i) => i.recompressible);
  const skipReasons = new Map<string, number>();
  let skippedBytes = 0;
  for (const img of images) {
    if (img.recompressible) continue;
    skippedBytes += img.encodedBytes;
    if (img.skipReason) skipReasons.set(img.skipReason, (skipReasons.get(img.skipReason) ?? 0) + 1);
  }

  const dpis = recompressible.map((i) => i.dpi).filter((d): d is number => d != null && Number.isFinite(d));
  const qualities = recompressible
    .map((i) => i.jpeg?.quality)
    .filter((q): q is number => q != null);

  return {
    pageCount: doc.getPageCount(),
    totalBytes,
    images,
    recompressible,
    actionableBytes: recompressible.reduce((n, i) => n + i.encodedBytes, 0),
    skippedBytes,
    skipReasons,
    medianDpi: median(dpis),
    medianQuality: median(qualities),
    allJpeg: recompressible.length > 0 && recompressible.every((i) => i.filters.includes('DCTDecode')),
    hasText: documentHasText(doc),
    signed: documentIsSigned(doc),
  };
}

// ---------------------------------------------------------------- decoding

type Decoded = { bitmap: ImageBitmap } | { data: ImageData };

async function decodeImage(doc: PDFDocument, img: PdfImage): Promise<Decoded | null> {
  const raw = img.stream.getContents();

  if (img.filters.includes('DCTDecode')) {
    try {
      const bitmap = await createImageBitmap(new Blob([raw as BlobPart], { type: 'image/jpeg' }));
      return { bitmap };
    } catch {
      // CMYK and some Adobe-flavoured JPEGs defeat the browser decoder. Leaving the
      // original in place is the correct outcome, not an error.
      return null;
    }
  }

  // Raw samples behind Flate (or none at all).
  let samples: Uint8Array;
  if (img.filters.includes('FlateDecode')) {
    try {
      samples = await inflate(raw);
    } catch {
      return null;
    }
    const parms = img.stream.dict.lookup(PDFName.of('DecodeParms'));
    const p = parms instanceof PDFDict ? parms : parms instanceof PDFArray ? parms.lookup(0) : null;
    if (p instanceof PDFDict) {
      const pred = p.lookup(PDFName.of('Predictor'));
      const predictor = pred instanceof PDFNumber ? pred.asNumber() : 1;
      if (predictor >= 10) {
        const g = (k: string, d: number) => {
          const v = p.lookup(PDFName.of(k));
          return v instanceof PDFNumber ? v.asNumber() : d;
        };
        samples = unpredict(samples, predictor, g('Colors', 1), g('BitsPerComponent', 8), g('Columns', 1));
      }
    }
  } else if (img.filters.length === 0) {
    samples = raw;
  } else {
    return null;
  }

  const data = samplesToImageData(doc, img, samples);
  return data ? { data } : null;
}

function samplesToImageData(doc: PDFDocument, img: PdfImage, samples: Uint8Array): ImageData | null {
  const { width: w, height: h } = img;
  const out = new Uint8ClampedArray(w * h * 4);
  const cs = img.colorSpace ?? '';

  if (cs === 'Indexed') {
    const palette = readPalette(doc, img);
    if (!palette) return null;
    const bpc = img.bitsPerComponent;
    const perRow = Math.ceil((w * bpc) / 8);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const bitPos = x * bpc;
        const byte = samples[y * perRow + (bitPos >> 3)];
        if (byte === undefined) return null;
        const shift = 8 - bpc - (bitPos & 7);
        const index = (byte >> shift) & ((1 << bpc) - 1);
        const o = (y * w + x) * 4;
        const pi = index * palette.components;
        out[o] = palette.rgb[pi] ?? 0;
        out[o + 1] = palette.components === 1 ? out[o] : palette.rgb[pi + 1] ?? 0;
        out[o + 2] = palette.components === 1 ? out[o] : palette.rgb[pi + 2] ?? 0;
        out[o + 3] = 255;
      }
    }
    return new ImageData(out, w, h);
  }

  const comps = cs === 'DeviceGray' || cs === 'CalGray' || cs === 'ICCBased(1)' ? 1
    : cs === 'DeviceCMYK' ? 4 : 3;
  const need = w * h * comps;
  if (samples.length < need) return null;

  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    if (comps === 1) {
      const g = samples[i];
      out[p] = g; out[p + 1] = g; out[p + 2] = g;
    } else if (comps === 3) {
      out[p] = samples[i * 3]; out[p + 1] = samples[i * 3 + 1]; out[p + 2] = samples[i * 3 + 2];
    } else {
      // Naive CMYK -> RGB. Only reached for uncompressed CMYK, which is rare.
      const c = samples[i * 4] / 255, m = samples[i * 4 + 1] / 255;
      const yy = samples[i * 4 + 2] / 255, k = samples[i * 4 + 3] / 255;
      out[p] = 255 * (1 - Math.min(1, c + k));
      out[p + 1] = 255 * (1 - Math.min(1, m + k));
      out[p + 2] = 255 * (1 - Math.min(1, yy + k));
    }
    out[p + 3] = 255;
  }
  return new ImageData(out, w, h);
}

function readPalette(doc: PDFDocument, img: PdfImage): { rgb: Uint8Array; components: number } | null {
  const cs = img.stream.dict.lookup(PDFName.of('ColorSpace'));
  if (!(cs instanceof PDFArray) || cs.size() < 4) return null;
  const base = cs.lookup(1);
  const baseName = base instanceof PDFName ? base.asString().replace(/^\//, '') : null;
  const components = baseName === 'DeviceGray' ? 1 : 3;
  const lookup = cs.lookup(3);
  if (lookup instanceof PDFString || lookup instanceof PDFHexString) {
    return { rgb: lookup.asBytes(), components };
  }
  if (lookup instanceof PDFRawStream) {
    const filters = filterNames(lookup.dict);
    if (filters.length === 0) return { rgb: lookup.getContents(), components };
    return null; // compressed palette: rare, and guessing is worse than skipping
  }
  return null;
}

// ---------------------------------------------------------------- encoding

async function toJpeg(source: Decoded, targetW: number, targetH: number, quality: number): Promise<Uint8Array | null> {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(targetW, targetH)
    : Object.assign(document.createElement('canvas'), { width: targetW, height: targetH });

  const ctx = (canvas as OffscreenCanvas).getContext('2d', { alpha: false }) as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) return null;

  // JPEG has no alpha; compose onto white so transparent areas do not go black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if ('bitmap' in source) {
    ctx.drawImage(source.bitmap, 0, 0, targetW, targetH);
  } else {
    const tmp = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(source.data.width, source.data.height)
      : Object.assign(document.createElement('canvas'), { width: source.data.width, height: source.data.height });
    const tctx = (tmp as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D | null;
    if (!tctx) return null;
    tctx.putImageData(source.data, 0, 0);
    ctx.drawImage(tmp as unknown as CanvasImageSource, 0, 0, targetW, targetH);
  }

  const blob = canvas instanceof HTMLCanvasElement
    ? await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality))
    : await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality });
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

// ---------------------------------------------------------------- the pass

export async function compress(
  doc: PDFDocument,
  originalBytes: number,
  analysis: Analysis,
  opts: CompressOptions
): Promise<CompressResult> {
  const { preset, stripMetadata, signal, onProgress } = opts;
  const targets = analysis.recompressible;
  let recompressed = 0;
  let downscaled = 0;
  let skipped = analysis.images.length - targets.length;
  const writtenDpis: number[] = [];

  onProgress?.(0, targets.length, 0);

  for (let i = 0; i < targets.length; i++) {
    throwIfAborted(signal);
    const img = targets[i];
    onProgress?.(i, targets.length, 1);

    const decoded = await decodeImage(doc, img);
    if (!decoded) { skipped++; continue; }

    // Scale only when the image is genuinely drawn finer than the target.
    const scale = img.dpi && img.dpi > preset.targetDpi ? preset.targetDpi / img.dpi : 1;
    const targetW = Math.max(1, Math.round(img.width * scale));
    const targetH = Math.max(1, Math.round(img.height * scale));

    const jpeg = await toJpeg(decoded, targetW, targetH, preset.quality);
    if ('bitmap' in decoded) decoded.bitmap.close();
    if (!jpeg) { skipped++; continue; }

    // Rule 1: never hand back something bigger than what was already there.
    if (jpeg.length >= img.encodedBytes) { skipped++; continue; }

    replaceImage(doc, img, jpeg, targetW, targetH);
    recompressed++;
    if (scale < 1) downscaled++;
    if (img.dpi) writtenDpis.push(Math.round(img.dpi * scale));

    // Let the progress bar actually paint between images.
    if ((i & 3) === 3) await new Promise((r) => setTimeout(r, 0));
  }

  throwIfAborted(signal);
  onProgress?.(targets.length, targets.length, 2);

  if (stripMetadata) stripDocumentMetadata(doc);

  const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false });

  throwIfAborted(signal);
  onProgress?.(targets.length, targets.length, 3);

  // Rule: verify before claiming. Re-open what we produced and check the page count
  // survived, so "62 in, 62 out" is a statement about the actual output file.
  const check = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  if (check.getPageCount() !== analysis.pageCount) {
    throw new Error(`page count changed: ${analysis.pageCount} in, ${check.getPageCount()} out`);
  }

  return {
    bytes,
    beforeBytes: originalBytes,
    afterBytes: bytes.length,
    imagesRecompressed: recompressed,
    imagesSkipped: skipped,
    writtenQuality: Math.round(preset.quality * 100),
    writtenDpi: median(writtenDpis),
    downscaled,
    metadataStripped: stripMetadata,
    signed: analysis.signed,
  };
}

function replaceImage(doc: PDFDocument, img: PdfImage, jpeg: Uint8Array, w: number, h: number): void {
  const dict = doc.context.obj({}) as PDFDict;
  // Carry across only the entries that still describe the new stream.
  for (const key of ['SMask', 'Mask', 'Intent', 'Metadata', 'OC', 'StructParent', 'ImageMask']) {
    const v = img.stream.dict.get(PDFName.of(key));
    if (v) dict.set(PDFName.of(key), v);
  }
  dict.set(PDFName.of('Type'), PDFName.of('XObject'));
  dict.set(PDFName.of('Subtype'), PDFName.of('Image'));
  dict.set(PDFName.of('Width'), PDFNumber.of(w));
  dict.set(PDFName.of('Height'), PDFNumber.of(h));
  dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
  dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
  dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
  dict.set(PDFName.of('Length'), PDFNumber.of(jpeg.length));
  // /Decode and /DecodeParms described the old samples and must not survive.
  doc.context.assign(img.ref, PDFRawStream.of(dict, jpeg));
}

function stripDocumentMetadata(doc: PDFDocument): void {
  doc.setTitle('');
  doc.setAuthor('');
  doc.setSubject('');
  doc.setKeywords([]);
  doc.setProducer('');
  doc.setCreator('');
  // The XMP packet carries the same facts again in a different syntax.
  const meta = doc.catalog.get(PDFName.of('Metadata'));
  if (meta) doc.catalog.delete(PDFName.of('Metadata'));
  const info = doc.context.trailerInfo.Info;
  if (info instanceof PDFRef) {
    const dict = doc.context.lookup(info);
    if (dict instanceof PDFDict) {
      for (const key of ['CreationDate', 'ModDate', 'Producer', 'Creator', 'Author', 'Title', 'Subject', 'Keywords', 'Company', 'SourceModified']) {
        dict.delete(PDFName.of(key));
      }
    }
  }
}

/**
 * Was this worth doing? The threshold is deliberately generous: a saving the user
 * cannot perceive is not a saving, and telling them so is the whole point of the
 * nothing-to-gain screen.
 */
export function worthIt(before: number, after: number): boolean {
  const saved = before - after;
  return saved > 0 && saved / before >= 0.03 && saved >= 50 * 1024;
}

/**
 * The sentence that explains *why* a file cannot get smaller, built from what the
 * document actually contains. Never templated.
 */
export function explainNoGain(analysis: Analysis, preset: Preset): string {
  const n = analysis.recompressible.length;
  const bits: string[] = [];

  if (n === 0) {
    const total = analysis.images.length;
    if (total === 0) {
      return analysis.hasText
        ? 'It holds no images at all — it is text and vector drawing, which is already the most compact way to store a page. There is nothing here that recompressing could shrink.'
        : 'It holds no images we can act on, and no text layer either. There is nothing in it that recompressing would shrink.';
    }
    const reasons = [...analysis.skipReasons.entries()].sort((a, b) => b[1] - a[1]);
    const leading = reasons[0];
    return `Its ${total === 1 ? 'one image is' : `${total} images are`} ${leading ? leading[0] : 'not in a form we rebuild'}. Recompressing ${total === 1 ? 'it' : 'them'} would add bytes rather than remove them.`;
  }

  const q = analysis.medianQuality;
  const dpi = analysis.medianDpi;
  bits.push(`Its ${n === 1 ? 'one image is' : `${n} images are`} already ${analysis.allJpeg ? 'JPEG' : 'compressed'}`);
  if (q != null) bits.push(`at quality ${q}`);
  if (dpi != null) bits.push(`${q != null ? 'and ' : 'at '}${Math.round(dpi)} dpi`);

  let sentence = `${bits.join(' ')} — close to what our ${preset.name} setting would produce.`;
  if (analysis.skippedBytes > analysis.actionableBytes) {
    sentence += ' Most of the file is not image data at all.';
  }
  sentence += ' We could hand you a visibly worse file for a few kilobytes, but that is not an improvement, so we are telling you instead.';
  return sentence;
}
