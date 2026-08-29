/**
 * Turning pictures into PDF pages.
 *
 * The design promises images are "placed at full resolution", and separately offers to
 * strip EXIF. Those two pull against each other: the orientation flag lives in EXIF, so
 * throwing EXIF away naively lands phone photos on the page sideways, and fixing that by
 * rotating pixels means re-encoding — which is no longer full resolution.
 *
 * The way out is that a PDF can place an image under a transform. For the four rotation
 * orientations the JPEG is embedded byte-for-byte and the rotation is expressed in the
 * placement instead, so nothing is re-encoded and nothing comes out sideways. Only the
 * four mirrored orientations, which are rare, need a re-encode — and when that happens
 * the result panel says so rather than quietly claiming otherwise.
 */

export type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface LoadedImage {
  name: string;
  /** Bytes to embed, which for JPEG and PNG are the originals minus metadata. */
  bytes: Uint8Array;
  kind: 'jpeg' | 'png';
  width: number;
  height: number;
  /** Quarter-turns to apply at placement time: 0, 90, 180 or 270. */
  rotate: 0 | 90 | 180 | 270;
  /** True when we had to decode and re-encode rather than embed the original. */
  reencoded: boolean;
  /** True when metadata was present and has been removed. */
  hadMetadata: boolean;
  /** A data URL for the tray thumbnail. */
  thumb: string;
}

const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b: Uint8Array) =>
  b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

