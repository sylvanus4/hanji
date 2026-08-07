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
  /**
   * What the user typed into this target's field, if it declared one. Empty
   * string when the field exists but was left blank; undefined when the target
   * has no field at all.
   */
  value?: string;
}

/**
 * A field a target needs before it can run.
 *
 * Only one target so far wants this: keeping a page range out of a PDF needs to
 * know which pages, and there is no sane default to guess. It is deliberately a
 * single free-text box rather than a page-picker UI. A picker means rendering
 * every page as a selectable thumbnail, which is a large surface for something
 * people can express in six characters.
 */
export interface TargetInput {
  /** Shown inside the empty field, as an example rather than an instruction. */
  placeholder: string;
  /** Accessible name; the field has no visible label next to it. */
  label: string;
  /** Message shown if the button is pressed with the field empty. */
  required: string;
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
  /**
   * Targets sharing a group render together under one heading.
   *
   * This exists because the GIF presets arrived: ten sibling buttons that are
   * all the same conversion at different settings. Left in the main row they
   * would drown the two or three targets that are genuinely different formats,
   * and their notes would turn the footnote under the bar into a paragraph. A
   * grouped target's note stays on the chip, where it is read at the moment
   * someone is choosing between chips.
   */
  group?: string;
  input?: TargetInput;
  run: (ctx: ConversionContext) => Promise<ConvertedFile>;
}

/** Strip the extension so converted files inherit the original's name. */
export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? fileName : fileName.slice(0, dot);
}
