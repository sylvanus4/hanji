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
      `어디로도 전송되지 않았습니다. 이 앱 자체 파일 ${assets}건만 불러왔습니다.`,
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
    ko: "한글(HWP·HWPX), PDF, 이미지, 동영상을 이 탭 안에서 실행되는 코드가 엽니다. 여러 개를 한꺼번에 놓으면 합치거나 GIF로 만들 수 있습니다.",
    en: "Hangul, PDF, image and video files are opened by code running in this tab. Drop several at once to merge them or turn them into a GIF.",
  },
  // Desktop says something stronger, not just something different. A web page
  // can only promise it does not upload; an installed app can invite you to pull
  // the network and watch it keep working, which is a claim you can check in ten
  // seconds rather than take on faith. (It also has no "tab" to speak of.)
  emptyBodyDesktop: {
    ko: "한글(HWP·HWPX), PDF, 이미지, 동영상을 이 컴퓨터 안에서 엽니다. 인터넷을 꺼두고 써보세요. 그대로 동작합니다.",
    en: "Hangul, PDF, image and video files are opened on this computer. Try it with the network switched off, it keeps working.",
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
  // Desktop only: the native Save panel was dismissed. The conversion itself
  // succeeded, so this is not phrased as a failure.
  saveCancelled: { ko: "저장을 취소했습니다", en: "Save cancelled" },
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

  // ---- video ----
  //
  // We decode with the platform's own player rather than shipping ffmpeg, so a
  // failure here means "this machine has no decoder for that codec" and not
  // "the file is broken". The message says so, because the two call for
  // completely different next steps from the user.
  videoUndecodable: {
    ko: "이 영상을 재생할 수 없습니다. 컴퓨터에 해당 코덱이 없거나 파일이 손상됐을 수 있습니다. MP4(H.264)나 WebM은 대부분 열립니다.",
    en: "This video could not be decoded. The codec may not be available on this machine, or the file may be damaged. MP4 (H.264) and WebM open almost everywhere.",
  },
  videoOpened: {
    ko: (w: number, h: number, s: number) => `${w} × ${h}, ${s}초`,
    en: (w: number, h: number, s: number) => `${w} × ${h}, ${s}s`,
  },
  extractingFrame: {
    ko: (n: number, total: number) => `${total}장 중 ${n}장 뽑는 중…`,
    en: (n: number, total: number) => `Extracting frame ${n} of ${total}…`,
  },
  labelCurrentFrame: { ko: "이 장면 저장", en: "Save this frame" },
  noteCurrentFrame: {
    ko: "재생 위치의 화면을 원본 해상도 PNG로 저장합니다",
    en: "saves the frame at the playhead as a full-resolution PNG",
  },
  labelStills: { ko: "장면 여러 장", en: "Stills" },
  noteStills: {
    ko: (max: number) => `영상 전체에서 고르게 최대 ${max}장, .zip으로 묶어 저장`,
    en: (max: number) => `up to ${max} evenly spaced frames, delivered as a .zip`,
  },
  labelGif: { ko: "GIF로 만들기", en: "Make a GIF" },
  noteVideoGif: {
    ko: (secs: number) => `재생 위치부터 약 ${secs}초, 소리는 빠집니다`,
    en: (secs: number) => `about ${secs}s from the playhead, without sound`,
  },

  // ---- several files at once ----
  // Blaming one file for a batch problem sends the user off to inspect a file
  // that is fine. The fault is in the combination, so the message says that.
  openFailedMany: {
    ko: (n: number, why: string) => `${n}개를 열지 못했습니다. ${why}`,
    en: (n: number, why: string) => `Those ${n} files could not be opened. ${why}`,
  },
  openingMany: {
    ko: (n: number) => `${n}개 여는 중…`,
    en: (n: number) => `Opening ${n} files…`,
  },
  batchOpened: {
    ko: (n: number, kind: string) => `${kind} ${n}개`,
    en: (n: number, kind: string) => `${n} ${kind}`,
  },
  batchKindImage: { ko: "이미지", en: "images" },
  batchKindPdf: { ko: "PDF", en: "PDFs" },
  batchMixed: {
    ko: "여러 개를 한 번에 열 때는 같은 종류여야 합니다. 이미지끼리, 또는 PDF끼리 놓아주세요.",
    en: "Opening several files at once needs them to be the same kind. Drop images together, or PDFs together.",
  },
  batchOrder: {
    ko: "이름 순서대로 처리합니다. 순서를 바꾸려면 파일 이름 앞에 번호를 붙여주세요.",
    en: "Processed in filename order. To change the order, number the filenames.",
  },
  labelMergePdf: { ko: "하나로 합치기", en: "Merge into one" },
  noteMergePdf: {
    ko: "놓은 순서가 아니라 파일 이름 순서로 이어 붙입니다",
    en: "joined in filename order, not the order they were dropped",
  },
  labelImagesToGif: { ko: "GIF로 만들기", en: "Make a GIF" },
  noteImagesToGif: {
    ko: "한 장당 0.5초, 첫 장 크기에 맞춰 나머지를 담습니다",
    en: "half a second per image, fitted to the first image's size",
  },
  labelImagesToPdf: { ko: "PDF로 묶기", en: "Combine into a PDF" },
  noteImagesToPdf: {
    ko: "한 장당 한 쪽, 이름 순서대로",
    en: "one page per image, in filename order",
  },

  // ---- PDF editing ----
  labelSplitPages: { ko: "낱장으로 나누기", en: "Split into pages" },
  noteSplitPages: {
    ko: "쪽마다 PDF 한 개, .zip으로 묶어 저장",
    en: "one PDF per page, delivered as a .zip",
  },
  labelRotate: {
    ko: (deg: number) => `${deg}° 돌리기`,
    en: (deg: number) => `Rotate ${deg}°`,
  },
  noteRotate: {
    ko: "모든 쪽을 지금 각도에서 더 돌립니다. 다시 그리지 않아 글자는 그대로 남습니다",
    en: "turns every page from its current angle. Nothing is re-rendered, so the text stays selectable",
  },
  labelExtractPages: { ko: "고른 쪽만 저장", en: "Keep only these pages" },
  noteExtractPages: {
    ko: "예: 1-3,7 처럼 적으면 그 쪽만 남깁니다",
    en: "for example 1-3,7 keeps just those pages",
  },
  pageSpecPlaceholder: { ko: "1-3,7", en: "1-3,7" },
  pageSpecLabel: { ko: "남길 쪽 번호", en: "Pages to keep" },
  pageSpecEmpty: {
    ko: "남길 쪽 번호를 먼저 적어주세요.",
    en: "Type which pages to keep first.",
  },
  mergingFile: {
    ko: (n: number, total: number) => `${total}개 중 ${n}개째 합치는 중…`,
    en: (n: number, total: number) => `Merging ${n} of ${total}…`,
  },
  splittingPage: {
    ko: (n: number, total: number) => `${total}쪽 중 ${n}쪽 나누는 중…`,
    en: (n: number, total: number) => `Splitting page ${n} of ${total}…`,
  },
} as const;
