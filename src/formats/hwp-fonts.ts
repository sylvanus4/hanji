/**
 * Korean fallback fonts for the Hangul renderer.
 *
 * HWP documents name fonts nobody outside Korea has installed (한컴바탕, HY명조,
 * 함초롬돋움). rhwp maps each to an open-source equivalent, but only *names* it —
 * the page has to supply it. Without these faces the browser substitutes
 * something with different metrics, `measureTextWidth` reports those metrics
 * back to the engine, and line breaks, justification and table widths all drift.
 *
 * The upstream README recommends the Google Fonts CDN. We cannot use it: this
 * app's entire claim is that it makes no outbound requests, and its CSP pins
 * `font-src` to 'self'. So the faces are self-hosted, hashed and served by us.
 *
 * ~3 MB of Hangul, which is why nothing here is imported until a Hangul file is
 * actually opened. Someone converting a PNG never pays for it.
 */

import sansKrKorean from "@fontsource/noto-sans-kr/files/noto-sans-kr-korean-400-normal.woff2?url";
import sansKrKoreanBold from "@fontsource/noto-sans-kr/files/noto-sans-kr-korean-700-normal.woff2?url";
import sansKrLatin from "@fontsource/noto-sans-kr/files/noto-sans-kr-latin-400-normal.woff2?url";
import sansKrLatinBold from "@fontsource/noto-sans-kr/files/noto-sans-kr-latin-700-normal.woff2?url";
import serifKrKorean from "@fontsource/noto-serif-kr/files/noto-serif-kr-korean-400-normal.woff2?url";
import serifKrKoreanBold from "@fontsource/noto-serif-kr/files/noto-serif-kr-korean-700-normal.woff2?url";
import serifKrLatin from "@fontsource/noto-serif-kr/files/noto-serif-kr-latin-400-normal.woff2?url";
import serifKrLatinBold from "@fontsource/noto-serif-kr/files/noto-serif-kr-latin-700-normal.woff2?url";

/** Hangul syllables, jamo and the CJK punctuation that Korean text sits in. */
const KOREAN_RANGE =
  "U+1100-11FF, U+3000-303F, U+3131-318E, U+A960-A97F, U+AC00-D7A3, U+D7B0-D7FF, U+FF00-FFEF";
const LATIN_RANGE = "U+0000-00FF, U+0131, U+2000-206F, U+2212, U+2215";

interface FaceSpec {
  family: string;
  url: string;
  weight: string;
  range: string;
}

const FACES: FaceSpec[] = [
  { family: "Noto Sans KR", url: sansKrKorean, weight: "400", range: KOREAN_RANGE },
  { family: "Noto Sans KR", url: sansKrKoreanBold, weight: "700", range: KOREAN_RANGE },
  { family: "Noto Sans KR", url: sansKrLatin, weight: "400", range: LATIN_RANGE },
  { family: "Noto Sans KR", url: sansKrLatinBold, weight: "700", range: LATIN_RANGE },
  { family: "Noto Serif KR", url: serifKrKorean, weight: "400", range: KOREAN_RANGE },
  { family: "Noto Serif KR", url: serifKrKoreanBold, weight: "700", range: KOREAN_RANGE },
  { family: "Noto Serif KR", url: serifKrLatin, weight: "400", range: LATIN_RANGE },
  { family: "Noto Serif KR", url: serifKrLatinBold, weight: "700", range: LATIN_RANGE },
];

let loaded: Promise<void> | null = null;

/**
 * Register the faces and resolve only once they are genuinely usable.
 *
 * Awaiting matters more than it looks: `measureTextWidth` answers from whatever
 * is available at the instant it is called, so a face that lands mid-render is
 * indistinguishable from no face at all.
 *
 * A font that fails to load is not fatal — the document still renders, just with
 * the substituted metrics — so failures are logged and swallowed rather than
 * taking down the viewer.
 */
export function loadKoreanFallbackFonts(): Promise<void> {
  if (loaded) return loaded;

  loaded = Promise.all(
    FACES.map(async ({ family, url, weight, range }) => {
      try {
        const face = new FontFace(family, `url(${url}) format('woff2')`, {
          weight,
          unicodeRange: range,
          display: "swap",
        });
        document.fonts.add(await face.load());
      } catch (err) {
        console.warn(`[hanji] fallback font unavailable: ${family} ${weight}`, err);
      }
    }),
  ).then(() => undefined);

  return loaded;
}