/** HEIC/HEIF sit in an ISO-BMFF box; the brand is at bytes 8..12. */
export function isHeic(b: Uint8Array): boolean {
  if (b.length < 12) return false;
  const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
  return b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 &&
    ['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'mif1', 'msf1'].includes(brand);
}

// ---------------------------------------------------------------- EXIF

/** Read the orientation tag without decoding the image. */
export function readOrientation(jpeg: Uint8Array): Orientation {
  let i = 2;
  while (i < jpeg.length - 1) {
    if (jpeg[i] !== 0xff) { i++; continue; }
    const marker = jpeg[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    if (marker === 0xda || marker === 0xd9) break;
    const length = (jpeg[i + 2] << 8) | jpeg[i + 3];
    if (marker === 0xe1) {
      const start = i + 4;
      const header = String.fromCharCode(...jpeg.subarray(start, start + 4));
      if (header === 'Exif') {
        const tiff = start + 6;
        const little = jpeg[tiff] === 0x49;
        const u16 = (at: number) => little ? jpeg[at] | (jpeg[at + 1] << 8) : (jpeg[at] << 8) | jpeg[at + 1];
        const u32 = (at: number) => little
          ? jpeg[at] | (jpeg[at + 1] << 8) | (jpeg[at + 2] << 16) | (jpeg[at + 3] << 24)
          : (jpeg[at] << 24) | (jpeg[at + 1] << 16) | (jpeg[at + 2] << 8) | jpeg[at + 3];
        const ifd0 = tiff + u32(tiff + 4);
        const count = u16(ifd0);
        for (let e = 0; e < count; e++) {
          const entry = ifd0 + 2 + e * 12;
          if (u16(entry) === 0x0112) {
            const value = u16(entry + 8);
            if (value >= 1 && value <= 8) return value as Orientation;
          }
        }
      }
    }
    i += 2 + length;
  }
  return 1;
}

/**
 * Remove every metadata segment, leaving the frame headers and compressed scan data
 * exactly as they were. This is a byte edit, not a re-encode: no pixel changes.
 * APP0/JFIF is kept because it carries the density the decoder may need.
 */
export function stripJpegMetadata(jpeg: Uint8Array): { bytes: Uint8Array; removed: boolean } {
  const keep: Array<[number, number]> = [];
  let removed = false;
  let i = 2;
  keep.push([0, 2]); // SOI

  while (i < jpeg.length - 1) {
    if (jpeg[i] !== 0xff) { i++; continue; }
    const marker = jpeg[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      keep.push([i, i + 2]);
      i += 2;
      continue;
    }
    if (marker === 0xda) {
      // Start of scan: everything from here to the end is image data.
      keep.push([i, jpeg.length]);
      break;
    }
    if (i + 3 >= jpeg.length) break;
    const length = (jpeg[i + 2] << 8) | jpeg[i + 3];
    const end = i + 2 + length;
    // APP1 (EXIF/XMP), APP13 (IPTC/Photoshop) and COM (comments) go.
    //
    // APP2 and APP14 deliberately stay. APP2 carries the ICC profile and APP14 the
    // Adobe colour transform, and both change how the image is *decoded* — dropping
    // them shifts the colours of the picture. "Strip metadata" means remove the facts
    // about where and when the photo was taken, not quietly alter the photo.
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (drop) removed = true;
    else keep.push([i, end]);
    i = end;
  }

  if (!removed) return { bytes: jpeg, removed: false };

  const total = keep.reduce((n, [a, b]) => n + (b - a), 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const [a, b] of keep) {
    out.set(jpeg.subarray(a, b), at);
    at += b - a;
  }
  return { bytes: out, removed: true };
}

// ---------------------------------------------------------------- loading

async function decodeToCanvas(bytes: Uint8Array, type: string): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

const MIRRORED: Orientation[] = [2, 4, 5, 7];
const ROTATION: Record<Orientation, 0 | 90 | 180 | 270> = {
  1: 0, 2: 0, 3: 180, 4: 180, 5: 90, 6: 90, 7: 270, 8: 270,
};

export async function loadImage(file: File, stripMetadata: boolean): Promise<LoadedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (isJpeg(bytes)) {
    const orientation = readOrientation(bytes);
    const mirrored = MIRRORED.includes(orientation);

    if (!mirrored) {
      // The common path: embed the original scan data untouched and express the
      // orientation as a placement rotation.
      const stripped = stripMetadata ? stripJpegMetadata(bytes) : { bytes, removed: false };
      const size = await measure(bytes, 'image/jpeg');
      return {
        name: file.name, bytes: stripped.bytes, kind: 'jpeg',
        width: size.width, height: size.height,
        rotate: ROTATION[orientation], reencoded: false,
        hadMetadata: stripMetadata ? stripped.removed : readHasMetadata(bytes),
        thumb: await thumbnail(bytes, 'image/jpeg', ROTATION[orientation]),
      };
    }
    // Mirrored orientations cannot be undone by a placement matrix alone.
    const canvas = await decodeToCanvas(bytes, 'image/jpeg');
    const fixed = applyMirror(canvas, orientation);
    const encoded = await canvasBytes(fixed, 'image/jpeg', 0.95);
    return {
      name: file.name, bytes: encoded, kind: 'jpeg',
      width: fixed.width, height: fixed.height,
      rotate: 0, reencoded: true, hadMetadata: true,
      thumb: fixed.toDataURL('image/jpeg', 0.6),
    };
  }

  if (isPng(bytes)) {
    const size = await measure(bytes, 'image/png');
    return {
      name: file.name, bytes, kind: 'png',
      width: size.width, height: size.height,
      rotate: 0, reencoded: false, hadMetadata: false,
      thumb: await thumbnail(bytes, 'image/png', 0),
    };
  }

  // WebP, AVIF, GIF and anything else the browser can decode: there is no way to put
  // these into a PDF without converting, so they are re-encoded and the UI says so.
  const type = file.type || 'image/*';
  const canvas = await decodeToCanvas(bytes, type);
  const encoded = await canvasBytes(canvas, 'image/jpeg', 0.92);
  return {
    name: file.name, bytes: encoded, kind: 'jpeg',
    width: canvas.width, height: canvas.height,
    rotate: 0, reencoded: true, hadMetadata: false,
    thumb: canvas.toDataURL('image/jpeg', 0.6),
  };
}

function readHasMetadata(jpeg: Uint8Array): boolean {
  return stripJpegMetadata(jpeg).removed;
}

async function measure(bytes: Uint8Array, type: string): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

function applyMirror(canvas: HTMLCanvasElement, orientation: Orientation): HTMLCanvasElement {
  const swap = orientation === 5 || orientation === 7;
  const out = document.createElement('canvas');
  out.width = swap ? canvas.height : canvas.width;
  out.height = swap ? canvas.width : canvas.height;
  const ctx = out.getContext('2d')!;
  const transforms: Record<number, () => void> = {
    2: () => { ctx.translate(out.width, 0); ctx.scale(-1, 1); },
    4: () => { ctx.translate(0, out.height); ctx.scale(1, -1); },
    5: () => { ctx.rotate(0.5 * Math.PI); ctx.scale(1, -1); },
    7: () => { ctx.rotate(-0.5 * Math.PI); ctx.translate(-out.height, out.width); ctx.scale(1, -1); },
  };
  transforms[orientation]?.();
  ctx.drawImage(canvas, 0, 0);
  return out;
}

async function canvasBytes(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, quality));
  return new Uint8Array(await blob!.arrayBuffer());
}

async function thumbnail(bytes: Uint8Array, type: string, rotate: number): Promise<string> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
  const long = 72;
  const swap = rotate === 90 || rotate === 270;
  const scale = long / Math.max(bitmap.width, bitmap.height);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = swap ? h : w;
  canvas.height = swap ? w : h;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.6);
}
