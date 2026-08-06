/**
 * Handing a produced file back to the user.
 *
 * A blob URL plus a synthetic anchor click is the whole mechanism, and it is
 * worth being explicit that this is *not* a network operation: the bytes never
 * leave the tab, the browser writes them straight to disk. The network badge
 * stays at zero through every export, which is the point.
 */

export function saveBlob(blob: Blob, fileName: string): void {
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
