/**
 * hanji — local-first document viewer and converter.
 *
 * Load order matters here: the network watch is armed before anything else is
 * imported, so no feature module can register a request before the instrument
 * that is supposed to be counting them exists.
 */

import "./styles/global.css";
import "./components/netbadge/netbadge.css";
import "./components/exportbar/exportbar.css";

import { armNetworkWatch, mountNetBadge } from "./components/netbadge/netbadge";

armNetworkWatch();

import { mountDropzone } from "./components/dropzone/dropzone";
import {
  resolveHandler,
  supportedExtensions,
  UnsupportedFormatError,
} from "./formats/registry";
import { MixedBatchError } from "./formats/batch";
import type { ConversionTarget } from "./convert/types";
import { getLang, onLangChange, S, setLang, t } from "./i18n";
import { isDesktop } from "./platform";
import {
  cycleTheme,
  effectiveTheme,
  getTheme,
  initTheme,
  onThemeChange,
} from "./theme";

const stage = document.querySelector<HTMLElement>("#stage");
const badgeHost = document.querySelector<HTMLElement>("#badge-host");
const openButton = document.querySelector<HTMLElement>("#open-file");
const langButton = document.querySelector<HTMLButtonElement>("#lang-toggle");
const tagline = document.querySelector<HTMLElement>("#tagline");
const themeButton = document.querySelector<HTMLButtonElement>("#theme-toggle");
const themeGlyph = document.querySelector<HTMLElement>("#theme-glyph");
const themeLabel = document.querySelector<HTMLElement>("#theme-label");

if (
  !stage || !badgeHost || !openButton || !langButton || !tagline ||
  !themeButton || !themeGlyph || !themeLabel
) {
  throw new Error(t(S.shellBroken));
}

initTheme();

mountNetBadge(badgeHost);

/**
 * The file currently on screen.
 *
 * Kept so switching language can re-open it. Re-rendering is cheap (~50 ms for
 * a Hangul document) and much better than either reloading the page or leaving
 * half the interface in the old language.
 */
let openFiles: File[] = [];

/** Half-filled circle for system, sun for light, moon for dark. */
const THEME_GLYPH = { system: "◐", light: "☀", dark: "☾" } as const;

function paintTheme(): void {
  const mode = getTheme();
  const name = t(
    mode === "light" ? S.themeLight : mode === "dark" ? S.themeDark : S.themeSystem,
  );
  themeGlyph!.textContent = THEME_GLYPH[mode];
  themeLabel!.textContent = name;
  themeButton!.title = t(S.themeTitle)(name);
  // The glyph alone is ambiguous to a screen reader, and the visible label is
  // hidden on narrow screens, so the button carries its own name.
  themeButton!.setAttribute("aria-label", t(S.themeTitle)(name));
  themeButton!.dataset.mode = mode;
  themeButton!.dataset.effective = effectiveTheme();
}

function paintChrome(): void {
  document.documentElement.lang = getLang();
  tagline!.textContent = t(S.tagline);
  openButton!.textContent = t(S.openFile);
  langButton!.textContent = t(S.switchLang);
  langButton!.title = t(S.switchLangTitle);
  paintTheme();
}

function emptyState(): void {
  stage!.innerHTML = `
    <div class="empty">
      <h2 class="empty-title"></h2>
      <p class="empty-sub"></p>
      <div class="empty-formats">
        ${supportedExtensions.map((e) => `<span class="chip">${e}</span>`).join("")}
      </div>
    </div>
  `;
  stage!.querySelector(".empty-title")!.textContent = t(S.emptyTitle);
  stage!.querySelector(".empty-sub")!.textContent = t(
    isDesktop() ? S.emptyBodyDesktop : S.emptyBody,
  );
}

function shell(): {
  viewer: HTMLElement;
  status: HTMLElement;
  toolbar: HTMLElement;
} {
  stage!.innerHTML = `
    <div class="viewer">
      <p class="viewer-status" id="status" aria-live="polite"></p>
      <div class="viewer-toolbar" id="toolbar"></div>
    </div>
  `;
  const viewer = stage!.querySelector<HTMLElement>(".viewer")!;
  return {
    viewer,
    status: viewer.querySelector<HTMLElement>("#status")!,
    toolbar: viewer.querySelector<HTMLElement>("#toolbar")!,
  };
}

async function open(files: File[]): Promise<void> {
  const [first] = files;
  if (!first) return;
  openFiles = files;

  const { viewer, status, toolbar } = shell();
  const report = (message: string) => {
    status.textContent = message;
  };

  report(
    files.length === 1
      ? t(S.opening)(first.name)
      : t(S.openingMany)(files.length),
  );

  try {
    // One file is a document; several are a job to do with them. The two paths
    // stay separate rather than treating a single file as a batch of one,
    // because "merge these" and "what is in this" are different questions and
    // collapsing them would put merge buttons under every PDF a user opens.
    const many = files.length > 1;
    const targets = many
      ? await openMany(files, viewer, report)
      : await openOne(first, viewer, report);

    // Mounted only after a successful render: offering to convert a document
    // that failed to open would be offering something we cannot deliver.
    const [{ mountExportBar }, { printablePages, printDocument }] =
      await Promise.all([
        import("./components/exportbar/exportbar"),
        import("./print"),
      ]);

    // Asked of the rendered result rather than declared by the format handler,
    // so a view only offers print when there is genuinely something page-shaped
    // on screen. A video and a batch contact sheet both answer zero.
    const pages = printablePages(viewer);

    // The ordering rule applies to every batch target at once, so it is stated
    // once under the bar instead of being repeated inside thirteen notes.
    mountExportBar({
      host: toolbar,
      targets,
      report,
      ...(pages > 0 ? { print: { pages, run: printDocument } } : {}),
      ...(many ? { footnote: t(S.batchOrder) } : {}),
    });
  } catch (error) {
    const message =
      error instanceof UnsupportedFormatError || error instanceof MixedBatchError
        ? error.describe()
        : error instanceof Error
          ? error.message
          : String(error);

    // The failure is shown in place rather than thrown away, because a file that
    // will not open is exactly the moment a user needs to know why.
    viewer.innerHTML = "";
    const box = document.createElement("p");
    box.className = "viewer-error";
    box.textContent =
      files.length === 1
        ? t(S.openFailed)(first.name, message)
        : t(S.openFailedMany)(files.length, message);
    viewer.append(box);
    console.error(error);
  }
}

async function openOne(
  file: File,
  viewer: HTMLElement,
  report: (message: string) => void,
): Promise<ConversionTarget[]> {
  const handler = await resolveHandler(file);
  await handler.render(file, { host: viewer, report });
  return handler.conversions?.(file) ?? [];
}

async function openMany(
  files: File[],
  viewer: HTMLElement,
  report: (message: string) => void,
): Promise<ConversionTarget[]> {
  const { resolveBatch } = await import("./formats/batch");
  const handler = resolveBatch(files);
  await handler.render(files, { host: viewer, report });
  return handler.conversions(files);
}

langButton.addEventListener("click", () => {
  setLang(getLang() === "ko" ? "en" : "ko");
});

themeButton.addEventListener("click", () => {
  cycleTheme();
});

onThemeChange(paintTheme);

onLangChange(() => {
  paintChrome();
  if (openFiles.length > 0) void open(openFiles);
  else emptyState();
});

mountDropzone({
  stage,
  trigger: openButton,
  accept: supportedExtensions,
  onFiles: open,
});

paintChrome();
emptyState();
