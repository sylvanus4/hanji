#!/usr/bin/env python3
"""
Record the one-minute LinkedIn demo: four real conversions, end to end.

Scripted rather than screen-captured by hand. A hand-recorded clip goes stale the
moment a label changes and nobody re-records it, so the demo quietly keeps
advertising an interface that no longer exists. This regenerates from the
current build, which means it can be re-run at release instead of rotting.

Every drop is a real DataTransfer through the app's own handler and every
conversion actually runs and actually produces a file. Nothing is mocked, so if
a feature breaks the demo breaks with it rather than continuing to show it
working.

Shape is 1080x1350 — LinkedIn's tallest feed-friendly ratio, so the post takes
the most vertical space a phone will give it. Captions are burned in above and
below the window rather than over it: the feed autoplays muted, so the text is
the narration, and covering the interface to explain the interface is silly.

    export HANJI_FIXTURE_VIDEO=/path/to/any.mp4   # optional, case 4 is skipped without it
    npm run preview &                             # or set HANJI_URL
    python3 linkedin-record.py
    → docs/media/linkedin-demo.mp4
"""

import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent
OUT = HERE / "docs" / "media"
BASE = os.environ.get("HANJI_URL", "http://127.0.0.1:4173/")
VIDEO = os.environ.get("HANJI_FIXTURE_VIDEO", "")
FIXTURES = pathlib.Path(os.environ.get("HANJI_FIXTURE_DIR", "/tmp/hanji-fix"))

# Recorded small and scaled up, deliberately.
#
# A 1240px-wide capture placed in a 1080px slot is nearly 1:1, and on a phone
# feed — where this video is maybe 400px across — the toolbar labels become
# unreadable smudges, so the viewer can see that something happened but not
# what. Capturing at 900 and scaling up magnifies the whole interface by about
# 40%, which is the difference between a demo and a blur. Compared side by side
# at final output size before choosing.
VIEW = {"width": 900, "height": 660}
FRAME_W, FRAME_H = 1080, 1350
APP_W = 1080
APP_H = round(VIEW["height"] * APP_W / VIEW["width"])   # 784
TOP = 250                                              # headline band
BOTTOM = FRAME_H - TOP - APP_H                         # 316, caption band

# The seal is the vermillion of the app's mark, not the green of the badge.
# The two were the same colour until the mark stopped being a green tile.
PAPER, INK, SOFT, SEAL = "#fcfaf7", "#1a1814", "#5a5854", "#b23a2e"


# --------------------------------------------------------------------------
# 1. capture — drive the real app, one webm per case
# --------------------------------------------------------------------------

def drop(page, paths):
    """A real drag-and-drop, not a file-picker call dressed up as one.

    The app listens for drop events; going through set_input_files would exercise
    a different code path from the one every visitor actually uses, and would let
    drag-and-drop rot silently.
    """
    payload = []
    for p in paths:
        payload.append({"name": pathlib.Path(p).name,
                        "buffer": pathlib.Path(p).read_bytes().hex()})
    page.evaluate(
        """(files) => {
            const dt = new DataTransfer();
            for (const f of files) {
                const bytes = new Uint8Array(f.buffer.match(/../g).map(h => parseInt(h, 16)));
                dt.items.add(new File([bytes], f.name));
            }
            const stage = document.querySelector('#stage');
            stage.dispatchEvent(new DragEvent('dragover', {dataTransfer: dt, bubbles: true}));
            stage.dispatchEvent(new DragEvent('drop', {dataTransfer: dt, bubbles: true}));
        }""",
        payload,
    )


