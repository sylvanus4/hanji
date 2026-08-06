# Decisions

Each entry records what was chosen, what evidence forced it, and what would reverse it.

---

## D1 — Host on Cloudflare Pages, not GitHub Pages

**Evidence.** GitHub's own documentation and three long-running community discussions confirm
GitHub Pages offers no mechanism whatsoever for custom response headers. Without
`Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` the page cannot become
cross-origin isolated, so `SharedArrayBuffer` is unavailable, so multi-threaded WASM is
unavailable. That closes off ffmpeg.wasm's fast build and LibreOffice-class engines permanently.

The `coi-serviceworker` workaround does exist and does work, but it forces a reload on first
visit, has broken on Safari before, requires the worker and all WASM to be same-origin, and once
COEP is on, every cross-origin subresource must send CORP or it is silently blocked.

Cloudflare Pages supports `_headers`, has no meaningful bandwidth ceiling for an app whose
traffic is just its own bundle, allows commercial use, and permits 25 MiB assets — comfortably
above the 7.2 MB Hangul WASM.

**Reversed if.** GitHub ships header configuration for Pages.

---

## D2 — Every engine behind a dynamic import

**Evidence.** The Hangul WASM alone is 7.2 MB (2.7 MB gzipped) and pdf.js adds another ~415 kB
of JS plus a 1.2 MB worker. Loading those eagerly would make someone who only wanted to resize a
PNG pay for a Korean word processor and a PDF parser.

Measured result: initial page weight is 6.5 kB JS and 6.8 kB CSS, roughly 4.9 kB gzipped
combined. Engines arrive only when a matching file is opened.

**Reversed if.** Never — but the registry in `src/formats/registry.ts` must keep every heavy
import inside a loader function. A single top-level `import` of an engine silently undoes this.

---

## D3 — The no-upload claim is instrumented and tested, not asserted

**Evidence.** Every major competitor (iLovePDF, Smallpdf, CloudConvert, Convertio) is
server-side and markets fast deletion, per each vendor's own privacy documentation. "We delete
quickly" and "it never leaves" are different products, and the difference is only credible if it
is demonstrable.

So: `src/components/netbadge` wraps `fetch`, `XMLHttpRequest`, `sendBeacon` and `WebSocket`, and
additionally watches `PerformanceObserver` resource entries to catch requests that bypass those
wrappers. It is armed before any feature module is imported. The CSP in `public/_headers` pins
`connect-src` to `'self'`, so an accidental phone-home fails at the browser rather than at review
time. `e2e-smoke.py` fails the build if a single foreign request occurs while opening real files.

**Reversed if.** Never. If a feature genuinely needs the network, it becomes a separate,
explicitly-labelled surface — it does not get to quietly relax this.

---

## D4 — The Hangul rendering defect was two bugs, one of them ours

**Superseded the original entry**, which guessed at a CLI/WASM render-path divergence. Building
the CLI at matching tags disproved that. There were two independent causes.

### D4a — We never installed the engine's text-measurement callback (our bug)

`@rhwp/core` has no access to browser fonts, so it calls out to `globalThis.measureTextWidth` and
uses the answer to decide line breaks and justification. Its README carries a section titled
"필수 설정: measureTextWidth" saying the global must be registered *before* WASM init. We had not
read it.

Omitting it does not throw. The engine falls back to its embedded metrics, silently mismeasures
every glyph it lacks, and the right-hand column overruns the page. That symptom was what got
written up here as an upstream defect.

Fixed in `src/formats/hwp.ts` (`installMeasureBridge`), which resolved the column clipping
outright. The Korean fallback fonts in `src/formats/hwp-fonts.ts` were added at the same time; the
README recommends loading them from the Google Fonts CDN, which our CSP and our no-upload claim
both forbid, so they are self-hosted. Measurably they changed nothing on this document, but they
matter for documents whose fonts fall outside the engine's embedded metrics.

**Lesson worth more than the fix:** we recorded a defect against a dependency without reading that
dependency's README. A missing host contract and a library bug present identically.

