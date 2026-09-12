/**
 * A TrueType font with one empty glyph, built here, for the invisible text layer.
 *
 * The layer is written in text rendering mode 3, so nothing is ever drawn and the glyph shapes
 * are irrelevant — what matters is that codes come back out through /ToUnicode. For a long time
 * the font program was therefore left out altogether, and readers coped: MuPDF and pypdf both
 * extracted the words. But a PDF whose /FontFile2 is missing is not a valid one, MuPDF said so on
 * every file ("non-embedded font using identity encoding"), and a preflight or PDF/A check would
 * refuse it. These files are kept, forwarded and filed by people who did not make them.
 *
 * So the font is embedded, and it is this: a single glyph with no outline, every CID mapped to it
 * through a /CIDToGIDMap stream of zeros. About a kilobyte and a half, the same shape Tesseract
 * uses for the same reason.
 *
 * Everything below writes big-endian sfnt structures. The comments name each table's job rather
 * than restating the spec; the field order is the spec's and cannot be rearranged.
 */

const UNITS_PER_EM = 1000;

/** The advance every CID gets, matching /DW in the font dictionary so widths cannot disagree. */
export const GLYPH_ADVANCE = 1000;

class Writer {
  private bytes: number[] = [];

  u8(v: number): void { this.bytes.push(v & 0xff); }
  u16(v: number): void { this.u8(v >> 8); this.u8(v); }
  i16(v: number): void { this.u16(v < 0 ? v + 0x10000 : v); }
  u32(v: number): void { this.u16(v >>> 16); this.u16(v & 0xffff); }
  tag(s: string): void { for (const c of s) this.u8(c.charCodeAt(0)); }
  /** Longs the format wants but nothing here uses: dates, reserved fields. */
  zeros(n: number): void { for (let i = 0; i < n; i++) this.u8(0); }

  get done(): Uint8Array { return Uint8Array.from(this.bytes); }
}

function head(): Uint8Array {
  const w = new Writer();
  w.u32(0x00010000);      // version
  w.u32(0x00010000);      // fontRevision
  w.u32(0);               // checkSumAdjustment — left zero, as glyphless fonts commonly do
  w.u32(0x5f0f3cf5);      // magicNumber
  w.u16(3);               // flags: baseline at y=0, left sidebearing at x=0
  w.u16(UNITS_PER_EM);
  w.zeros(8);             // created
  w.zeros(8);             // modified
  w.i16(0); w.i16(0); w.i16(0); w.i16(0); // xMin, yMin, xMax, yMax — no outline
  w.u16(0);               // macStyle
  w.u16(3);               // lowestRecPPEM
  w.i16(2);               // fontDirectionHint
  w.i16(0);               // indexToLocFormat: short offsets
  w.i16(0);               // glyphDataFormat
  return w.done;
}

function hhea(): Uint8Array {
  const w = new Writer();
  w.u32(0x00010000);
  w.i16(800);             // ascender
  w.i16(-200);            // descender
  w.i16(0);               // lineGap
  w.u16(GLYPH_ADVANCE);   // advanceWidthMax
  w.i16(0); w.i16(0); w.i16(0);           // min left/right sidebearing, xMaxExtent
  w.i16(1); w.i16(0); w.i16(0);           // caret slope rise/run, caret offset
  w.zeros(8);             // four reserved
  w.i16(0);               // metricDataFormat
  w.u16(1);               // numberOfHMetrics
  return w.done;
}

function maxp(): Uint8Array {
  const w = new Writer();
  w.u32(0x00010000);
  w.u16(1);               // numGlyphs — the empty one
  for (let i = 0; i < 13; i++) w.u16(0); // maxPoints … maxComponentDepth
  return w.done;
}

function hmtx(): Uint8Array {
  const w = new Writer();
  w.u16(GLYPH_ADVANCE);
  w.i16(0);               // leftSideBearing
  return w.done;
}

/** Short-format offsets, in units of two bytes: glyph 0 starts and ends at 0, so it is empty. */
function loca(): Uint8Array {
  const w = new Writer();
  w.u16(0);
  w.u16(0);
  return w.done;
}

