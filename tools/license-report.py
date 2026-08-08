#!/usr/bin/env python3
"""Build THIRD_PARTY_LICENSES.md from what is actually installed.

Written rather than hand-maintained because a hand-written notice file is
accurate on the day it is written and wrong by the next dependency bump, and
the failure is silent: nothing breaks, the notice simply stops describing the
thing being shipped.

Two trees are walked, and only the parts that reach a user:

  npm   — production dependencies only. Vite, TypeScript and the Tauri CLI
          build the app and are not in it, so listing them would overstate what
          is being distributed.
  cargo — the desktop shell's dependency graph. Only relevant to the packaged
          binaries; the web build ships no Rust.

The licence *text* is copied in, not just the identifier. Apache-2.0 requires
recipients to receive a copy of the licence, and "Apache-2.0" written in a table
is not a copy of it.

    python3 tools/license-report.py            # write THIRD_PARTY_LICENSES.md
    python3 tools/license-report.py --check    # fail if anything is copyleft
                                               # or unidentified
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys
from dataclasses import dataclass, field

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "THIRD_PARTY_LICENSES.md"

# Two very different situations, kept apart because collapsing them produces
# either false alarms or false comfort.
#
# BLOCKING would change what this project may be: strong copyleft reaches the
# whole work, and the non-commercial and source-available terms are not open
# source at all. None are present. The list exists to notice the day one
# arrives, which is otherwise discovered by somebody else's lawyer.
BLOCKING = re.compile(
    r"\b(A?GPL-[\d.]+|GPL-[\d.]+|SSPL|BUSL|CC-BY-NC|Commons-Clause|"
    r"Elastic-2\.0|PolyForm)", re.IGNORECASE,
)
# RECIPROCAL is per-file copyleft. It permits distribution inside a larger work
# under other terms, and in exchange the covered files stay under their own
# licence and their source has to remain available to recipients. That is an
# obligation to document, not a reason to remove the dependency — and left
# undocumented it is the most commonly missed one in a notice file.
RECIPROCAL = re.compile(r"\b(MPL-[\d.]+|EPL-[\d.]+|CDDL-[\d.]+|LGPL-[\d.]+)",
                        re.IGNORECASE)
# The platforms the desktop app is actually built for. Without this filter the
# graph is every crate any dependency could pull in on any target: it listed a
# UEFI-only crate whose third licence option is LGPL, which is not compiled into
# anything we ship and would have been a fabricated obligation.
TARGETS = ("aarch64-apple-darwin", "x86_64-apple-darwin", "x86_64-pc-windows-msvc")
# The Rust ecosystem states dual licences as OR expressions. Splitting on them
# keeps "Apache-2.0 OR MIT" from being read as one exotic licence.
SPLIT = re.compile(r"\s+(?:OR|AND)\s+|\s*/\s*", re.IGNORECASE)

LICENSE_FILE_NAMES = (
    "LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md",
    "LICENSE-MIT", "LICENSE-APACHE", "COPYING", "NOTICE", "OFL.txt",
)


@dataclass
class Package:
    name: str
    version: str
    license: str
    ecosystem: str
    homepage: str = ""
    texts: dict[str, str] = field(default_factory=dict)

    @property
    def ids(self) -> list[str]:
        return [p.strip("() ") for p in SPLIT.split(self.license) if p.strip("() ")]


def read_license_texts(directory: pathlib.Path) -> dict[str, str]:
    """Collect licence files sitting next to a package."""
    found: dict[str, str] = {}
    if not directory.is_dir():
        return found
    for entry in sorted(directory.iterdir()):
        if not entry.is_file():
            continue
        stem = entry.name
        if stem in LICENSE_FILE_NAMES or stem.upper().startswith("LICENSE"):
            try:
                text = entry.read_text(encoding="utf-8", errors="replace").strip()
            except OSError:
                continue
            # Long enough to be a licence rather than a one-line pointer.
            if len(text) > 200:
                found[stem] = text
    return found


def npm_packages() -> list[Package]:
    """Production npm dependencies, from the installed tree."""
    raw = subprocess.run(
        ["npm", "ls", "--omit=dev", "--all", "--json", "--long"],
        cwd=ROOT, capture_output=True, text=True,
    ).stdout
    tree = json.loads(raw or "{}")

    seen: dict[tuple[str, str], Package] = {}

    def walk(node: dict) -> None:
        for name, info in (node.get("dependencies") or {}).items():
            version = info.get("version", "")
            key = (name, version)
            if key not in seen:
                where = info.get("path") or str(ROOT / "node_modules" / name)
                # A vendored dependency is a symlink into the repository; its
                # licence lives with the vendored copy, which is the whole point
                # of vendoring it under a licence that permits modification.
                directory = pathlib.Path(where).resolve()
                seen[key] = Package(
                    name=name,
                    version=version,
                    license=str(info.get("license") or "UNKNOWN"),
                    ecosystem="npm",
                    homepage=str(info.get("homepage") or ""),
                    texts=read_license_texts(directory),
                )
            walk(info)

    walk(tree)
    return sorted(seen.values(), key=lambda p: p.name.lower())


def cargo_packages() -> list[Package]:
    """Rust crates in the desktop shell's dependency graph."""
    tauri = ROOT / "src-tauri"
    if not (tauri / "Cargo.toml").exists():
        return []

    # The union across shipping targets, because a crate compiled only on
    # Windows is still distributed — to Windows users.
    out: dict[tuple[str, str], Package] = {}
    for target in TARGETS:
        meta = subprocess.run(
            ["cargo", "metadata", "--format-version", "1",
             "--filter-platform", target],
            cwd=tauri, capture_output=True, text=True,
        )
        if meta.returncode != 0:
            print(f"  cargo metadata ({target}) unavailable: "
                  f"{meta.stderr.strip()[:160]}", file=sys.stderr)
            continue
        data = json.loads(meta.stdout)
        # resolve.nodes is the graph cargo would actually build; the flat
        # package list includes crates no feature set of ours enables.
        wanted = {node["id"] for node in data.get("resolve", {}).get("nodes", [])}
        for pkg in data["packages"]:
            if pkg["id"] not in wanted or pkg["name"] == "hanji":
                continue
            key = (pkg["name"], pkg["version"])
            if key in out:
                continue
            out[key] = Package(
                name=pkg["name"],
                version=pkg["version"],
                license=str(pkg.get("license") or "UNKNOWN"),
                ecosystem="cargo",
                homepage=str(pkg.get("repository") or ""),
                texts=read_license_texts(pathlib.Path(pkg["manifest_path"]).parent),
            )
    return sorted(out.values(), key=lambda p: p.name.lower())


