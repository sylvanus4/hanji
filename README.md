# hanji

Open, convert and lightly edit Hangul (HWP/HWPX), PDF and image files **entirely in your browser**.

Every other online converter uploads your file and then promises to delete it. This one has
nothing to delete, because nothing is sent. The app ships a badge that counts outbound requests
in real time so the claim is visible rather than asserted, and the end-to-end test fails the
build if a single foreign request appears.

> Status: early. The viewer works; conversion and editing are being built. See the roadmap below.

## Why

Korean document folders are a mix of HWP, PDF and images, and no single no-upload tool handles
all three. The excellent client-side tools that exist are each single-format: Squoosh for images,
BentoPDF and PDFCraft for PDF, rhwp for Hangul. Meanwhile Korean public bodies were required from
2026-05-18 to move to open document formats (HWPX/ODF/PDF-A), which makes Hangul-format tooling
newly relevant to a lot of people who never thought about it before.

## What works today

| | |
|---|---|
| View | HWP, HWPX, HML, PDF, PNG/JPEG/WebP/GIF/BMP/SVG/AVIF |
| Convert | not yet |
| Edit | not yet |

Measured on a real 2-page Korean civil-service exam paper: HWP parsed in ~50 ms cold, ~5 ms warm.
Initial page weight is under 5 kB gzipped; every engine is a dynamic import that only downloads
when you actually open a file of that kind.

## Hangul fidelity

Two-column Hangul documents used to render badly here. Both causes are now identified.

The first was ours: `@rhwp/core` requires the page to provide a `globalThis.measureTextWidth`
callback, because WASM cannot see browser fonts and needs it to decide line breaks. We had not
installed it, so text was mismeasured and columns overran. Fixed.

The second is an upstream regression, bisected to rhwp commit `10c36e23` (first shipped in
v0.7.6): a block-level table preceded by tabs is displaced by the tab width, pushing boxed
passages out of their column. It reproduces in rhwp's own CLI with no browser involved. We carry a
patch for it and have reported it upstream — see [docs/DECISIONS.md](docs/DECISIONS.md) for the
bisect and the measurements.

We have no Hancom reference renderer, so "correct" here means *matches rhwp before the regression
and stays inside the page*. Building a real fidelity corpus for Hangul documents is on the roadmap.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # typecheck + production build
python3 e2e-smoke.py # headless browser test (needs `npm run preview` on :4173)
```

The dev server sets the same COOP/COEP headers as production so cross-origin-isolation problems
surface locally instead of after deploy.

## Deploy

Cloudflare Pages. Build `npm run build`, output `dist`. The `public/_headers` file carries the
COOP/COEP and CSP configuration.

GitHub Pages **cannot host this correctly** — it provides no way to set response headers at all,
so the page can never become cross-origin isolated and multi-threaded WASM stays unavailable.

## Roadmap

- [x] Viewer: HWP/HWPX, PDF, images
- [x] Network-zero badge with a test that enforces it
- [ ] Fidelity corpus of real Hangul documents, and an upstream issue for the render defect
- [ ] Convert: HWP → PDF/PNG, PDF ↔ image, image ↔ image, HEIC → JPEG
- [ ] Edit: PDF merge/split/rotate/reorder, Hangul text edits with re-save
- [ ] PWA / full offline

Out of scope for v1: Office (docx/pptx) conversion, which has no clean client-side path; video and
audio, pending a real measurement of ffmpeg.wasm's cost.

## License

MIT. Built on [rhwp](https://github.com/edwardkim/rhwp) (MIT), [pdf.js](https://github.com/mozilla/pdf.js)
and [pdf-lib](https://github.com/Hopding/pdf-lib).