### D4b — Block-level table x-offset, a genuine upstream regression

With the bridge installed, one defect remained: every boxed passage was displaced right by exactly
117.3px — one inch at this page's 117.4 px/inch. Table *widths* were correct (421.41 in every
build); only x differed.

Bisected across 358 commits to `10c36e23` ("Task #146: TAC 표 선행 텍스트 폭을 inline x 좌표에
반영", 2026-04-23), first released in **v0.7.6**. Good at v0.7.3, bad from v0.7.6 through v0.8.2.

| Build | Table x |
|---|---|
| CLI v0.7.3 | 22.7 / 495.1 (correct) |
| CLI v0.7.6 → v0.8.2 | 139.7 / 612.1 |
| WASM 0.8.2 | 140.0 / 612.5 |

CLI and WASM agree at the same version, which is what settles the original question: this is a
**version regression, not a path divergence.** It also reproduces in the CLI alone, so the bug
report needs no browser.

Cause: for a TAC table classified as *block*, `compute_tac_leading_width` sums every run on line 0
and adds it to the table's x. That is right when a table genuinely follows text inline, and the
branch exists to support Hancom's table-width filler glyphs (U+F081C). But here line 0 is two tabs
(`U+0009 U+0009`, 117.00px) — paragraph indentation, not leading text — so the table is pushed a
tab-stop pair out of its column.

Our fix skips tab-only runs in that branch. Verified: table x returns to 24.5 / 497.0 and the
rightmost rect edge returns to 971.4, inside the 971.36px page, from 1034.0 before.

**Open caveat.** We have no Hancom oracle, so we cannot prove what the *correct* offset is — only
that a table must not leave its column, and that this file rendered correctly before `10c36e23`.

### D4c — We ship our own engine build rather than wait

Every published `@rhwp/core` from 0.7.6 onward carries the regression, so there is no version to
pin to. `vendor/rhwp-core` is v0.8.2 built from source with the patch applied
(`wasm-pack build --target web --release`), versioned `0.8.2-hanji.1` so it cannot be mistaken for
a release. Provenance and rebuild steps are in [`vendor/README.md`](../vendor/README.md).

In the browser this lands the table at x 24.5 / 497.0 with the rightmost rect at 971.4 inside a
971.36px page — matching the patched CLI to within 0.3px, the expected residual between Canvas
`measureText` and the engine's embedded metrics.

`e2e-smoke.py` now asserts no rect exceeds the page width, so installing an unpatched engine fails
the build. Without that guard the regression is easy to reintroduce: the page still renders, it
just renders wrong.

The upstream issue is drafted in `docs/upstream/` but **deliberately not filed**. The patch is
ours to carry for now.

rhwp's README declines to treat Hancom's PDF as ground truth, so no fidelity baseline exists for
this ecosystem. Building one remains on the roadmap and is plausibly worth more than the viewer.

---

## D5 — Office formats are out of scope for v1

**Evidence.** LibreOffice compiled to WASM (ZetaOffice) is real and high-fidelity, but requires
SharedArrayBuffer and therefore COOP/COEP, carries a ~50 MB initial download (third-party
reported; the vendor publishes no figure), and its own demo disables itself on mobile. The
JS-only paths are worse: mammoth.js does not render headers or footers at all, and the
html2canvas route rasterises text so the resulting PDF has no selectable or searchable content.
No credible free client-side pptx→PDF path was found. Only xlsx is solved, via SheetJS.

**Reversed if.** A WASM layout engine appears that is small enough to lazy-load and does not need
cross-origin isolation.

---

## D6 — Editorial monochrome, one accent

**Evidence.** The product's subject is the user's document, so interface colour competes with the
content it is supposed to display. Warm paper and ink carry the whole UI; a single accent exists
and is spent entirely on the network-zero badge, because that badge is the product's argument.

Practical consequence: adding a second accent for a "primary action" would dilute the only signal
that matters. Emphasis comes from scale and weight instead.
