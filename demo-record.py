#!/usr/bin/env python3
"""
Record the 30-second usage demo used in the README.

Scripted rather than hand-recorded on purpose. A hand-captured screencast goes
stale the moment a label changes and nobody re-records it, so the demo quietly
starts showing an interface that no longer exists. This version regenerates from
the current build in about a minute, which means it can be re-run on release
instead of rotting.

The drop is a real DataTransfer drop through the app's own handler — not a
staged animation over a file picker — so if drag-and-drop ever breaks, the demo
breaks with it rather than continuing to advertise a feature that stopped
working.

    python3 demo-record.py            # needs `npm run preview` on :4173
    → docs/media/demo.mp4  (+ .gif if ffmpeg's palette filters are available)
"""

import base64
import os
import pathlib
import shutil
import subprocess
import sys

from playwright.sync_api import sync_playwright

HWP = pathlib.Path.home() / "Downloads" / "행정학개론(지방행정 포함)(지방9급)-D.hwp"
OUT = pathlib.Path(__file__).parent / "docs" / "media"

# Overridable because 4173 is Vite's shared default and another project's server
# can already hold it — in which case this script silently records that project's
# homepage instead of hanji. Ask for the URL rather than assuming the port.
BASE = os.environ.get("HANJI_URL", "http://127.0.0.1:4173/")

# 16:9 at a size that stays legible when GitHub scales it into a README column.
VIEWPORT = {"width": 1280, "height": 720}

CAPTION_CSS = """
#demo-caption {
  position: fixed; inset-inline: 0; bottom: 0; z-index: 9999;
  padding: 18px 28px;
  font: 600 21px/1.4 'Noto Sans KR', -apple-system, sans-serif;
  color: #fff; background: rgba(24,22,20,.88);
  backdrop-filter: blur(6px);
  transition: opacity .25s ease-out;
}
#demo-caption small { display:block; font-weight:400; font-size:15px; opacity:.75; margin-top:3px; }
"""


def caption(page, text: str, sub: str = "") -> None:
    page.evaluate(
        """([text, sub]) => {
        let el = document.querySelector('#demo-caption');
        if (!el) {
          el = document.createElement('div');
          el.id = 'demo-caption';
          document.body.append(el);
        }
        el.innerHTML = text + (sub ? '<small>' + sub + '</small>' : '');
    }""",
        [text, sub],
    )


def main() -> int:
    if not HWP.exists():
        print(f"missing sample document: {HWP}", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)

    payload = base64.b64encode(HWP.read_bytes()).decode()

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context(
            viewport=VIEWPORT,
            record_video_dir=str(OUT / ".raw"),
            record_video_size=VIEWPORT,
            device_scale_factor=2,
        )
        page = context.new_page()
        page.goto(BASE)
        page.add_style_tag(content=CAPTION_CSS)
        page.wait_for_selector(".empty-title")

        caption(page, "① 파일을 창에 끌어다 놓습니다", "작은 칸에 맞출 필요 없이 창 전체가 받습니다")
        page.wait_for_timeout(2600)

        # A genuine drop through the app's own listeners. The dashed outline the
        # viewer shows during a drag is the app reacting, not an overlay we drew.
        page.evaluate(
            """async ([name, b64]) => {
            const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            const file = new File([bin], name);
            const dt = new DataTransfer();
            dt.items.add(file);
            const stage = document.querySelector('#stage');
            const fire = (type) => stage.dispatchEvent(
              new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
            fire('dragenter');
            fire('dragover');
            await new Promise(r => setTimeout(r, 900));
            fire('drop');
        }""",
            [HWP.name, payload],
        )

        page.wait_for_selector(".viewer img.page", timeout=60_000)
        page.wait_for_timeout(700)
        caption(page, "② 문서가 열립니다", "오른쪽 위 '전송 0' — 어디로도 보내지 않았다는 실시간 계측입니다")
        page.wait_for_timeout(3000)

        page.mouse.wheel(0, 420)
        page.wait_for_timeout(1400)
        page.mouse.wheel(0, -420)
        page.wait_for_timeout(600)

        caption(page, "③ 다른 형식으로 저장", "공공기관 개방형 포맷인 HWPX로 바로 내보냅니다")
        page.wait_for_timeout(2200)

        with page.expect_download(timeout=120_000):
            page.get_by_role("button", name="HWPX", exact=False).first.click()

        page.wait_for_timeout(400)
        caption(page, "④ 끝났습니다", "변환도 이 기기 안에서 — 전송 계기는 여전히 0입니다")
        page.wait_for_timeout(3200)

        video = page.video
        context.close()
        browser.close()
        raw = pathlib.Path(video.path())

    mp4 = OUT / "demo.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(raw), "-vf", "scale=1280:-2",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26",
         "-movflags", "+faststart", str(mp4)],
        check=True, capture_output=True,
    )

    gif = OUT / "demo.gif"
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(raw),
         "-vf", "fps=10,scale=900:-1:flags=lanczos,split[a][b];"
                "[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer",
         str(gif)],
        check=True, capture_output=True,
    )

    shutil.rmtree(OUT / ".raw", ignore_errors=True)
    for f in (mp4, gif):
        print(f"{f.relative_to(pathlib.Path(__file__).parent)}  {f.stat().st_size / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
