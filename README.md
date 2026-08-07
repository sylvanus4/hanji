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
| Convert | HWP ↔ HWPX ↔ HML · Hangul → PDF / PNG · PDF → PNG / JPEG · image → PNG / JPEG / WebP |
| Edit | not yet |

**HWP → HWPX is the one worth calling out.** Korean public bodies were required from 2026-05-18 to
move to open document formats, and HWPX is the open one. The engine exports it natively, so the
output is a real HWPX package rather than a re-render — and unlike every other converter that does
this, your file never leaves the tab. The test suite converts a document, reopens the result and
checks its page geometry survived.

Multi-page exports arrive as a `.zip`, written by a small store-only ZIP writer. Everything going
in is already-compressed PNG or JPEG, so deflate would cost CPU and save nothing.

PDF export rasterises each page, which means the text in it is not selectable or searchable. The
button says so before you click. A vector path would need Korean fonts embedded in the PDF; that
is a real piece of work and is on the roadmap rather than pretended away.

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
passages out of their column. It reproduces in rhwp's own CLI with no browser involved.

Every published `@rhwp/core` since 0.7.6 has it, so there is no version to pin to. We build the
engine ourselves with a one-file patch — see [vendor/README.md](vendor/README.md) for provenance
and rebuild steps, and [docs/DECISIONS.md](docs/DECISIONS.md) for the bisect and measurements.
Upstream's own test suite passes 2933/2933 with the patch applied.

Both are fixed as of now. `e2e-smoke.py` asserts that no table exceeds the page width, so a
regression fails the build rather than quietly rendering a wrong-looking page.

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

Cloudflare Pages. Build command `npm run build`, output directory `dist`. The `public/_headers`
file carries the CSP and the COOP/COEP configuration.

```bash
npx wrangler pages deploy dist --project-name hanji
```

**Why not GitHub Pages?** Not for the reason you would expect. The app runs fine with no response
headers at all — nothing here uses threads, so cross-origin isolation is irrelevant (measured; see
[docs/DECISIONS.md](docs/DECISIONS.md) D1). It comes down to bandwidth and framing: opening a
Hangul document transfers roughly 6 MB, so a 100 GB/month tier is ~17,000 sessions, and without a
real CSP header we lose `frame-ancestors`, which lets anyone embed this tool inside a page that
claims to upload your file. Cloudflare Pages meters neither and sends both.

## Roadmap

- [x] Viewer: HWP/HWPX, PDF, images
- [x] Network-zero badge with a test that enforces it
- [x] Convert: HWP ↔ HWPX ↔ HML, Hangul → PDF/PNG, PDF → image, image → image
- [ ] HEIC → JPEG (iPhone photos; needs a lazily-loaded decoder, no browser ships one)
- [ ] Vector PDF export, so exported text stays selectable
- [ ] Edit: PDF merge/split/rotate/reorder, Hangul text edits with re-save
- [ ] Fidelity corpus of real Hangul documents — no baseline exists for this ecosystem
- [ ] PWA / full offline

Out of scope for v1: Office (docx/pptx) conversion, which has no clean client-side path; video and
audio, pending a real measurement of ffmpeg.wasm's cost.

## Language

Korean by default, with an English toggle in the header. The default is
unconditional rather than sniffed from `navigator.language`: this tool exists for
Korean documents, and someone arriving with an English-locale browser is more
likely to be a Korean user on an English machine than an English speaker holding
an HWP file. Guessing wrong in that direction hides the product from the people
it was built for. The choice persists, and switching re-opens the current
document rather than reloading the page.

## Accessibility

Keyboard order is Open → each conversion → the file input, every control is a real `<button>` with
a visible focus ring, the status line is an `aria-live` region, and focus returns to the button you
pressed after a conversion finishes rather than being dropped on `<body>`. Motion respects
`prefers-reduced-motion`; both light and dark themes are deliberate rather than inverted.

## License

MIT. Built on [rhwp](https://github.com/edwardkim/rhwp) (MIT), [pdf.js](https://github.com/mozilla/pdf.js)
and [pdf-lib](https://github.com/Hopding/pdf-lib).
