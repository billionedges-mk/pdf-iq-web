/**
 * The invisible text layer: what makes a scan searchable.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE DELETING ANYTHING HERE AS DEAD CODE.
 *
 * Nothing on the free path calls this any more. Free OCR gives the reader the extracted
 * text; writing that text back into the PDF as an invisible layer is the Pro deliverable,
 * and Pro is not on sale yet. So this file looks unreachable, and it is — from the UI.
 *
 * It is exercised by `src/test/tools-selftest.ts`, which drives it directly rather than
 * through the OCR page, on purpose. That test round-trips "Zażółć gęślą jaźń Ünicode naïve
 * PDF £42.50" through a real PDF and back out via pdf.js, and it is the only thing standing
 * between us and shipping months-old unexecuted code the day Pro opens.
 *
 * If you delete that test because it appears to cover a feature nobody uses, this file
 * stops being verified and nothing will tell you. The failure it guards against is not
 * hypothetical: the first version of this wrote simple Type1 fonts, and extraction returned
 * a single stray character, because byte codes resolve through glyph names before
 * /ToUnicode. It has been Type0/Identity-H with a /ToUnicode CMap ever since, and that is
 * only demonstrably still true because the test runs.
 *
 * Implemented, correct and unreachable is this project's most repeated defect. This file is
 * deliberately in that state, with the test as the thing that makes it survivable.
 * ─────────────────────────────────────────────────────────────────────────────────────
 *
 * The invisible text layer.
 *
 * OCR output is written behind the scan in text rendering mode 3, which draws nothing.
 * The page looks exactly as it did; the words become selectable and searchable. The
 * design originally offered a switch to replace the scan with typeset text instead —
 * that option is deliberately not built. Recognition is never perfect, and keeping the
 * original image means a misread can never damage the document, while replacing it
 * turns every error into visible garbage with no original left to check against.
 *
 * Encoding note: the glyphs are never rendered, so the base font's own encoding does
 * not matter — but text *extraction* does, and that comes from /ToUnicode. So each
 * distinct character in the document is assigned a byte code and mapped back to its
 * real Unicode in a CMap. That is what makes "Łódź" copy out of the page as "Łódź"
 * rather than as whatever Helvetica happens to have at that byte.
 */

import { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFArray, PDFDict, PDFRef, PDFString } from 'pdf-lib';

export interface OcrWord {
  text: string;
  /** Bounding box in rendered-canvas pixels, y measured from the top. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence: number;
}

export interface PageGeometry {
  /** Unrotated page size in PDF points. */
  widthPt: number;
  heightPt: number;
  /** The page's /Rotate value: 0, 90, 180 or 270. */
  rotation: number;
  /** Pixels per point used when the page was rendered for OCR. */
  scale: number;
}

/** Every code is this wide, which makes fitting a word to its box exact arithmetic. */
const GLYPH_WIDTH = 500;

export class TextLayerFont {
  private codeOf = new Map<string, number>();
  private chars: string[] = [];

  /**
   * Assign a CID to every character. This is a Type0 font with Identity-H encoding, so
   * codes are two bytes and there is room for 65,534 distinct characters — more than
   * any document's alphabet, where a single-byte encoding would have run out.
   */
  register(text: string): void {
    for (const ch of text) {
      if (!this.codeOf.has(ch) && this.chars.length < 65534) {
        this.chars.push(ch);
        this.codeOf.set(ch, this.chars.length); // CIDs start at 1; 0 is notdef
      }
    }
  }

  /** Hex string for a word, dropping characters that did not fit in the table. */
  encode(text: string): string {
    let out = '';
    for (const ch of text) {
      const code = this.codeOf.get(ch);
      if (code !== undefined) out += code.toString(16).padStart(4, '0');
    }
    return out;
  }

  /** How many characters of this word will actually be written. */
  encodedLength(text: string): number {
    let n = 0;
    for (const ch of text) if (this.codeOf.has(ch)) n++;
    return n;
  }

  get overflowed(): boolean {
    return this.chars.length >= 65534;
  }

