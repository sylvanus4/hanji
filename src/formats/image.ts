/**
 * Image rendering.
 *
 * Anything the browser can decode natively costs us zero bytes of dependency, so
 * this module deliberately stays dependency-free. HEIC is the one common format
 * no browser decodes — iPhone photos land here — and it will get a lazily loaded
 * WASM decoder of its own rather than being bolted onto this path.
 */

import type { FormatHandler, RenderContext } from "./registry";

async function render(file: File, ctx: RenderContext): Promise<void> {
  ctx.report("Decoding…");
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
    ctx.report(
      `${img.naturalWidth} × ${img.naturalHeight}, decoded in ${ms} ms`,
    );
    ctx.host.append(img);
  } finally {
    // Revoked on the next frame so the decoded bitmap is already attached.
    requestAnimationFrame(() => URL.revokeObjectURL(url));
  }
}

export const handler: FormatHandler = { label: "Image", render };