def summarise(packages: list[Package]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for pkg in packages:
        for one in pkg.ids:
            counts[one] = counts.get(one, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))


def blocking(packages: list[Package]) -> list[Package]:
    """Licences that would change what this project may be, plus unknowns.

    A dual licence is only blocking if *every* option is. `MIT OR Apache-2.0 OR
    LGPL-2.1-or-later` offers two perfectly ordinary choices, and reading it as
    an LGPL obligation invents one.
    """
    out = []
    for p in packages:
        if p.license.upper() == "UNKNOWN":
            out.append(p)
        elif p.ids and all(BLOCKING.search(one) for one in p.ids):
            out.append(p)
    return out


def reciprocal(packages: list[Package]) -> list[Package]:
    """Per-file copyleft: distributable, but it has to be disclosed."""
    return [
        p for p in packages
        if p.ids and all(RECIPROCAL.search(one) for one in p.ids)
    ]


def render(npm: list[Package], cargo: list[Package]) -> str:
    lines: list[str] = []
    add = lines.append

    add("# Third-party licences")
    add("")
    add("hanji's own source is MIT. It is distributed together with the")
    add("components listed here, which carry their own licences and their own")
    add("obligations — most relevantly pdf.js under Apache-2.0 and the Noto")
    add("fonts under the SIL Open Font License. \"hanji is MIT\" describes this")
    add("repository, not everything inside the installer.")
    add("")
    add("This file is generated. Run `python3 tools/license-report.py` after")
    add("changing a dependency; a notice file maintained by hand goes stale")
    add("silently, which is the only way this kind of file ever fails.")
    add("")

    for title, packages, note in (
        (
            "JavaScript dependencies",
            npm,
            "The production npm tree. Build tooling — Vite, TypeScript, the "
            "Tauri CLI — is excluded because it is not distributed. The tree is "
            "listed in full rather than narrowed to what a bundler keeps: some "
            "entries here are optional native binaries that a dependency offers "
            "for Node and that no browser build can contain, and over-listing "
            "is the safe direction for a notice file.",
        ),
        (
            "Compiled into the desktop binaries",
            cargo,
            "Rust crates in the desktop shell's dependency graph. The browser "
            "build contains none of these.",
        ),
    ):
        if not packages:
            continue
        add(f"## {title}")
        add("")
        add(note)
        add("")
        add("| Package | Version | Licence |")
        add("|---|---|---|")
        for pkg in packages:
            add(f"| `{pkg.name}` | {pkg.version} | {pkg.license} |")
        add("")
        counts = summarise(packages)
        add("Licences in use: "
            + ", ".join(f"{name} ({n})" for name, n in counts.items())
            + ".")
        add("")

    shared = reciprocal(npm + cargo)
    if shared:
        add("## Components under a reciprocal licence")
        add("")
        add("These carry per-file copyleft. They may be distributed inside a")
        add("larger work under other terms, and in exchange the covered files")
        add("stay under their own licence and their source must remain")
        add("available to anyone who receives this software.")
        add("")
        add("They are used unmodified, exactly as published. The source of each")
        add("is the published release named below, which is the copy this")
        add("notice points recipients to.")
        add("")
        add("| Package | Version | Licence | Source |")
        add("|---|---|---|---|")
        for pkg in shared:
            where = pkg.homepage or (
                f"https://crates.io/crates/{pkg.name}/{pkg.version}"
                if pkg.ecosystem == "cargo"
                else f"https://www.npmjs.com/package/{pkg.name}/v/{pkg.version}"
            )
            add(f"| `{pkg.name}` | {pkg.version} | {pkg.license} | {where} |")
        add("")

    # Full texts, deduplicated. Ninety copies of the MIT licence would bury the
    # one Apache-2.0 text that actually has to be reproduced.
    add("## Licence texts")
    add("")
    add("One copy of each distinct text, with the components it covers. Where a")
    add("component ships its own copyright line, that copy is the one kept.")
    add("")

    texts: dict[str, list[str]] = {}
    for pkg in npm + cargo:
        for filename, body in pkg.texts.items():
            texts.setdefault(body.strip(), []).append(f"{pkg.name} ({filename})")

    for body, owners in sorted(texts.items(), key=lambda kv: -len(kv[1])):
        first = owners[0].split(" (")[0]
        add(f"### {first}" + (f" and {len(owners) - 1} others" if len(owners) > 1 else ""))
        add("")
        add("<details><summary>Covers: " + ", ".join(sorted(owners)) + "</summary>")
        add("")
        add("```")
        add(body)
        add("```")
        add("")
        add("</details>")
        add("")

    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true",
                        help="exit non-zero on copyleft or unidentified licences")
    args = parser.parse_args()

    print("reading npm tree…", file=sys.stderr)
    npm = npm_packages()
    print(f"  {len(npm)} production packages", file=sys.stderr)
    print("reading cargo graph…", file=sys.stderr)
    cargo = cargo_packages()
    print(f"  {len(cargo)} crates", file=sys.stderr)

    stop = blocking(npm + cargo)
    share = reciprocal(npm + cargo)

    for pkg in share:
        print(f"  notice required  {pkg.ecosystem}:{pkg.name}@{pkg.version} "
              f"-> {pkg.license}", file=sys.stderr)
    for pkg in stop:
        print(f"  BLOCKING  {pkg.ecosystem}:{pkg.name}@{pkg.version} "
              f"-> {pkg.license}", file=sys.stderr)

    if args.check:
        # Reciprocal licences do not fail the check: they are disclosed in the
        # generated file, which is the obligation. Failing on them would train
        # everyone to pass --no-verify.
        if stop:
            print(f"{len(stop)} package(s) need a human decision", file=sys.stderr)
            return 1
        print(f"no blocking licences; {len(share)} reciprocal component(s) "
              f"disclosed", file=sys.stderr)
        return 0

    OUT.write_text(render(npm, cargo), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}", file=sys.stderr)
    return 1 if stop else 0


if __name__ == "__main__":
    sys.exit(main())
