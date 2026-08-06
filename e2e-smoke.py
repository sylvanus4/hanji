"""Headless smoke test: does hanji actually open a real HWP in a browser?

This exists because "it typechecks and builds" is not evidence that a WASM engine
loads, that lazy chunks resolve, or that pages render. It drives a real Chromium
against the production build and asserts on what appears on screen.
"""

import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:4173/"
HWP = "/Users/hanhyojung/Downloads/행정학개론(지방행정 포함)(지방9급)-D.hwp"
PDF = "/Users/hanhyojung/Downloads/행정학개론(지방행정 포함)(지방9급)-D.pdf"

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
        if not r.url.startswith("http://localhost:4173")
        and not r.url.startswith("blob:")
        and not r.url.startswith("data:")
        else None,
    )

    page.goto(URL, wait_until="networkidle")
    check("shell renders", "Drop a document" in page.inner_text("body"))
    check("badge starts clean", page.inner_text(".netbadge").strip().lower() == "0 sent",
          f'-> "{page.inner_text(".netbadge").strip()}"')

    # --- HWP ---
    page.set_input_files('input[type=file]', HWP)
    page.wait_for_selector(".viewer img.page", timeout=60000)
    page.wait_for_timeout(2500)
    hwp_pages = page.locator(".viewer img.page").count()
    status = page.inner_text("#status")
    check("HWP renders pages", hwp_pages == 2, f"-> {hwp_pages} pages, status: {status!r}")

    # --- PDF ---
    page.set_input_files('input[type=file]', PDF)
    page.wait_for_selector(".viewer canvas.page", timeout=60000)
    page.wait_for_timeout(2500)
    pdf_pages = page.locator(".viewer canvas.page").count()
    check("PDF renders pages", pdf_pages == 2, f"-> {pdf_pages} pages")

    # --- unsupported format must fail visibly, not silently ---
    page.set_input_files('input[type=file]', __file__)
    page.wait_for_selector(".viewer-error", timeout=15000)
    check("unsupported format shows an error", True,
          f'-> {page.inner_text(".viewer-error")[:60]!r}')

    # --- the claim ---
    check("zero foreign requests", len(foreign) == 0, f"-> {foreign[:3]}")
    check("badge still clean after 3 files",
          page.inner_text(".netbadge").strip().lower() == "0 sent",
          f'-> "{page.inner_text(".netbadge").strip()}"')

    check("no uncaught page errors", not errors, f"-> {errors[:2]}")

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
