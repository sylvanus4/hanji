/**
 * Named ways to turn a stack of frames into a GIF.
 *
 * The encoder could always do all of this; what was missing was any way to ask.
 * A single hardcoded half-second-per-frame merge serves exactly one of the
 * things people make GIFs for and quietly fails the rest: a forty-shot burst
 * wants a tenth of that, a screenshot someone has to read wants five times it,
 * and a two-shot before-and-after wants no downscaling at all, because
 * comparing detail is the entire point of it.
 *
 * What is offered is therefore the *outcome*, not the settings. Nobody opening
 * this app wants to reason about frame delay in milliseconds; they want
 * "슬라이드쇼" or "채팅에 붙이기", and they want it saved on the first click.
 * Every preset below is a use someone actually has, and its numbers are
 * downstream of that use rather than the other way round.
 *
 * Names live here beside the numbers instead of in the i18n catalogue. A preset
 * is a name and a set of values that mean it; separating them is how you end up
 * with a button called "타임랩스" that shows each photo for two seconds.
 */

/** Which source a preset belongs to. */
export type GifSubject = "images" | "video";

export type GifMotion = "forward" | "pingpong" | "reverse";

interface Bilingual {
  ko: string;
  en: string;
}

export interface GifPreset {
  /** Stable id; also the DOM test hook. */
  id: string;
  subject: GifSubject;
  /** Says what you would use it for. Short — it sits in a row of chips. */
  label: Bilingual;
  /** The one line under it. States the actual timing, so the name is checkable. */
  note: Bilingual;
  /** Milliseconds per frame. */
  delayMs: number;
  /** Longest edge in pixels. 0 keeps the original size. */
  maxEdge: number;
  /** 0 repeats forever, which is the GIF default; 1 plays once and stops. */
  loops?: number;
  motion?: GifMotion;
  /** Hold the opening frame longer, for a sequence that starts on a title. */
  firstFrameMs?: number;
  /** Hold the closing frame longer, so a loop does not snap away from the end. */
  lastFrameMs?: number;
}

/**
 * Photo presets and video presets are separate entries rather than one table
 * with a per-subject override, because the same number means different things
 * in each. For photos a delay is how long you look at a picture; for video it
 * is playback speed against frames that were sampled at ten per second. A
 * shared "boomerang" at 350ms would be a pleasant pace for a burst of photos
 * and three-and-a-half times slow motion for a clip.
 *
 * Delays stay at or above 40ms on purpose. Viewers have long clamped very fast
 * frames — historically rewriting anything under 20ms to 100ms — so a GIF that
 * asks for 10ms plays *slower* than one honestly asking for 50ms, which is a
 * confusing thing to hand someone who just pressed "fast".
 */
