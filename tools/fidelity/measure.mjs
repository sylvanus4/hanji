#!/usr/bin/env node
/**
 * Fidelity corpus — structural measurement pass (P0-c).
 *
 * hanji has no Hancom reference renderer, so pixel-accurate fidelity against
 * ground truth is not measurable (see README.en.md "Hangul fidelity" and
 * docs/PLAN.md P0 notes). What *is* measurable without a ground truth is
 * whether the same engine hanji ships (@rhwp/core, vendored under
 * vendor/rhwp-core with hanji's own patch) behaves correctly on a structural
 * level:
 *
 *   - the document parses at all (no throw)
 *   - the page count is a document property, not a rendering accident: it
 *     survives an HWP<->HWPX round trip through the engine's own exporter
 *   - no painted rectangle (table cell, box, frame) extends past the page
 *     edge — this is the exact regression class documented in
 *     README.en.md "Hangul fidelity" (rhwp commit 10c36e23) and already
 *     guarded for page 1 in e2e-smoke.py; this script checks every page.
 *
 * This is the same technique e2e-smoke.py uses (drive the real engine, parse
 * the real SVG it emits, measure painted rects) generalised to N documents
 * and running headlessly under Node instead of a browser tab, via
 * @rhwp/core's initSync() entry point which needs no DOM.
 *
 * Usage:
 *   node tools/fidelity/measure.mjs docs/fidelity/corpus-paths.local.json > docs/fidelity/measurements.json
 *
 * Input is {"id": "/absolute/path.hwp", ...} (see build_corpus.mjs). Output
 * is keyed by id only — no filenames or paths, so it is safe to commit.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("usage: node tools/fidelity/measure.mjs <id-to-path.json>");
  process.exit(1);
}
const idToPath = JSON.parse(fs.readFileSync(inputPath, "utf8"));

/**
 * The engine has no access to browser fonts and needs measureTextWidth to
 * decide line breaks (see src/formats/hwp.ts installMeasureBridge). The real
 * app uses an actual <canvas> 2D context; Node has none by default. This is
 * a deterministic CJK-aware approximation (full-width for Hangul/CJK/full-
 * width punctuation, ~0.55x for everything else) — close enough to keep
 * pagination stable and reproducible, but NOT the real font metrics. Every
 * number this script produces inherits that approximation; see the caveat
 * in docs/fidelity/README.md before treating pageCount as ground truth.
 */
function installApproxMeasureBridge() {
  globalThis.measureTextWidth = (font, text) => {
    const m = /([\d.]+)px/.exec(font);
    const size = m ? parseFloat(m[1]) : 16;
    let w = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      const wide =
        cp >= 0x1100 &&
        ((cp >= 0xac00 && cp <= 0xd7a3) ||
          (cp >= 0x3130 && cp <= 0x318f) ||
          (cp >= 0x4e00 && cp <= 0x9fff) ||
          (cp >= 0xff00 && cp <= 0xffef));
      w += wide ? size : size * 0.55;
    }
    return w;
  };
}

function loadEngine() {
  installApproxMeasureBridge();
  const dir = path.resolve("vendor/rhwp-core");
  return import(path.join(dir, "rhwp.js")).then((rhwp) => {
    rhwp.initSync({ module: fs.readFileSync(path.join(dir, "rhwp_bg.wasm")) });
    return rhwp;
  });
}

/**
 * Port of e2e-smoke.py's "no table escapes the page" check, generalised to
 * every page instead of just page 1. Only rectangles outside <defs> are
 * painted — the engine emits a body clip rect wider than the sheet inside
 * <defs>, which e2e-smoke.py's own comments document as a false positive if
 * you forget to strip it first.
 */
