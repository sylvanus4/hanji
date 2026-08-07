/**
 * Image rendering.
 *
 * Anything the browser can decode natively costs us zero bytes of dependency, so
 * this module deliberately stays dependency-free. HEIC is the one common format
 * no browser decodes — iPhone photos land here — and it will get a lazily loaded
 * WASM decoder of its own rather than being bolted onto this path.
 */

import type { FormatHandler, RenderContext } from "./registry";
import { baseName, type ConversionTarget } from "../convert/types";
import { canvasToBlob, RASTER_EXT, type RasterType } from "../convert/raster";
import { extensionOf } from "./registry";
import { S, t } from "../i18n";

async function render(file: File, ctx: RenderContext): Promise<void> {
  ctx.report(t(S.decoding));
  const url = URL.createObjectURL(file);

  try {
    const started = performance.now();
    const img = new Image();
    img.className = "page";
    img.alt = file.name;
    img.decoding = "async";
    img.src = url;
    await img.decode();

    const ms = Math.round(performance.now() - started);
    ctx.report(t(S.imageDecoded)(img.naturalWidth, img.naturalHeight, ms));
    ctx.host.append(img);
  } finally {
    // Revoked on the next frame so the decoded bitmap is already attached.
    requestAnimationFrame(() => URL.revokeObjectURL(url));
  }
}

/**
 * Decode to a canvas so the browser's own encoders can re-emit it.
 *
 * SVG is the interesting case: it decodes at its intrinsic size, so converting
 * a vector file to PNG produces whatever the document declares rather than an
 * arbitrary raster size.
 */
async function toCanvas(file: File, type: RasterType): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(t(S.noCanvas));

    // Formats without alpha would otherwise render transparency as black.
    if (type !== "image/png") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function conversions(file: File): ConversionTarget[] {
  const stem = baseName(file.name);
  const ext = extensionOf(file.name);

  const targets: [RasterType, string][] = [
    ["image/png", "PNG"],
    ["image/jpeg", "JPEG"],
    ["image/webp", "WebP"],
  ];

  return targets
    // Offering "PNG" while viewing a PNG is noise.
    .filter(([type]) => RASTER_EXT[type] !== ext && !(type === "image/jpeg" && ext === "jpeg"))
    .map(([type, label]) => ({
      id: RASTER_EXT[type],
      label,
      run: async ({ report }) => {
        report(t(S.encodingAs)(label));
        const canvas = await toCanvas(file, type);
        const blob = await canvasToBlob(canvas, type);
        canvas.width = 0;
        canvas.height = 0;
        return { name: `${stem}.${RASTER_EXT[type]}`, blob };
      },
    }));
}

export const handler: FormatHandler = { label: "Image", render, conversions };