export const GIF_PRESETS: readonly GifPreset[] = [
  // ---------- photographs ----------
  {
    id: "slideshow",
    subject: "images",
    label: { ko: "슬라이드쇼", en: "Slideshow" },
    note: { ko: "한 장에 1.2초, 차례대로", en: "1.2s a picture, in order" },
    delayMs: 1200,
    maxEdge: 900,
  },
  {
    id: "flip",
    subject: "images",
    label: { ko: "빠르게 넘기기", en: "Quick flip" },
    note: { ko: "한 장에 0.3초, 훑어볼 때", en: "0.3s a picture, for skimming" },
    delayMs: 300,
    maxEdge: 900,
  },
  {
    id: "timelapse",
    subject: "images",
    label: { ko: "타임랩스", en: "Timelapse" },
    note: { ko: "한 장에 0.1초, 사진이 아주 많을 때", en: "0.1s a picture, for long bursts" },
    delayMs: 100,
    maxEdge: 800,
  },
  {
    id: "readable",
    subject: "images",
    label: { ko: "읽을 시간 주기", en: "Time to read" },
    note: { ko: "한 장에 2.5초, 글자가 있는 화면", en: "2.5s a picture, for screens with text" },
    delayMs: 2500,
    maxEdge: 1000,
  },
  {
    id: "cover",
    subject: "images",
    label: { ko: "표지 먼저 보여주기", en: "Hold the cover" },
    note: { ko: "첫 장만 2초, 나머지는 0.5초", en: "2s on the first, 0.5s on the rest" },
    delayMs: 500,
    maxEdge: 900,
    firstFrameMs: 2000,
  },
  {
    id: "compare",
    subject: "images",
    // Downscaling is off here alone: a comparison is judged on detail, and
    // 900px would throw away the thing being compared.
    label: { ko: "전후 비교", en: "Before and after" },
    note: { ko: "원본 크기 그대로 번갈아, 두 장일 때", en: "full size, alternating — best with two" },
    delayMs: 1200,
    maxEdge: 0,
    lastFrameMs: 1200,
  },
  {
    id: "boomerang",
    subject: "images",
    label: { ko: "왕복 재생", en: "Boomerang" },
    note: { ko: "끝까지 갔다가 되돌아옵니다", en: "runs to the end, then back" },
    delayMs: 350,
    maxEdge: 800,
    motion: "pingpong",
  },
  {
    id: "reverse",
    subject: "images",
    label: { ko: "거꾸로 재생", en: "Reverse" },
    note: { ko: "마지막 장부터 거꾸로", en: "last picture first" },
    delayMs: 600,
    maxEdge: 900,
    motion: "reverse",
  },
  {
    id: "once",
    subject: "images",
    label: { ko: "한 번만 재생", en: "Play once" },
    note: { ko: "반복 없이 마지막 장에서 멈춤", en: "no repeat; rests on the last picture" },
    delayMs: 700,
    maxEdge: 900,
    loops: 1,
  },
  {
    id: "chat",
    subject: "images",
    label: { ko: "채팅에 붙이기", en: "Small for chat" },
    note: { ko: "긴 쪽 320px으로 줄여 용량을 낮춤", en: "320px on the long edge, for size" },
    delayMs: 400,
    maxEdge: 320,
  },

  // ---------- video, sampled at ten frames a second ----------
  {
    id: "video-realtime",
    subject: "video",
    label: { ko: "실제 속도", en: "Real time" },
    note: { ko: "영상에서 보이던 속도 그대로", en: "the speed it played at" },
    delayMs: 100,
    maxEdge: 640,
  },
  {
    id: "video-fast",
    subject: "video",
    label: { ko: "2배 빠르게", en: "Double speed" },
    note: { ko: "두 배 속도, 길이는 절반", en: "twice the speed, half as long" },
    delayMs: 50,
    maxEdge: 640,
  },
  {
    id: "video-boomerang",
    subject: "video",
    label: { ko: "왕복 재생", en: "Boomerang" },
    note: { ko: "끝까지 갔다가 되돌아옵니다", en: "runs to the end, then back" },
    delayMs: 100,
    maxEdge: 640,
    motion: "pingpong",
  },
  {
    id: "video-once",
    subject: "video",
    label: { ko: "한 번만 재생", en: "Play once" },
    note: { ko: "반복 없이 마지막에서 멈춤", en: "no repeat; rests on the last frame" },
    delayMs: 100,
    maxEdge: 640,
    loops: 1,
  },
  {
    id: "video-chat",
    subject: "video",
    label: { ko: "채팅에 붙이기", en: "Small for chat" },
    note: { ko: "긴 쪽 320px으로 줄여 용량을 낮춤", en: "320px on the long edge, for size" },
    delayMs: 100,
    maxEdge: 320,
  },
];

export function presetsFor(subject: GifSubject): GifPreset[] {
  return GIF_PRESETS.filter((preset) => preset.subject === subject);
}

/** One entry per rendered frame: which source to draw, and how long to hold it. */
export interface PlannedFrame {
  index: number;
  delayMs: number;
}

/**
 * Expand a preset into a concrete frame order and per-frame timing.
 *
 * Kept out of the encoder so the ordering rules can be checked on their own,
 * and so the encoder never has to know what a boomerang is.
 */
export function planFrames(preset: GifPreset, count: number): PlannedFrame[] {
  if (count <= 0) return [];
  const forward = [...Array(count).keys()];

  let order: number[];
  switch (preset.motion) {
    case "reverse":
      order = [...forward].reverse();
      break;
    case "pingpong":
      // The two endpoints are not repeated on the way back. Including them
      // would hold the first and last frame for twice as long once per cycle,
      // which reads as a stutter at each turn rather than a smooth reversal.
      order =
        count < 3
          ? forward
          : [...forward, ...forward.slice(1, -1).reverse()];
      break;
    default:
      order = forward;
  }

  return order.map((index, position) => {
    let delayMs = preset.delayMs;
    // Applied by position in the played sequence rather than by source index,
    // so a reversed sequence still emphasises the frame the viewer sees first.
    if (position === 0 && preset.firstFrameMs) delayMs = preset.firstFrameMs;
    if (position === order.length - 1 && preset.lastFrameMs) delayMs = preset.lastFrameMs;
    return { index, delayMs };
  });
}
