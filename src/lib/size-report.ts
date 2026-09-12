/**
 * What a tool that is not trying to make files smaller says about size.
 *
 * Merge reported the size of what it wrote and never set it beside what it was given, so a merged
 * file larger than its inputs arrived with no word about it. The site's promise is the real
 * before and after; a bigger file handed back in silence is the opposite of that, even from a
 * tool whose job is not size. So both ends are shown, and a larger result is said out loud with
 * the measured difference and what the tool can and cannot do about it.
 */
import { formatBytes } from './format.js';

export interface SizeReport {
  /** Both ends, for the facts list: "1.3 MB in, 1.2 MB out". */
  fact: string;
  /** A sentence when the result is larger than the inputs together; empty otherwise. */
  note: string;
}

export function describeMergedSize(inputBytes: number[], outputBytes: number): SizeReport {
  const inTotal = inputBytes.reduce((n, b) => n + b, 0);
  const fact = `${formatBytes(inTotal)} in, ${formatBytes(outputBytes)} out`;
  if (outputBytes <= inTotal) return { fact, note: '' };
  return {
    fact,
    note:
      `The merged file is ${formatBytes(outputBytes - inTotal)} larger than the files you gave it add up to. ` +
      'Merging copies each page’s images and fonts exactly as they are, so it cannot win those bytes back — ' +
      'Compress is the tool that tries.',
  };
}
