/**
 * Video, opened only far enough to take pictures of it.
 *
 * This is not a video editor and is not trying to become one. The demand it
 * serves is narrow and real: someone has a clip on their machine and needs a
 * still out of it, or a short animation to paste into a document. Every online
 * tool for that asks them to upload the clip first, which is exactly the thing
 * this app exists to avoid.
 *
 * No ffmpeg. The browser already ships a decoder, and a `<video>` element drawn
 * onto a canvas gets frames out of it. Bundling ffmpeg would have added roughly
 * ten times the app's entire size, pulled in a GPL obligation, and brought along
 * several hundred parsers we would then be responsible for. The two things
 * people actually asked for do not need any of that.
 *
 * The trade is honest and worth stating: we can only open what the platform's
 * own decoder understands. That covers MP4/H.264 and WebM everywhere this app
 * runs, and leaves the exotic codecs to a real video tool.
 */

import type { FormatHandler, RenderContext } from "./registry";
import {
  baseName,
  type ConversionContext,
  type ConversionTarget,
} from "../convert/types";
import { planFrames, presetsFor } from "../convert/gifpresets";
import { S, t } from "../i18n";
import { makeZip } from "../convert/zip";
import { canvasToBlob, pageLabel } from "../convert/raster";

/** Sixty stills is a contact sheet. Six hundred is a mess nobody asked for. */
const MAX_STILLS = 60;
/** Above this the GIF stops being pasteable and starts being a download. */
const GIF_MAX_FRAMES = 48;
const GIF_FPS = 10;
const GIF_MAX_EDGE = 640;

/**
 * The element currently on screen.
 *
 * Held at module scope because "save the frame I am looking at" needs the
 * playhead the user actually scrubbed to, and `conversions(file)` receives only
 * the file. main.ts awaits render() before asking for conversions, so this is
 * always the element belonging to the open document.
 */
let onScreen: HTMLVideoElement | null = null;

/** Object URLs outlive the element unless revoked, and video blobs are large. */
function openSource(file: File): { element: HTMLVideoElement; dispose: () => void } {
  const url = URL.createObjectURL(file);
  const element = document.createElement("video");
  element.src = url;
  element.preload = "auto";
  // Muted is required for any programmatic playback path to be allowed, and a
  // still-extraction tool has no business making noise.
  element.muted = true;
  element.playsInline = true;
  return { element, dispose: () => URL.revokeObjectURL(url) };
}

function whenReady(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2) return resolve();
    video.addEventListener("loadeddata", () => resolve(), { once: true });
    // A decoder that cannot open the file fires `error` and never `loadeddata`,
    // so without this the conversion would hang instead of failing.
    video.addEventListener(
      "error",
      () => reject(new Error(t(S.videoUndecodable))),
      { once: true },
    );
  });
}

function seek(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    video.addEventListener("seeked", () => resolve(), { once: true });
    video.addEventListener(
      "error",
      () => reject(new Error(t(S.videoUndecodable))),
      { once: true },
    );
    video.currentTime = seconds;
  });
}

async function render(file: File, ctx: RenderContext): Promise<void> {
  ctx.report(t(S.readingDocument));
  const { element } = openSource(file);
  element.className = "page video-page";
  element.controls = true;
  element.setAttribute("aria-label", file.name);

  ctx.host.append(element);
  await whenReady(element);
  onScreen = element;

  ctx.report(
    t(S.videoOpened)(
      element.videoWidth,
      element.videoHeight,
      Math.round(element.duration),
    ),
  );
}

/** Draw whatever the element is showing right now, at native resolution. */
async function grabFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  maxEdge = 0,
): Promise<void> {
  const scale =
    maxEdge > 0
      ? Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight))
      : 1;
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error(t(S.noCanvas));
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
}

/**
 * Sample the clip at even intervals.
 *
 * The interval is derived from the duration rather than fixed, so a six second
 * clip and a two hour recording both yield a set someone can actually look
 * through. A fixed one-second interval would turn the latter into 7200 files.
 */