/**
 * A format 4 subtable that maps nothing.
 *
 * The PDF reader never consults it — CIDs reach glyphs through /CIDToGIDMap — but a TrueType
 * font without a cmap is rejected by strict validators, which is the whole reason this font
 * exists. One segment, the required 0xFFFF terminator, mapping to glyph 0.
 */
function cmap(): Uint8Array {
  const sub = new Writer();
  sub.u16(4);             // format
  sub.u16(24);            // length of this subtable
  sub.u16(0);             // language
  sub.u16(2);             // segCountX2
  sub.u16(2);             // searchRange
  sub.u16(0);             // entrySelector
  sub.u16(0);             // rangeShift
  sub.u16(0xffff);        // endCode[0]
  sub.u16(0);             // reservedPad
  sub.u16(0xffff);        // startCode[0]
  sub.i16(1);             // idDelta[0]
  sub.u16(0);             // idRangeOffset[0]
  const subtable = sub.done;

  const w = new Writer();
  w.u16(0);               // version
  w.u16(1);               // numTables
  w.u16(3);               // platformID: Windows
  w.u16(1);               // encodingID: Unicode BMP
  w.u32(12);              // offset to the subtable
  const header = w.done;

  const out = new Uint8Array(header.length + subtable.length);
  out.set(header);
  out.set(subtable, header.length);
  return out;
}

/** Version 3.0: no glyph names at all, which is what a font with one empty glyph wants. */
function post(): Uint8Array {
  const w = new Writer();
  w.u32(0x00030000);
  w.u32(0);               // italicAngle
  w.i16(0); w.i16(0);     // underlinePosition, underlineThickness
  w.u32(0);               // isFixedPitch
  w.u32(0); w.u32(0); w.u32(0); w.u32(0); // memory hints, all zero
  return w.done;
}

/** No name records. The font is never shown to anyone, and PDF carries its own /BaseFont. */
function name(): Uint8Array {
  const w = new Writer();
  w.u16(0);               // format
  w.u16(0);               // count
  w.u16(6);               // stringOffset, past this header
  return w.done;
}

const pad4 = (n: number) => (n + 3) & ~3;

function checksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const word = ((data[i] ?? 0) << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0);
    sum = (sum + word) >>> 0;
  }
  return sum >>> 0;
}

/**
 * The font program, ready for /FontFile2.
 *
 * Tables must appear in the directory sorted by tag, and each must start on a four-byte
 * boundary; the directory's search fields are derived from the table count, as the format
 * defines them.
 */
export function glyphlessFont(): Uint8Array {
  const tables: Array<[string, Uint8Array]> = [
    ['cmap', cmap()],
    ['glyf', new Uint8Array(0)], // the one glyph has no outline
    ['head', head()],
    ['hhea', hhea()],
    ['hmtx', hmtx()],
    ['loca', loca()],
    ['maxp', maxp()],
    ['name', name()],
    ['post', post()],
  ].sort((a, b) => (a[0] < b[0] ? -1 : 1)) as Array<[string, Uint8Array]>;

  const count = tables.length;
  let entrySelector = 0;
  while (1 << (entrySelector + 1) <= count) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;

  const header = new Writer();
  header.u32(0x00010000); // sfnt version: TrueType outlines
  header.u16(count);
  header.u16(searchRange);
  header.u16(entrySelector);
  header.u16(count * 16 - searchRange); // rangeShift
  const headerBytes = header.done;

  let offset = headerBytes.length + count * 16;
  const directory = new Writer();
  const placed: Array<{ data: Uint8Array; at: number }> = [];
  for (const [tag, data] of tables) {
    directory.tag(tag);
    directory.u32(checksum(data));
    directory.u32(offset);
    directory.u32(data.length);
    placed.push({ data, at: offset });
    offset = pad4(offset + data.length);
  }

  const out = new Uint8Array(offset);
  out.set(headerBytes, 0);
  out.set(directory.done, headerBytes.length);
  for (const { data, at } of placed) out.set(data, at);
  return out;
}
