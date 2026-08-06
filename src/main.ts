/**
 * hanji — local-first document viewer and converter.
 *
 * Load order matters here: the network watch is armed before anything else is
 * imported, so no feature module can register a request before the instrument
 * that is supposed to be counting them exists.
 */

import "./styles/global.css";
import "./components/netbadge/netbadge.css";

import { armNetworkWatch, mountNetBadge } from "./components/netbadge/netbadge";

armNetworkWatch();

import { mountDropzone } from "./components/dropzone/dropzone";
import {
  resolveHandler,
  supportedExtensions,
  UnsupportedFormatError,
} from "./formats/registry";

const stage = document.querySelector<HTMLElement>("#stage");
const badgeHost = document.querySelector<HTMLElement>("#badge-host");
const openButton = document.querySelector<HTMLElement>("#open-file");

if (!stage || !badgeHost || !openButton) {
  throw new Error("The app shell is missing required elements.");
}

mountNetBadge(badgeHost);

function emptyState(): void {
  stage!.innerHTML = `
    <div class="empty">
      <h2 class="empty-title">Drop a document. It stays on this device.</h2>
      <p class="empty-sub">
        Hangul, PDF and image files are opened by code running in this tab.
        Nothing is uploaded, so nothing has to be deleted afterwards.
      </p>
      <div class="empty-formats">
        ${supportedExtensions.map((e) => `<span class="chip">${e}</span>`).join("")}
      </div>
    </div>
  `;
}

function shell(): { viewer: HTMLElement; status: HTMLElement } {
  stage!.innerHTML = `
    <div class="viewer">
      <p class="viewer-status" id="status" aria-live="polite"></p>
    </div>
  `;
  const viewer = stage!.querySelector<HTMLElement>(".viewer")!;
  const status = viewer.querySelector<HTMLElement>("#status")!;
  return { viewer, status };
}

async function open(file: File): Promise<void> {
  const { viewer, status } = shell();
  const report = (message: string) => {
    status.textContent = message;
  };

  report(`Opening ${file.name}…`);

  try {
    const handler = await resolveHandler(file);
    await handler.render(file, { host: viewer, report });
  } catch (error) {
    const message =
      error instanceof UnsupportedFormatError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

    // The failure is shown in place rather than thrown away, because a file that
    // will not open is exactly the moment a user needs to know why.
    viewer.innerHTML = "";
    const box = document.createElement("p");
    box.className = "viewer-error";
    box.textContent = `${file.name} could not be opened. ${message}`;
    viewer.append(box);
    console.error(error);
  }
}

mountDropzone({
  stage,
  trigger: openButton,
  accept: supportedExtensions,
  onFile: open,
});

emptyState();
