#!/usr/bin/env node
/**
 * Fidelity corpus — discovery pass (P0-c).
 *
 * Scans local directories for real HWP/HWPX documents and writes a
 * LOCAL-ONLY index: absolute path, sha256, byte size, and a filename-based
 * classification hint. This file contains real filenames (which can reveal
 * business/person names) and is therefore never committed — see
 * docs/fidelity/README.md for why the manifest downstream only carries
 * ids + hashes.
 *
 * Usage:
 *   node tools/fidelity/discover.mjs > docs/fidelity/discovery.local.json
 *
 * Scan roots are read from FIDELITY_SCAN_ROOTS (colon-separated), defaulting
 * to the two locations this task was told already hold real Korean
 * documents. Override for a different machine.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

const HOME = os.homedir();
const DEFAULT_ROOTS = [
  { dir: path.join(HOME, "Downloads"), recursive: false },
  { dir: path.join(HOME, "thaki", "rhwp"), recursive: true },
];

const roots = process.env.FIDELITY_SCAN_ROOTS
  ? process.env.FIDELITY_SCAN_ROOTS.split(":").map((d) => ({ dir: d, recursive: true }))
  : DEFAULT_ROOTS;

/**
 * Filename-based hints only — these are NOT the fidelity measurement, just
 * cheap signals to steer selection before the WASM harness runs. The real
 * has_table / page_count signals come from tools/fidelity/measure.mjs.
 */
const HINTS = [
  { tag: "gov_notice", re: /공고문|보도자료|고시|공문|공고|모집/ },
  { tag: "gov_form", re: /서식|양식|청구서|신청서|별지/ },
  { tag: "gov_stat", re: /통계|현황/ },
  { tag: "exam", re: /(9급|기출|모의고사|문제지|행정학개론|행정법총론|국어|영어|한국사)/ },
  { tag: "contract_or_charter", re: /계약서|정관|약관/ },
  { tag: "biz_plan", re: /사업계획서|사업계획/ },
  { tag: "spec_or_api_doc", re: /spec|API|ctl_/i },
  { tag: "rfp", re: /RFP|입찰|제안요청서/i },
];

/**
 * rhwp ships its own regression-test fixtures alongside real-world samples,
 * using a distinct naming convention: short slugs with a numeric suffix
 * (re-align-center-01, tac-case-001, table-vpos-01, eq-01, footnote-01, ...),
 * or generic template/blank/empty names. Those are synthetic single-feature
 * probes, not documents that ever circulated for a real purpose — flag them
 * so the selection step can exclude them from the "real document" pool.
 */
const TEST_FIXTURE_BASENAME_RE =
  /^(re-|tac-|lseg-|multisize|blank-|empty|\d+\.hwp$|form-\d+\b|table-\d+\b|table-complex|table-in-tbox|table-vpos|table-ipc|multi-table|hwp_table_test|inner-table|group-box|group-drawing|draw-group|shape-group|footnote-\d+|endnote-\d+|field-\d+|h-pen-|img-start-|pic-crop|pic-in-|loading-fail|eq-\d+|hwp-multi-|honbo-save|KTX(-\d+)?\.hwp$|calendar_|BlogForm_|BookReview\.hwp$|interview\.hwp$|shortcut\.hwp$|sungeo\.hwp$|Textmail\.hwp$|Worldcup_|NewYear_|treatise sample\.hwp$|english\.hwp$|Hyper\(hwp2010\)\.hwp$|hwp-3\.0-HWPML|number-bullet|para-head-num|oullim-|shift-return|hwp-img-\d+|request\.hwp$)/i;
// Whole subtrees that are rhwp's own template/regression harness, regardless
// of the individual filename inside them.
const TEST_FIXTURE_DIR_RE = /(^|\/)(template|saved)(\/|$)/i;

function walk(dir, recursive, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (recursive && e.name !== "node_modules" && e.name !== ".git") {
        walk(full, recursive, out);
      }
      continue;
    }
    if (/\.(hwp|hwpx)$/i.test(e.name)) out.push(full);
  }
}

function classify(basename, relDirPath) {
  const hints = HINTS.filter((h) => h.re.test(basename)).map((h) => h.tag);
  const isFixture =
    TEST_FIXTURE_BASENAME_RE.test(basename) || TEST_FIXTURE_DIR_RE.test(relDirPath);
  return { hints, isLikelyTestFixture: isFixture };
}

const files = [];
for (const { dir, recursive } of roots) walk(dir, recursive, files);

const out = files.map((p) => {
  const bytes = fs.readFileSync(p);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const rel = path.basename(p);
  const relDirPath = path.relative(HOME, p).split(path.sep).join("/");
  const { hints, isLikelyTestFixture } = classify(rel, relDirPath);
  return {
    path: p,
    basename: rel,
    ext: path.extname(p).slice(1).toLowerCase(),
    byteSize: bytes.length,
    sha256,
    hints,
    isLikelyTestFixture,
  };
});

process.stdout.write(JSON.stringify({ generatedAt: new Date().toISOString(), roots, count: out.length, files: out }, null, 2));
