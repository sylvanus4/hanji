/**
 * Handing a produced file back to the user.
 *
 * Two shells, two mechanisms, one honest guarantee: in both cases the bytes go
 * straight from memory to disk and the network badge stays at zero.
 *
 *   Browser — a blob URL and a synthetic anchor click. The browser writes the
 *   file itself; there is no request, and the user cannot cancel because the
 *   download has already happened by the time they see it.
 *
 *   Desktop — a native Save panel, then a write to the path it returned. This
 *   shell can be cancelled, which the browser one cannot, so the function
 *   reports whether a file was actually written instead of assuming it was.
 *   Claiming "saved" over a cancelled dialog would be a small lie told at
 *   exactly the moment the user is checking whether the tool did what it said.
 */

import { isDesktop } from "../platform";

/** @returns true if a file was written, false if the user cancelled. */
export async function saveBlob(blob: Blob, fileName: string): Promise<boolean> {
  if (isDesktop()) return saveViaPanel(blob, fileName);
  saveViaAnchor(blob, fileName);
  return true;
}

function saveViaAnchor(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on a later turn: revoking synchronously can cancel the download in
  // some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function saveViaPanel(blob: Blob, fileName: string): Promise<boolean> {
  // Imported lazily so the web build never pulls the desktop bridge into its
  // bundle — a browser visitor should not download code that cannot run.
  const [{ save }, { writeFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);

  const dot = fileName.lastIndexOf(".");
  const extension = dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();

  const path = await save({
    defaultPath: fileName,
    // Without a filter macOS offers to append its own extension to the name we
    // already chose, producing things like report.hwpx.hwpx.
    filters: extension
      ? [{ name: extension.toUpperCase(), extensions: [extension] }]
      : undefined,
  });
  if (!path) return false;

  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return true;
}
