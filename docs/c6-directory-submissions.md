# C6 — directory submissions

Drafted 30 August 2026. Every criterion below was read from the destination's own
documentation on the day, not from memory — see CLAIMS.md check 21.

**Two of the five cannot be submitted yet, and both blockers are structural rather than a
matter of writing a better entry.** They are first, so no time is spent on copy that cannot
be used.

---

## BLOCKED — awesome-selfhosted

The list moved to a separate data repository. Entries are YAML in
`awesome-selfhosted/awesome-selfhosted-data`, not a README diff in the main repo, so a PR
against the visible list would be against the wrong thing.

Their contributing guide, quoted:

> Any software project you are adding was first released more than 4 months ago. This count
> initiates only after a release has been created to ensure users need not rely on the latest
> development version to use the project.

`pdf-iq-web` has **zero tags** and went public today, so the clock has not started. There is
also a separate canned rejection for "No tagged releases".

**What unblocks it:** cut a tagged release. That starts a four-month wait, so it is worth
doing now even though nothing else depends on it. The version number is a product decision —
`v1.0.0` if the seven tools are considered finished, `v0.9.0` if Pro and the app are meant to
land first.

Earliest submission: four months after that tag.

---

## BLOCKED — Lobsters

Invitation-only, and quoting their about page:

> Invitations are used as a mechanism for spam-control, to slow registrations to a pace we can
> acculturate.

There is a second restriction that matters more, because it applies even once an invite
arrives: **new users cannot submit links to new domains for their first 70 days.** So an
invite obtained today does not permit a `pdf-iq.com` submission until roughly November.

Their self-promotion rule is also stricter than most:

> Self-promo should be less than a quarter of one's stories and comments.

That is a participation requirement, not a posting rule — it cannot be satisfied by a single
submission.

**What unblocks it:** an invite from an existing member, then 70 days, then a history of
non-self-promotional participation. This is a slow relationship, not a submission. Treat it
as out of scope for this quarter.

---

## READY — AlternativeTo

Open signup. Submit at <https://alternativeto.net/manage/create-app/>.

**Listed as an alternative to:** iLovePDF, Smallpdf, PDF24, Sejda, Adobe Acrobat online

**Name:** pdf-iq
**URL:** https://pdf-iq.com
**Licence:** Open Source — MIT
**Platforms:** Web, Android
**Tags:** pdf, pdf-editor, pdf-compressor, ocr, privacy, offline, no-registration, self-hosted

**Short description (the field is tight, this is 148 characters):**

> Seven PDF tools that run inside the browser tab. Files are never uploaded — compress, merge,
> split, rotate, reorder, convert and OCR, with no account.

**Long description:**

> pdf-iq does the work in your browser rather than on a server. The file is opened by the
> browser, changed on your device and saved back to disk, so there is no upload, no queue and
> nothing to delete afterwards. Every page carries a live counter of bytes sent and
> third-party requests, so the claim is checkable rather than asserted.
>
> Seven tools: compress, merge, split, rotate, reorder pages, images to PDF, and OCR. All of
> them free and unlimited, one file at a time, with no account. Everything except the first
> OCR run works with the network switched off — that one downloads a language model once,
> then works offline too.
>
> Honest about limits: files over 60 MB are refused, because past that a browser tab stops
> being able to finish rather than crashing outright. When a PDF cannot be compressed any
> further, it says so instead of returning the same file and calling it optimised.
>
> MIT licensed, source at github.com/billionedges-mk/pdf-iq-web. An Android app covers six of
> the seven tools offline.

---

## READY — awesome-privacy

A pull request against `Lissy93/awesome-privacy`, editing **`awesome-privacy.yml`** — one
large YAML file, not a README.

Suggested section: **Creative Tools → File Converters** (its `alternativeTo` already lists
`online-convert.com`, which is the closest match to what this replaces). If a reviewer prefers,
Productivity Tools is the fallback.

Add to that section's `services:` list, matching the surrounding style exactly:

```yaml
      - name: pdf-iq
        url: https://pdf-iq.com
        icon: https://pdf-iq.com/favicon.svg
        openSource: true
        github: billionedges-mk/pdf-iq-web
        description: |
          Seven PDF tools — compress, merge, split, rotate, reorder, images to PDF and OCR —
          which run entirely inside the browser tab. The file is never uploaded: it is opened
          by the browser, changed on the device and saved back to disk. Every page shows a
          live count of bytes sent and third-party requests, so the claim can be checked
          rather than taken on trust. No account, and everything except the first OCR run
          works with the network off.
```

