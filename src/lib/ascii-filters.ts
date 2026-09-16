/**
 * The two ASCII stream filters, ASCIIHexDecode and ASCII85Decode (ISO 32000-1, 7.4.2 and 7.4.3).
 *
 * pdf-inspect.ts used to treat both as opaque, with a comment saying they were "rare in modern writers". They are not:
 * ReportLab, one of the most common PDF libraries, writes page content as [/ASCII85Decode /FlateDecode] and images as
 * [/ASCII85Decode /DCTDecode] by default. With the page content unreadable, Compress found no image drawn anywhere and told
 * people "Its 2 images are never drawn on any page" about images that fill the page, and compressed nothing (found
 * 16 September 2026; 13 of the 20 test PDFs in the Android repo are ReportLab files).
 *
 * Both functions throw on malformed input rather than returning a guess; callers keep their old behaviour then.
 */

const isSpace = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;

/** ASCII85: groups of five characters '!'..'u' give four bytes; 'z' is four zero bytes; '~>' ends the data. */
export function ascii85Decode(input: Uint8Array): Uint8Array {
  let i = 0;
  // Some writers keep the "<~" prefix PostScript uses; the PDF filter does not require it.
  while (i < input.length && isSpace(input[i])) i++;
  if (input[i] === 0x3c && input[i + 1] === 0x7e) i += 2;

  const out = new Uint8Array(Math.ceil(input.length * 4 / 5) + 4);
  let o = 0;
  const group = new Array<number>(5);
  let n = 0;
  let ended = false;

  for (; i < input.length; i++) {
    const c = input[i];
    if (isSpace(c)) continue;
    if (c === 0x7e) {
      if (input[i + 1] !== 0x3e) throw new Error('ASCII85: "~" not followed by ">"');
      ended = true;
      break;
    }
    if (c === 0x7a) {
      if (n !== 0) throw new Error('ASCII85: "z" inside a group');
      out[o++] = 0; out[o++] = 0; out[o++] = 0; out[o++] = 0;
      continue;
    }
    if (c < 0x21 || c > 0x75) throw new Error(`ASCII85: character ${c} outside "!".."u"`);
    group[n++] = c - 33;
    if (n === 5) {
      let v = 0;
      for (let k = 0; k < 5; k++) v = v * 85 + group[k];
      if (v > 0xffffffff) throw new Error('ASCII85: group exceeds 2^32');
      out[o++] = (v >>> 24) & 255; out[o++] = (v >>> 16) & 255; out[o++] = (v >>> 8) & 255; out[o++] = v & 255;
      n = 0;
    }
  }
  if (!ended) throw new Error('ASCII85: no "~>" end marker');
  if (n === 1) throw new Error('ASCII85: a final group of one character');
  if (n > 1) {
    // A final partial group of n characters is padded with "u" (84) and yields n - 1 bytes.
    let v = 0;
    for (let k = 0; k < 5; k++) v = v * 85 + (k < n ? group[k] : 84);
    const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    for (let k = 0; k < n - 1; k++) out[o++] = bytes[k];
  }
  return out.slice(0, o);
}

/** ASCIIHex: pairs of hex digits, whitespace ignored, '>' ends the data; an odd final digit is followed by an implied 0. */
export function asciiHexDecode(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(input.length / 2));
  let o = 0;
  let high = -1;
  let ended = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (isSpace(c)) continue;
    if (c === 0x3e) { ended = true; break; }
    const d = c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 55 : c >= 0x61 && c <= 0x66 ? c - 87 : -1;
    if (d < 0) throw new Error(`ASCIIHex: character ${c} is not a hex digit`);
    if (high < 0) high = d;
    else { out[o++] = (high << 4) | d; high = -1; }
  }
  if (!ended) throw new Error('ASCIIHex: no ">" end marker');
  if (high >= 0) out[o++] = high << 4;
  return out.slice(0, o);
}

export const ASCII_FILTERS = new Set(['ASCII85Decode', 'ASCIIHexDecode']);

/**
 * Remove the ASCII filters at the front of a filter chain: the bytes they decode to, the filters left, and how many were
 * removed (a /DecodeParms array is indexed by position in the original chain). Null when a wrapper does not decode.
 */
export function unwrapAscii(bytes: Uint8Array, filters: string[]): { bytes: Uint8Array; filters: string[]; removed: number } | null {
  let b = bytes;
  let k = 0;
  try {
    for (; k < filters.length && ASCII_FILTERS.has(filters[k]); k++) {
      b = filters[k] === 'ASCII85Decode' ? ascii85Decode(b) : asciiHexDecode(b);
    }
  } catch {
    return null;
  }
  return { bytes: b, filters: filters.slice(k), removed: k };
}
