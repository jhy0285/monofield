#!/usr/bin/env bash
# Scan a Git repository before and after each given commit and classify the difference with MonoField's own
# compatibility comparison, one report per commit.
#   replay_commits.sh <repo> <out-dir> <commit>...
# Needs python3 and, from the MonoField checkout, `pnpm install` and a built @open-design/contracts.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
monofield="$(cd "$here/../../../../.." && pwd)"
scan="$monofield/plugins/_official/interface-spec/scripts/scan_spring.py"
repo="$(cd "$1" && pwd)"; mkdir -p "$2"; out="$(cd "$2" && pwd)"; shift 2  # absolute: the comparison runs from the checkout
for commit in "$@"; do
  for side in before after; do
    rev="$commit"; [ "$side" = before ] && rev="$commit^"
    dir="$out/$commit/$side"; rm -rf "$dir"; mkdir -p "$dir"
    git -C "$repo" archive "$rev" src/main | tar -x -C "$dir"
    python3 "$scan" --codebase-path "$dir" --codebase-name replay --out "$out/$commit/$side.json" > /dev/null
  done
  (cd "$monofield" && pnpm exec tsx e2e/scripts/abt-compare.ts "$out/$commit/before.json" "$out/$commit/after.json" "$out/$commit/report.json" > /dev/null)
  rm -rf "$out/$commit/before" "$out/$commit/after"
  python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(sys.argv[2], r['level'], r['counts'])" "$out/$commit/report.json" "$commit"
done
