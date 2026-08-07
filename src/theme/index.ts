/**
 * Theme: light, dark, or follow the system.
 *
 * Three states rather than two. A binary toggle silently overrides the OS
 * preference forever after one accidental click, and there is no way back to
 * "just do what my machine does" — which is what most people actually want.
 *
 * The choice is written to `data-theme` on <html>; `tokens.css` reads it. When
 * the mode is "system" the attribute is removed entirely, so the media query in
 * that file takes over and no JavaScript is involved in the decision.
 */

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "hanji.theme";
const ORDER: ThemeMode[] = ["system", "light", "dark"];

let current: ThemeMode = read();
const listeners = new Set<(mode: ThemeMode) => void>();

function read(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    // Private-mode Safari throws here. Falling back to "system" is harmless.
  }
  return "system";
}

/** Resolve what is actually on screen right now, following the OS if needed. */
export function effectiveTheme(): "light" | "dark" {
  if (current !== "system") return current;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function getTheme(): ThemeMode {
  return current;
}

export function setTheme(mode: ThemeMode): void {
  current = mode;
  if (mode === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.dataset.theme = mode;
  }
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Preference will not persist; the session still renders correctly.
  }
  for (const fn of listeners) fn(mode);
}

/** Advance system → light → dark → system. */
export function cycleTheme(): ThemeMode {
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!;
  setTheme(next);
  return next;
}

export function onThemeChange(fn: (mode: ThemeMode) => void): void {
  listeners.add(fn);
}

/**
 * Apply the stored choice.
 *
 * Called from a blocking script in <head>, before first paint — otherwise a
 * dark-mode user gets a full-brightness flash of the light palette on every
 * load, which is both ugly and briefly blinding at night.
 */
export function initTheme(): void {
  setTheme(current);
  // While following the system, react to the OS flipping mid-session.
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (current === "system") for (const fn of listeners) fn(current);
    });
}
