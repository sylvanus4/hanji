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

## D4 — Hangul multi-column rendering is currently approximate

**Evidence, measured 2026-08-06** against a real 2-page Korean civil-service exam paper
(`행정학개론(지방행정 포함)(지방9급)-D.hwp`):

| Path | Result |
|---|---|
| rhwp CLI v0.7.2 (native Rust) | Correct. Two-column layout, boxed passages and circled numerals all intact. Page number left blank. |
| `@rhwp/core` 0.7.19 (WASM) | Right-hand column clipped at the page edge; boxed passages overlap body text. Page number correctly filled. |
| `@rhwp/core` 0.8.2 (WASM) | Byte-for-byte the same defect as 0.7.19. |

Because the two WASM versions are pixel-identical to one another and only the CLI differs, this
looks like a divergence between the CLI and WASM render paths rather than a version regression.
That is **not yet confirmed** — the CLI is v0.7.2 while the npm builds start at 0.7.11, so a
regression introduced in between cannot be ruled out without building the CLI at a matching tag.

rhwp's own README declines to treat Hancom's PDF output as ground truth, so no fidelity baseline
exists for this ecosystem at all. Establishing one is on the roadmap and is arguably worth more
to users than the viewer itself.

**Action.** Build the CLI at the latest tag, render the same file, isolate the cause, and file an
upstream issue with the reproduction. Until then the README and the UI say multi-column output is
approximate rather than pretending otherwise.

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
