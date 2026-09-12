# What ML Kit sends, and how each clause on /privacy is known

The paragraph under **Diagnostics and analytics** on `/privacy` — "Google's ML Kit…" — states
several things about data leaving a user's phone. This file is where each of those clauses comes
from, kept clause by clause rather than summarised, because a paraphrase of a source is not a
source. It was nearly put on the Play Data Safety form on the strength of one.

Measured 12 September 2026 on the tablet (SM-X516B, Android 16, Play build vc16) and taken from
Google's own documents. Applied to the page on the same day; the page's effective date moved with
it.

## Why the page changed

`vc16` sends ML Kit usage reports to Google after Read a scan. Measured twice on the
Play-installed release:

| | |
|---|---|
| Cold start, 60 s idle, no OCR (the control) | one upload, to the Firebase endpoint the page already declares |
| Read a scan finished | 14:32:21 |
| 35 seconds later | `firebaselogging.googleapis.com/v0cc/log/batch`, HTTP 200 |

Read out of the app's own queue before it emptied: log source `FIREBASE_ML_SDK`, 7 events
totalling 1,099 bytes for one document. **No document content**, and the events are far too small
to carry a page. Google's own terms say the same thing, which is the point — this was published
all along:

> "The ML Kit APIs also send metrics about the performance and utilization of the APIs in your app
> to Google."
> — developers.google.com/ml-kit/terms

The sentence the page used to carry — "That is a download to you, not an upload from you" — was
therefore inaccurate **today**, before any scanner ships. The document really is never sent.
Something else is. That phrase is now in `tools/retired-claims.mjs`, so it cannot return quietly.

## Every clause, and where it comes from

| Clause | Where it comes from |
|---|---|
| The list of what is in the report | ML Kit's own disclosure page (developers.google.com/ml-kit/android-data-disclosure), which lists device information, application information, per-installation identifiers, performance metrics, API configuration, input and output size, feature version, event type and error codes — each "Used for diagnostics and usage analytics" |
| Language, country, time zone | read from the queued payloads on the device |
| "never contains the page… or any text" | the payloads are 146–155 bytes each; readable content was the package name, ML Kit version, locale and a UUID. **The protobuf was not decoded field by field** — this is the limit of what was checked, and the page says so in those terms |
| "does not pass these reports to anyone else" | Google's words, quoted on the page: "For the collected data listed on this page, ML Kit does not transfer this data to third-parties." |
| "for Google's own purposes" | "Google uses this metrics data to measure performance, debug, maintain and improve the APIs, and detect misuse or abuse" |
| "no setting… turns them off" | searched ML Kit's four libraries (2,228 classes) with a control string that was found; nothing by any obvious name. Google's terms offer none, and put the duty on us: "You are responsible for informing users of your app about Google's processing of ML Kit metrics data" |
| "If you are offline the report waits" | measured: in airplane mode the queue grew from 3 to 17 events with 0 bytes sent and no upload attempt logged |

## What the rest of the Read-a-scan sentence rests on

With the tablet in airplane mode (ping answering "Network is unreachable"), Read a scan worked,
and so did a two-file batch — `Done. 2 of 2 finished.` Across that whole offline session every app
moved **0 bytes**. That is why everything in the sentence except the retired clause stayed.

## Parked, and deliberately not applied

Two further changes belong with the document scanner, which is not built. They ship only if it
does, and the site must not describe it before then (see `tools/retired-claims.mjs`):

- **3a** — that *Take a photo* hands the job to the phone's own camera app while *Scan a document*
  hands it to Google's document scanner inside Play services, neither needing a permission from
  PDFiq, with the picture staying on the phone. Measured: while the scanner was in front,
  including the capture, Play services sent 1–3 KB per ten seconds against a 450–850 byte idle
  baseline, while the captured JPEG was 474 KB.
- **3e** — the on-device list item becoming "Creating a PDF from photos, camera images or scanned
  pages".

## Not this repo's to change

- **Play Data Safety.** *Device or other IDs* is ticked Collected, unticked Shared. The reasoning,
  both readings of it, and the purposes question are in the Android repo at TECH_DEBT 29.
- **The app's paywall**, `PaywallViewModel.kt:149`.

## Sources

- https://developers.google.com/ml-kit/terms
- https://developers.google.com/ml-kit/android-data-disclosure
- Measurements: TEST_MATRIX sections 20A (what vc16 sends) and 20E (offline), in the Android repo.
