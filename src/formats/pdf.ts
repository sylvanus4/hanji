/**
 * PDF rendering via pdf.js.
 *
 * pdf.js ships its parser in a worker; the worker file is bundled locally rather
 * than pulled from a CDN because a CDN fetch would be a cross-origin request, and
 * the network-zero badge would (correctly) light up red. Everything this app
 * needs must live on our own origin.
 */

import type { FormatHandler, RenderContext } from "./registry";

/** Cap the raster width so a 200-page document does not exhaust mobile memory. */
const MAX_RASTER_WIDTH = 1400;

async function render(file: File, ctx: RenderContext): Promise<void> {
  ctx.report("Loading the PDF engine…");
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (
    await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
  ).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  ctx.report("Reading the document…");
  const data = new Uint8Array(await file.arrayBuffer());

  const started = performance.now();
  const doc = await pdfjs.getDocument({ data }).promise;
  const parseMs = Math.round(performance.now() - started);

  ctx.report(
    `${doc.numPages} page${doc.numPages === 1 ? "" : "s"}, opened in ${parseMs} ms`,
  );

  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const fit = Math.min(MAX_RASTER_WIDTH / base.width, 2);
    const viewport = page.getViewport({ scale: fit * dpr });

    const canvas = document.createElement("canvas");
    canvas.className = "page";
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${Math.ceil(viewport.width / dpr)}px`;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `Page ${n}`);

    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser refused a 2D canvas context.");

    ctx.host.append(canvas);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    page.cleanup();
  }
}

export const handler: FormatHandler = { label: "PDF", render };
