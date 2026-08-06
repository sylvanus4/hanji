/**
 * HWP / HWPX / HML rendering, via the rhwp WASM engine.
 *
 * The engine has no access to browser fonts, so it calls back out to
 * `globalThis.measureTextWidth` for every glyph it cannot satisfy from its own
 * embedded metrics, and uses the answer to decide line breaks and justification.
 * Omitting that global does not throw — it silently degrades layout, which is
 * how we spent a day blaming rhwp for clipped columns. See installMeasureBridge.
 */

import type { FormatHandler, RenderContext } from "./registry";
import { loadKoreanFallbackFonts } from "./hwp-fonts";

/**
 * Text-measurement bridge required by the engine, per @rhwp/core's README.
 *
 * Must be installed *before* WASM init, not merely before first render: the
 * engine captures the binding during initialisation.
 *
 * The canvas and its font string are cached because this is called once per
 * distinct glyph per font — thousands of times for a dense page — and assigning
 * `ctx.font` forces a font re-resolve even when the value is unchanged.
 */
function installMeasureBridge(): void {
  if ("measureTextWidth" in globalThis) return;

  let ctx: CanvasRenderingContext2D | null = null;
  let lastFont = "";

  Object.defineProperty(globalThis, "measureTextWidth", {
    value: (font: string, text: string): number => {
      if (!ctx) {
        ctx = document.createElement("canvas").getContext("2d");
        if (!ctx) return 0;
      }
      if (font !== lastFont) {
        ctx.font = font;
        lastFont = font;
      }
      return ctx.measureText(text).width;
    },
    writable: false,
    configurable: false,
  });
}

let ready: Promise<typeof import("@rhwp/core")> | null = null;

/** Load and initialise the WASM engine exactly once per session. */
function engine(): Promise<typeof import("@rhwp/core")> {
  if (!ready) {
    ready = (async () => {
      installMeasureBridge();
      // Fonts before init, not merely before render: the engine measures during
      // layout, and a face that arrives later cannot retroactively fix a line
      // break that was already decided against the substituted metrics.
      const [mod] = await Promise.all([
        import("@rhwp/core"),
        loadKoreanFallbackFonts(),
      ]);
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
