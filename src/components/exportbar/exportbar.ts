/**
 * The row of conversion buttons shown once a document is open.
 *
 * Deliberately not a dropdown. The available conversions are the second half of
 * what this app is for, and burying them behind a menu would make the product
 * look like a viewer that happens to export.
 */

import type { ConversionTarget } from "../../convert/types";
import { saveBlob } from "../../convert/save";
import { S, t } from "../../i18n";

export interface ExportBarOptions {
  host: HTMLElement;
  targets: ConversionTarget[];
  report: (message: string) => void;
}

export function mountExportBar({
  host,
  targets,
  report,
}: ExportBarOptions): void {
  if (targets.length === 0) return;

  const bar = document.createElement("div");
  bar.className = "exportbar";
  // A labelled group, so a screen reader announces what this row of buttons is
  // for before reading the buttons themselves.
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", t(S.saveAsAria));

  const label = document.createElement("span");
  label.className = "exportbar-label";
  label.textContent = t(S.saveAs);
  label.setAttribute("aria-hidden", "true");
  bar.append(label);

  for (const target of targets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "exportbar-button";
    button.dataset.target = target.id;
    button.textContent = target.label;
    if (target.note) button.title = target.note;

    button.addEventListener("click", async () => {
      // Every button is disabled, not just the clicked one: these conversions
      // re-parse the document and compete for the same memory, and two large
      // exports at once is the fastest way to lose a mobile tab.
      const buttons = [...bar.querySelectorAll("button")];
      for (const b of buttons) b.disabled = true;
      const original = button.textContent;
      button.textContent = t(S.working);
      bar.setAttribute("aria-busy", "true");

      try {
        const result = await target.run({ report });
        // Desktop puts up a Save panel the user can dismiss; the browser cannot
        // be cancelled. Reporting the outcome rather than the intent keeps the
        // status line truthful in both shells.
        const written = await saveBlob(result.blob, result.name);
        report(written ? t(S.saved)(result.name) : t(S.saveCancelled));
        if (written) bar.dataset.lastSaved = result.name;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report(t(S.convertFailed)(message));
        console.error(error);
      } finally {
        button.textContent = original;
        for (const b of buttons) b.disabled = false;
        bar.removeAttribute("aria-busy");
        // Return focus to the button that started this. Re-enabling a disabled
        // element drops focus to <body>, which strands keyboard users.
        button.focus();
      }
    });

    bar.append(button);
  }

  const notes = targets.filter((t) => t.note);
  if (notes.length > 0) {
    const footnote = document.createElement("p");
    footnote.className = "exportbar-note";
    footnote.textContent = notes
      .map((t) => `${t.label}: ${t.note}`)
      .join(" · ");
    bar.append(footnote);
  }

  host.append(bar);
}
