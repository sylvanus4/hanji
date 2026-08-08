#!/usr/bin/env bash
#
# The security scan, run locally.
#
# Same four questions as .github/workflows/security.yml — secrets, vulnerable
# dependencies, known-bad code patterns, licence obligations — so that the
# answer is available before pushing rather than ten minutes after.
#
# Missing tools are reported and skipped rather than fatal. A laptop without
# semgrep installed should still get the dependency answer, and a scan that
# refuses to start is a scan nobody runs.
#
#   tools/security-scan.sh          # everything available
#   tools/security-scan.sh deps     # one section

set -uo pipefail
cd "$(dirname "$0")/.."

only="${1:-all}"
missing=()
failed=()

have() { command -v "$1" >/dev/null 2>&1; }
head() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
skip() { printf '   skipped: %s not installed (%s)\n' "$1" "$2"; missing+=("$1"); }
note() { printf '   %s\n' "$1"; }

run() { # run <label> <command...>
  local label="$1"; shift
  if "$@"; then
    printf '   \033[32mok\033[0m   %s\n' "$label"
  else
    printf '   \033[31mFAIL\033[0m %s\n' "$label"
    failed+=("$label")
  fi
}

if [[ "$only" == all || "$only" == secrets ]]; then
  head "secrets"
  if have gitleaks; then
    # The whole history, not the working tree: a key that was committed and
    # later deleted is still a leaked key.
    run "gitleaks (history)" gitleaks detect --source . --redact --no-banner
  else
    skip gitleaks "brew install gitleaks"
  fi
fi

if [[ "$only" == all || "$only" == deps ]]; then
  head "dependencies"
  if have npm; then
    # Production only. A finding in the build tooling is a finding about this
    # machine, not about anything a user installs.
    run "npm audit (production)" npm audit --omit=dev --audit-level=high
  else
    skip npm "install Node"
  fi

  if have cargo-audit || cargo audit --version >/dev/null 2>&1; then
    run "cargo audit" bash -c 'cd src-tauri && cargo audit'
    note "warnings about the gtk/gdk/atk stack are Linux-only crates;"
    note "the shipped macOS and Windows binaries do not contain them."
  else
    skip cargo-audit "cargo install cargo-audit --locked"
  fi

  if have osv-scanner; then
    run "osv-scanner" osv-scanner --lockfile=package-lock.json \
      --lockfile=src-tauri/Cargo.lock
  else
    skip osv-scanner "https://github.com/google/osv-scanner (CI runs it)"
  fi
fi

if [[ "$only" == all || "$only" == code ]]; then
  head "static analysis"
  if have semgrep; then
    run "semgrep" semgrep scan --error --quiet \
      --config p/typescript --config p/security-audit --config p/secrets \
      src tools
  else
    skip semgrep "pip install semgrep (CI runs it, with CodeQL)"
  fi
fi

if [[ "$only" == all || "$only" == licences ]]; then
  head "licence obligations"
  if have python3; then
    run "licence check" python3 tools/license-report.py --check
  else
    skip python3 "install Python 3"
  fi
fi

printf '\n'
if ((${#missing[@]})); then
  printf 'not run: %s\n' "${missing[*]}"
fi
if ((${#failed[@]})); then
  printf '\033[31mfailed: %s\033[0m\n' "${failed[*]}"
  exit 1
fi
printf '\033[32mno findings from the tools that ran\033[0m\n'
