/*
 * Applies the saved theme before first paint.
 *
 * A separate same-origin file rather than an inline <script>, because the CSP
 * pins script-src to 'self' with no 'unsafe-inline'. Loading it synchronously in
 * <head> is the point: if the module bundle set the theme instead, anyone whose
 * choice differs from their OS would get a flash of the wrong palette on every
 * load — briefly blinding on a dark-mode phone at night.
 *
 * Absent attribute means "follow the system", which the stylesheet's media query
 * already handles without any script.
 */
try {
  var mode = localStorage.getItem("hanji.theme");
  if (mode === "light" || mode === "dark") {
    document.documentElement.setAttribute("data-theme", mode);
  }
} catch (e) {
  /* Private-mode Safari denies storage; the system preference still applies. */
}
