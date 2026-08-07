"""Headless smoke test: does hanji actually open a real HWP in a browser?

This exists because "it typechecks and builds" is not evidence that a WASM engine
loads, that lazy chunks resolve, or that pages render. It drives a real Chromium
against the production build and asserts on what appears on screen.
"""

import os
import re
import sys
import tempfile
import zipfile
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

URL = os.environ.get("HANJI_URL", "http://localhost:4173/")
# Derived, not hard-coded: the foreign-request assertion is the product's whole
# claim, and a stale literal port would classify our own assets as egress —
# turning the most important check in the suite into noise.
_parts = urlsplit(URL)
ORIGIN = f"{_parts.scheme}://{_parts.netloc}"

# Fixtures are supplied rather than committed: the sample used during
# development is a Korean civil-service exam paper, and shipping arbitrary
# real-world documents in a public repository is a habit worth not forming.
#
# Any HWP and any PDF will do — the page-count assertions read the numbers off
# the documents themselves rather than hard-coding 2.
HWP = os.environ.get("HANJI_FIXTURE_HWP", "")
PDF = os.environ.get("HANJI_FIXTURE_PDF", "")

if not HWP or not PDF:
    sys.exit(
        "This suite needs two documents to drive.\n\n"
        "  export HANJI_FIXTURE_HWP=/path/to/any.hwp\n"
        "  export HANJI_FIXTURE_PDF=/path/to/any.pdf\n"
        "  npm run preview   # in another shell\n"
        "  python3 e2e-smoke.py\n\n"
        "Override the address with HANJI_URL if preview is not on :4173 — the "
        "port is Vite's default and another project may already hold it."
    )

failures = []


