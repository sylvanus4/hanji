/**
 * The conversion contract.
 *
 * A target describes one thing a user can turn the open document into. Targets
 * are declared per format handler and produced lazily — building the list must
 * be cheap, because it happens on every open, while `run` may be expensive and
 * is only called when someone actually clicks.
 */

export interface ConvertedFile {
  name: string;
  blob: Blob;
}

export interface ConversionContext {
  /** Progress text; conversions of large documents are not instant. */
  report: (message: string) => void;
}

export interface ConversionTarget {
  /** Stable id, used for test hooks and DOM ids. */
  id: string;
  /** Button label. Short — this sits in a row of buttons. */
  label: string;
  /**
   * A caveat the user should read *before* clicking, not after. Rasterised PDF
   * loses selectable text; that is the kind of thing that belongs here.
   */
  note?: string;
  run: (ctx: ConversionContext) => Promise<ConvertedFile>;
}

/** Strip the extension so converted files inherit the original's name. */
export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? fileName : fileName.slice(0, dot);
}
