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
import { getLang, onLangChange, S, setLang, t } from "./i18n";

const stage = document.querySelector<HTMLElement>("#stage");
const badgeHost = document.querySelector<HTMLElement>("#badge-host");
const openButton = document.querySelector<HTMLElement>("#open-file");
const langButton = document.querySelector<HTMLButtonElement>("#lang-toggle");
const tagline = document.querySelector<HTMLElement>("#tagline");

if (!stage || !badgeHost || !openButton || !langButton || !tagline) {
  throw new Error(t(S.shellBroken));
}

mountNetBadge(badgeHost);

/**
 * The file currently on screen.
 *
 * Kept so switching language can re-open it. Re-rendering is cheap (~50 ms for
 * a Hangul document) and much better than either reloading the page or leaving
 * half the interface in the old language.
 */
let openFile: File | null = null;

function paintChrome(): void {
  document.documentElement.lang = getLang();
  tagline!.textContent = t(S.tagline);
  openButton!.textContent = t(S.openFile);
  langButton!.textContent = t(S.switchLang);
  langButton!.title = t(S.switchLangTitle);
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
  stage!.querySelector(".empty-sub")!.textContent = t(S.emptyBody);
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

async function open(file: File): Promise<void> {
  openFile = file;
  const { viewer, status, toolbar } = shell();
  const report = (message: string) => {
    status.textContent = message;
  };

  report(t(S.opening)(file.name));

  try {
    const handler = await resolveHandler(file);
    await handler.render(file, { host: viewer, report });

    // Mounted only after a successful render: offering to convert a document
    // that failed to open would be offering something we cannot deliver.
    const targets = handler.conversions?.(file) ?? [];
    const { mountExportBar } = await import("./components/exportbar/exportbar");
    mountExportBar({ host: toolbar, targets, report });
  } catch (error) {
    const message =
      error instanceof UnsupportedFormatError
        ? error.describe()
        : error instanceof Error
          ? error.message
          : String(error);

    // The failure is shown in place rather than thrown away, because a file that
    // will not open is exactly the moment a user needs to know why.
    viewer.innerHTML = "";
    const box = document.createElement("p");
    box.className = "viewer-error";
    box.textContent = t(S.openFailed)(file.name, message);
    viewer.append(box);
    console.error(error);
  }
}

langButton.addEventListener("click", () => {
  setLang(getLang() === "ko" ? "en" : "ko");
});

onLangChange(() => {
  paintChrome();
  if (openFile) void open(openFile);
  else emptyState();
});

mountDropzone({
  stage,
  trigger: openButton,
  accept: supportedExtensions,
  onFile: open,
});

paintChrome();
emptyState();
