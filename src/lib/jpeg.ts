/**
 * Reading facts back out of a JPEG.
 *
 * The compress page claims things like "already JPEG at quality 61". That number has
 * to come from the document rather than from a template, so it is recovered from the
 * file's own quantization tables: the IJG encoder derives its tables from the quality
 * setting by a known formula, and that formula can be inverted.
 *
 * It is an estimate and is labelled as one in the UI — an encoder that used custom
 * tables (some scanners do) will not have come from an IJG quality number at all. In
 * that case we report the tables as custom instead of inventing a figure.
 */

/** Annex K luminance table, in natural (row-major) order. */
const BASE_LUMA_NATURAL = [
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];

/** Natural-order index for each zigzag position. */
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10,
  17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36,
  29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63,
];

/** A DQT segment stores its 64 coefficients in zigzag order, so the base table has
 *  to be walked in the same order or every comparison is against the wrong entry. */
const BASE_LUMA = ZIGZAG.map((natural) => BASE_LUMA_NATURAL[natural]);

export interface JpegFacts {
  width: number;
  height: number;
  components: number;
  progressive: boolean;
  /** Estimated IJG quality 1-100, or null when the tables did not come from one. */
  quality: number | null;
  /** True when the quantization tables do not match the IJG family. */
  customTables: boolean;
  /** Why the estimate came out as it did. Diagnostics, not for display. */
  diagnostic: { scale: number; worstResidual: number; usable: number; table: number[] } | null;
}

/** Walk JPEG markers. Returns null if this is not a JPEG at all. */
export function readJpeg(data: Uint8Array): JpegFacts | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;

  let i = 2;
  let width = 0;
  let height = 0;
  let components = 0;
  let progressive = false;
  let lumaTable: number[] | null = null;

  while (i < data.length - 1) {
    if (data[i] !== 0xff) { i++; continue; }
    let marker = data[i + 1];
    // Fill bytes.
    while (marker === 0xff && i + 2 < data.length) { i++; marker = data[i + 1]; }
    i += 2;
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9) break;              // EOI
    if (i + 1 >= data.length) break;
    const length = (data[i] << 8) | data[i + 1];
    if (length < 2 || i + length > data.length) break;
    const segStart = i + 2;
    const segEnd = i + length;

    if (marker === 0xdb) {
      // DQT — one or more tables, each 1 byte of (precision<<4 | id) then 64 or 128 bytes.
      let p = segStart;
      while (p < segEnd) {
        const pq = data[p] >> 4;
        const tq = data[p] & 0x0f;
        p += 1;
        const table: number[] = [];
        for (let k = 0; k < 64; k++) {
          if (pq === 0) { table.push(data[p]); p += 1; }
          else { table.push((data[p] << 8) | data[p + 1]); p += 2; }
        }
        if (tq === 0 && !lumaTable) lumaTable = table;
      }
    } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      progressive = marker === 0xc2;
      height = (data[segStart + 1] << 8) | data[segStart + 2];
      width = (data[segStart + 3] << 8) | data[segStart + 4];
      components = data[segStart + 5];
    } else if (marker === 0xda) {
      break; // start of scan — everything we need is already behind us
    }
    i = segEnd;
  }

  if (!width || !height) return null;

  const q = lumaTable ? estimateQuality(lumaTable) : { quality: null, custom: true, diagnostic: null };
  return {
    width, height, components, progressive,
    quality: q.quality, customTables: q.custom, diagnostic: q.diagnostic,
  };
}

/**
 * Invert the IJG scaling. For quality Q the encoder computes
 *   S = Q < 50 ? 5000/Q : 200 - 2Q
 *   q_i = clamp((base_i * S + 50) / 100, 1, 255)
 * so each unsaturated coefficient gives back an estimate of S, and the spread across
 * coefficients tells us whether the table really came from that formula.
 */
function estimateQuality(table: number[]): {
  quality: number | null;
  custom: boolean;
  diagnostic: JpegFacts['diagnostic'];
} {
  const scales: number[] = [];
  for (let i = 0; i < 64; i++) {
    const q = table[i];
    // Saturated entries (1 and 255) have lost the information; skip them.
    if (q <= 1 || q >= 255) continue;
    scales.push(((q * 100) - 50) / BASE_LUMA[i]);
  }
  const diag = (scale: number, worstResidual: number) =>
    ({ scale, worstResidual, usable: scales.length, table: table.slice(0, 8) });

  if (scales.length < 8) return { quality: null, custom: true, diagnostic: diag(0, 0) };

  scales.sort((a, b) => a - b);
  const median = scales[scales.length >> 1];
  if (!(median > 0)) return { quality: null, custom: true, diagnostic: diag(median, 0) };

  // How well does a single scale factor explain the whole table? If the tables were
  // hand-tuned rather than IJG-derived the residuals are large and no quality number
  // would be honest.
  //
  // The tolerance needs an absolute floor as well as a proportional one. At quality 90
  // the coefficients are down at 2 and 3, where the one-step rounding inside the
  // encoder's own integer division is a 33% relative error and means nothing. Anything
  // within a single step is agreement, not evidence of a custom table.
  let worst = 0;
  for (let i = 0; i < 64; i++) {
    const q = table[i];
    if (q <= 1 || q >= 255) continue;
    const predicted = Math.max(1, Math.min(255, Math.floor((BASE_LUMA[i] * median + 50) / 100)));
    const slack = Math.max(1, q * 0.15);
    worst = Math.max(worst, Math.abs(predicted - q) / slack);
  }
  if (worst > 1) return { quality: null, custom: true, diagnostic: diag(median, worst) };

  const quality = median >= 100 ? 5000 / median : (200 - median) / 2;
  if (!Number.isFinite(quality)) return { quality: null, custom: true, diagnostic: diag(median, worst) };
  return {
    quality: Math.max(1, Math.min(100, Math.round(quality))),
    custom: false,
    diagnostic: diag(median, worst),
  };
}
