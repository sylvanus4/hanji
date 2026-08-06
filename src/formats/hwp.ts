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
import { baseName, type ConversionTarget } from "../convert/types";
import { makeZip } from "../convert/zip";
import {
  canvasToBlob,
  PAGE_SCALE,
  pageLabel,
  pdfFromPageImages,
} from "../convert/raster";
import { extensionOf } from "./registry";

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

/**
 * Open the document again for a conversion.
 *
 * Re-parsing rather than holding the viewer's instance open costs ~50 ms and
 * removes a whole class of lifetime bug: the viewer is free to `free()` its
 * document whenever it likes, and a conversion can never operate on one that
 * has already been released.
 */
async function withDocument<T>(
  file: File,
  work: (doc: InstanceType<typeof import("@rhwp/core").HwpDocument>) => Promise<T> | T,
): Promise<T> {
  const rhwp = await engine();
  const doc = new rhwp.HwpDocument(new Uint8Array(await file.arrayBuffer()));
  try {
    return await work(doc);
  } finally {
    doc.free();
  }
}

/** Render every page to a canvas and hand back PNG bytes plus dimensions. */
async function rasterisePages(
  file: File,
  report: (message: string) => void,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; width: number; height: number }[]> {
  return withDocument(file, async (doc) => {
    const total = doc.pageCount();
    const out: {
      bytes: Uint8Array<ArrayBuffer>;
      width: number;
      height: number;
    }[] = [];

    for (let i = 0; i < total; i += 1) {
      report(`Rendering page ${i + 1} of ${total}…`);
      const canvas = document.createElement("canvas");
      doc.renderPageToCanvas(i, canvas, PAGE_SCALE);
      const blob = await canvasToBlob(canvas, "image/png");
      out.push({
        bytes: new Uint8Array(await blob.arrayBuffer()),
        width: canvas.width,
        height: canvas.height,
      });
      // Release the backing store immediately; a 50-page document at 2× would
      // otherwise hold every page's bitmap at once.
      canvas.width = 0;
      canvas.height = 0;
      await new Promise((r) => setTimeout(r, 0));
    }

    return out;
  });
}

function conversions(file: File): ConversionTarget[] {
  const stem = baseName(file.name);
  const ext = extensionOf(file.name);
  const targets: ConversionTarget[] = [];

  // Format conversions come first because they are the reason this app exists
  // for Hangul users: Korean public bodies were required from 2026-05-18 to
  // move to open formats, and HWPX is the open one. Every other tool that does
  // this uploads the file.
  if (ext !== "hwpx") {
    targets.push({
      id: "hwpx",
      label: "HWPX",
      note: "the open XML format required for public-sector documents",
      run: async ({ report }) => {
        report("Converting to HWPX…");
        const bytes = await withDocument(file, (doc) => doc.exportHwpx());
        return {
          name: `${stem}.hwpx`,
          blob: new Blob([bytes as Uint8Array<ArrayBuffer>], {
            type: "application/hwp+zip",
          }),
        };
      },
    });
  }

  if (ext !== "hwp") {
    targets.push({
      id: "hwp",
      label: "HWP",
      run: async ({ report }) => {
        report("Converting to HWP…");
        const bytes = await withDocument(file, (doc) => doc.exportHwp());
        return {
          name: `${stem}.hwp`,
          blob: new Blob([bytes as Uint8Array<ArrayBuffer>], {
            type: "application/x-hwp",
          }),
        };
      },
    });
  }

  targets.push({
    id: "pdf",
    label: "PDF",
    note: "pages are images, so the text is not selectable or searchable",
    run: async ({ report }) => {
      const pages = await rasterisePages(file, report);
      report("Assembling the PDF…");
      return { name: `${stem}.pdf`, blob: await pdfFromPageImages(pages) };
    },
  });

  targets.push({
    id: "png",
    label: "PNG pages",
    note: "one image per page, delivered as a .zip",
    run: async ({ report }) => {
      const pages = await rasterisePages(file, report);
      report("Building the archive…");
      const zip = await makeZip(
        pages.map((page, i) => ({
          name: `${stem}-${pageLabel(i + 1, pages.length)}.png`,
          blob: new Blob([page.bytes], { type: "image/png" }),
        })),
      );
      return { name: `${stem}-pages.zip`, blob: zip };
    },
  });

  return targets;
}

export const handler: FormatHandler = {
  label: "Hangul document",
  render,
  conversions,
};
