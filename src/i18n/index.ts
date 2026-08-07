/**
 * Korean-first bilingual strings.
 *
 * The users who actually need this tool are Korean — HWP is a Korean format and
 * the demand trigger is a Korean public-sector mandate — so Korean is the
 * default rather than a translation bolted onto an English original. English
 * exists because this category is distributed through GitHub and Hacker News.
 *
 * Every entry carries both languages side by side. Keeping them adjacent is
 * deliberate: a catalogue split across two files drifts, and a half-translated
 * interface reads worse than a consistently foreign one.
 */

export type Lang = "ko" | "en";

const STORAGE_KEY = "hanji.lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "ko" || saved === "en") return saved;
  } catch {
    // Private-mode Safari throws on localStorage access. A missing preference
    // is not worth failing over.
  }
  // Korean, unconditionally, until the visitor says otherwise.
  //
  // Not sniffing navigator.language is deliberate. This tool exists for Korean
  // documents; someone arriving with an English browser is more likely to be a
  // Korean user on an English-locale machine than an English speaker with an
  // HWP file. Guessing wrong in that direction hides the product from exactly
  // the people it was built for, and the toggle is one click away.
  return "ko";
}

let current: Lang = initialLang();
const listeners = new Set<(lang: Lang) => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Preference simply will not persist. The session still works.
  }
  document.documentElement.lang = lang;
  for (const fn of listeners) fn(lang);
}

export function onLangChange(fn: (lang: Lang) => void): void {
  listeners.add(fn);
}

/** Pick the current language out of a bilingual entry. */
export function t<T>(entry: { ko: T; en: T }): T {
  return entry[current];
}

