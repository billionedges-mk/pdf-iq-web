# Compress to a target: the contract, for both products

Pro adds two ways to compress beside the three presets:

1. **Target resolution** — "no image above *N* dpi".
2. **Target size** — "no larger than *S*".

This document is the decision. The web builds from it first; the Android app ports it later.
Nothing here exists on Android today: the app's "advanced compression" is its three presets,
and neither product has ever offered a target. Two products disagreeing about what "compress to
5 MB" means would be worse than either answer alone — the same reason PASSWORD_RULE.md exists.

Written 12 September 2026. Every behaviour below is to be tested before it is claimed on a page.

---

## What both modes share

- **Only images change.** Text, vectors, fonts, form fields, page count, page order and page size
  are copied as they are. That is how both compressors already work, and neither mode relaxes it.
- **No image is replaced by a larger one.** If re-encoding an image does not make it smaller, the
  original stays. (Both products already hold this rule.)
- **Nothing is predicted.** Every size shown is the byte length of a file that was actually
  produced. A target mode never estimates what a setting "would" give.
- **Every pass starts from the original file**, never from the output of a previous pass.
  Compressing compressed output degrades images twice and is not what any setting means.
- **Cancel means nothing is handed over.** Not a partial result, not the best pass so far.
- The existing rules for **locked files** (PASSWORD_RULE.md), **signed files** (the signature does
  not survive and the user is told first) and the **metadata** option apply unchanged.

## Effective resolution

The resolution of an image is its pixels divided by the inches it occupies on the page, at its
**largest placement**. An image drawn on several pages, or at several sizes, is judged where it is
drawn biggest — so bringing it to *N* dpi there leaves no placement finer than *N*, and none
coarser than it has to be.

An image whose placement cannot be measured has **unknown resolution**. Neither mode guesses it.

## Mode 1: target resolution

The user chooses *N*. For each image the compressor can re-encode:

| Image | What happens |
|---|---|
| Above *N* dpi | Downscaled to exactly *N* dpi at its largest placement, then re-encoded. |
| At or below *N* dpi | **Left byte for byte.** Not re-encoded, never upscaled. |
| Unknown resolution | Left byte for byte, and counted as "resolution unknown". |
| One the compressor cannot re-encode (CMYK, JPEG 2000, JBIG2, CCITT, masks) | Left, with the same reason the presets give. |

**Quality is not a second lever in this mode.** A downscaled image is re-encoded at its own JPEG
quality where that can be read from the file, and at 85 where it cannot, so the change the user
asked for — resolution — is the change they get. A downscaled image that would still not come out
smaller is left as it was (the shared rule above) and counted separately, so "no image above *N*"
is never claimed for a file where one stayed above.

**Before running:** if no image is above *N*, say so — "every image is already at or below *N* dpi,
so this would change nothing" — and produce nothing.

**The result says:** how many images were downscaled, the resolution they were written at, how many
were already at or below *N*, how many have unknown resolution, how many could not be re-encoded and
why, and the size before and after — measured. If any image stayed above *N*, that is said too.

## Mode 2: target size

The user chooses *S*. Sizes are in the units the site already displays: **1 KB is 1,024 bytes and 1 MB
is 1,048,576 bytes**, so a result shown as "4.9 MB" is under a "5 MB" target by the same arithmetic.
The result also gives the exact byte count, so nobody has to trust the rounding.

### The ladder

A target is reached by walking a fixed ladder of settings from mildest to harshest. Each step is a
resolution and a JPEG quality, applied as the presets are:

| Step | Resolution | Quality | |
|---:|---:|---:|---|
| 1 | 220 dpi | 85 | |
| 2 | 200 dpi | 80 | |
| 3 | 180 dpi | 76 | |
| 4 | 150 dpi | 72 | = Balanced |
| 5 | 130 dpi | 66 | |
| 6 | 110 dpi | 58 | = Smaller |
| 7 | 96 dpi | 52 | |
| 8 | 84 dpi | 47 | |
| 9 | 72 dpi | 42 | = Smallest — the floor |

The three presets are points on it. **The floor is the Smallest preset.** A target that cannot be
reached at Smallest is not reached by going further — below it, fine print in scans stops being
readable, and a file that fits and cannot be read has not met anyone's need.

### The search

1. **Already small enough:** if the original is at or under *S*, say so and produce nothing.
2. **Run the floor first.** One real pass at step 9. If that output is over *S*, the target cannot be
   met here — and that is now a measured fact, not a prediction.
3. **Otherwise find the mildest step that fits**, by bisecting the ladder between step 1 and step 9.
   Every candidate is a complete, real pass from the original file. Output size falls as the ladder
   descends, so bisection finds the mildest fitting step in at most four more passes. If an encoder
   ever breaks that ordering, the cost is a result one step harsher than it needed to be — never a
   result over *S*, because the chosen output is always one that was measured under it.
4. **Hand over the chosen pass's file.**

The "worth it" thresholds the presets use (at least 3% and 50 KB smaller) do **not** apply here. The
user named a size; any output at or under it is the answer, however small the saving.

### When the target cannot be met

Say so, and hand over nothing:

> "This file can't be brought under 5 MB here. At our harshest setting — 72 dpi, quality 42 — it
> comes to 6.3 MB (6,612,480 bytes)."

The smallest size reached is stated because it was measured, and because it tells the user what
target would work. **The file itself is not offered.** Returning the nearest thing to what was asked
for, as if it were what was asked for, is the failure this rule exists to prevent. The user can set
a larger target, or choose a preset.

### The result says

The size reached, with exact bytes; the step that reached it, named as its resolution and quality;
that it is "the mildest setting that got there"; how many passes were run and how long they took —
all measured. Image counts as for the presets.

## Limits

- The input limit is the same as every tool's. It was measured for **one** pass. A target-size run
  makes up to five, one after another, each releasing the previous. Whether a file near the limit
  completes a full search **has not been measured**, and no page may claim it does until it has.
- Progress is shown per pass ("pass 2 of up to 5"), because a search is several complete
  compressions and a single bar would sit still.

---

## Porting to Android

What carries across unchanged: the ladder, floor-first, mildest-fitting, no nearest-thing, cancel
hands over nothing, every pass from the original, the units, and the wording of every outcome.

What does not, and is the real cost of the port:

- **The app does not measure resolution.** Its presets cap each image's *pixel count*
  (`CompressionLevel.pixelCap`: 1.1M, 2.6M and 4.6M pixels), deliberately, because a DPI "would depend
  on page size". A target in dpi — which is what the user reads — needs the placement of each image on
  its page: the size in points it is drawn at, from the content stream's transformation matrix when
  the image is painted (PdfBox can report this from a `PDFStreamEngine` subclass). Until the app
  measures placement, it cannot honour Mode 1 as written, and Mode 2's ladder cannot be expressed in
  its terms.
- **The app's "worth it" threshold is 5%**; the web's is 3% and 50 KB. Neither applies to target mode,
  so the difference does not carry into it, but it is noted so nobody reconciles it by accident.
- The app's rule for leaving an image alone ("already within the cap and already JPEG") becomes, in
  Mode 1, "at or below *N* dpi" — the same idea on a different measure.
