#!/usr/bin/env bash
# Mirrors the 604-page Mushaf line-layout dataset (zonetecde/mushaf-layout)
# into ./mushaf-layout/ in this repo, so the Quran tab depends on files you
# host yourself instead of a live fetch to a small third-party GitHub repo.
#
# Usage: run this once from the root of your quran-flashcards repo, then
# commit the resulting mushaf-layout/ folder.
#
#   chmod +x download-mushaf-layout.sh
#   ./download-mushaf-layout.sh
#
# Safe to re-run: already-downloaded files are skipped, so if some pages
# fail (network hiccup, rate limit) just run it again to pick up the rest.

set -uo pipefail

BASE_URL="https://raw.githubusercontent.com/zonetecde/mushaf-layout/refs/heads/main/mushaf"
OUT_DIR="mushaf-layout"
mkdir -p "$OUT_DIR"

failed=()

for i in $(seq -w 1 604); do
  out="${OUT_DIR}/page-${i}.json"

  # Skip files already downloaded successfully (non-empty).
  if [ -s "$out" ]; then
    continue
  fi

  ok=0
  for attempt in 1 2 3; do
    if curl -sSL --fail "${BASE_URL}/page-${i}.json" -o "$out"; then
      ok=1
      break
    fi
    sleep 1
  done

  if [ "$ok" -eq 1 ]; then
    echo "OK   page-${i}.json"
  else
    echo "FAIL page-${i}.json"
    failed+=("$i")
    rm -f "$out" # don't leave a partial/empty file behind
  fi

  sleep 0.05
done

echo ""
count=$(ls "${OUT_DIR}"/*.json 2>/dev/null | wc -l | tr -d ' ')
echo "Downloaded: ${count} / 604 files in ${OUT_DIR}/"

if [ ${#failed[@]} -gt 0 ]; then
  echo "Failed pages: ${failed[*]}"
  echo "Re-run this script to retry just the missing ones."
  exit 1
fi

echo "All pages downloaded successfully."
