/**
 * HWP / HWPX / HML rendering, via the rhwp WASM engine.
 *
 * Known fidelity caveat, measured 2026-08-06 against a real Korean civil-service
 * exam paper: the WASM build (verified identical on 0.7.19 and 0.8.2) clips the
 * right-hand column of a two-column layout and overlaps boxed passages, while the
 * native rhwp CLI at v0.7.2 renders the same file correctly. Because both WASM
 * versions are pixel-identical to each other, this looks like a divergence
 * between the CLI and WASM render paths rather than a version regression, but
 * that is not yet confirmed. Until it is, multi-column documents must be treated
 * as approximate and the UI says so. See docs/DECISIONS.md.
 */

import type { FormatHandler, RenderContext } from "./registry";

let ready: Promise<typeof import("@rhwp/core")> | null = null;

/** Load and initialise the WASM engine exactly once per session. */
function engine(): Promise<typeof import("@rhwp/core")> {
  if (!ready) {
    ready = (async () => {
      const mod = await import("@rhwp/core");
      await mod.default();
      return mod;
    })();
  }
  return ready;
}

async function render(file: File, ctx: RenderContext): Promise<void> {
  ctx.report("Loading the Hangul engine…");
  const rhwp = await engine();

  ctx.report("Reading the document…");
  const bytes = new Uint8Array(await file.arrayBuffer());

  const started = performance.now();
  const doc = new rhwp.HwpDocument(bytes);
  const parseMs = Math.round(performance.now() - started);

  const pages = doc.pageCount();
  ctx.report(`${pages} page${pages === 1 ? "" : "s"}, parsed in ${parseMs} ms`);

  for (let i = 0; i < pages; i += 1) {
    const svg = doc.renderPageSvg(i);
    // The SVG is injected as a blob-backed <img> rather than inline markup so it
    // cannot execute script or reach outside the document if a file is hostile.
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const img = new Image();
    img.className = "page";
    img.alt = `Page ${i + 1}`;
    img.decoding = "async";
    img.src = URL.createObjectURL(blob);
    img.addEventListener("load", () => URL.revokeObjectURL(img.src), {
      once: true,
    });
    ctx.host.append(img);
    // Yield so a long document paints progressively instead of freezing the tab.
    await new Promise((r) => setTimeout(r, 0));
  }

  doc.free();
}

export const handler: FormatHandler = { label: "Hangul document", render };
