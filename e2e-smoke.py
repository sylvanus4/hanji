"""Headless smoke test: does hanji actually open a real HWP in a browser?

This exists because "it typechecks and builds" is not evidence that a WASM engine
loads, that lazy chunks resolve, or that pages render. It drives a real Chromium
against the production build and asserts on what appears on screen.
"""

import os
import pathlib
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
# Optional. The video and image batch checks are skipped rather than failed when
# these are absent, because they exercise added features and should not stop
# someone verifying the core claim.
VIDEO = os.environ.get("HANJI_FIXTURE_VIDEO", "")
IMAGES = sorted(
    p for p in os.environ.get("HANJI_FIXTURE_IMAGES", "").split(os.pathsep) if p
)


def pdf_page_count(browser_page, path: str) -> int:
    """Count pages by reopening the file in the app and counting what renders.

    An earlier version scanned the bytes for /Type /Page markers and reported
    zero for every file, because pdf-lib writes page dictionaries into
    deflate-compressed object streams where those markers do not appear as plain
    text. The comment defending that shortcut claimed our own output was the
    safe case to parse crudely; our own output was in fact exactly the case it
    could not read.

    Feeding the file back through the viewer needs no new dependency and asserts
    something stronger anyway: not that the bytes contain a marker, but that the
    document opens and shows the pages it should.
    """
    browser_page.set_input_files("input[type=file]", path)
    browser_page.wait_for_selector(".viewer canvas.page", timeout=90000)
    browser_page.wait_for_timeout(1500)
    return browser_page.locator(".viewer canvas.page").count()

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
    # Only rectangles that are actually painted.
    #
    # <defs> holds the clip paths, and the engine emits one body clip per page
    # that is wider than the sheet. Nothing inside <defs> is ever drawn, so
    # counting those rectangles reports an overflow that no reader could see —
    # which is exactly what it did, blaming a correctly placed table for a clip
    # region sitting behind it at the same origin.
    #
    # Third time in this suite that a check has measured the wrong thing: the
    # PDF page counter scanned for markers that live in compressed streams, the
    # GIF frame counter matched its marker inside LZW data, and now this. The
    # pattern is scanning a structured format as if it were flat text. When a
    # check fails, confirm what it measured before believing what it claims.
    painted = re.sub(r"<defs>.*?</defs>", "", svg, flags=re.S)
    edges = [
        float(x.group(1)) + float(w.group(1))
        for r in re.findall(r"<rect[^>]*>", painted)
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
            f".exportbar [data-target={target_id}]", timeout=60000
        )
        with conv.expect_download(timeout=180000) as handle:
            conv.click(f".exportbar [data-target={target_id}]")
        # Keep the produced suffix: the app dispatches on extension, so a file
        # saved without one cannot be fed back in.
        download = handle.value
        suffix = os.path.splitext(download.suggested_filename)[1]
        out = os.path.join(tempfile.gettempdir(), f"hanji-e2e-{target_id}{suffix}")
        download.save_as(out)
        return out

    # The Hangul handler offers whichever of HWP/HWPX the file is not, so which
    # button to press depends on the fixture. Hard-coding hwpx made the suite
    # hang for a full minute against an .hwpx fixture, waiting for a button the
    # app is correct not to offer.
    other = "hwp" if HWP.lower().endswith(".hwpx") else "hwpx"
    converted = convert(HWP, other)

    if other == "hwpx":
        entries = zipfile.ZipFile(converted).namelist() if zipfile.is_zipfile(converted) else []
        check(
            "HWP converts to a structurally valid HWPX",
            "mimetype" in entries and any(e.startswith("Contents/") for e in entries),
            f"-> {entries[:4]}",
        )
    else:
        # HWP 5.0 is an OLE compound file; this is that format's magic number.
        head = open(converted, "rb").read(8)
        check(
            "HWPX converts to a structurally valid HWP",
            head == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",
            f"-> {head.hex(' ')}",
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

    # --- PDF editing ---
    #
    # These are the lossless operations: the output must still be a real PDF
    # whose text a reader can select, which is the whole reason they exist
    # rather than being another rasterise-and-hope path.
    out = convert(PDF, "split")
    entries = zipfile.ZipFile(out).namelist() if zipfile.is_zipfile(out) else []
    check("PDF splits into one file per page", len(entries) == pdf_pages,
          f"-> {len(entries)} entries for {pdf_pages} pages")
    if entries:
        with zipfile.ZipFile(out) as z:
            check("each split piece is a real PDF",
                  z.read(entries[0])[:5] == b"%PDF-")

    out = convert(PDF, "rotate")
    check("PDF rotates and stays a PDF", open(out, "rb").read(5) == b"%PDF-")
    rotated_pages = pdf_page_count(conv, out)
    check("rotating keeps every page", rotated_pages == pdf_pages,
          f"-> {rotated_pages} pages")

    conv.set_input_files("input[type=file]", PDF)
    conv.wait_for_selector(".exportbar-field", timeout=60000)
    conv.fill(".exportbar-field", "1")
    with conv.expect_download(timeout=120000) as handle:
        conv.click(".exportbar-button[data-target=extract]")
    extracted = os.path.join(tempfile.gettempdir(), "hanji-e2e-extract.pdf")
    handle.value.save_as(extracted)
    kept = pdf_page_count(conv, extracted)
    check("page range keeps only the pages asked for", kept == 1,
          f"-> {kept} pages from spec '1'")

    # An empty field must not silently produce a broken file.
    conv.set_input_files("input[type=file]", PDF)
    conv.wait_for_selector(".exportbar-field", timeout=60000)
    conv.fill(".exportbar-field", "")
    conv.click(".exportbar-button[data-target=extract]")
    conv.wait_for_timeout(400)
    check("empty page range refuses instead of guessing",
          "쪽 번호" in conv.inner_text("#status"),
          f'-> {conv.inner_text("#status")!r}')

    # --- video: frames without ffmpeg ---
    if os.path.exists(VIDEO):
        conv.set_input_files("input[type=file]", VIDEO)
        conv.wait_for_selector(".viewer video.page", timeout=60000)
        check("video opens with the platform decoder",
              conv.locator(".viewer video.page").count() == 1)

        out = convert(VIDEO, "stills")
        entries = zipfile.ZipFile(out).namelist() if zipfile.is_zipfile(out) else []
        check("video yields still frames", len(entries) >= 1,
              f"-> {len(entries)} stills")

        out = convert(VIDEO, "gif-video-realtime")
        with open(out, "rb") as fh:
            head = fh.read(6)
        check("video yields a real GIF", head in (b"GIF89a", b"GIF87a"),
              f"-> magic {head!r}, {os.path.getsize(out)} bytes")

    # --- several files at once ---
    #
    # Multi-file intake is what makes merge and GIF possible at all, so these
    # check the intake as much as the encoders.
    conv.set_input_files("input[type=file]", IMAGES)
    conv.wait_for_selector(".batch-thumb", timeout=60000)
    check("a batch of images shows every one of them",
          conv.locator(".batch-thumb").count() == len(IMAGES),
          f"-> {conv.locator('.batch-thumb').count()} thumbnails")

    def convert_many(paths, target_id):
        conv.set_input_files("input[type=file]", paths)
        conv.wait_for_selector(
            f".exportbar [data-target={target_id}]", timeout=60000
        )
        with conv.expect_download(timeout=180000) as handle:
            conv.click(f".exportbar [data-target={target_id}]")
        download = handle.value
        suffix = os.path.splitext(download.suggested_filename)[1]
        out = os.path.join(tempfile.gettempdir(), f"hanji-e2e-many-{target_id}{suffix}")
        download.save_as(out)
        return out

    out = convert_many(IMAGES, "gif-slideshow")
    with open(out, "rb") as fh:
        head = fh.read(6)
    check("images become a real GIF", head in (b"GIF89a", b"GIF87a"),
          f"-> magic {head!r}, {os.path.getsize(out)} bytes")

    # --- GIF presets ---
    #
    # A preset that produced a valid GIF but ignored its own settings would pass
    # the check above, so these read the settings back out of the bytes. Each
    # one targets the single property that distinguishes that preset from the
    # default, because a preset nobody can tell apart from another is not a
    # feature, it is ten buttons.
    def gif_facts(path):
        """Read a GIF's real structure by walking its blocks.

        The first version of this counted occurrences of the three bytes that
        introduce a frame and reported five frames in a four-frame boomerang,
        because that byte sequence also turned up inside the compressed image
        data. It failed a feature that was working correctly — the second time
        in this suite that a shortcut in the checker accused the code.

        Walking the blocks costs about twenty lines, cannot be fooled by
        compressed bytes, and yields the per-frame delays as well, which is what
        the presets are actually made of.
        """
        data = pathlib.Path(path).read_bytes()
        # Header, then the logical screen descriptor: width and height first.
        width = int.from_bytes(data[6:8], "little")
        height = int.from_bytes(data[8:10], "little")
        flags = data[10]
        i = 13
        if flags & 0x80:  # skip the global colour table
            i += 3 * (2 ** ((flags & 7) + 1))

        frames, delays, loops = 0, [], False
        while i < len(data) and data[i] != 0x3B:  # 0x3B is the trailer
            marker = data[i]
            if marker == 0x21:  # extension
                label = data[i + 1]
                i += 2
                if label == 0xFF and data[i + 1:i + 12] == b"NETSCAPE2.0":
                    loops = True  # the record that makes a GIF repeat
                if label == 0xF9:  # graphic control: delay in centiseconds
                    delays.append(int.from_bytes(data[i + 2:i + 4], "little") * 10)
                while i < len(data) and data[i] != 0:
                    i += data[i] + 1
                i += 1
            elif marker == 0x2C:  # image descriptor: one per frame
                frames += 1
                local = data[i + 9]
                i += 10
                if local & 0x80:  # skip the local colour table
                    i += 3 * (2 ** ((local & 7) + 1))
                i += 1  # LZW minimum code size
                while i < len(data) and data[i] != 0:
                    i += data[i] + 1
                i += 1
            else:
                break

        return {"width": width, "height": height, "frames": frames,
                "delays": delays, "loops": loops}

    base = gif_facts(out)
    check("a slideshow GIF repeats, one frame per picture, at its stated pace",
          base["loops"] and base["frames"] == len(IMAGES)
          and set(base["delays"]) == {1200},
          f"-> {base['frames']} frames, delays {base['delays']}, loops={base['loops']}")

    cover = gif_facts(convert_many(IMAGES, "gif-cover"))
    # The one preset whose entire point is that frames differ from each other.
    check("holding the cover gives the first picture its own longer delay",
          cover["delays"][:1] == [2000] and set(cover["delays"][1:]) == {500},
          f"-> delays {cover['delays']}")

    boomerang = gif_facts(convert_many(IMAGES, "gif-boomerang"))
    # Out and back without repeating either endpoint: n + (n - 2).
    expected = len(IMAGES) * 2 - 2
    check("a boomerang GIF plays back out and returns",
          boomerang["frames"] == expected,
          f"-> {boomerang['frames']} frames, expected {expected}")

    once = gif_facts(convert_many(IMAGES, "gif-once"))
    check("a play-once GIF carries no loop record",
          not once["loops"], f"-> loops={once['loops']}")

    chat = gif_facts(convert_many(IMAGES, "gif-chat"))
    check("a chat-sized GIF is capped at 320px on its long edge",
          max(chat["width"], chat["height"]) == 320,
          f"-> {chat['width']}x{chat['height']}")

    out = convert_many(IMAGES, "pdf")
    # Kept under its own name: the print section needs a document with more than
    # one page, and `out` is reassigned twice before it gets there.
    images_pdf = out
    made = pdf_page_count(conv, out)
    check("images become one PDF page each", made == len(IMAGES),
          f"-> {made} pages for {len(IMAGES)} images")

    out = convert_many([PDF, PDF], "merge")
    merged = pdf_page_count(conv, out)
    check("merging two PDFs sums their pages", merged == pdf_pages * 2,
          f"-> {merged} pages, expected {pdf_pages * 2}")

    # Mixing kinds has no sensible answer, so it must say so rather than pick one.
    conv.set_input_files("input[type=file]", [PDF, IMAGES[0]])
    conv.wait_for_selector(".viewer-error", timeout=30000)
    check("a mixed batch explains itself",
          "같은 종류" in conv.inner_text(".viewer-error"),
          f'-> {conv.inner_text(".viewer-error")[:50]!r}')

    # The output has to be openable, so feed the converted file straight back in.
    conv.set_input_files("input[type=file]", converted)
    conv.wait_for_selector(".viewer img.page", timeout=90000)
    conv.wait_for_timeout(2500)
    check(
        f"the converted {other.upper()} reopens",
        conv.locator(".viewer img.page").count() == hwp_pages,
        f"-> {conv.locator('.viewer img.page').count()} pages",
    )
    conv.close()

    check("conversions sent nothing either", len(foreign) == 0, f"-> {foreign[:3]}")

    # --- print ---
    #
    # Asserted by actually printing. A print stylesheet is the kind of thing
    # that looks right in the source and produces one sheet of a scrolled
    # viewport in practice, because the screen layout is a fixed-height app
    # shell and every one of its scroll containers has to be unwound. Chromium
    # renders page.pdf() through the print stylesheet, so the page count of that
    # file is the real answer to "what would come out of the printer".
    pr = browser.new_page()
    pr.goto(URL, wait_until="networkidle")
    pr.set_input_files("input[type=file]", HWP)
    pr.wait_for_selector(".viewer img.page", timeout=90000)
    pr.wait_for_timeout(2500)

    check(
        "a document offers to print",
        pr.locator(".exportbar [data-target=print]").count() == 1,
        f'-> {pr.inner_text(".exportbar [data-target=print]").strip()!r}',
    )

    pr.emulate_media(media="print")
    hidden = pr.evaluate(
        """() => [".bar", ".exportbar", ".viewer-status"]
             .filter(s => document.querySelector(s))
             .filter(s => getComputedStyle(document.querySelector(s)).display !== "none")"""
    )
    check("the interface is not on the paper", hidden == [], f"-> still shown: {hidden}")
    scrollers = pr.evaluate(
        """() => [".stage", ".viewer"]
             .filter(s => getComputedStyle(document.querySelector(s)).overflow !== "visible")"""
    )
    check(
        "no scroll container survives into print",
        scrollers == [],
        f"-> still clipping: {scrollers}",
    )
    # The print emulation deliberately stays on through pdf() below.
    #
    # page.pdf() renders with print media by default, but an explicit
    # emulate_media() call overrides that default and keeps overriding it. This
    # test switched back to screen after the style assertions and then printed —
    # producing one sheet of the screen layout and reporting the print
    # stylesheet as broken while it was in fact working.

    # Deliberately printed from a multi-page document rather than the Hangul
    # fixture, which may well be a single page. One sheet for one page is true
    # of a completely broken print stylesheet too, so it is no evidence at all;
    # the thing worth proving is that page two exists and did not get clipped
    # away with the scroll container it was sitting in.
    multi = images_pdf if len(IMAGES) > 1 else PDF
    expected = pdf_page_count(pr, multi)
    pr.wait_for_timeout(1000)

    printed = os.path.join(tempfile.gettempdir(), "hanji-printed.pdf")
    pr.pdf(path=printed, prefer_css_page_size=True)
    printed_pages = pdf_page_count(pr, printed)
    # The failure this catches is a single sheet showing whatever happened to be
    # scrolled into view, which is what an unstyled print of this app produces.
    check(
        "printing yields one sheet per document page",
        printed_pages == expected and expected > 1,
        f"-> {printed_pages} sheets for {expected} pages",
    )
    pr.close()

    if VIDEO:
        vid = browser.new_page()
        vid.goto(URL, wait_until="networkidle")
        vid.set_input_files("input[type=file]", VIDEO)
        vid.wait_for_selector(".video-page", timeout=60000)
        vid.wait_for_timeout(1500)
        # A paused frame of a recording is not a document. Offering to print it
        # would be offering something nobody asked for.
        check(
            "a video does not offer to print",
            vid.locator(".exportbar [data-target=print]").count() == 0,
        )
        vid.close()

    # --- print, desktop path ---
    #
    # The desktop shell must not use window.print(): inside a packaged web view
    # on macOS that call can return having done nothing, and a print button that
    # silently does nothing is worse than none, because the user blames the
    # document. So the packaged app goes through a Rust command instead, and
    # this asserts the button reaches for that command and not the web one.
    desk = browser.new_page()
    desk.add_init_script(
        """window.__TAURI_INTERNALS__ = {
             invoke: (cmd) => { (window.__invoked ||= []).push(cmd);
                                return Promise.resolve(); },
             transformCallback: (cb) => cb,
           };
           window.__webPrintCalled = false;
           window.print = () => { window.__webPrintCalled = true; };"""
    )
    desk.goto(URL, wait_until="networkidle")
    desk.set_input_files("input[type=file]", HWP)
    desk.wait_for_selector(".viewer img.page", timeout=90000)
    desk.wait_for_timeout(2000)
    desk.click(".exportbar [data-target=print]")
    desk.wait_for_timeout(800)
    invoked = desk.evaluate("() => window.__invoked || []")
    check(
        "the desktop build prints through the shell, not the web view",
        invoked == ["print_document"]
        and desk.evaluate("() => window.__webPrintCalled") is False,
        f"-> invoked {invoked}",
    )
    check(
        "printing does not make the app accuse itself of sending anything",
        desk.inner_text(".netbadge").strip() == "전송 0",
        f'-> "{desk.inner_text(".netbadge").strip()}"',
    )
    desk.close()

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