def record(case, action, work_dir):
    """Run one case in its own browser context so each gets its own video file."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport=VIEW, record_video_dir=str(work_dir),
                                  record_video_size=VIEW)
        page = ctx.new_page()
        # Downloads are accepted and thrown away: the point is that the
        # conversion really ran, not that the file is kept.
        page.on("download", lambda d: d.cancel())
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(700)
        action(page)
        page.wait_for_timeout(900)
        path = page.video.path()
        ctx.close()
        browser.close()
    final = work_dir / f"{case}.webm"
    shutil.move(path, final)
    return final


def case_hangul(page):
    drop(page, [FIXTURES / "예시-문서.hwpx"])
    page.wait_for_selector(".viewer img.page", timeout=60000)
    page.wait_for_timeout(2200)
    page.click(".exportbar [data-target=pdf]")
    page.wait_for_timeout(2600)


def case_print(page):
    drop(page, [FIXTURES / "예시-문서.hwpx"])
    page.wait_for_selector(".viewer img.page", timeout=60000)
    page.wait_for_timeout(1900)
    page.hover(".exportbar [data-target=print]")
    page.wait_for_timeout(900)
    # The print dialog belongs to the operating system and cannot be filmed, so
    # the call is stubbed. What the viewer sees instead is the more useful half:
    # the same pages with the interface taken off, which is what would actually
    # have gone to the printer.
    page.evaluate("() => { window.print = () => {}; }")
    page.click(".exportbar [data-target=print]")
    page.wait_for_timeout(1100)
    page.emulate_media(media="print")
    page.wait_for_timeout(3200)
    page.emulate_media(media="screen")
    page.wait_for_timeout(600)


def case_pdf(page):
    drop(page, [FIXTURES / "sample-doc.pdf"])
    page.wait_for_selector(".exportbar [data-target=extract]", timeout=60000)
    page.wait_for_timeout(1400)
    field = page.locator(".exportbar-field").first
    field.click()
    # Typed a character at a time so the viewer can see it being entered.
    field.type("1", delay=260)
    page.wait_for_timeout(700)
    page.click(".exportbar [data-target=extract]")
    page.wait_for_timeout(2200)


def case_gif(page):
    drop(page, [FIXTURES / f"{n:02d}-sample.png" for n in (1, 2, 3)])
    page.wait_for_selector(".exportbar-chip", timeout=60000)
    page.wait_for_timeout(2400)
    page.hover(".exportbar [data-target=gif-boomerang]")
    page.wait_for_timeout(900)
    page.click(".exportbar [data-target=gif-boomerang]")
    page.wait_for_timeout(3000)


def case_video(page):
    drop(page, [VIDEO])
    page.wait_for_selector(".viewer video.page", timeout=60000)
    page.wait_for_timeout(2000)
    page.click(".exportbar [data-target=stills]")
    page.wait_for_timeout(3400)


# --------------------------------------------------------------------------
# 2. cards — Korean captions rendered by the browser, not by ffmpeg
# --------------------------------------------------------------------------
#
# drawtext would need a font path and gets Hangul shaping wrong often enough to
# be a liability. Chromium already renders this text correctly on screen, so the
# bands are rendered there and composited as images.

CARD = """
<html><head><meta charset=utf-8><style>
  @font-face {{ font-family: x; src: local("Pretendard"); }}
  * {{ margin:0; box-sizing:border-box }}
  /*
    The body stays transparent and the two bands paint their own background, so
    the slot between them punches a hole for the recording underneath. An opaque
    body here covers the very window the card exists to frame — which is exactly
    what the first render did, producing sixty seconds of captions over nothing.
  */
  body {{ width:{W}px; height:{H}px; background:transparent;
         font-family: Pretendard, -apple-system, 'Apple SD Gothic Neo', sans-serif;
         color:{ink}; display:flex; flex-direction:column; }}
  .top {{ height:{TOP}px; padding:52px 64px 0; background:{paper}; }}
  .step {{ font-size:22px; letter-spacing:.16em; color:{seal}; font-weight:700; margin-bottom:14px }}
  .head {{ font-size:56px; line-height:1.16; letter-spacing:-.03em; font-weight:700;
           word-break:keep-all }}
  .gap {{ height:{APP_H}px }}   /* the hole */
  .bot {{ height:{BOTTOM}px; padding:38px 64px 0; background:{paper}; }}
  .sub {{ font-size:30px; line-height:1.5; color:{soft}; word-break:keep-all }}
  .rail {{ position:absolute; left:64px; right:64px; bottom:52px;
           display:flex; align-items:center; gap:10px }}
  .seg {{ height:5px; flex:1; border-radius:3px; background:#e2dfda }}
  .seg.on {{ background:{seal} }}
  .brand {{ position:absolute; right:64px; bottom:78px; font-size:20px; color:#9a9791;
            letter-spacing:.04em }}
</style></head><body>
  <div class=top><div class=step>{step}</div><div class=head>{head}</div></div>
  <div class=gap></div>
  <div class=bot><div class=sub>{sub}</div></div>
  <div class=rail>{segs}</div>
  <div class=brand>hanji</div>
</body></html>
"""

FULL = """
<html><head><meta charset=utf-8><style>
  * {{ margin:0; box-sizing:border-box }}
  body {{ width:{W}px; height:{H}px; background:{bg}; color:{fg};
          font-family: Pretendard, -apple-system, 'Apple SD Gothic Neo', sans-serif;
          display:flex; flex-direction:column; justify-content:center; padding:0 76px }}
  .mark {{ width:96px; height:96px; border-radius:14px; background:{seal};
           display:grid; place-items:center; margin-bottom:44px }}
  .kicker {{ font-size:24px; letter-spacing:.18em; color:{kicker}; font-weight:700; margin-bottom:20px }}
  h1 {{ font-size:{hsize}px; line-height:1.12; letter-spacing:-.035em; font-weight:700;
        word-break:keep-all; margin-bottom:28px }}
  p {{ font-size:31px; line-height:1.55; color:{sub}; word-break:keep-all }}
  .url {{ margin-top:40px; font-size:29px; color:{seal2}; font-weight:600 }}
</style></head><body>
  <div class=mark>
    <svg width=58 height=58 viewBox="0 0 64 64">
      <g fill=none stroke="#fcfaf7" stroke-width=5 stroke-linecap=round>
        <path d="M32 12.5v4.5"/><path d="M20.5 24h23"/></g>
      <circle cx=32 cy=40.5 r=9.5 fill=none stroke="#fcfaf7" stroke-width=5/>
    </svg>
  </div>
  <div class=kicker>{kicker_text}</div>
  <h1>{title}</h1>
  <p>{body}</p>
  {url_block}
</body></html>
"""


def render_cards(cases, work):
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": FRAME_W, "height": FRAME_H})

        for i, c in enumerate(cases):
            segs = "".join(
                f'<div class="seg{" on" if j <= i else ""}"></div>' for j in range(len(cases))
            )
            pg.set_content(CARD.format(W=FRAME_W, H=FRAME_H, TOP=TOP, APP_H=APP_H,
                                       BOTTOM=BOTTOM, paper=PAPER, ink=INK, soft=SOFT,
                                       seal=SEAL, step=c["step"], head=c["head"],
                                       sub=c["sub"], segs=segs))
            pg.wait_for_timeout(150)
            pg.screenshot(path=str(work / f"card-{c['id']}.png"), omit_background=True)

        pg.set_content(FULL.format(W=FRAME_W, H=FRAME_H, bg=PAPER, fg=INK, seal=SEAL,
                                   seal2=SEAL, kicker="#9a9791", sub=SOFT, hsize=76,
                                   kicker_text="한글 · PDF · 이미지 · 동영상",
                                   title="문서가 이 기기를<br>벗어나지 않습니다",
                                   body="변환하려고 파일을 어딘가에 올리지 않습니다.<br>여는 것도 바꾸는 것도 이 컴퓨터 안에서 끝납니다.",
                                   url_block=""))
        pg.wait_for_timeout(150)
        pg.screenshot(path=str(work / "card-intro.png"))

        pg.set_content(FULL.format(W=FRAME_W, H=FRAME_H, bg=INK, fg=PAPER, seal=SEAL,
                                   seal2="#7ee0a3", kicker="#8d8a85", sub="#c9c6c1", hsize=64,
                                   kicker_text="MACOS · WINDOWS · MIT 오픈소스",
                                   title="설치해서 인터넷을 끄고<br>써보셔도 됩니다",
                                   body="설치 파일과 단계별 안내는 아래에 있습니다.",
                                   url_block='<div class=url>sylvanus4.github.io/hanji-download</div>'))
        pg.wait_for_timeout(150)
        pg.screenshot(path=str(work / "card-outro.png"))
        b.close()


# --------------------------------------------------------------------------
# 3. compose — pad each clip into the frame, stamp its card, concat
# --------------------------------------------------------------------------

def ff(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "json", str(path)], capture_output=True, text=True, check=True)
    return float(json.loads(out.stdout)["format"]["duration"])


def segment(clip, card, seconds, dst):
    """One case: scale the recording into the window slot, lay the card over it.

    The clip is retimed to the target length rather than cut, so a conversion
    that happens to run long still shows its whole self, just faster. Cutting
    would drop the moment the file is saved, which is the only part that proves
    anything.
    """
    have = duration(clip)
    rate = max(0.35, min(2.6, have / seconds))
    ff("-i", str(clip), "-i", str(card),
       "-filter_complex",
       f"[0:v]setpts=PTS/{rate:.5f},scale={APP_W}:{APP_H}:flags=lanczos,"
       f"pad={FRAME_W}:{FRAME_H}:0:{TOP}:color={PAPER}[app];"
       f"[app][1:v]overlay=0:0:format=auto[v]",
       "-map", "[v]", "-t", f"{seconds}", "-r", "30",
       "-c:v", "libx264", "-preset", "medium", "-crf", "20",
       "-pix_fmt", "yuv420p", str(dst))


def still(card, seconds, dst):
    ff("-loop", "1", "-i", str(card), "-t", f"{seconds}", "-r", "30",
       "-c:v", "libx264", "-preset", "medium", "-crf", "20",
       "-pix_fmt", "yuv420p", "-vf", f"scale={FRAME_W}:{FRAME_H}", str(dst))


def main():
    if not FIXTURES.exists():
        sys.exit(f"Fixtures not found at {FIXTURES}. Set HANJI_FIXTURE_DIR.")

    cases = [
        {"id": "hangul", "fn": case_hangul, "secs": 12,
         "step": "01 · 한글 문서",
         "head": "공공기관이 요구하는<br>형식으로 바꿉니다",
         "sub": "HWP·HWPX를 열고 PDF나 개방형 포맷으로. 어디에도 올리지 않습니다."},
        {"id": "print", "fn": case_print, "secs": 11,
         "step": "02 · 인쇄",
         "head": "화면 그대로<br>종이로 나갑니다",
         "sub": "도구 막대도 배지도 빠집니다. 한 쪽이 한 장으로 나갑니다."},
        {"id": "pdf", "fn": case_pdf, "secs": 10,
         "step": "03 · PDF",
         "head": "필요한 쪽만<br>골라냅니다",
         "sub": "쪽 번호만 적으면 됩니다. 다시 그리지 않아 글자는 그대로 남습니다."},
        {"id": "gif", "fn": case_gif, "secs": 11,
         "step": "04 · 사진 여러 장",
         "head": "고르면 바로<br>GIF가 됩니다",
         "sub": "슬라이드쇼·타임랩스·왕복 재생처럼 쓰임새로 고릅니다."},
    ]
    if VIDEO and pathlib.Path(VIDEO).exists():
        cases.append({"id": "video", "fn": case_video, "secs": 10,
                      "step": "05 · 동영상",
                      "head": "장면을 사진으로<br>뽑아냅니다",
                      "sub": "영상 전체에서 고르게. ffmpeg 설치는 필요 없습니다."})
    else:
        print("! HANJI_FIXTURE_VIDEO not set — recording without the video case")

    work = pathlib.Path(tempfile.mkdtemp(prefix="hanji-li-"))
    print(f"working in {work}")

    print("rendering caption cards")
    render_cards(cases, work)

    parts = []
    intro = work / "seg-intro.mp4"
    still(work / "card-intro.png", 4, intro)
    parts.append(intro)

    for c in cases:
        print(f"recording {c['id']}")
        clip = record(c["id"], c["fn"], work)
        dst = work / f"seg-{c['id']}.mp4"
        segment(clip, work / f"card-{c['id']}.png", c["secs"], dst)
        parts.append(dst)

    outro = work / "seg-outro.mp4"
    still(work / "card-outro.png", 5, outro)
    parts.append(outro)

    listing = work / "parts.txt"
    listing.write_text("".join(f"file '{p}'\n" for p in parts))
    OUT.mkdir(parents=True, exist_ok=True)
    final = OUT / "linkedin-demo.mp4"
    # A silent AAC track is attached rather than shipping video-only. The feed
    # autoplays muted so there is nothing to hear either way, but several
    # players and uploaders handle a missing audio stream badly, and a track of
    # silence costs a few kilobytes to avoid finding out which ones.
    ff("-f", "concat", "-safe", "0", "-i", str(listing),
       "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
       "-shortest",
       "-c:v", "libx264", "-preset", "slow", "-crf", "21",
       "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k",
       "-movflags", "+faststart", str(final))

    print(f"\n{final}  {duration(final):.1f}s  {final.stat().st_size/1e6:.1f} MB")


if __name__ == "__main__":
    main()