  /**
   * A composite font is used rather than a simple one on purpose. With a simple Type1
   * font the byte codes resolve through a glyph-name encoding *before* anything looks
   * at /ToUnicode, and codes with no standard glyph name are discarded by readers
   * before extraction happens — measured: pdf.js returned a single stray character for
   * a whole page written that way. A Type0/Identity-H font has no such indirection: the
   * code is the CID, and /ToUnicode is the only thing that says what it means.
   *
   * No font program is embedded. Nothing is ever drawn — the layer is written in text
   * rendering mode 3 — so there are no glyphs to rasterise, only codes to extract.
   */
  embed(doc: PDFDocument): PDFRef {
    const context = doc.context;

    const descriptor = context.obj({}) as PDFDict;
    descriptor.set(PDFName.of('Type'), PDFName.of('FontDescriptor'));
    descriptor.set(PDFName.of('FontName'), PDFName.of('PdfiqInvisible'));
    descriptor.set(PDFName.of('Flags'), PDFNumber.of(4)); // symbolic
    descriptor.set(PDFName.of('FontBBox'), context.obj([0, 0, 1000, 1000]));
    descriptor.set(PDFName.of('ItalicAngle'), PDFNumber.of(0));
    descriptor.set(PDFName.of('Ascent'), PDFNumber.of(800));
    descriptor.set(PDFName.of('Descent'), PDFNumber.of(-200));
    descriptor.set(PDFName.of('CapHeight'), PDFNumber.of(700));
    descriptor.set(PDFName.of('StemV'), PDFNumber.of(80));

    const cidInfo = context.obj({}) as PDFDict;
    cidInfo.set(PDFName.of('Registry'), PDFString.of('Adobe'));
    cidInfo.set(PDFName.of('Ordering'), PDFString.of('Identity'));
    cidInfo.set(PDFName.of('Supplement'), PDFNumber.of(0));

    const descendant = context.obj({}) as PDFDict;
    descendant.set(PDFName.of('Type'), PDFName.of('Font'));
    descendant.set(PDFName.of('Subtype'), PDFName.of('CIDFontType2'));
    descendant.set(PDFName.of('BaseFont'), PDFName.of('PdfiqInvisible'));
    descendant.set(PDFName.of('CIDSystemInfo'), cidInfo);
    descendant.set(PDFName.of('FontDescriptor'), context.register(descriptor));
    // One width for every CID keeps fitting a word to its box exact arithmetic.
    descendant.set(PDFName.of('DW'), PDFNumber.of(GLYPH_WIDTH));
    descendant.set(PDFName.of('CIDToGIDMap'), PDFName.of('Identity'));

    const font = context.obj({}) as PDFDict;
    font.set(PDFName.of('Type'), PDFName.of('Font'));
    font.set(PDFName.of('Subtype'), PDFName.of('Type0'));
    font.set(PDFName.of('BaseFont'), PDFName.of('PdfiqInvisible'));
    font.set(PDFName.of('Encoding'), PDFName.of('Identity-H'));
    font.set(PDFName.of('DescendantFonts'), context.obj([context.register(descendant)]));
    font.set(PDFName.of('ToUnicode'), context.register(this.toUnicodeStream(doc)));

    return context.register(font);
  }

  private toUnicodeStream(doc: PDFDocument): PDFRawStream {
    const entries = this.chars.map((ch, i) => {
      const code = (i + 1).toString(16).padStart(4, '0');
      // Surrogate pairs are written as two UTF-16 units, which is what the format wants.
      const units = [...ch].flatMap((c) => {
        const cp = c.codePointAt(0)!;
        if (cp > 0xffff) {
          const v = cp - 0x10000;
          return [0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)];
        }
        return [cp];
      });
      return `<${code}> <${units.map((u) => u.toString(16).padStart(4, '0')).join('')}>`;
    });

    // bfchar blocks are capped at 100 entries each.
    const blocks: string[] = [];
    for (let i = 0; i < entries.length; i += 100) {
      const chunk = entries.slice(i, i + 100);
      blocks.push(`${chunk.length} beginbfchar\n${chunk.join('\n')}\nendbfchar`);
    }

    const cmap = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <ffff>
endcodespacerange
${blocks.join('\n')}
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;

    const bytes = new TextEncoder().encode(cmap);
    const dict = doc.context.obj({}) as PDFDict;
    dict.set(PDFName.of('Length'), PDFNumber.of(bytes.length));
    return PDFRawStream.of(dict, bytes);
  }
}

/**
 * Map a point in the rendered canvas back into PDF user space, undoing the rotation
 * the renderer applied. Also returns the text matrix direction, because on a rotated
 * page the words run along the page's y axis rather than its x axis.
 */
