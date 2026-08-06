# Vendored dependencies

## rhwp-core

A build of [rhwp](https://github.com/edwardkim/rhwp) **v0.8.2** with one patch applied.

### Why this exists

rhwp v0.7.6 introduced a regression that displaces block-level tables by the width of any tabs
preceding them, pushing boxed passages out of their column and off the page. It affects every
release from v0.7.6 through v0.8.2, including the published `@rhwp/core` npm builds, so there is
no upstream version we can simply pin to.

The bisect, the measurements and the cause are in [`../docs/DECISIONS.md`](../docs/DECISIONS.md)
(D4b). The patch is [`../docs/upstream/rhwp-block-tac-table-x.patch`](../docs/upstream/rhwp-block-tac-table-x.patch).

### Provenance

| | |
|---|---|
| Upstream | `github.com/edwardkim/rhwp` |
| Tag | `v0.8.2` (`9b16aa9e2`) |
| Patch | `docs/upstream/rhwp-block-tac-table-x.patch` (11 insertions, 2 deletions, one file) |
| Built with | `wasm-pack build --target web --release`, wasm-pack 0.15.0 |
| Upstream test suite | `cargo test --lib` — 2933 passed, 0 failed, with the patch applied |
| License | MIT (retained verbatim in `rhwp-core/LICENSE`) |

Versioned `0.8.2-hanji.1` so it can never be confused with a published release.

### Rebuilding

```bash
git clone https://github.com/edwardkim/rhwp && cd rhwp
git checkout v0.8.2
git apply /path/to/hanji/docs/upstream/rhwp-block-tac-table-x.patch
CARGO_NET_GIT_FETCH_WITH_CLI=true wasm-pack build --target web --release
cp pkg/{rhwp.js,rhwp_bg.wasm,rhwp.d.ts,rhwp_bg.wasm.d.ts,LICENSE} /path/to/hanji/vendor/rhwp-core/
```

`CARGO_NET_GIT_FETCH_WITH_CLI=true` is required — rhwp depends on a git repository over SSH and
cargo's built-in fetcher fails to authenticate. The release build takes roughly four minutes.

Keep `package.json`'s `version` field; the copy step above deliberately does not overwrite it.

### Retiring this

If the fix lands upstream, delete this directory and change the dependency in `package.json` back
to a normal version range. `e2e-smoke.py` asserts the table geometry, so a regression on the way
back out would fail the build rather than pass silently.
