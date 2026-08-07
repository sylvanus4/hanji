/**
 * Shared raster helpers for conversion targets.
 *
 * Two ideas live here that every format needs: turn a canvas into a file, and
 * turn a stack of page images into a PDF.
 */

import { S, t } from "../i18n";

/** 2× gives a page that still looks sharp when printed or zoomed once. */
export const PAGE_SCALE = 2;

export type RasterType = "image/png" | "image/jpeg" | "image/webp";

export const RASTER_EXT: Record<RasterType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * `canvas.toBlob` reports failure by handing back null rather than throwing,
 * which is easy to propagate as a confusing "cannot read property" later. Turn
 * it into a real error at the boundary.
 */
export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: RasterType,
  quality = 0.92,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error(t(S.encodeFailed)(type))),
      type,
      quality,
    );
  });
}

/** Zero-pad page numbers so archive entries sort correctly in a file manager. */
export function pageLabel(index: number, total: number): string {
  return String(index).padStart(String(total).length, "0");
}

/**
 * Assemble PNG page images into a single PDF.
 *
 * The result is a picture of the document, not text: nothing in it is
 * selectable or searchable. That is a real downgrade, so every target using
 * this carries a note saying so rather than letting the user discover it after
 * downloading a 40-page file.
 *
 * A vector path exists in principle — the engine emits SVG — but it needs
 * Korean fonts embedded in the PDF, which is a much larger piece of work.
 */
export async function pdfFromPageImages(
  pages: { bytes: Uint8Array<ArrayBuffer>; width: number; height: number }[],
): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();

  for (const page of pages) {
    const image = await pdf.embedPng(page.bytes);
    // Lay the page out at CSS-pixel size rather than raster size, so a 2×
    // raster yields a normal-sized page at double resolution.
    const width = page.width / PAGE_SCALE;
    const height = page.height / PAGE_SCALE;
    const sheet = pdf.addPage([width, height]);
    sheet.drawImage(image, { x: 0, y: 0, width, height });
  }

  const saved = await pdf.save();
  return new Blob([saved as Uint8Array<ArrayBuffer>], {
    type: "application/pdf",
  });
}
