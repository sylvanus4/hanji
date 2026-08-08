/**
 * Sending the open document to a printer.
 *
 * For most of the people this app was built for, print is not a nice extra at
 * the end of the conversion — it *is* the destination. A public-sector document
 * gets opened so it can be signed, stamped, filed or handed to someone, and all
 * four of those happen on paper. Shipping a Hangul viewer without print would
 * mean the last step still had to happen in some other program.
 *
 * Two shells, two mechanisms, and the difference is not cosmetic:
 *
 *   Browser — `window.print()`. The page's own print stylesheet decides what
 *   lands on the sheet, and every engine implements this.
 *
 *   Desktop — a Rust command that calls the webview's native print operation.
 *   `window.print()` is *not* a reliable substitute here: on macOS the WebKit
 *   view only prints if the host application drives NSPrintOperation itself, so
 *   calling it from JavaScript can silently do nothing. A print button that
 *   sometimes does nothing is worse than no print button, because the user
 *   concludes the document is at fault. wry implements the native path on all
 *   three desktop platforms and Tauri exposes it, so we go through Rust.
 *
 * Both paths print what is already rendered on screen. Nothing is re-parsed, no
 * temporary file is written, and — as everywhere else in this app — nothing is
 * uploaded to a print service.
 */

import { isDesktop } from "../platform";

/**
 * How many pages in this view could go on paper.
 *
 * Deliberately a DOM question rather than a per-format flag. Every renderer
 * that produces something page-shaped marks it `.page`, so a format added later
 * gets print for free, and one that does not produce pages cannot accidentally
 * claim it can be printed.
 *
 * Video is the exception the selector has to state out loud: a `<video>` is
 * given `.page` so it inherits the sheet styling, but a paused frame of a
 * recording is not a document and offering to print it would be offering
 * something nobody asked for.
 */
export function printablePages(host: ParentNode): number {
  return host.querySelectorAll(".page:not(.video-page)").length;
}

/**
 * Open the system print dialog.
 *
 * Resolves once the dialog has been *requested*, not once anything has been
 * printed. Whether the user then prints, saves to PDF, or cancels is between
 * them and the operating system, and the web platform deliberately does not
 * report it back. So callers must not claim a document was printed.
 */
export async function printDocument(): Promise<void> {
  if (!isDesktop()) {
    window.print();
    return;
  }

  // The Tauri bridge is imported lazily so the web bundle never carries it.
  // This is the third caller of `invoke` in the app, after the save panel and
  // the file write, and like those two it travels over the in-process IPC
  // bridge rather than the network — see netbadge, which excludes exactly those
  // schemes so that printing a document does not make the app accuse itself of
  // sending one.
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("print_document");
}