**PR title:** `Add pdf-iq to File Converters`

**PR body:**

> pdf-iq is a set of seven PDF tools that run client-side in the browser — compress, merge,
> split, rotate, reorder, images to PDF and OCR. Nothing is uploaded and there is no account.
>
> The reason I think it fits here rather than being another web utility: the footer of every
> page carries live instrumentation counting bytes sent and third-party requests, so "nothing
> leaves your device" is verifiable by the reader instead of being a promise. There is no
> analytics of any kind, no cookies and no consent banner, because there is nothing to
> consent to.
>
> MIT licensed. Source: https://github.com/billionedges-mk/pdf-iq-web
>
> One disclosure in the interest of the list's standards: there is a companion Android app
> which does include Firebase Analytics and Crashlytics, and an optional AI summarise feature
> that sends text to Google's Gemini API. Neither exists on the website, and the entry above is
> for the website only. The privacy policy covers both surfaces separately.

---

## READY, WITH A CAVEAT — Privacy Guides forum

Open signup at <https://discuss.privacyguides.net>. Post under **Site Development → Tool
Suggestions**.

Their bar is high and their reviewers are thorough. Two things will come up, so raise them
first rather than being caught by them:

1. The Android app contains Firebase Analytics and Crashlytics and an optional Gemini-backed
   summarise feature. Privacy Guides will find this. The website is the strong candidate; the
   app is not, and the post should say so.
2. They generally want a tool to have existed for a while and to have some independent
   scrutiny. This is new and has none. Being straightforward about that is better received
   than hoping it goes unnoticed.

**Title:** `pdf-iq — PDF tools that run in the browser tab, with the network claim made checkable`

**Post:**

> I have been building a set of PDF tools that do the work client-side, and I would value this
> forum's scrutiny before I claim anything about them publicly.
>
> **What it is:** seven tools — compress, merge, split, rotate, reorder, images to PDF, OCR —
> at https://pdf-iq.com. The file is opened by the browser, processed on the device and saved
> back to disk. No upload, no account, no cookies, no consent banner, no analytics of any kind.
> MIT licensed, source at https://github.com/billionedges-mk/pdf-iq-web.
>
> **The part I would like judged:** every page's footer shows a live count of bytes sent and
> third-party requests, from a PerformanceObserver plus patched `fetch`, `XMLHttpRequest`,
> `sendBeacon` and `WebSocket`. The intention is that the central claim is checkable in the
> page rather than asserted in a policy. It has been wrong three times during development and
> each time the fix is in the git history. I would rather it were picked apart here than
> trusted.
>
> The CSP is `default-src 'none'` with `connect-src 'self'`, which is what blocked a
> third-party form service and made me write a same-origin endpoint instead.
>
> **Disclosure, since it is relevant to your criteria:**
>
> - There is one page that sends something — `/for-professionals`, a form asking firms what to
>   build. It says so before you press anything and the counter moves when you do. Three fields
>   and an email, stored on Cloudflare D1. The IP is deliberately not recorded.
> - There is a companion Android app which **does** contain Firebase Analytics and Crashlytics,
>   and an optional AI summarise feature that sends document text to Google's Gemini API. None
>   of that exists on the website and it never will — putting it there would break the one
>   promise the site makes checkable. I am not suggesting the app for the list.
> - The project is new and has had no independent review. That is partly why I am posting.
>
> **Known limitations**, all in the README rather than buried: files over 60 MB are refused
> because past that a tab stops being able to finish; only RC4 40-bit encrypted PDFs have been
> tested against a real file, with AES implemented from spec but never exercised; CMYK, JPEG
> 2000, JBIG2 and CCITT images are detected and skipped but that path has never met a real
> file; OCR accuracy is measured only against synthetic type; desktop Safari and Firefox are
> untested.

---

## Order

1. **Cut a tagged release** — costs nothing, starts the awesome-selfhosted clock today.
2. **AlternativeTo** — fastest, and the listing is permanent.
3. **awesome-privacy PR** — a single YAML addition, low friction.
4. **Privacy Guides** — post last of the three, because the discussion may surface things
   worth fixing before more eyes arrive.
5. **awesome-selfhosted** — diary it for four months after the tag.
6. **Lobsters** — not a submission. Out of scope this quarter.
