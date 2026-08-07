/**
 * GIF only supports one canvas size for the whole animation and a single
 * shared palette of at most two hundred fifty six colours per frame. Real
 * capture sources rarely agree with either constraint: a burst of photos can
 * vary in resolution from shot to shot, and any photo on its own already has
 * millions of distinct colours. This module exists to absorb that mismatch
 * in one place, normalising every frame onto a single canvas sized from the
 * first frame, letterboxing anything that does not match its aspect ratio
 * instead of stretching it, and letting gifenc quantise each frame down to
 * a palette the format can actually store. Some banding on photographic
 * content is the cost of the format, not a defect in this code.
 */

export interface GifOptions {
  /** Milliseconds each frame is shown. */
  delayMs: number;
  /** Longest edge in pixels; frames are scaled down to fit. 0 disables scaling. */
  maxEdge?: number;
  /** Progress text for the status line. Called as report(doneCount, total). */
  report?: (done: number, total: number) => void;
}

const DEFAULT_MAX_EDGE = 800;
const PALETTE_FORMAT = "rgb565";
const LETTERBOX_FILL = "#000000";

/**
 * Encode a sequence of already-decoded images into an animated GIF.
 * Sources may be different sizes; the output is sized from the first frame and
 * later frames are letterboxed to fit it (GIF has one canvas size for all frames).
 */
export async function encodeGif(
  sources: ImageBitmap[],
  options: GifOptions,
): Promise<Blob> {
  // Destructured up front so the compiler carries the non-undefined type
  // through the size calculation below; tsconfig has noUncheckedIndexedAccess,
  // and an empty sequence is a caller bug rather than something to paper over.
  const [first] = sources;
  if (!first) {
    throw new Error("encodeGif requires at least one source image.");
  }

  const { GIFEncoder, quantize, applyPalette } = await import("gifenc");

  const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE;
  const longestEdge = Math.max(first.width, first.height);
  const scale =
    maxEdge > 0 && longestEdge > maxEdge ? maxEdge / longestEdge : 1;
  const canvasWidth = Math.max(1, Math.round(first.width * scale));
  const canvasHeight = Math.max(1, Math.round(first.height * scale));

  // One canvas is reused for every frame, drawn into and read back before the
  // next frame overwrites it, so a sixty image GIF never holds more than one
  // full resolution bitmap's worth of pixel data at a time.
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to acquire a 2D canvas context for GIF encoding.");
  }

  const gif = GIFEncoder();
  const total = sources.length;

  // Iterated by value rather than by index: noUncheckedIndexedAccess widens
  // sources[i] to include undefined, and a `!` here would be asserting away the
  // one thing the compiler is actually right about.
  let done = 0;
  for (const source of sources) {
    // A frame that does not share the first frame's aspect ratio gets
    // centred on a solid background rather than stretched, since stretching
    // would visibly distort the image just to satisfy the format's single
    // canvas size.
    ctx.fillStyle = LETTERBOX_FILL;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    const fitScale = Math.min(
      canvasWidth / source.width,
      canvasHeight / source.height,
    );
    const drawWidth = source.width * fitScale;
    const drawHeight = source.height * fitScale;
    const dx = (canvasWidth - drawWidth) / 2;
    const dy = (canvasHeight - drawHeight) / 2;
    ctx.drawImage(source, dx, dy, drawWidth, drawHeight);

    const { data } = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    const palette = quantize(data, 256, { format: PALETTE_FORMAT });
    const index = applyPalette(data, palette, PALETTE_FORMAT);
    gif.writeFrame(index, canvasWidth, canvasHeight, {
      palette,
      delay: options.delayMs,
      transparent: false,
    });

    done += 1;
    options.report?.(done, total);

    // Yielding here keeps the tab responsive while a long sequence encodes,
    // instead of blocking the main thread for the whole run.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  gif.finish();

  // bytesView exposes a view over gifenc's own internal buffer, and that
  // view's underlying ArrayBufferLike is not guaranteed to satisfy this
  // project's stricter BlobPart typing, so it is copied into a fresh, plain
  // ArrayBuffer before it is handed to Blob.
  const bytes = new Uint8Array(gif.bytesView());
  return new Blob([bytes], { type: "image/gif" });
}
