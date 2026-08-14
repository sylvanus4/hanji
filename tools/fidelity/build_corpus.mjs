#!/usr/bin/env node
/**
 * Fidelity corpus — selection pass (P0-c).
 *
 * Turns the local discovery index (docs/fidelity/discovery.local.json, built
 * by discover.mjs — real filenames, never committed) into the two files that
 * downstream tooling and the repo actually carry:
 *
 *   - docs/fidelity/corpus-manifest.json   (COMMITTED) — id, sha256, byte
 *     size, source extension, and axis tags only. No filename, no path, no
 *     document text.
 *   - docs/fidelity/corpus-paths.local.json (gitignored, *.local.json) — id
 *     -> absolute path, so the harness can be re-run on this machine. This
 *     mirrors the existing e2e-smoke.py convention: real documents are
 *     supplied at run time via a local path, never checked in (see its
 *     "Fixtures are supplied rather than committed" comment).
 *
 * The selection below is a deliberate editorial pass over 294 discovered
 * .hwp/.hwpx files, not a mechanical top-N. It is written out explicitly
 * (by sha256, not by trusting discovery order) so the reasoning survives
 * even though the filenames that motivated it cannot be committed:
 *
 *   - 256 of 294 are rhwp's own regression-test fixtures (re-*, tac-*,
 *     lseg-*, template/, blank-*, empty*, footnote-01, table-vpos-01, ...) —
 *     synthetic single-feature probes, never a document that circulated for
 *     a real purpose. Excluded outright by discover.mjs's fixture heuristic.
 *   - Two more are personal/family documents (a child's school essay, a
 *     personal idea note) that carry no business relevance to any axis this
 *     task asks about — excluded for privacy, not because they failed a
 *     content test.
 *   - A handful more are excluded for ambiguous provenance: they read as
 *     rhwp/rhwp-studio *demo* samples (a business-plan template and a
 *     78-page sample shipped in rhwp-studio's own public demo folder) or
 *     have filenames that pattern-match rhwp's own test-fixture naming
 *     convention closely enough (`task-001`, `hwpers_test4_...`) that
 *     calling them "real circulated documents" would be asserting more than
 *     is known. Also excluded: two of three near-duplicate saves of the
 *     same promotional document, and one of two byte-identical duplicate
 *     copies of the same 사업계획서 attachment — kept once each so the
 *     corpus is not padded with near-identical entries.
 *
 * What's left is 25 documents that are, with reasonable confidence, real:
 * government tenant-recruitment notices, government trade-statistics press
 * releases (one of them present as BOTH .hwp and .hwpx — the same real
 * content in both formats hanji converts between), a government fiscal-
 * statistics series, a government program-status report, an official
 * attached form (별지 서식) and a tax-refund claim form, a standard
 * business contract, a corporate charter (정관), two 9급 공무원 civil-
 * service exam papers, a public-works RFP, and a set of real technical API
 * / file-format specification documents (dense tables, up to 178 pages).
 *
 * Usage:
 *   node tools/fidelity/build_corpus.mjs docs/fidelity/discovery.local.json
 */
import fs from "node:fs";
import path from "node:path";

const discoveryPath = process.argv[2] || "docs/fidelity/discovery.local.json";
const discovery = JSON.parse(fs.readFileSync(discoveryPath, "utf8"));
const bySha = new Map(discovery.files.map((f) => [f.sha256, f]));

/**
 * axes:
 *   gov       — 공문서: government-issued notice, press release, statistics,
 *               program-status report.
 *   exam      — 시험지: real 9급 공무원 civil-service exam preparation
 *               material.
 *   form      — 서식/양식: an official attached form or claim form, i.e. a
 *               fill-in template with legal/administrative standing.
 *   contract  — a real signed-type legal document (contract, corporate
 *               charter) that is not itself a government form.
 *   tech_doc  — real technical documentation (API reference, file-format
 *               spec) — not one of the task's named axes, kept because it
 *               is real, dense in tables, and stresses the engine hard
 *               (up to 178 pages / 3,340 rects).
 *   rfp       — a real request-for-proposal document.
 * has_table_proxy is filled in from tools/fidelity/measure.mjs output, not
 * guessed here — see docs/fidelity/README.md for the exact threshold.
 */
