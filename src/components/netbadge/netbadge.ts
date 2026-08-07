/**
 * Network-zero badge.
 *
 * This is the one piece of UI that carries the product's entire claim, so it is
 * not decoration and it is not a promise printed on a page: it instruments every
 * outbound channel the page has and reports what actually happened.
 *
 * What counts as an "egress" event: any request to an origin other than our own.
 * Same-origin requests are the app's own shell and WASM binaries being fetched,
 * which is how the tool loads at all; those are counted separately and shown as
 * asset loads so the number stays honest rather than flattering.
 *
 * The instrumentation is installed before any feature module is imported, so a
 * later module cannot quietly slip a request past it.
 */

import { onLangChange, S, t } from "../../i18n";
import { isDesktop } from "../../platform";

export interface NetStats {
  egress: number;
  assets: number;
  lastEgressUrl: string | null;
}

const stats: NetStats = { egress: 0, assets: 0, lastEgressUrl: null };
const listeners = new Set<(s: NetStats) => void>();

/**
 * The desktop shell's own bridge, which is not a network channel.
 *
 * Tauri routes `invoke` to the app's own Rust process through a custom scheme
 * the webview resolves in-process. No socket is opened, and the process on the
 * other end links no HTTP client at all — see src-tauri/Cargo.toml, which has
 * neither reqwest nor hyper, deliberately.
 *
 * Without this, one desktop save counted as two transmissions: the Save panel
 * and the write are two separate invokes. So a user who saved a single file
 * watched this badge turn red and report "sent 2" — the app accusing itself of
 * leaking at the exact moment it had just proven it does not. A false alarm
 * here is worse than no badge, because it teaches people the badge is noise.
 *
 * The exemption is deliberately narrow. It is a closed list, and it applies
 * only inside the desktop shell. In a browser these are ordinary foreign
 * origins and still count; and a real `fetch("https://…")` from the desktop app
 * still counts too, because the webview genuinely can reach the network.
 */
const BRIDGE_SCHEMES = new Set(["ipc:", "tauri:", "asset:"]);
const BRIDGE_HOSTS = new Set([
  "ipc.localhost",
  "tauri.localhost",
  "asset.localhost",
]);

function isDesktopBridge(u: URL): boolean {
  if (!isDesktop()) return false;
  return BRIDGE_SCHEMES.has(u.protocol) || BRIDGE_HOSTS.has(u.hostname);
}

function isForeign(url: string): boolean {
  try {
    const u = new URL(url, location.href);
    // blob:/data: never touch the network at all.
    if (u.protocol === "blob:" || u.protocol === "data:") return false;
    if (isDesktopBridge(u)) return false;
    return u.origin !== location.origin;
  } catch {
    // An unparseable URL is treated as foreign: fail loud, not silent.
    return true;
  }
}

function record(url: string): void {
  if (isForeign(url)) {
    stats.egress += 1;
    stats.lastEgressUrl = url;
  } else {
    stats.assets += 1;
  }
  for (const fn of listeners) fn({ ...stats });
}

/** Install interceptors. Call once, as early as possible. */
export function armNetworkWatch(): void {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    record(url);
    return nativeFetch(input, init);
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    record(String(url));
    // eslint-disable-next-line prefer-rest-params
    return nativeOpen.apply(this, [method, url, ...rest] as never);
  } as typeof XMLHttpRequest.prototype.open;

  if (navigator.sendBeacon) {
    const nativeBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
      record(String(url));
      return nativeBeacon(url, data);
    };
  }

  const NativeWS = window.WebSocket;
  window.WebSocket = class extends NativeWS {
    constructor(url: string | URL, protocols?: string | string[]) {
      record(String(url));
      super(url, protocols);
    }
  } as typeof WebSocket;

  // Catch anything that bypassed the wrappers above (img src, css url(), etc).
  if ("PerformanceObserver" in window) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (isForeign(entry.name)) {
          stats.egress += 1;
          stats.lastEgressUrl = entry.name;
          for (const fn of listeners) fn({ ...stats });
        }
      }
    }).observe({ type: "resource", buffered: true });
  }
}

export function onNetChange(fn: (s: NetStats) => void): void {
  listeners.add(fn);
  fn({ ...stats });
}

export function mountNetBadge(host: HTMLElement): void {
  const el = document.createElement("output");
  el.className = "netbadge";
  el.setAttribute("aria-live", "polite");
  host.append(el);

  const paint = (s: NetStats) => {
    const clean = s.egress === 0;
    el.dataset.state = clean ? "clean" : "breached";
    el.title = clean
      ? t(S.sentCleanTitle)(s.assets)
      : t(S.sentBreachedTitle)(String(s.lastEgressUrl));
    el.textContent = clean ? t(S.sentClean) : t(S.sentBreached)(s.egress);
  };

  onNetChange(paint);
  // Repaint on language change; the badge is the one label a user is most
  // likely to be staring at when they hit the toggle.
  onLangChange(() => paint({ ...stats }));
}
