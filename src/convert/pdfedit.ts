/**
 * PDF structural edits: merge, split, rotate, and page extraction.
 *
 * These are exactly the operations someone reaches for when a PDF holds
 * something confidential and a browser-based converter is the only place they
 * are willing to open it. Combining two contracts, pulling one page out of a
 * scanned agreement, or fixing a sideways scan should never require handing
 * the file to a server. pdf-lib does the structural work; everything here just
 * shapes File objects into pdf-lib calls and turns its output back into Blobs
 * that the rest of the app already knows how to save or zip.
 */

import { pageLabel } from "./raster";

export interface EditProgress {
  report?: (message: string) => void;
}

/** Narrow an unknown catch value to a message without reaching for `any`. */
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Parse "1-3,7" into zero-based page indices, de-duplicated in the order they
 * were first named. Strict on purpose: a silently-ignored typo in a page
 * range is how someone extracts the wrong five pages of a confidential file
 * and never notices.
 */
export function parsePageSpec(spec: string, pageCount: number): number[] {
  const trimmed = spec.trim();
  if (trimmed.length === 0) {
    throw new Error("Page range is empty.");
  }

  const seen = new Set<number>();
  const indices: number[] = [];

  for (const rawToken of trimmed.split(",")) {
    const token = rawToken.trim();
    if (token.length === 0) {
      throw new Error("Page range has an empty entry between two commas.");
    }

    const parts = token.split(/\s*-\s*/);
    const isRange = parts.length === 2;
    if (parts.length > 2 || parts.some((part) => !/^\d+$/.test(part))) {
      throw new Error(`"${token}" is not a valid page number or range.`);
    }

    const start = Number.parseInt(parts[0]!, 10);
    const end = isRange ? Number.parseInt(parts[1]!, 10) : start;
    if (isRange && start > end) {
      throw new Error(
        `"${token}" is a reversed range: the start page must not come after the end page.`,
      );
    }

    for (let page = start; page <= end; page += 1) {
      if (page < 1) {
        throw new Error(`Page ${page} does not exist; pages are numbered starting from 1.`);
      }
      if (page > pageCount) {
        const noun = pageCount === 1 ? "page" : "pages";
        throw new Error(`Page ${page} does not exist; this document only has ${pageCount} ${noun}.`);
      }
      const index = page - 1;
      if (!seen.has(index)) {
        seen.add(index);
        indices.push(index);
      }
    }
  }

  return indices;
}

/** Concatenate several PDFs into one, in the order given. */
export async function mergePdfs(files: File[], opts?: EditProgress): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const merged = await PDFDocument.create();

  for (const [index, file] of files.entries()) {
    opts?.report?.(`Merging file ${index + 1} of ${files.length}`);

    let source;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      source = await PDFDocument.load(bytes);
    } catch (cause) {
      // Naming the file here is the whole point: a batch of eight PDFs with
      // one bad apple is useless to debug from a bare pdf-lib parse error.
      throw new Error(`Could not read "${file.name}" as a PDF: ${errorMessage(cause)}`, { cause });
    }

    const copied = await merged.copyPages(source, source.getPageIndices());
    for (const page of copied) {
      merged.addPage(page);
    }
  }

  const saved = await merged.save();
  return new Blob([saved as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
}

/** One single-page PDF per page of the input, returned in page order. */
export async function splitPdfPages(
  file: File,
  opts?: EditProgress,
): Promise<{ name: string; blob: Blob }[]> {
  const { PDFDocument } = await import("pdf-lib");
  const bytes = new Uint8Array(await file.arrayBuffer());

  let source;
  try {
    source = await PDFDocument.load(bytes);
  } catch (cause) {
    throw new Error(`Could not read "${file.name}" as a PDF: ${errorMessage(cause)}`, { cause });
  }

  const pageCount = source.getPageCount();
  const baseName = file.name.replace(/\.[^./]+$/, "");
  const pages: { name: string; blob: Blob }[] = [];

  for (let index = 0; index < pageCount; index += 1) {
    opts?.report?.(`Splitting page ${index + 1} of ${pageCount}`);

    const single = await PDFDocument.create();
    const [copied] = await single.copyPages(source, [index]);
    single.addPage(copied!);
    const saved = await single.save();

    pages.push({
      name: `${baseName}-${pageLabel(index + 1, pageCount)}.pdf`,
      blob: new Blob([saved as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
    });
  }

  return pages;
}

/** Rotate every page by a quarter turn multiple, relative to its current rotation. */
export async function rotatePdf(
  file: File,
  quarterTurns: 1 | 2 | 3,
  opts?: EditProgress,
): Promise<Blob> {
  const { PDFDocument, degrees } = await import("pdf-lib");
  const bytes = new Uint8Array(await file.arrayBuffer());

  let pdf;
  try {
    pdf = await PDFDocument.load(bytes);
  } catch (cause) {
    throw new Error(`Could not read "${file.name}" as a PDF: ${errorMessage(cause)}`, { cause });
  }

  const pages = pdf.getPages();
  pages.forEach((page, index) => {
    opts?.report?.(`Rotating page ${index + 1} of ${pages.length}`);
    // Adding rather than overwriting keeps a page that a scanner already
    // rotated 90 degrees correct after the user rotates it once more.
    const current = page.getRotation().angle;
    const next = ((current + quarterTurns * 90) % 360 + 360) % 360;
    page.setRotation(degrees(next));
  });

  const saved = await pdf.save();
  return new Blob([saved as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
}

/**
 * Keep only the pages named by a 1-based range spec like "1-3,7,10-12".
 * Throws a descriptive Error if the spec is malformed or names a page that
 * does not exist.
 */
export async function extractPages(file: File, spec: string, opts?: EditProgress): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const bytes = new Uint8Array(await file.arrayBuffer());

  let source;
  try {
    source = await PDFDocument.load(bytes);
  } catch (cause) {
    throw new Error(`Could not read "${file.name}" as a PDF: ${errorMessage(cause)}`, { cause });
  }

  const indices = parsePageSpec(spec, source.getPageCount());
  opts?.report?.(`Extracting ${indices.length} page${indices.length === 1 ? "" : "s"}`);

  const result = await PDFDocument.create();
  const copied = await result.copyPages(source, indices);
  for (const page of copied) {
    result.addPage(page);
  }

  const saved = await result.save();
  return new Blob([saved as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
}