async function stills(
  file: File,
  report: (message: string) => void,
): Promise<Blob[]> {
  const { element, dispose } = openSource(file);
  try {
    await whenReady(element);
    const duration = element.duration;
    const count = Math.max(1, Math.min(MAX_STILLS, Math.floor(duration)));
    const step = duration / count;

    const canvas = document.createElement("canvas");
    const out: Blob[] = [];
    for (let i = 0; i < count; i += 1) {
      report(t(S.extractingFrame)(i + 1, count));
      // Half a step in, so the first still is a real frame rather than the
      // black or logo frame many clips open on.
      await seek(element, Math.min(duration - 0.01, i * step + step / 2));
      await grabFrame(element, canvas);
      out.push(await canvasToBlob(canvas, "image/png"));
      await new Promise((r) => setTimeout(r, 0));
    }
    canvas.width = 0;
    canvas.height = 0;
    return out;
  } finally {
    element.src = "";
    dispose();
  }
}

/** Sample a window of the clip fast enough to read as motion. */
async function gifFrames(
  file: File,
  startAt: number,
  report: (done: number, total: number) => void,
): Promise<ImageBitmap[]> {
  const { element, dispose } = openSource(file);
  try {
    await whenReady(element);
    const step = 1 / GIF_FPS;
    const available = Math.max(0, element.duration - startAt);
    const count = Math.max(1, Math.min(GIF_MAX_FRAMES, Math.floor(available / step)));

    const canvas = document.createElement("canvas");
    const out: ImageBitmap[] = [];
    for (let i = 0; i < count; i += 1) {
      await seek(element, startAt + i * step);
      await grabFrame(element, canvas, GIF_MAX_EDGE);
      out.push(await createImageBitmap(canvas));
      report(i + 1, count);
      await new Promise((r) => setTimeout(r, 0));
    }
    canvas.width = 0;
    canvas.height = 0;
    return out;
  } finally {
    element.src = "";
    dispose();
  }
}

function conversions(file: File): ConversionTarget[] {
  const stem = baseName(file.name);

  return [
    {
      id: "frame",
      label: t(S.labelCurrentFrame),
      note: t(S.noteCurrentFrame),
      run: async () => {
        // Deliberately reads the on-screen element rather than opening its own:
        // the whole point of this target is the moment the user scrubbed to.
        const video = onScreen;
        if (!video) throw new Error(t(S.videoUndecodable));
        const canvas = document.createElement("canvas");
        await grabFrame(video, canvas);
        const blob = await canvasToBlob(canvas, "image/png");
        const at = Math.round(video.currentTime);
        canvas.width = 0;
        canvas.height = 0;
        return { name: `${stem}-${at}s.png`, blob };
      },
    },
    {
      id: "stills",
      label: t(S.labelStills),
      note: t(S.noteStills)(MAX_STILLS),
      run: async ({ report }) => {
        const frames = await stills(file, report);
        report(t(S.buildingArchive));
        const zip = await makeZip(
          frames.map((blob, i) => ({
            name: `${stem}-${pageLabel(i + 1, frames.length)}.png`,
            blob,
          })),
        );
        return { name: `${stem}-stills.zip`, blob: zip };
      },
    },
    ...presetsFor("video").map((preset) => ({
      id: `gif-${preset.id}`,
      label: t(preset.label),
      note: `${t(preset.note)}. ${t(S.noteVideoGif)(Math.round(GIF_MAX_FRAMES / GIF_FPS))}`,
      group: t(S.gifGroup),
      run: async ({ report }: ConversionContext) => {
        // Starts from wherever the user left the playhead, so a GIF of the one
        // interesting second does not require trimming the file first.
        const startAt = onScreen ? onScreen.currentTime : 0;
        const bitmaps = await gifFrames(file, startAt, (done, total) =>
          report(t(S.extractingFrame)(done, total)),
        );
        report(t(S.encodingAs)("GIF"));
        const { encodeGif } = await import("../convert/gif");
        const frames = planFrames(preset, bitmaps.length).flatMap((planned) => {
          const source = bitmaps[planned.index];
          return source ? [{ source, delayMs: planned.delayMs }] : [];
        });
        const blob = await encodeGif(frames, {
          maxEdge: preset.maxEdge,
          loops: preset.loops,
        });
        // Closed by walking the extracted originals rather than the plan: a
        // boomerang names the same bitmap twice and would be closed twice.
        for (const bitmap of bitmaps) bitmap.close();
        return { name: `${stem}-${preset.id.replace(/^video-/, "")}.gif`, blob };
      },
    })),
  ];
}

export const handler: FormatHandler = { label: "Video", render, conversions };