def check(label, condition, detail=""):
    mark = "PASS" if condition else "FAIL"
    print(f"[{mark}] {label} {detail}")
    if not condition:
        failures.append(label)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()

    # Only genuinely uncaught errors count. A console.error emitted by the app's
    # own catch block is the error path working, not a defect.
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    # Record every request that leaves the origin. This is the product's core
    # claim, so the test asserts it rather than trusting the badge's own count.
    foreign = []
    page.on(
        "request",
        lambda r: foreign.append(r.url)
        if not r.url.startswith(ORIGIN)
        and not r.url.startswith("blob:")
        and not r.url.startswith("data:")
        else None,
    )

    page.goto(URL, wait_until="networkidle")
    # Korean is the unconditional default — this tool is for Korean documents,
    # and sniffing navigator.language would hide it from Korean users on
    # English-locale machines.
    check("shell renders in Korean by default",
          "문서를 끌어다 놓으세요" in page.inner_text("body")
          and page.get_attribute("html", "lang") == "ko")
    check("badge starts clean", page.inner_text(".netbadge").strip() == "전송 0",
          f'-> "{page.inner_text(".netbadge").strip()}"')

    # --- HWP ---
    page.set_input_files('input[type=file]', HWP)
    page.wait_for_selector(".viewer img.page", timeout=60000)
    page.wait_for_timeout(2500)
    hwp_pages = page.locator(".viewer img.page").count()
    status = page.inner_text("#status")
    # Any HWP will do, so the bar is "it rendered something", and the observed
    # count becomes the yardstick every later page assertion is measured against.
    check("HWP renders pages", hwp_pages >= 1, f"-> {hwp_pages} pages, status: {status!r}")

    # --- PDF ---
    page.set_input_files('input[type=file]', PDF)
    page.wait_for_selector(".viewer canvas.page", timeout=60000)
    page.wait_for_timeout(2500)
    pdf_pages = page.locator(".viewer canvas.page").count()
    check("PDF renders pages", pdf_pages >= 1, f"-> {pdf_pages} pages")

    # --- unsupported format must fail visibly, not silently ---
    page.set_input_files('input[type=file]', __file__)
    page.wait_for_selector(".viewer-error", timeout=15000)
    check("unsupported format shows an error", True,
          f'-> {page.inner_text(".viewer-error")[:60]!r}')

    # --- language toggle, with a document open ---
    #
    # Switching language re-opens the current file rather than reloading, so the
    # risk being covered is a half-translated interface or a lost document.
    page.set_input_files("input[type=file]", HWP)
    page.wait_for_selector(".exportbar-button", timeout=60000)
    page.wait_for_timeout(2000)
    page.click("#lang-toggle")
    page.wait_for_selector(".exportbar-button", timeout=60000)
    page.wait_for_timeout(2000)
    check("toggle switches every surface to English",
          page.get_attribute("html", "lang") == "en"
          and page.inner_text(".netbadge").strip().lower() == "0 sent"
          and page.inner_text("#open-file") == "Open a file"
          and "page" in page.inner_text("#status"),
          f'-> status {page.inner_text("#status")!r}')
    check("the open document survives the switch",
          page.locator(".viewer img.page").count() == hwp_pages,
          f'-> {page.locator(".viewer img.page").count()} pages')
    page.click("#lang-toggle")
    page.wait_for_selector(".exportbar-button", timeout=60000)
    page.wait_for_timeout(2000)

    # --- Hangul geometry regression guard ---
    #
    # rhwp v0.7.6 through v0.8.2 displace block-level tables by the width of any
    # preceding tabs, pushing boxed passages off the page. We ship a patched
    # engine build (see vendor/README.md); this fails the build if an unpatched
    # one is ever installed, which is otherwise easy to miss — the page still
    # renders, it just renders wrong.
    #
    # Blob URLs are revoked on load, so the shim below keeps them readable. It
    # is scoped to this one page and does not touch the app.
    geo = browser.new_page()
    geo.add_init_script("URL.revokeObjectURL = () => {};")
    geo.goto(URL, wait_until="networkidle")
    geo.set_input_files("input[type=file]", HWP)
    geo.wait_for_selector(".viewer img.page", timeout=60000)
    geo.wait_for_timeout(2500)
    svg = geo.evaluate(
        "async () => (await fetch(document.querySelector('.viewer img.page').src)).text()"
    )
    geo.close()

    page_w = float(re.search(r'<svg[^>]*\bwidth="([\d.]+)"', svg).group(1))
    edges = [
        float(x.group(1)) + float(w.group(1))
        for r in re.findall(r"<rect[^>]*>", svg)
        if (x := re.search(r'\bx="([-\d.]+)"', r)) and (w := re.search(r'\bwidth="([-\d.]+)"', r))
    ]
    overflow = max(edges) - page_w
    check(
        "no table escapes the page",
        overflow < 1.0,
        f"-> rightmost rect {max(edges):.1f} vs page {page_w:.1f} (overflow {overflow:+.1f}px)",
    )

    # --- the claim ---
    check("zero foreign requests", len(foreign) == 0, f"-> {foreign[:3]}")
    check("badge still clean after 3 files",
          page.inner_text(".netbadge").strip() == "전송 0",
          f'-> "{page.inner_text(".netbadge").strip()}"')

    check("no uncaught page errors", not errors, f"-> {errors[:2]}")

    # --- theme: three states, and the case a media query cannot express ---
    #
    # A binary toggle would silently strand anyone who clicked once, so "system"
    # has to be reachable again. The explicit-dark-on-a-light-OS case is the one
    # that proves data-theme actually beats prefers-color-scheme.
    themed = browser.new_context(color_scheme="light")
    tp = themed.new_page()
    tp.goto(URL, wait_until="networkidle")
    seen = []
    for _ in range(4):
        seen.append(tp.evaluate("() => document.querySelector('#theme-toggle').dataset.mode"))
        tp.click("#theme-toggle")
        tp.wait_for_timeout(150)
    check("theme cycles system -> light -> dark -> system",
          seen == ["system", "light", "dark", "system"], f"-> {seen}")

    tp.evaluate("() => localStorage.setItem('hanji.theme','dark')")
    tp.reload(wait_until="domcontentloaded")
    # Asserted at domcontentloaded, not networkidle: the whole point of the
    # separate theme-init.js is that it lands before first paint.
    check("explicit dark beats a light OS, before first paint",
          tp.get_attribute("html", "data-theme") == "dark",
          f'-> {tp.get_attribute("html", "data-theme")!r}')
    themed.close()

    # --- touch targets at a phone width ---
    phone = browser.new_context(
        viewport={"width": 320, "height": 780}, has_touch=True, is_mobile=True
    )
    pp = phone.new_page()
    pp.goto(URL, wait_until="networkidle")
    pp.set_input_files("input[type=file]", HWP)
    pp.wait_for_selector(".exportbar-button", timeout=60000)
    pp.wait_for_timeout(2000)
    metrics = pp.evaluate("""() => {
      const de = document.documentElement;
      return {
        overflow: de.scrollWidth - de.clientWidth,
        minButton: Math.min(...[...document.querySelectorAll('button')]
          .map(e => Math.round(e.getBoundingClientRect().height))),
      };
    }""")
    check("320px: no sideways scroll and every target >= 44px",
          metrics["overflow"] <= 0 and metrics["minButton"] >= 44,
          f'-> overflow {metrics["overflow"]}px, smallest button {metrics["minButton"]}px')
    phone.close()

    # --- conversions ---
    #
    # Asserting on the produced bytes, not on the button having been clicked. A
    # converter that emits a plausible-looking file which no application can
    # open is worse than one that fails loudly.
    conv = browser.new_page(accept_downloads=True)
    conv.on(
        "request",
        lambda r: foreign.append(r.url)
        if not r.url.startswith(ORIGIN)
        and not r.url.startswith("blob:")
        and not r.url.startswith("data:")
        else None,
    )
    conv.goto(URL, wait_until="networkidle")

    def convert(path, target_id):
        conv.set_input_files("input[type=file]", path)
        conv.wait_for_selector(
            f".exportbar-button[data-target={target_id}]", timeout=60000
        )
        with conv.expect_download(timeout=180000) as handle:
            conv.click(f".exportbar-button[data-target={target_id}]")
        # Keep the produced suffix: the app dispatches on extension, so a file
        # saved without one cannot be fed back in.
        download = handle.value
        suffix = os.path.splitext(download.suggested_filename)[1]
        out = os.path.join(tempfile.gettempdir(), f"hanji-e2e-{target_id}{suffix}")
        download.save_as(out)
        return out

    hwpx = convert(HWP, "hwpx")
    entries = zipfile.ZipFile(hwpx).namelist() if zipfile.is_zipfile(hwpx) else []
    check(
        "HWP converts to a structurally valid HWPX",
        "mimetype" in entries and any(e.startswith("Contents/") for e in entries),
        f"-> {entries[:4]}",
    )

    out = convert(HWP, "pdf")
    with open(out, "rb") as fh:
        check("HWP converts to a PDF", fh.read(5) == b"%PDF-")

    out = convert(HWP, "png")
    entries = zipfile.ZipFile(out).namelist() if zipfile.is_zipfile(out) else []
    check("HWP converts to one PNG per page", len(entries) == hwp_pages,
          f"-> {len(entries)} entries for {hwp_pages} pages")

    out = convert(PDF, "png")
    entries = zipfile.ZipFile(out).namelist() if zipfile.is_zipfile(out) else []
    check("PDF converts to one PNG per page", len(entries) == pdf_pages,
          f"-> {len(entries)} entries for {pdf_pages} pages")

    # The output has to be openable, so feed the converted HWPX straight back in.
    conv.set_input_files("input[type=file]", hwpx)
    conv.wait_for_selector(".viewer img.page", timeout=90000)
    conv.wait_for_timeout(2500)
    check(
        "the converted HWPX reopens",
        conv.locator(".viewer img.page").count() == hwp_pages,
        f"-> {conv.locator('.viewer img.page').count()} pages",
    )
    conv.close()

    check("conversions sent nothing either", len(foreign) == 0, f"-> {foreign[:3]}")

    page.screenshot(path="/tmp/hanji-shot-final.png", full_page=False)
    page.set_input_files('input[type=file]', HWP)
    page.wait_for_selector(".viewer img.page", timeout=60000)
    page.wait_for_timeout(2000)
    page.screenshot(path="/tmp/hanji-shot-hwp.png", full_page=False)

    browser.close()

print()
if failures:
    print(f"FAILED: {failures}")
    sys.exit(1)
print("ALL CHECKS PASSED")
