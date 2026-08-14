#!/usr/bin/env node
/**
 * Fidelity corpus — summary pass (P0-c).
 *
 * Joins the committed manifest (docs/fidelity/corpus-manifest.json) with the
 * committed measurements (docs/fidelity/measurements.json) and prints the
 * per-axis fidelity numbers that docs/fidelity/README.md quotes. Uses only
 * committed, hash-keyed files — no local paths or filenames required, so
 * this reproduces on any machine with the repo checked out.
 *
 * Usage: node tools/fidelity/summarize.mjs
 */
import fs from "node:fs";

const man = JSON.parse(fs.readFileSync("docs/fidelity/corpus-manifest.json", "utf8"));
const meas = JSON.parse(fs.readFileSync("docs/fidelity/measurements.json", "utf8"));

// Documented, arbitrary-but-stated threshold: real HWP tables in this
// corpus render as several rects per page (borders/cells); a plain text
// page or a form with a couple of boxed fields sits at rpp < 3. This is a
// structural proxy, not a visual table detector — see README.md caveats.
const HAS_TABLE_RPP = 3.0;

const axisTotals = {};
let allParseOk = true;
let totalPages = 0;
let maxOverflowPx = 0;
let anyOverflow = false;
let rtOk = 0;
let hasTable = 0;
const perExt = {};

for (const d of man.documents) {
  for (const a of d.axes) axisTotals[a] = (axisTotals[a] || 0) + 1;
  perExt[d.ext] = (perExt[d.ext] || 0) + 1;
  const m = meas.documents[d.id];
  if (!m || !m.parseOk) {
    allParseOk = false;
    continue;
  }
  totalPages += m.pageCount || 0;
  if (typeof m.maxOverflowPx === "number") maxOverflowPx = Math.max(maxOverflowPx, m.maxOverflowPx);
  if (m.anyTableOverflow) anyOverflow = true;
  if (m.roundTrip?.ok) rtOk += 1;
  const rpp = (m.totalRects || 0) / (m.pageCount || 1);
  if (rpp >= HAS_TABLE_RPP) hasTable += 1;
}

const N = man.documents.length;
console.log(`Fidelity corpus: N=${N} real documents (engine ${meas.engineVersion})`);
console.log(`  by format: ${JSON.stringify(perExt)}`);
console.log(`  by axis:   ${JSON.stringify(axisTotals)}`);
console.log("");
console.log(`Structural fidelity (measured, no Hancom ground truth exists — see README):`);
console.log(`  parse succeeded on all documents: ${allParseOk} (${N}/${N})`);
console.log(`  total pages rendered: ${totalPages}`);
console.log(`  "no table escapes the page" (README.en.md regression guard), all pages: ` +
  `${!anyOverflow ? "HOLDS" : "VIOLATED"} (max overflow ${maxOverflowPx}px across every page of every document)`);
console.log(`  HWP<->HWPX round-trip preserves page count: ${rtOk}/${N}`);
console.log(`  has_table proxy (rects/page >= ${HAS_TABLE_RPP}): ${hasTable}/${N}`);
console.log(`  has_formula: NOT MEASURED — see README.md ("수식 포함" section)`);
