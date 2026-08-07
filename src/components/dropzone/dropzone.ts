/**
 * Whole-stage drop target.
 *
 * The entire viewport is the drop zone rather than a small dashed rectangle: the
 * user already has the file under the cursor, and making them aim at a box is
 * friction with no purpose. A hidden file input backs it so keyboard and mobile
 * users get the same entry point.
 */

import { onLangChange, S, t } from "../../i18n";

export interface DropzoneOptions {
  stage: HTMLElement;
  trigger: HTMLElement;
  accept: string[];
  /**
   * Receives everything that was dropped or picked, in the order the platform
   * handed it over. Callers that need a deterministic order sort by name
   * themselves; this layer does not decide that for them.
   */
  onFiles: (files: File[]) => void;
}

export function mountDropzone({
  stage,
  trigger,
  accept,
  onFiles,
}: DropzoneOptions): void {
  const input = document.createElement("input");
  input.type = "file";
  input.className = "sr-only";
  // The input is visually hidden and driven by the toolbar button, so it needs
  // its own accessible name — a screen reader reaching it directly would
  // otherwise hear an unlabelled file control.
  const label = () => input.setAttribute("aria-label", t(S.chooseFile));
  label();
  onLangChange(label);
  input.accept = accept.map((e) => `.${e}`).join(",");
  // Multiple because merging PDFs and building a GIF are both "these files, as
  // one thing", and making someone open them one at a time would make those
  // features impossible rather than merely tedious.
  input.multiple = true;
  input.addEventListener("change", () => {
    const files = [...(input.files ?? [])];
    if (files.length > 0) onFiles(files);
    input.value = "";
  });
  // Deliberately parented to <body>, not to the stage: the stage's innerHTML is
  // replaced every time a document is opened, which would silently destroy this
  // input and leave the Open button dead. Caught by the e2e smoke test.
  document.body.append(input);

  trigger.addEventListener("click", () => input.click());

  // dragenter/leave fire for every child element, so track depth rather than
  // toggling on each event — otherwise the outline flickers as the pointer moves.
  let depth = 0;
  const setDragging = (on: boolean) => {
    stage.dataset.dragging = String(on);
  };

  stage.addEventListener("dragenter", (e) => {
    e.preventDefault();
    depth += 1;
    setDragging(true);
  });

  stage.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });

  stage.addEventListener("dragleave", (e) => {
    e.preventDefault();
    depth = Math.max(0, depth - 1);
    if (depth === 0) setDragging(false);
  });

  stage.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    setDragging(false);
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length > 0) onFiles(files);
  });

  // A file dropped anywhere else would otherwise navigate the tab away and
  // silently destroy in-progress work.
  for (const type of ["dragover", "drop"] as const) {
    window.addEventListener(type, (e) => {
      if (!stage.contains(e.target as Node)) e.preventDefault();
    });
  }
}
