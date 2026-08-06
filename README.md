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

## Known limitation, stated up front

The Hangul engine's WASM build clips the right-hand column of two-column layouts and overlaps
boxed passages. The native rhwp CLI renders the same file correctly, and the defect is identical
on rhwp 0.7.19 and 0.8.2, which points at a CLI/WASM render-path divergence rather than a version
regression. **Multi-column Hangul documents are approximate right now.** Details and the
reproduction are in [docs/DECISIONS.md](docs/DECISIONS.md).

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
