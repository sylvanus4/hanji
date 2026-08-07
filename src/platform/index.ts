/**
 * Which shell are we running inside?
 *
 * The same bundle is served as a web page and packaged as a desktop app, and
 * three things differ between them: how a produced file is saved, whether a
 * save can be cancelled, and what the network badge is counting. Everything
 * else — every parser, renderer and encoder — is identical, which is why this
 * check is a single boolean rather than a platform abstraction layer.
 *
 * Tauri injects __TAURI_INTERNALS__ into the page before any of our code runs,
 * so this is reliable from the first line of main.ts.
 */

export function isDesktop(): boolean {
  return "__TAURI_INTERNALS__" in globalThis;
}