function mapPoint(
  u: number,
  v: number,
  g: PageGeometry
): { x: number; y: number } {
  const { widthPt: pw, heightPt: ph, rotation } = g;
  switch (((rotation % 360) + 360) % 360) {
    case 90: return { x: v, y: u };
    case 180: return { x: pw - u, y: v };
    case 270: return { x: pw - v, y: ph - u };
    default: return { x: u, y: ph - v };
  }
}

/** The 2x2 part of the text matrix, so text runs the way the reader sees it. */
function textDirection(rotation: number): [number, number, number, number] {
  switch (((rotation % 360) + 360) % 360) {
    case 90: return [0, 1, -1, 0];
    case 180: return [-1, 0, 0, -1];
    case 270: return [0, -1, 1, 0];
    default: return [1, 0, 0, 1];
  }
}

const fmt = (n: number): string => (Math.abs(n) < 0.0005 ? '0' : n.toFixed(3));

/**
 * Build the content-stream operators that place `words` invisibly on the page.
 * Returns null when there is nothing worth writing.
 */
export function buildTextOperators(
  words: OcrWord[],
  geometry: PageGeometry,
  font: TextLayerFont,
  fontName: string
): string | null {
  const usable = words.filter((w) => w.text.trim().length > 0 && w.x1 > w.x0 && w.y1 > w.y0);
  if (!usable.length) return null;

  const [a, b, c, d] = textDirection(geometry.rotation);
  const S = geometry.scale;
  const parts: string[] = ['BT', '3 Tr'];

  for (const word of usable) {
    const text = word.text.trim();
    const count = font.encodedLength(text);
    if (!count) continue;

    // The box in points, in the rotated view the OCR actually saw.
    const boxWidth = (word.x1 - word.x0) / S;
    const boxHeight = (word.y1 - word.y0) / S;
    if (boxWidth <= 0 || boxHeight <= 0) continue;

    // Baseline sits at the bottom of the box in view space.
    const origin = mapPoint(word.x0 / S, word.y1 / S, geometry);

    const size = boxHeight;
    const natural = (GLYPH_WIDTH / 1000) * size * count;
    // Stretch horizontally so the selectable run matches the width of the printed word.
    const stretch = natural > 0 ? Math.max(1, Math.min(1000, (boxWidth / natural) * 100)) : 100;

    parts.push(`/${fontName} ${fmt(size)} Tf`);
    parts.push(`${fmt(stretch)} Tz`);
    parts.push(`${fmt(a)} ${fmt(b)} ${fmt(c)} ${fmt(d)} ${fmt(origin.x)} ${fmt(origin.y)} Tm`);
    parts.push(`<${font.encode(text)}> Tj`);
  }

  parts.push('ET');
  return parts.length > 3 ? parts.join('\n') : null;
}

/** Attach the font to a page's resources under a name of our choosing. */
export function attachFont(page: import('pdf-lib').PDFPage, fontRef: PDFRef, name: string): void {
  page.node.setFontDictionary(PDFName.of(name), fontRef);
}

/**
 * Append a raw content stream to a page.
 *
 * pdf-lib's pushOperators only accepts its own PDFOperator objects, and there is no
 * operator for "here is a block of already-formed content". A PDF page's /Contents may
 * be a single stream or an array of them that the viewer concatenates, so the text
 * layer goes on as one more entry in that array — leaving the original content stream
 * byte-for-byte untouched, which is the whole point of not re-rendering the scan.
 *
 * The block is wrapped in q/Q so nothing it does can leak into content added later.
 */
export function appendContentStream(
  doc: PDFDocument,
  page: import('pdf-lib').PDFPage,
  operators: string
): void {
  const context = doc.context;
  const bytes = new TextEncoder().encode(`\nq\n${operators}\nQ\n`);

  const dict = context.obj({}) as PDFDict;
  dict.set(PDFName.of('Length'), PDFNumber.of(bytes.length));
  const ref = context.register(PDFRawStream.of(dict, bytes));

  const contents = page.node.get(PDFName.of('Contents'));
  if (contents instanceof PDFArray) {
    contents.push(ref);
  } else if (contents) {
    page.node.set(PDFName.of('Contents'), context.obj([contents, ref]));
  } else {
    page.node.set(PDFName.of('Contents'), context.obj([ref]));
  }
}
