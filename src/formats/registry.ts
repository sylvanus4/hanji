/**
 * Format registry.
 *
 * Every heavy dependency in this app is behind a dynamic import that only fires
 * once a file of that kind is actually dropped. The HWP engine alone is ~7 MB of
 * WASM; eagerly loading it would make a user who only wanted to rotate a PDF pay
 * for a Korean word-processor parser. Nothing here is imported at module scope.
 */

import type { ConversionTarget } from "../convert/types";

export interface RenderContext {
  /** Where pages/canvases should be appended. */
  host: HTMLElement;
  /** Progress text for long operations. */
  report: (message: string) => void;
}

export interface FormatHandler {
  /** Human label shown in the UI. */
  label: string;
  render: (file: File, ctx: RenderContext) => Promise<void>;
  /**
   * What this file can be turned into. Building the list must stay cheap — it
   * runs on every open — so the expensive work belongs inside each target's
   * `run`, not here.
   */
  conversions?: (file: File) => ConversionTarget[];
}

type Loader = () => Promise<FormatHandler>;

const byExtension: Record<string, Loader> = {
  hwp: () => import("./hwp").then((m) => m.handler),
  hwpx: () => import("./hwp").then((m) => m.handler),
  hml: () => import("./hwp").then((m) => m.handler),
  pdf: () => import("./pdf").then((m) => m.handler),
  png: () => import("./image").then((m) => m.handler),
  jpg: () => import("./image").then((m) => m.handler),
  jpeg: () => import("./image").then((m) => m.handler),
  webp: () => import("./image").then((m) => m.handler),
  gif: () => import("./image").then((m) => m.handler),
  bmp: () => import("./image").then((m) => m.handler),
  svg: () => import("./image").then((m) => m.handler),
  avif: () => import("./image").then((m) => m.handler),
};

export const supportedExtensions = Object.keys(byExtension);

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export class UnsupportedFormatError extends Error {
  constructor(readonly extension: string) {
    super(
      extension
        ? `.${extension} is not supported yet.`
        : "That file has no extension, so its type could not be determined.",
    );
    this.name = "UnsupportedFormatError";
  }
}

export async function resolveHandler(file: File): Promise<FormatHandler> {
  const ext = extensionOf(file.name);
  const loader = byExtension[ext];
  if (!loader) throw new UnsupportedFormatError(ext);
  return loader();
}