// Notes are deliberately generic category descriptions in English, not the
// document's own title: several real titles name a specific company,
// agency office, or product. Reproducing a real title verbatim in a
// committed file is exactly the "document text" the hard rule about this
// corpus says to keep out, even when the title itself is a few words.
const SELECTION = [
  { sha256: "0c3049856e", axes: ["gov", "form"], note: "government startup-support program application form template (one of two byte-identical copies found on disk, kept once)" },
  { sha256: "5e6d0eed33", axes: ["gov", "form"], note: "official attached form (별지 서식), citing its statutory basis in the title" },
  { sha256: "8e284432fd", axes: ["contract"], note: "standard advisory services contract" },
  { sha256: "972b5a8838", axes: ["exam"], note: "9th-grade (지방9급) civil-service exam prep paper — administrative law" },
  { sha256: "276fa46e79", axes: ["exam"], note: "9th-grade (지방9급) civil-service exam prep paper — public administration" },
  { sha256: "0eb28a32e0", axes: ["gov"], note: "government tenant-recruitment public notice, agency A" },
  { sha256: "f16051c56c", axes: ["gov"], note: "government tenant-recruitment public notice, agency B" },
  { sha256: "e1ddaae4e1", axes: ["gov"], note: "government tenant-recruitment public notice, agency C" },
  { sha256: "98798e60e2", axes: ["contract"], note: "corporate charter (정관 / articles of incorporation)" },
  { sha256: "c0742e0dd4", axes: ["gov", "form"], note: "local-tax refund claim form" },
  { sha256: "33b62742f5", axes: ["gov"], note: "government program participating-institution status report" },
  { sha256: "d11dd13310", axes: ["tech_doc"], note: "real technical API reference document, part 1 of 3 (105 pages, table-dense — stress test)" },
  { sha256: "7076cb9bf6", axes: ["tech_doc"], note: "real technical API reference document, part 2 of 3" },
  { sha256: "76645c03f0", axes: ["tech_doc"], note: "real technical API reference document, part 3 of 3 (73 pages)" },
  { sha256: "64df877f3c", axes: ["tech_doc"], note: "real published file-format specification document (178 pages — largest in the corpus)" },
  { sha256: "e17464a151", axes: ["gov"], note: "government quarterly trade-statistics press release, .hwp — pairs with the next entry" },
  { sha256: "8be6e93134", axes: ["gov"], note: "the same release as the entry above, distributed as .hwpx — a same-content HWP/HWPX pair" },
  { sha256: "54f25292bd", axes: ["gov"], note: "government quarterly trade-statistics press release (different quarter)" },
  { sha256: "abae7aebec", axes: ["gov"], note: "government annual trade-statistics press release" },
  { sha256: "d247282733", axes: ["gov"], note: "government quarterly trade-statistics press release (different quarter)" },
  { sha256: "e49c69c090", axes: ["gov"], note: "government quarterly trade-statistics press release (different quarter)" },
  { sha256: "1b4d1169c8", axes: ["rfp"], note: "real public-works request-for-proposal document (27 pages)" },
  { sha256: "d785f1ba52", axes: ["gov"], note: "government consolidated fiscal-statistics report, period A" },
  { sha256: "18b094a33b", axes: ["gov"], note: "government consolidated fiscal-statistics report, period B" },
  { sha256: "8e21dc8d51", axes: ["gov"], note: "government consolidated fiscal-statistics report, period C" },
];

const manifest = [];
const localPaths = {};

SELECTION.forEach((sel, i) => {
  const full = [...bySha.keys()].find((h) => h.startsWith(sel.sha256));
  if (!full) {
    console.error(`sha256 prefix ${sel.sha256} not found in discovery index — re-run discover.mjs?`);
    process.exit(1);
  }
  const f = bySha.get(full);
  const id = `doc-${String(i + 1).padStart(3, "0")}`;
  manifest.push({
    id,
    sha256: full,
    byteSize: f.byteSize,
    ext: f.ext,
    axes: sel.axes,
    selectionNote: sel.note,
  });
  localPaths[id] = f.path;
});

fs.mkdirSync("docs/fidelity", { recursive: true });
fs.writeFileSync(
  "docs/fidelity/corpus-manifest.json",
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      count: manifest.length,
      description:
        "Fidelity corpus for P0-c (see docs/fidelity/README.md). Real HWP/HWPX documents, " +
        "identified by content hash only — no filenames or document text are stored here.",
      documents: manifest,
    },
    null,
    2,
  ),
);
fs.writeFileSync("docs/fidelity/corpus-paths.local.json", JSON.stringify(localPaths, null, 2));

console.log(`wrote docs/fidelity/corpus-manifest.json (${manifest.length} documents)`);
console.log("wrote docs/fidelity/corpus-paths.local.json (gitignored, local-only)");
