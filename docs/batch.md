# Batch: one operation across many files

The contract, written before the code, as `docs/compress-to-target.md` was. Both products are
meant to behave the same way here, so this states where the web follows the Android
implementation (`BatchRunner.kt`, `BatchModels.kt`) and where the browser forces a difference.

Pro, behind the flag, and sign-in is required to run one. Nothing free needs an account.

## The operations

A small closed set, the same three the app offers, with the same labels:

| Operation | What it does | Output |
|---|---|---|
| Compress | The Balanced preset, exactly as `/compress/` applies it | `.pdf` |
| Read the text | OCR, or the document's own text layer where it has one | `.txt` |
| Rotate right | Every page a quarter turn clockwise; nothing is re-encoded | `.pdf` |

The set is deliberately small. Batch is worth paying for when it does a few things properly
across many files, not when it exposes every tool a second time.

## The output is one ZIP per run

One file, named `pdfiq-batch-<YYYY-MM-DD-HH-MM-SS>.zip`, built by `src/lib/zip.ts`.

The app writes a folder per run because a phone has a Downloads folder; a browser tab has no
folder to write into, and twenty separate downloads is twenty save prompts. So the run's outputs
are one archive, and the archive's entries **are** the result.

Entry names keep the name the user gave the file, as on Android: no `_compressed` suffix. Only a
type change alters the extension (`Read the text` writes `.txt`). A name already used **in this
run** gets ` (2)`, ` (3)`, and so on — collisions are resolved against what this run has written,
which is the only thing that can collide inside a fresh archive.

## What happens to each file

Five outcomes, per file, named on the screen. Four are the app's; "stopped partway" is the web's,
added after watching a cancelled OCR count a third of a document as a finished file.

- **Done.** The output is in the archive.
- **Failed.** Named, with the reason, from the same typed errors the single-file tools use
  (`src/lib/errors.ts`) — never a sentence matched from prose. **A failed file puts nothing in the
  archive**: no zero-byte entry, no copy of the input. The archive holds successes only.
- **Left alone.** Compress declines a document whose images are already small enough, because
  re-encoding would spend quality and save nothing. That is not a failure and must not be
  reported as one. The file is not in the archive, and the summary says why.
- **Stopped partway.** The file the stop landed in. Nothing of it is kept and nothing of it goes
  in the archive, because an operation that is interrupted can still return what it had — the OCR
  pool hands back the pages it managed — and a third of a document is not that document. Watched
  on 12 September 2026: a 30-page scan stopped at page 10 was reported as done, with its partial
  text in the archive.
- **Not attempted.** Only after a cancel: the files the run had not reached. They are named too,
  so a cancelled run of twenty after three does not leave seventeen files unmentioned for the
  reader to assume the worst about.

The app's first real run turned twenty good documents into seventeen zero-byte files with a
summary claiming they had all failed, because "left alone" was treated as an ordinary success.
Three sentences were wrong at once. That is the case this section exists for.

## The summary is reconciled against the archive

Before the ZIP is handed over, the number of entries in it is compared with the number of files
the run recorded as **Done**. If they disagree, the run says so rather than presenting the
summary: the archive's contents are the result, and a summary that disagrees with them is the
screen lying about the user's files.

On Android this is `countDownloadsIn` against the run folder, and it caught a cancelled run whose
folder held one file more than its summary claimed. The web has it cheaper — the entry list is in
memory — so there is no excuse for not doing it.

## Cancel hands over what finished

Stopping is not failing. A cancelled run writes the archive containing every file that completed
before the stop, and the summary says it was stopped and names what was not attempted.

**This is the opposite of `compress-to-target`, deliberately.** There, the passes are attempts at
one file and a cancelled search has produced nothing the user asked for, so it hands over nothing.
Here, each completed file is a finished deliverable that the user watched succeed; deleting those
to tidy up is the opposite of what cancel means.

## Staying on the page

The work happens in the tab. So:

- While a run is busy, leaving the page warns first (`beforeunload`, as the other tools do).
- A screen wake lock is requested for the duration, and released when the run ends. If the browser
  refuses it, the run continues and nothing is claimed about it.
- The copy says plainly that the tab must stay open, and why: nothing is uploaded, so there is no
  server to keep working while the tab is closed.

## What is not claimed

**No size or count ceiling is published until it is measured.** Not "up to 50 files", not "up to
500 MB". The per-file ceiling the tools already enforce (`MAX_BYTES`) still applies to each file.
A whole-run ceiling depends on the device's memory and on what the archive holds, so it is
measured on a real device, by `/memory-probe/` or an equivalent, before a number is printed
anywhere. Until then the page says nothing about it.

Retrying failed files re-runs only those files, into a new archive of their own.

## Porting notes

- Android holds outputs as files in a run folder; the web holds them as entries in memory until
  the ZIP is written. If measurement shows that ceiling is too low to be useful, entries move to
  OPFS and this document gets the measured figures — not before.
- Android's foreground service lets a run survive backgrounding. A browser tab has no equivalent,
  which is why the wake lock and the warning exist, and why neither is described as a guarantee.
