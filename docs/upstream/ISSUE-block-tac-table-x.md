# Draft upstream issue for edwardkim/rhwp

**Not filed, by decision.** Kept as the written record of the bisect and as the source of the
patch we vendor. If we ever do submit it, this is the text.

---

**Title:** Block-level TAC table shifted right by preceding tab width (regression in v0.7.6, `10c36e23`)

## Summary

Since v0.7.6, a TAC table that is classified as *block* and whose paragraph's first line contains
only tabs is displaced horizontally by the width of those tabs. On a two-column A4 page this pushes
boxed passages out of their column and past the page edge.

Reproduces in the CLI alone — no browser or WASM involved.

## Reproduction

Any Korean civil-service exam paper with boxed passages in a two-column layout. Ours is
`행정학개론(지방행정 포함)(지방9급)-D.hwp`, a public 2026 지방직 9급 paper; happy to attach it or a
reduced case if useful.

```bash
rhwp export-svg '행정학개론(지방행정 포함)(지방9급)-D.hwp' -o out/
```

Then read the `x` of the `<rect>` elements whose `width` is 421.41 (the passage boxes).

## Observed

Page is 971.36px wide. Table widths are identical across every version tested; only `x` moves.

| Build | Table `x` | Rightmost rect edge |
|---|---|---|
| CLI v0.7.3 | 22.7 / 495.1 | 971.4 |
| CLI v0.7.6 | 139.7 / 612.1 | 1034.0 |
| CLI v0.8.2 | 139.7 / 612.1 | 1034.0 |
| `@rhwp/core` 0.8.2 (WASM) | 140.0 / 612.5 | 1034.4 |

The offset is a constant +117.0px, and the rightmost box ends 62.6px beyond the page.

CLI and WASM agree at the same version, so this is not a CLI/WASM path difference.

## Bisect

`git bisect` over the 358 commits between v0.7.3 and v0.7.6 identifies:

```
10c36e23ca121d661c308818e4935807bc20130a
Task #146: TAC 표 선행 텍스트 폭을 inline x 좌표에 반영
```

## Cause

In `compute_tac_leading_width` (`src/renderer/layout.rs`), the `None` arm — reached when the TAC
table is block-classified, so `tac_controls` has no entry — sums every run on line 0 and treats the
total as leading text width:

```rust
None => {
    // block 취급 TAC: 전체 run 합산
    width += estimate_text_width(effective_full, &style);
    char_pos += run_len;
}
```

For these documents line 0 is `["U+0009", "U+0009"]`, measuring 117.00px. Those tabs are paragraph
indentation, not text preceding the table on the same line, so the table inherits a one-inch
offset it should not have.

The comment on the sibling `line0_has_real_text` guard says this branch is meant for Hancom's
table-width filler glyphs (U+F081C). Tabs seem to fall through it because that guard also requires
`c.lines.len() > 1`, and these paragraphs are a single line. (Removing that length condition alone
does not fix it — the tabs are not alphanumeric, so the guard still does not fire.)

## Suggested fix

Skip tab-only runs in the block-classified branch:

```rust
if !effective_full.chars().all(|c| c == '\t') {
    width += estimate_text_width(effective_full, &style);
}
```

Result: table `x` returns to 24.5 / 497.0 and the rightmost rect edge to 971.4, back inside the
page. `cargo test --lib` passes 2933/2933 with the change applied.

## Caveat

We have no Hancom reference renderer, so we cannot claim what the *correct* offset is — only that
the table should not leave its column, and that this file rendered correctly before `10c36e23`.
If tabs are meant to contribute leading in some case we have not hit, the guard likely belongs
somewhere narrower than what we propose. Happy to test any alternative against our sample.

Patch: `rhwp-block-tac-table-x.patch` in this directory.