export const S = {
  // ---- chrome ----
  tagline: { ko: "이 기기 안에서", en: "local only" },
  openFile: { ko: "파일 열기", en: "Open a file" },
  chooseFile: { ko: "열 문서 선택", en: "Choose a document to open" },
  switchLang: { ko: "English", en: "한국어" },
  themeSystem: { ko: "시스템", en: "System" },
  themeLight: { ko: "밝게", en: "Light" },
  themeDark: { ko: "어둡게", en: "Dark" },
  themeTitle: {
    ko: (next: string) => `테마: 지금은 ${next}. 눌러서 전환합니다.`,
    en: (next: string) => `Theme: currently ${next}. Click to change.`,
  },

  switchLangTitle: {
    ko: "Switch to English",
    en: "한국어로 전환",
  },

  // ---- network badge ----
  sentClean: { ko: "전송 0", en: "0 sent" },
  sentBreached: {
    ko: (n: number) => `전송 ${n}`,
    en: (n: number) => `${n} sent`,
  },
  sentCleanTitle: {
    ko: (assets: number) =>
      `어디로도 전송되지 않았습니다. 이 사이트 자체 파일 ${assets}건만 불러왔습니다.`,
    en: (assets: number) =>
      `Nothing has been sent anywhere. ${assets} local asset loads.`,
  },
  sentBreachedTitle: {
    ko: (url: string) => `예상치 못한 외부 요청: ${url}`,
    en: (url: string) => `Unexpected outbound request: ${url}`,
  },

  // ---- empty state ----
  emptyTitle: {
    ko: "문서를 끌어다 놓으세요. 이 기기를 벗어나지 않습니다.",
    en: "Drop a document. It stays on this device.",
  },
  emptyBody: {
    ko: "한글(HWP·HWPX), PDF, 이미지 파일을 이 탭 안에서 실행되는 코드가 엽니다. 업로드하지 않으니 나중에 지울 것도 없습니다.",
    en: "Hangul, PDF and image files are opened by code running in this tab. Nothing is uploaded, so nothing has to be deleted afterwards.",
  },

  // ---- viewer ----
  opening: {
    ko: (name: string) => `${name} 여는 중…`,
    en: (name: string) => `Opening ${name}…`,
  },
  loadingHangulEngine: {
    ko: "한글 엔진 불러오는 중…",
    en: "Loading the Hangul engine…",
  },
  loadingPdfEngine: {
    ko: "PDF 엔진 불러오는 중…",
    en: "Loading the PDF engine…",
  },
  readingDocument: { ko: "문서 읽는 중…", en: "Reading the document…" },
  decoding: { ko: "디코딩 중…", en: "Decoding…" },
  pagesParsed: {
    ko: (n: number, ms: number) => `${n}쪽, ${ms}ms 만에 해석`,
    en: (n: number, ms: number) =>
      `${n} page${n === 1 ? "" : "s"}, parsed in ${ms} ms`,
  },
  pagesOpened: {
    ko: (n: number, ms: number) => `${n}쪽, ${ms}ms 만에 열림`,
    en: (n: number, ms: number) =>
      `${n} page${n === 1 ? "" : "s"}, opened in ${ms} ms`,
  },
  imageDecoded: {
    ko: (w: number, h: number, ms: number) => `${w} × ${h}, ${ms}ms 만에 디코딩`,
    en: (w: number, h: number, ms: number) => `${w} × ${h}, decoded in ${ms} ms`,
  },
  pageAria: {
    ko: (n: number) => `${n}쪽`,
    en: (n: number) => `Page ${n}`,
  },
  openFailed: {
    ko: (name: string, why: string) => `${name} 을(를) 열지 못했습니다. ${why}`,
    en: (name: string, why: string) => `${name} could not be opened. ${why}`,
  },
  unsupportedExt: {
    ko: (ext: string) => `.${ext} 형식은 아직 지원하지 않습니다.`,
    en: (ext: string) => `.${ext} is not supported yet.`,
  },
  unsupportedNoExt: {
    ko: "확장자가 없어 파일 종류를 알 수 없습니다.",
    en: "That file has no extension, so its type could not be determined.",
  },
  noCanvas: {
    ko: "이 브라우저가 2D 캔버스를 제공하지 않았습니다.",
    en: "This browser refused a 2D canvas context.",
  },
  shellBroken: {
    ko: "앱 셸에 필요한 요소가 없습니다.",
    en: "The app shell is missing required elements.",
  },

  // ---- conversion ----
  saveAs: { ko: "다른 형식으로 저장", en: "Save as" },
  saveAsAria: {
    ko: "이 문서를 다른 형식으로 변환해 저장",
    en: "Convert and save this document",
  },
  working: { ko: "변환 중…", en: "Working…" },
  saved: {
    ko: (name: string) => `${name} 저장됨`,
    en: (name: string) => `Saved ${name}`,
  },
  convertFailed: {
    ko: (why: string) => `변환하지 못했습니다: ${why}`,
    en: (why: string) => `Could not convert: ${why}`,
  },
  labelPngPages: { ko: "PNG (쪽별)", en: "PNG pages" },
  labelJpegPages: { ko: "JPEG (쪽별)", en: "JPEG pages" },
  noteHwpx: {
    ko: "공공기관 문서에 요구되는 개방형 XML 형식",
    en: "the open XML format required for public-sector documents",
  },
  notePdfRaster: {
    ko: "각 쪽이 이미지라 글자를 선택하거나 검색할 수 없습니다",
    en: "pages are images, so the text is not selectable or searchable",
  },
  noteZip: {
    ko: "쪽마다 이미지 한 장, .zip으로 묶어 저장",
    en: "one image per page, delivered as a .zip",
  },
  convertingTo: {
    ko: (fmt: string) => `${fmt}(으)로 변환 중…`,
    en: (fmt: string) => `Converting to ${fmt}…`,
  },
  encodingAs: {
    ko: (fmt: string) => `${fmt}(으)로 인코딩 중…`,
    en: (fmt: string) => `Encoding as ${fmt}…`,
  },
  renderingPage: {
    ko: (n: number, total: number) => `${total}쪽 중 ${n}쪽 렌더링 중…`,
    en: (n: number, total: number) => `Rendering page ${n} of ${total}…`,
  },
  assemblingPdf: { ko: "PDF 조립 중…", en: "Assembling the PDF…" },
  buildingArchive: { ko: "압축 파일 만드는 중…", en: "Building the archive…" },
  zipTooBig: {
    ko: "내보낼 파일이 4GB를 넘어 이 압축 형식으로 담을 수 없습니다. 쪽 수를 줄여 다시 시도하세요.",
    en: "That export is larger than 4 GB, which this archive format cannot hold. Try exporting fewer pages.",
  },
  encodeFailed: {
    ko: (type: string) =>
      `이 브라우저가 ${type} 형식으로 인코딩하지 못했습니다. 쪽 크기가 너무 클 수 있습니다.`,
    en: (type: string) =>
      `This browser could not encode the image as ${type}. The page may be too large.`,
  },
} as const;
