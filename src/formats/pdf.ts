/**
 * PDF rendering via pdf.js.
 *
 * pdf.js ships its parser in a worker; the worker file is bundled locally rather
 * than pulled from a CDN because a CDN fetch would be a cross-origin request, and
 * the network-zero badge would (correctly) light up red. Everything this app
 * needs must live on our own origin.
 */

import type { FormatHandler, RenderContext } from "./registry";
import { baseName, type ConversionTarget } from "../convert/types";
import { S, t } from "../i18n";
import { makeZip } from "../convert/zip";
import {
  canvasToBlob,
  PAGE_SCALE,
  pageLabel,
  RASTER_EXT,
  type RasterType,
} from "../convert/raster";

/** Cap the raster width so a 200-page document does not exhaust mobile memory. */
const MAX_RASTER_WIDTH = 1400;

let ready: Promise<typeof import("pdfjs-dist")> | null = null;

/** Load pdf.js and point it at our own worker, exactly once per session. */
function loadEngine(): Promise<typeof import("pdfjs-dist")> {
  if (!ready) {
    ready = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const workerUrl = (
        await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
      ).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return ready;
}

/**
 * Start loading a PDF, with the surfaces we do not want left off.
 *
 * Every document opened here is untrusted by definition — the premise of the
 * app is that people bring files other people sent them — so the engine's
 * defaults deserve a second look rather than a shrug.
 *
 * `enableXfa` is off. XFA is effectively a second document format layered on
 * PDF, an XML application that Adobe itself deprecated, and it is a large
 * amount of parser to expose for a feature nobody here has asked for. It is
 * already the default, which is exactly why it is written down: a default that
 * flips in some future release would widen that surface in silence.
 *
 * There used to be an `isEvalSupported: false` alongside it, to stop pdf.js
 * compiling embedded font programs through `eval`. pdf.js 6 removed the option
 * because it removed the eval path, so passing it now would be a comforting
 * no-op — and a reader would reasonably assume a defence was in place that the
 * library no longer needs.
 *
 * None of this replaces keeping the engine current. Releases 5.6.83 through
 * 6.2.107 carried an arbitrary-JavaScript-execution flaw reachable by opening a
 * crafted file (GHSA-hq66-cqwq-w95j), and no option on this call would have
 * blunted it. The dependency audit that caught it runs in CI for that reason.
 *
 * @returns the loading task, not the document. Callers that finish with a
 * document must `destroy()` the task to shut down its worker; in pdf.js 6 that
 * method lives here rather than on the document proxy.
 */
function openDocument(
  pdfjs: Awaited<ReturnType<typeof loadEngine>>,
  data: Uint8Array,
) {
  return pdfjs.getDocument({ data, enableXfa: false });
}

async function render(file: File, ctx: RenderContext): Promise<void> {
  ctx.report(t(S.loadingPdfEngine));
  const pdfjs = await loadEngine();

  ctx.report(t(S.readingDocument));
  const data = new Uint8Array(await file.arrayBuffer());

  const started = performance.now();
  const doc = await openDocument(pdfjs, data).promise;
  const parseMs = Math.round(performance.now() - started);

  ctx.report(t(S.pagesOpened)(doc.numPages, parseMs));

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
    canvas.setAttribute("aria-label", t(S.pageAria)(n));

    const context = canvas.getContext("2d");
    if (!context) throw new Error(t(S.noCanvas));

    ctx.host.append(canvas);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    page.cleanup();
  }
}

/** Rasterise every page at `PAGE_SCALE`, independent of the on-screen render. */
async function rasterisePages(
  file: File,
  type: RasterType,
  report: (message: string) => void,
): Promise<Blob[]> {
  const pdfjs = await loadEngine();
  const task = openDocument(pdfjs, new Uint8Array(await file.arrayBuffer()));
  const doc = await task.promise;

  const out: Blob[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n += 1) {
      report(t(S.renderingPage)(n, doc.numPages));
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: PAGE_SCALE });

      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error(t(S.noCanvas));

      // JPEG has no alpha, so an untouched canvas would export as black.
      if (type === "image/jpeg") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }

      await page.render({ canvas, canvasContext: context, viewport }).promise;
      out.push(await canvasToBlob(canvas, type));
      page.cleanup();
      canvas.width = 0;
      canvas.height = 0;
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    // The loading task, not the document: pdf.js 6 moved teardown here, and it
    // is what actually stops the worker rather than just dropping caches.
    await task.destroy();
  }
  return out;
}

function conversions(file: File): ConversionTarget[] {
  const stem = baseName(file.name);

  const pageArchive = (type: RasterType, label: string): ConversionTarget => ({
    id: RASTER_EXT[type],
    label,
    note: t(S.noteZip),
    run: async ({ report }) => {
      const pages = await rasterisePages(file, type, report);
      report(t(S.buildingArchive));
      const zip = await makeZip(
        pages.map((blob, i) => ({
          name: `${stem}-${pageLabel(i + 1, pages.length)}.${RASTER_EXT[type]}`,
          blob,
        })),
      );
      return { name: `${stem}-pages.zip`, blob: zip };
    },
  });

  // Editing targets come first. Splitting or rotating keeps the document a real
  // PDF with selectable text, while the raster exports below throw that away, so
  // the lossless operations should be the ones a user reaches first.
  const editing: ConversionTarget[] = [
    {
      id: "split",
      label: t(S.labelSplitPages),
      note: t(S.noteSplitPages),
      run: async ({ report }) => {
        const { splitPdfPages } = await import("../convert/pdfedit");
        const parts = await splitPdfPages(file, { report });
        report(t(S.buildingArchive));
        return {
          name: `${stem}-pages.zip`,
          blob: await makeZip(parts),
        };
      },
    },
    {
      id: "rotate",
      label: t(S.labelRotate)(90),
      note: t(S.noteRotate),
      run: async () => {
        const { rotatePdf } = await import("../convert/pdfedit");
        return { name: `${stem}-rotated.pdf`, blob: await rotatePdf(file, 1) };
      },
    },
    {
      id: "extract",
      label: t(S.labelExtractPages),
      note: t(S.noteExtractPages),
      input: {
        placeholder: t(S.pageSpecPlaceholder),
        label: t(S.pageSpecLabel),
        required: t(S.pageSpecEmpty),
      },
      run: async ({ value }) => {
        const { extractPages } = await import("../convert/pdfedit");
        return {
          name: `${stem}-p${(value ?? "").replace(/[^0-9]+/g, "-")}.pdf`,
          blob: await extractPages(file, value ?? ""),
        };
      },
    },
  ];

  return [
    ...editing,
    pageArchive("image/png", t(S.labelPngPages)),
    pageArchive("image/jpeg", t(S.labelJpegPages)),
  ];
}

export const handler: FormatHandler = { label: "PDF", render, conversions };
