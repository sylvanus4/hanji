/**
 * Types for `gifenc`, which ships none.
 *
 * Declared properly rather than cast away at the call site. A local
 * `as unknown as SomeShape` looks equivalent but is not: it silences the error
 * without describing the module, so the next person to call a different export
 * gets `any` back and never knows. This file is the description, and it is short
 * enough that keeping it honest is cheap.
 *
 * Only the surface this project actually uses is declared. If a future call
 * needs `prequantize` or `snapColorsToPalette`, add it here with its real
 * signature instead of widening anything.
 */
declare module "gifenc" {
  /** A palette entry is [r, g, b] or [r, g, b, a], 0-255 per channel. */
  export type GifPalette = number[][];

  export interface GifFrameOptions {
    palette: GifPalette;
    /** Frame duration in milliseconds. */
    delay?: number;
    transparent?: boolean;
    transparentIndex?: number;
    /** 0 means "loop forever"; only read from the first frame. */
    repeat?: number;
  }

  export interface GifEncoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: GifFrameOptions,
    ): void;
    finish(): void;
    /** A view over the encoder's own buffer, not a copy. */
    bytesView(): Uint8Array;
    bytes(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(options?: { auto?: boolean }): GifEncoder;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: "rgb565" | "rgb444" | "rgba4444"; oneBitAlpha?: boolean },
  ): GifPalette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: "rgb565" | "rgb444" | "rgba4444",
  ): Uint8Array;
}