function pageOverflowPx(svg) {
  const wMatch = /<svg[^>]*\bwidth="([\d.]+)"/.exec(svg);
  if (!wMatch) return { pageWidth: null, overflowPx: null, rectCount: 0 };
  const pageWidth = parseFloat(wMatch[1]);
  const painted = svg.replace(/<defs>[\s\S]*?<\/defs>/g, "");
  const rects = painted.match(/<rect[^>]*>/g) || [];
  // Only rects with an absolute x/width in the tag itself can be checked for
  // page overflow; some cell-border rects sit inside a transformed <g> and
  // carry local coordinates instead, so they are counted (rectCount, the
  // "has a table" proxy) but skipped for the overflow bound (edgeableRects).
  const edgeable = rects.filter(
    (r) => /\bx="(-?[\d.]+)"/.test(r) && /\bwidth="(-?[\d.]+)"/.test(r),
  );
  let maxEdge = 0;
  for (const r of edgeable) {
    const x = /\bx="(-?[\d.]+)"/.exec(r);
    const w = /\bwidth="(-?[\d.]+)"/.exec(r);
    maxEdge = Math.max(maxEdge, parseFloat(x[1]) + parseFloat(w[1]));
  }
  const lineCount = (painted.match(/<line[^>]*>/g) || []).length;
  const textCount = (painted.match(/<text[^>]*>/g) || []).length;
  return {
    pageWidth,
    overflowPx: edgeable.length ? Number((maxEdge - pageWidth).toFixed(2)) : 0,
    rectCount: rects.length,
    edgeableRectCount: edgeable.length,
    lineCount,
    textCount,
  };
}

async function measureOne(rhwp, filePath) {
  const bytes = new Uint8Array(fs.readFileSync(filePath));
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const ext = path.extname(filePath).slice(1).toLowerCase();

  const result = {
    sha256,
    byteSize: bytes.length,
    sourceExt: ext,
    parseOk: false,
    parseMs: null,
    pageCount: null,
    pages: [],
    maxOverflowPx: null,
    anyTableOverflow: null,
    roundTrip: { attempted: false, ok: null, pageCountBefore: null, pageCountAfter: null, targetExt: null },
    error: null,
  };

  let doc;
  const t0 = performance.now();
  try {
    doc = new rhwp.HwpDocument(bytes);
  } catch (e) {
    result.error = `parse: ${String(e).slice(0, 300)}`;
    return result;
  }
  result.parseOk = true;
  result.parseMs = Math.round(performance.now() - t0);
  result.pageCount = doc.pageCount();

  for (let i = 0; i < result.pageCount; i += 1) {
    try {
      const svg = doc.renderPageSvg(i);
      result.pages.push(pageOverflowPx(svg));
    } catch (e) {
      result.pages.push({ error: String(e).slice(0, 200) });
    }
  }
  const overflows = result.pages.map((p) => p.overflowPx).filter((v) => typeof v === "number");
  result.maxOverflowPx = overflows.length ? Number(Math.max(...overflows).toFixed(2)) : null;
  result.anyTableOverflow = overflows.length ? overflows.some((v) => v >= 1.0) : null;
  result.totalRects = result.pages.reduce((s, p) => s + (p.rectCount || 0), 0);
  result.totalTextRuns = result.pages.reduce((s, p) => s + (p.textCount || 0), 0);

  // Round trip: HWP -> HWPX -> reopen, or HWPX -> HWP -> reopen. Page count
  // is a document-structure property; if it survives the engine's own
  // export+reimport, that is evidence the converter (the feature hanji is
  // actually shipping) preserves geometry rather than silently reflowing it.
  try {
    result.roundTrip.attempted = true;
    result.roundTrip.pageCountBefore = result.pageCount;
    const targetExt = ext === "hwpx" ? "hwp" : "hwpx";
    result.roundTrip.targetExt = targetExt;
    const converted = targetExt === "hwpx" ? doc.exportHwpx() : doc.exportHwp();
    const doc2 = new rhwp.HwpDocument(new Uint8Array(converted));
    result.roundTrip.pageCountAfter = doc2.pageCount();
    result.roundTrip.ok = result.roundTrip.pageCountAfter === result.roundTrip.pageCountBefore;
    doc2.free();
  } catch (e) {
    result.roundTrip.ok = false;
    result.roundTrip.error = String(e).slice(0, 300);
  }

  doc.free();
  return result;
}

const rhwp = await loadEngine();
const out = { generatedAt: new Date().toISOString(), engineVersion: rhwp.version(), documents: {} };

for (const [id, filePath] of Object.entries(idToPath)) {
  process.stderr.write(`measuring ${id}...\n`);
  try {
    out.documents[id] = await measureOne(rhwp, filePath);
  } catch (e) {
    out.documents[id] = { parseOk: false, error: `harness: ${String(e).slice(0, 300)}` };
  }
}

process.stdout.write(JSON.stringify(out, null, 2));
