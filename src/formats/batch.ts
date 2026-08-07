/**
 * Several files opened together.
 *
 * The single-document path answers "what is in this file". This one answers a
 * different question: "make one thing out of these". Merging a stack of PDFs and
 * turning a burst of photos into a GIF are the same shape of task, and both are
 * things people currently do by uploading the lot to a website.
 *
 * Order is taken from the filenames, not from the drop. A multi-file drag hands
 * over an order the operating system decided, which is not stable across
 * platforms and is invisible to the person doing the dragging. Sorting by name
 * is at least a rule they can see and control, so every batch target says so in
 * its note rather than letting them discover it from a scrambled result.
 */

import type { RenderContext } from "./registry";
import { extensionOf } from "./registry";
import { baseName, type ConversionTarget } from "../convert/types";
import { S, t } from "../i18n";
import { makeZip } from "../convert/zip";

const IMAGE_EXT = new Set([
  "png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "avif",
]);

/** Half a second reads as a slideshow rather than a flicker. */
const PHOTO_GIF_DELAY_MS = 500;
const PHOTO_GIF_MAX_EDGE = 900;

/** CSS pixels are 96 to the inch, PDF points are 72, so a page is 0.75× the image. */
const PX_TO_PT = 0.75;

export type BatchKind = "image" | "pdf";

export interface BatchHandler {
  kind: BatchKind;
  render: (files: File[], ctx: RenderContext) => Promise<void>;
  conversions: (files: File[]) => ConversionTarget[];
}

export class MixedBatchError extends Error {
  constructor() {
    super("A batch must be all images or all PDFs.");
    this.name = "MixedBatchError";
  }

  describe(): string {
    return t(S.batchMixed);
  }
}

/**
 * Numeric collation, so `10.jpg` sorts after `9.jpg`.
 *
 * Plain lexicographic order puts it second, which silently scrambles any
 * sequence a person numbered by hand. That is precisely the case this feature
 * exists for.
 */
export function inNameOrder(files: File[]): File[] {
  return [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  );
}

export function classify(files: File[]): BatchKind {
  const kinds = new Set(
    files.map((f) => (IMAGE_EXT.has(extensionOf(f.name)) ? "image" : extensionOf(f.name))),
  );
  if (kinds.size === 1 && kinds.has("image")) return "image";
  if (kinds.size === 1 && kinds.has("pdf")) return "pdf";
  throw new MixedBatchError();
}

/** The house decode path: an <img> handles SVG, which createImageBitmap does not. */
async function decode(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // Held until the next frame so the decoded bitmap is not dropped mid-draw.
    requestAnimationFrame(() => URL.revokeObjectURL(url));
  }
}

async function renderImages(files: File[], ctx: RenderContext): Promise<void> {
  ctx.report(t(S.decoding));
  const strip = document.createElement("div");
  strip.className = "batch-strip";
  ctx.host.append(strip);

  for (const [index, file] of files.entries()) {
    const img = new Image();
    img.className = "batch-thumb";
    // The index is shown because the order is the whole contract of a batch,
    // and a grid of pictures otherwise gives no way to check it.
    img.alt = `${index + 1}. ${file.name}`;
    img.title = img.alt;
    img.decoding = "async";
    img.src = URL.createObjectURL(file);
    img.addEventListener("load", () => URL.revokeObjectURL(img.src), { once: true });
    strip.append(img);
  }

  ctx.report(t(S.batchOpened)(files.length, t(S.batchKindImage)));
}

async function renderPdfs(files: File[], ctx: RenderContext): Promise<void> {
  const list = document.createElement("ol");
  list.className = "batch-list";
  for (const file of files) {
    const item = document.createElement("li");
    item.textContent = file.name;
    list.append(item);
  }
  ctx.host.append(list);
  ctx.report(t(S.batchOpened)(files.length, t(S.batchKindPdf)));
}

function imageTargets(files: File[]): ConversionTarget[] {
  const ordered = inNameOrder(files);
  const stem = baseName(ordered[0]?.name ?? "images");

  return [
    {
      id: "gif",
      label: t(S.labelImagesToGif),
      note: `${t(S.noteImagesToGif)}. ${t(S.batchOrder)}`,
      run: async ({ report }) => {
        const bitmaps: ImageBitmap[] = [];
        try {
          for (const [i, file] of ordered.entries()) {
            report(t(S.extractingFrame)(i + 1, ordered.length));
            const img = await decode(file);
            bitmaps.push(await createImageBitmap(img));
          }
          report(t(S.encodingAs)("GIF"));
          const { encodeGif } = await import("../convert/gif");
          const blob = await encodeGif(bitmaps, {
            delayMs: PHOTO_GIF_DELAY_MS,
            maxEdge: PHOTO_GIF_MAX_EDGE,
          });
          return { name: `${stem}.gif`, blob };
        } finally {
          for (const bitmap of bitmaps) bitmap.close();
        }
      },
    },
    {
      id: "pdf",
      label: t(S.labelImagesToPdf),
      note: `${t(S.noteImagesToPdf)}. ${t(S.batchOrder)}`,
      run: async ({ report }) => {
        const { PDFDocument } = await import("pdf-lib");
        const pdf = await PDFDocument.create();

        for (const [i, file] of ordered.entries()) {
          report(t(S.renderingPage)(i + 1, ordered.length));
          const img = await decode(file);

          // Re-encoded to PNG rather than embedded as-is: pdf-lib only embeds
          // PNG and JPEG, and the batch may contain WebP, BMP or SVG. Going
          // through a canvas normalises all of them in one step.
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const context = canvas.getContext("2d");
          if (!context) throw new Error(t(S.noCanvas));
          context.drawImage(img, 0, 0);
          const { canvasToBlob } = await import("../convert/raster");
          const png = await canvasToBlob(canvas, "image/png");
          canvas.width = 0;
          canvas.height = 0;

          const embedded = await pdf.embedPng(
            new Uint8Array(await png.arrayBuffer()),
          );
          const width = img.naturalWidth * PX_TO_PT;
          const height = img.naturalHeight * PX_TO_PT;
          pdf.addPage([width, height]).drawImage(embedded, {
            x: 0,
            y: 0,
            width,
            height,
          });
        }

        const saved = await pdf.save();
        return {
          name: `${stem}.pdf`,
          blob: new Blob([saved as Uint8Array<ArrayBuffer>], {
            type: "application/pdf",
          }),
        };
      },
    },
  ];
}

function pdfTargets(files: File[]): ConversionTarget[] {
  const ordered = inNameOrder(files);
  const stem = baseName(ordered[0]?.name ?? "merged");

  return [
    {
      id: "merge",
      label: t(S.labelMergePdf),
      note: t(S.noteMergePdf),
      run: async ({ report }) => {
        const { mergePdfs } = await import("../convert/pdfedit");
        const blob = await mergePdfs(ordered, {
          report: (message) => report(message),
        });
        return { name: `${stem}-merged.pdf`, blob };
      },
    },
    {
      id: "zip",
      label: "ZIP",
      note: t(S.batchOrder),
      run: async () => {
        const zip = await makeZip(
          ordered.map((file) => ({ name: file.name, blob: file })),
        );
        return { name: `${stem}-files.zip`, blob: zip };
      },
    },
  ];
}

export function resolveBatch(files: File[]): BatchHandler {
  const kind = classify(files);
  return kind === "image"
    ? { kind, render: renderImages, conversions: imageTargets }
    : { kind, render: renderPdfs, conversions: pdfTargets };
}
