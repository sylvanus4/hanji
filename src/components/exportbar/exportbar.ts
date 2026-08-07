/**
 * The row of conversion buttons shown once a document is open.
 *
 * Deliberately not a dropdown. The available conversions are the second half of
 * what this app is for, and burying them behind a menu would make the product
 * look like a viewer that happens to export.
 *
 * Two kinds of target share the bar. A plain target is a different *format* —
 * PDF, ZIP, HWPX — and sits in the top row. A grouped target is the same format
 * at different settings, and those go into a labelled block below, one chip
 * each, with the setting written under the name. The split exists because the
 * GIF presets are ten siblings: in the top row they would drown the two or
 * three targets that are genuinely different formats.
 */

import type { ConversionTarget } from "../../convert/types";
import { saveBlob } from "../../convert/save";
import { S, t } from "../../i18n";

export interface ExportBarOptions {
  host: HTMLElement;
  targets: ConversionTarget[];
  report: (message: string) => void;
  /**
   * A rule that governs every target rather than any one of them.
   *
   * Only the batch path uses it, to state that files are processed in filename
   * order. That used to be appended to each target's own note, which printed it
   * three times in one line once the GIF presets arrived, and would have printed
   * it ten more times had they been given notes of their own.
   */
  footnote?: string;
}

export function mountExportBar({
  host,
  targets,
  report,
  footnote,
}: ExportBarOptions): void {
  if (targets.length === 0) return;

  const bar = document.createElement("div");
  bar.className = "exportbar";
  // A labelled group, so a screen reader announces what this row of buttons is
  // for before reading the buttons themselves.
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", t(S.saveAsAria));

  const plain = targets.filter((target) => !target.group);
  const grouped = targets.filter((target) => target.group);

  const row = document.createElement("div");
  row.className = "exportbar-row";
  bar.append(row);

  if (plain.length > 0) {
    const label = document.createElement("span");
    label.className = "exportbar-label";
    label.textContent = t(S.saveAs);
    label.setAttribute("aria-hidden", "true");
    row.append(label);
  }

  /**
   * Build one target's control.
   *
   * `chip` targets carry their note visibly rather than in a tooltip: a chip's
   * whole job is to be compared against nine others, and a hover title is not
   * readable on a phone and not discoverable anywhere.
   */
  function build(target: ConversionTarget, chip: boolean): HTMLElement {
    // A target that needs a value gets its field and button wrapped together, so
    // the two never wrap onto separate lines and leave an orphaned input whose
    // purpose is no longer visible.
    const wrapper = document.createElement("span");
    wrapper.className = target.input ? "exportbar-group" : "exportbar-slot";

    let field: HTMLInputElement | null = null;
    if (target.input) {
      field = document.createElement("input");
      field.type = "text";
      field.className = "exportbar-field";
      field.placeholder = target.input.placeholder;
      field.setAttribute("aria-label", target.input.label);
      // inputmode rather than type=number: the value is a range expression like
      // 1-3,7, which a numeric input would refuse to hold.
      field.inputMode = "numeric";
      field.size = 8;
      wrapper.append(field);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = chip ? "exportbar-chip" : "exportbar-button";
    button.dataset.target = target.id;

    if (chip) {
      const name = document.createElement("span");
      name.className = "exportbar-chip-name";
      name.textContent = target.label;
      button.append(name);
      if (target.note) {
        const hint = document.createElement("small");
        hint.className = "exportbar-chip-note";
        hint.textContent = target.note;
        button.append(hint);
      }
    } else {
      button.textContent = target.label;
      if (target.note) button.title = target.note;
    }

    if (field) {
      // Typing a range and pressing Enter is the obvious gesture, and leaving it
      // inert would make the field feel broken.
      field.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !button.disabled) button.click();
      });
    }

    button.addEventListener("click", async () => {
      const value = field ? field.value.trim() : undefined;
      if (target.input && !value) {
        report(target.input.required);
        field?.focus();
        return;
      }

      // Every button is disabled, not just the clicked one: these conversions
      // re-parse the document and compete for the same memory, and two large
      // exports at once is the fastest way to lose a mobile tab.
      const buttons = [...bar.querySelectorAll("button")];
      const fields = [...bar.querySelectorAll("input")];
      for (const b of buttons) b.disabled = true;
      for (const f of fields) f.disabled = true;
      // A chip's label is a two-line structure, so the progress word replaces
      // only the name and leaves the setting underneath in place.
      const slot = chip
        ? button.querySelector<HTMLElement>(".exportbar-chip-name")
        : button;
      const original = slot?.textContent ?? "";
      if (slot) slot.textContent = t(S.working);
      bar.setAttribute("aria-busy", "true");

      try {
        const result = await target.run({ report, value });
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
        if (slot) slot.textContent = original;
        for (const b of buttons) b.disabled = false;
        for (const f of fields) f.disabled = false;
        bar.removeAttribute("aria-busy");
        // Return focus to the button that started this. Re-enabling a disabled
        // element drops focus to <body>, which strands keyboard users.
        button.focus();
      }
    });

    wrapper.append(button);
    return wrapper;
  }

  for (const target of plain) row.append(build(target, false));

  // Insertion order of the first appearance decides the order of the blocks, so
  // the format handler controls it by the order it declares its targets.
  const groupNames = [...new Set(grouped.map((target) => target.group))];
  for (const name of groupNames) {
    const block = document.createElement("div");
    block.className = "exportbar-presets";
    block.setAttribute("role", "group");
    if (name) block.setAttribute("aria-label", name);

    const heading = document.createElement("p");
    heading.className = "exportbar-presets-head";
    heading.textContent = name ?? "";
    block.append(heading);

    const chips = document.createElement("div");
    chips.className = "exportbar-chips";
    for (const target of grouped.filter((item) => item.group === name)) {
      chips.append(build(target, true));
    }
    block.append(chips);
    bar.append(block);
  }

  // Only the plain targets contribute here. Ten preset notes joined into one
  // line is a paragraph nobody reads, and each chip already carries its own.
  const notes = plain.filter((target) => target.note);
  const lines = notes.map((target) => `${target.label}: ${target.note}`);
  if (footnote) lines.push(footnote);
  if (lines.length > 0) {
    const line = document.createElement("p");
    line.className = "exportbar-note";
    line.textContent = lines.join(" · ");
    bar.append(line);
  }

  host.append(bar);
}
